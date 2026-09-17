import { destroySession } from '~~/server/utils/auth'
export default defineEventHandler(event => { destroySession(event); return { ok: true } })
