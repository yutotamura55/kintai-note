import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { editAttendanceTimes, findOwnedAttendance } from '~~/server/utils/attendance-edit'
import { attendanceEditError } from '~~/server/utils/attendance-edit-errors'
import { d1AttendanceRepository } from '~~/server/utils/attendance-repository'
import { japanDateTime, parseJapanDateTime } from '~~/shared/utils/attendance'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{
    id?: string
    clockIn?: string | null
    clockOut?: string | null
    breakMinutes?: number | string | null
  }>(event)
  const repository = d1AttendanceRepository(db(event))
  const owned = await findOwnedAttendance(repository, user.id, body?.id)
  if (!owned.ok) throw attendanceEditError(owned.reason)
  const { record } = owned

  // Retain support for old, already-open clients sending HH:MM. Never infer "next day".
  const parse = (value: unknown, previous: string | null) => {
    if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
      value = `${previous ? japanDateTime(previous).slice(0, 10) : record.work_date}T${value}`
    }
    const parsed = parseJapanDateTime(value)
    // datetime-local has minute precision; preserve seconds on unchanged fields.
    return previous && parsed && japanDateTime(previous) === japanDateTime(parsed) ? previous : parsed
  }
  let clockInAt: string | null
  let clockOutAt: string | null
  try {
    clockInAt = parse(body?.clockIn, record.clock_in_at)
    clockOutAt = parse(body?.clockOut, record.clock_out_at)
  } catch (cause) {
    throw createError({
      statusCode: 400,
      statusMessage: cause instanceof Error ? cause.message : '正しい日時を入力してください。',
    })
  }
  // A JSON body cannot hold undefined, so a present breakMinutes is passed as a value or null.
  const requestedBreak = body && 'breakMinutes' in body ? (body.breakMinutes ?? null) : undefined
  const result = await editAttendanceTimes(
    repository,
    user.id,
    record,
    clockInAt,
    clockOutAt,
    requestedBreak,
    new Date(),
  )
  if (!result.ok) throw attendanceEditError(result.reason)
  return { ok: true }
})
