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
export const OPEN_SHIFT_ORDER_SQL = `${EFFECTIVE_CLOCK_IN_SQL}, id`

export function openAttendance(database: D1Database, userId: string) {
  // Old data may contain multiple unfinished records; resolve oldest first.
  return database.prepare(`SELECT * FROM attendance_records
    WHERE user_id=? AND ${OPEN_SHIFT_SQL}
    ORDER BY ${OPEN_SHIFT_ORDER_SQL} LIMIT 1`).bind(userId).first<AttendanceRecord>()
}
