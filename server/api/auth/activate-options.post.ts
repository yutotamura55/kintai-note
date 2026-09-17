import { db, sha256 } from '~~/server/utils/db'
import { registrationOptions } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => {
  const { token } = await readBody<{ token: string }>(event)
  const invitation = await db(event).prepare(`SELECT i.id invitation_id, u.id, u.employee_code, u.display_name FROM invitations i JOIN users u ON u.id=i.user_id
    WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND u.status='invited'`).bind(await sha256(token || ''), new Date().toISOString()).first<any>()
  if (!invitation) throw createError({ statusCode: 404, statusMessage: '招待URLが無効、使用済み、または期限切れです。' })
  return registrationOptions(event, invitation, invitation.invitation_id)
})
