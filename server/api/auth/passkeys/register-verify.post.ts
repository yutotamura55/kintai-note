import { verifyRegistration } from '~~/server/utils/webauthn'
import { createSession, requireAuthAttempt } from '~~/server/utils/auth'
export default defineEventHandler(async (event) => {
  await requireAuthAttempt(event, 'verification')
  const result = await verifyRegistration(event, await readBody(event), 'account')
  await createSession(event, result.userId)
  return { ok: true }
})
