import { createSession } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { verifyRegistration } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => {
  const result = await verifyRegistration(event, await readBody(event))
  if (!result.invitationId) throw createError({ statusCode: 400, statusMessage: '招待情報が見つかりません。' })
  await db(event).batch([
    db(event).prepare("UPDATE users SET status='active' WHERE id=?").bind(result.userId),
    db(event).prepare('UPDATE invitations SET used_at=? WHERE id=?').bind(new Date().toISOString(), result.invitationId),
  ])
  await createSession(event, result.userId)
  return { ok: true }
})
