import type { H3Event } from 'h3'
import { db, isoNow } from './db'
import type { AttendanceRecord } from '../../shared/utils/attendance'

export function openAttendance(event: H3Event, userId: string) {
  // Old data may contain multiple unfinished records; resolve oldest first.
  return db(event).prepare(`SELECT * FROM attendance_records
    WHERE user_id=? AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
    ORDER BY clock_in_at, id LIMIT 1`).bind(userId).first<AttendanceRecord>()
}

export async function ownedAttendance(event: H3Event, userId: string, recordId: unknown) {
  if (typeof recordId !== 'string' || !recordId.trim()) throw createError({ statusCode: 400, statusMessage: '対象の記録が見つかりません。' })
  const record = await db(event).prepare('SELECT * FROM attendance_records WHERE id=? AND user_id=?').bind(recordId, userId).first<AttendanceRecord>()
  if (!record) throw createError({ statusCode: 404, statusMessage: '対象の記録が見つかりません。' })
  return record
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

  const result = await db(event).prepare(`UPDATE attendance_records SET clock_in_at=?1, clock_out_at=?2, break_minutes=?3, updated_at=?4
    WHERE id=?5 AND user_id=?6 AND clock_in_at IS ?7 AND clock_out_at IS ?8
    AND (?2 IS NOT NULL OR NOT EXISTS (
      SELECT 1 FROM attendance_records WHERE user_id=?6 AND id<>?5 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
    ))`).bind(clockInAt, clockOutAt, effectiveBreakMinutes, isoNow(), record.id, userId, record.clock_in_at, record.clock_out_at).run()
  if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: '記録が更新されたか、ほかに未退勤の勤務があります。画面を再読み込みして確認してください。' })
}
