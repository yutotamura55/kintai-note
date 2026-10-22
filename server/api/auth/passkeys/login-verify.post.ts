import { createSession, requireAuthAttempt } from '~~/server/utils/auth'
import { verifyLogin } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => {
  await requireAuthAttempt(event, 'verification')
  const userId = await verifyLogin(event, await readBody(event))
  await createSession(event, userId)
  return { ok: true }
})
