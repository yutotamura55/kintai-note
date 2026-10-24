import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { recordPunch } from '~~/server/utils/attendance-punch'
import type { AttendanceAction } from '~~/shared/utils/attendance'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const { action, recordId } = await readBody(event) || {}
  if (!['in', 'out', 'break_start', 'break_end'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: '不正な打刻です。' })
  }
  await recordPunch(db(event), user.id, action as AttendanceAction, recordId, new Date())
  return { ok: true }
})
