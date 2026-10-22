import { createSession } from '~~/server/utils/auth'
import { verifyRegistration } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => {
  const result = await verifyRegistration(event, await readBody(event), 'invitation')
  await createSession(event, result.userId)
  return { ok: true }
})
