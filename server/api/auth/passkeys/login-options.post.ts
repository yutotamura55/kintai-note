import { loginOptions } from '~~/server/utils/webauthn'
export default defineEventHandler(event => loginOptions(event))
