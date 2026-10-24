import { db, sha256 } from '~~/server/utils/db'
import { d1AuthRepository } from '~~/server/utils/auth-repository'
import { registrationOptions } from '~~/server/utils/webauthn'
import { requireAuthAttempt } from '~~/server/utils/auth'
export default defineEventHandler(async (event) => {
  await requireAuthAttempt(event, 'invitation')
  const { token } = await readBody<{ token: string }>(event)
  const invitation = await d1AuthRepository(db(event)).findUsableInvitation(await sha256(token || ''), new Date().toISOString())
  if (!invitation) throw createError({ statusCode: 404, statusMessage: '招待URLが無効、使用済み、または期限切れです。' })
  return registrationOptions(event, invitation, invitation.invitation_id)
})
