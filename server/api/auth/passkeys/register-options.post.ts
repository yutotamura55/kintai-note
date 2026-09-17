import { currentUser } from '~~/server/utils/auth'
import { registrationOptions } from '~~/server/utils/webauthn'
export default defineEventHandler(async (event) => registrationOptions(event, await currentUser(event)))
