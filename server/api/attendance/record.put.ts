import { currentUser } from '~~/server/utils/auth'
import { db, isoNow } from '~~/server/utils/db'
import { japanDateTime, parseJapanDateTime, type AttendanceRecord } from '~~/shared/utils/attendance'

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{ id?: string, clockIn?: string | null, clockOut?: string | null }>(event)
  if (typeof body?.id !== 'string' || !body.id) throw createError({ statusCode: 400, statusMessage: '編集対象の記録が見つかりません。' })

  const record = await db(event).prepare('SELECT * FROM attendance_records WHERE id=? AND user_id=?').bind(body.id, user.id).first<AttendanceRecord>()
  if (!record) throw createError({ statusCode: 404, statusMessage: '編集対象の記録が見つかりません。' })

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
  try { clockInAt = parse(body.clockIn, record.clock_in_at); clockOutAt = parse(body.clockOut, record.clock_out_at) }
  catch (cause) { throw createError({ statusCode: 400, statusMessage: cause instanceof Error ? cause.message : '正しい日時を入力してください。' }) }
  if (!clockInAt) throw createError({ statusCode: 400, statusMessage: '出勤時刻を入力してください。' })
  if (clockOutAt && clockOutAt <= clockInAt) throw createError({ statusCode: 400, statusMessage: '退勤時刻は出勤時刻より後にしてください。' })

  const result = await db(event).prepare(`UPDATE attendance_records SET clock_in_at=?1, clock_out_at=?2, updated_at=?3
    WHERE id=?4 AND user_id=?5 AND (?2 IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM attendance_records WHERE user_id=?5 AND id<>?4 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
    ))`).bind(clockInAt, clockOutAt, isoNow(), record.id, user.id).run()
  if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: 'ほかに未退勤の勤務があるため、この記録を未退勤にはできません。' })
  return { ok: true }
})
