import { createSession } from '~~/server/utils/auth'
import { verifyLogin } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => {
  const userId = await verifyLogin(event, await readBody(event))
  await createSession(event, userId)
  return { ok: true }
})
