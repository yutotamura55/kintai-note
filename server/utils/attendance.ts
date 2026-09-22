import type { H3Event } from 'h3'
import { db, isoNow } from './db'
import type { AttendanceRecord } from '../../shared/utils/attendance'

// A shift is "open" (not yet clocked out) per the same rule as attendanceState(): once a
// real clock-in is tracked (original_clock_in_at), only a real clock-out closes it, so
// editing clock_out_at can never reopen or close a tracked shift. Legacy rows that predate
// original-time tracking (original_clock_in_at IS NULL) fall back to the editable fields.
export const OPEN_SHIFT_SQL = `(
    (original_clock_in_at IS NOT NULL AND original_clock_out_at IS NULL)
    OR (original_clock_in_at IS NULL AND clock_in_at IS NOT NULL AND clock_out_at IS NULL)
  )`
export const EFFECTIVE_CLOCK_IN_SQL = 'COALESCE(original_clock_in_at, clock_in_at)'

export function openAttendance(event: H3Event, userId: string) {
  // Old data may contain multiple unfinished records; resolve oldest first.
  return db(event).prepare(`SELECT * FROM attendance_records
    WHERE user_id=? AND ${OPEN_SHIFT_SQL}
    ORDER BY ${EFFECTIVE_CLOCK_IN_SQL}, id LIMIT 1`).bind(userId).first<AttendanceRecord>()
}

export async function ownedAttendance(event: H3Event, userId: string, recordId: unknown) {
  if (typeof recordId !== 'string' || !recordId.trim()) throw createError({ statusCode: 400, statusMessage: '対象の記録が見つかりません。' })
  const record = await db(event).prepare('SELECT * FROM attendance_records WHERE id=? AND user_id=?').bind(recordId, userId).first<AttendanceRecord>()
  if (!record) throw createError({ statusCode: 404, statusMessage: '対象の記録が見つかりません。' })
  return record
}

export function resolveBreakMinutes(
  record: AttendanceRecord,
  requested: number,
  clockOutAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!record.break_started_at) {
    return record.break_minutes === null && requested === Math.floor((record.total_break_seconds || 0) / 60) ? null : requested
  }
  const start = new Date(record.break_started_at).getTime()
  const end = clockOutAt ? new Date(clockOutAt).getTime() : now.getTime()
  const punchMinutes = Math.max(0, Math.floor(((record.total_break_seconds || 0) * 1000 + Math.max(0, end - start)) / 60000))
  return record.break_minutes === null && requested === punchMinutes ? null : requested
}

// Both manual edits and restoration use the same validation and guarded write.
export async function saveAttendanceTimes(
  event: H3Event,
  userId: string,
  record: AttendanceRecord,
  clockInAt: string | null,
  clockOutAt: string | null,
  breakMinutes?: number | null,
) {
  if (!clockInAt) throw createError({ statusCode: 400, statusMessage: '出勤時刻を入力してください。' })
  if (clockOutAt && clockOutAt <= clockInAt) throw createError({ statusCode: 400, statusMessage: '退勤時刻は出勤時刻より後にしてください。' })

  const effectiveBreakMinutes = breakMinutes === undefined ? (record.break_minutes ?? null) : breakMinutes
  if (effectiveBreakMinutes !== null) {
    if (!Number.isInteger(effectiveBreakMinutes) || effectiveBreakMinutes < 0) {
      throw createError({ statusCode: 400, statusMessage: '休憩時間は0分以上の整数で入力してください。' })
    }
    if (clockInAt && clockOutAt) {
      const grossMinutes = Math.floor((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / (60 * 1000))
      if (effectiveBreakMinutes > grossMinutes) {
        throw createError({ statusCode: 400, statusMessage: '休憩時間は出勤から退勤までの総時間以内で入力してください。' })
      }
    }
  }

  const result = await db(event).prepare(`UPDATE attendance_records SET
      clock_in_at=?1,
      clock_out_at=?2,
      break_minutes=?3,
      total_break_seconds = CASE WHEN original_clock_in_at IS NULL AND ?2 IS NOT NULL AND break_started_at IS NOT NULL
        THEN total_break_seconds + max(0, strftime('%s', ?2) - strftime('%s', break_started_at)) ELSE total_break_seconds END,
      original_total_break_seconds = CASE WHEN original_clock_in_at IS NULL AND ?2 IS NOT NULL AND break_started_at IS NOT NULL
        THEN original_total_break_seconds + max(0, strftime('%s', ?2) - strftime('%s', break_started_at)) ELSE original_total_break_seconds END,
      break_started_at = CASE WHEN original_clock_in_at IS NULL AND ?2 IS NOT NULL THEN NULL ELSE break_started_at END,
      updated_at=?4
    WHERE id=?5 AND user_id=?6 AND clock_in_at IS ?7 AND clock_out_at IS ?8
    AND (?2 IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM attendance_records WHERE user_id=?6 AND id<>?5 AND ${OPEN_SHIFT_SQL}
    ))`).bind(clockInAt, clockOutAt, effectiveBreakMinutes, isoNow(), record.id, userId, record.clock_in_at, record.clock_out_at).run()
  if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: '記録が更新されたか、ほかに未退勤の勤務があります。画面を再読み込みして確認してください。' })
}
