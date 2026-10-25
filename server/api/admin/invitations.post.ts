import { requireAdmin } from '~~/server/utils/auth'
import { db, id, plusMinutes, sha256 } from '~~/server/utils/db'
import { d1AuthRepository } from '~~/server/utils/auth-repository'

export default defineEventHandler(async (event) => {
  await requireAdmin(event)
  const body = await readBody<{ employeeCode: string; displayName: string }>(event)
  if (!body?.employeeCode?.trim() || !body.displayName?.trim())
    throw createError({ statusCode: 400, statusMessage: '社員番号と表示名を入力してください。' })
  const userId = id()
  const invitationId = id()
  const token = crypto.randomUUID() + crypto.randomUUID()
  await d1AuthRepository(db(event)).createInvitation({
    invitationId,
    userId,
    employeeCode: body.employeeCode.trim(),
    displayName: body.displayName.trim(),
    tokenHash: await sha256(token),
    expiresAt: plusMinutes(60 * 24 * 7),
  })
  return { invitationUrl: `${getRequestURL(event).origin}/activate/${token}`, expiresAt: plusMinutes(60 * 24 * 7) }
})
