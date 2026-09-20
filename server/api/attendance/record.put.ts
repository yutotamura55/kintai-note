import { currentUser } from '~~/server/utils/auth'
import { ownedAttendance, saveAttendanceTimes } from '~~/server/utils/attendance'
import { japanDateTime, parseJapanDateTime } from '~~/shared/utils/attendance'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{ id?: string, clockIn?: string | null, clockOut?: string | null, breakMinutes?: number | string | null }>(event)
  const record = await ownedAttendance(event, user.id, body?.id)

  // Retain support for old, already-open clients sending HH:MM. Never infer "next day".
  const parse = (value: unknown, previous: string | null) => {
    if (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value)) {
      value = `${previous ? japanDateTime(previous).slice(0, 10) : record.work_date}T${value}`
    }
    const parsed = parseJapanDateTime(value)
    // datetime-local has minute precision; preserve seconds on unchanged fields.
    return previous && parsed && japanDateTime(previous) === japanDateTime(parsed) ? previous : parsed
  }
  let clockInAt: string | null; let clockOutAt: string | null
  try { clockInAt = parse(body?.clockIn, record.clock_in_at); clockOutAt = parse(body?.clockOut, record.clock_out_at) }
  catch (cause) { throw createError({ statusCode: 400, statusMessage: cause instanceof Error ? cause.message : '正しい日時を入力してください。' }) }
  if (record.break_started_at && clockOutAt && clockOutAt < record.break_started_at) {
    throw createError({ statusCode: 400, statusMessage: '退勤時刻は休憩開始時刻より後にしてください。' })
  }

  let breakMinutes: number | null | undefined = undefined
  if (body && 'breakMinutes' in body) {
    if (body.breakMinutes === null || body.breakMinutes === '' || body.breakMinutes === undefined) {
      breakMinutes = null
    } else {
      const parsed = Number(body.breakMinutes)
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        throw createError({ statusCode: 400, statusMessage: '休憩時間は0分以上の整数で入力してください。' })
      }
      // Preserve punch accumulation mode if unchanged from original punches
      if (record.break_minutes === null && parsed === Math.floor((record.total_break_seconds || 0) / 60)) {
        breakMinutes = null
      } else {
        breakMinutes = parsed
      }
    }
  }

  await saveAttendanceTimes(event, user.id, record, clockInAt, clockOutAt, breakMinutes)
  return { ok: true }
})
