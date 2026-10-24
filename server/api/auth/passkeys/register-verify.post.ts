import { verifyRegistration } from '~~/server/utils/webauthn'
import { createSession } from '~~/server/utils/auth'
export default defineEventHandler(async (event) => {
  const result = await verifyRegistration(event, await readBody(event), 'account')
  await createSession(event, result.userId)
  return { ok: true }
})
