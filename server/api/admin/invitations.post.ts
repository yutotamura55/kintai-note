import { requireAdmin } from '~~/server/utils/auth'
import { db, id, plusMinutes, sha256 } from '~~/server/utils/db'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ employeeCode: string; displayName: string }>(event)
  if (!body?.employeeCode?.trim() || !body.displayName?.trim()) throw createError({ statusCode: 400, statusMessage: '社員番号と表示名を入力してください。' })
  const userId = id(); const invitationId = id(); const token = crypto.randomUUID() + crypto.randomUUID()
  await db(event).batch([
    db(event).prepare("INSERT INTO users (id, employee_code, display_name) VALUES (?, ?, ?)").bind(userId, body.employeeCode.trim(), body.displayName.trim()),
    db(event).prepare('INSERT INTO invitations (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').bind(invitationId, userId, await sha256(token), plusMinutes(60 * 24 * 7)),
  ])
  return { invitationUrl: `${getRequestURL(event).origin}/activate/${token}`, expiresAt: plusMinutes(60 * 24 * 7) }
})
