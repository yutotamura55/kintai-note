import { currentUser } from '~~/server/utils/auth'
export default defineEventHandler(async event => currentUser(event))
