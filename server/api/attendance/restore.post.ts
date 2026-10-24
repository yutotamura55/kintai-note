import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { restoreAttendanceTimes } from '~~/server/utils/attendance-edit'
import { attendanceEditError } from '~~/server/utils/attendance-edit-errors'
import { d1AttendanceRepository } from '~~/server/utils/attendance-repository'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{ id?: string }>(event)
  const result = await restoreAttendanceTimes(d1AttendanceRepository(db(event)), user.id, body?.id, new Date())
  if (!result.ok) throw attendanceEditError(result.reason)
  return { ok: true }
})
