import { currentUser } from '~~/server/utils/auth'
import { ownedAttendance, saveAttendanceTimes } from '~~/server/utils/attendance'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{ id?: string }>(event)
  const record = await ownedAttendance(event, user.id, body?.id)
  if (!record.original_clock_in_at && !record.original_clock_out_at && record.break_minutes === null) {
    throw createError({ statusCode: 409, statusMessage: '元の打刻時刻が保存されていないため、復元できません。' })
  }
  // Only use trusted stored originals. Unknown fields keep their current value.
  await saveAttendanceTimes(event, user.id, record,
    record.original_clock_in_at ?? record.clock_in_at,
    record.original_clock_out_at ?? record.clock_out_at,
    null)
  return { ok: true }
})
