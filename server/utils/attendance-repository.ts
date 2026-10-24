import { id } from './db'
import { openAttendance, OPEN_SHIFT_SQL, OPEN_SHIFT_ORDER_SQL, EFFECTIVE_CLOCK_IN_SQL } from './attendance'
import type { AttendanceRecord } from '../../shared/utils/attendance'

export type PunchCommand =
  | { userId: string; action: 'in'; atIso: string; workDate: string }
  | { userId: string; action: 'out' | 'break_start' | 'break_end'; atIso: string; recordId: string }

// Attendance persistence used by the punch workflow. Reads are for choosing a target or
// explaining a failure; only applyPunch decides whether a punch happened.
export interface AttendanceRepository {
  findOldestOpen(userId: string): Promise<AttendanceRecord | null>
  findOwned(userId: string, recordId: string): Promise<AttendanceRecord | null>
  applyPunch(command: PunchCommand): Promise<'applied' | 'unchanged'>
}

// Every non-start punch must target the oldest unfinished shift, including legacy rows.
// Keep this check inside each UPDATE so a concurrent request cannot change the target
// between a read and the write.
// All three UPDATEs bind (now, targetId, userId), so the subquery uses ?3 for userId.
const OLDEST_OPEN_ID_SQL = `(SELECT id FROM attendance_records
  WHERE user_id=?3 AND ${OPEN_SHIFT_SQL}
  ORDER BY ${OPEN_SHIFT_ORDER_SQL} LIMIT 1)`

const CLOCK_IN_SQL = `INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, original_clock_in_at, updated_at)
    SELECT ?1, ?2, ?3, ?4, ?4, ?4 WHERE NOT EXISTS (
      SELECT 1 FROM attendance_records WHERE user_id=?2 AND ${OPEN_SHIFT_SQL}
    ) ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in_at=excluded.clock_in_at, original_clock_in_at=COALESCE(attendance_records.original_clock_in_at, excluded.original_clock_in_at), updated_at=excluded.updated_at
    WHERE attendance_records.clock_in_at IS NULL`

const BREAK_START_SQL = `UPDATE attendance_records SET break_started_at=?1, updated_at=?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL}
    AND break_started_at IS NULL AND ${EFFECTIVE_CLOCK_IN_SQL} <= ?1
    AND id=${OLDEST_OPEN_ID_SQL}`

const BREAK_END_SQL = `UPDATE attendance_records SET
    total_break_seconds = total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
    original_total_break_seconds = original_total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
    break_started_at = NULL,
    updated_at = ?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND break_started_at IS NOT NULL
    AND break_started_at <= ?1
    AND id=${OLDEST_OPEN_ID_SQL}`

const CLOCK_OUT_SQL = `UPDATE attendance_records SET clock_out_at=?1, original_clock_out_at=COALESCE(original_clock_out_at, ?1), updated_at=?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND ${EFFECTIVE_CLOCK_IN_SQL} < ?1 AND break_started_at IS NULL
    AND id=${OLDEST_OPEN_ID_SQL}`

const UPDATE_SQL = { break_start: BREAK_START_SQL, break_end: BREAK_END_SQL, out: CLOCK_OUT_SQL }

export function d1AttendanceRepository(database: D1Database): AttendanceRepository {
  return {
    findOldestOpen: userId => openAttendance(database, userId),
    findOwned: (userId, recordId) => database.prepare('SELECT * FROM attendance_records WHERE id=? AND user_id=?')
      .bind(recordId, userId).first<AttendanceRecord>(),
    async applyPunch(command) {
      const statement = command.action === 'in'
        ? database.prepare(CLOCK_IN_SQL).bind(id(), command.userId, command.workDate, command.atIso)
        : database.prepare(UPDATE_SQL[command.action]).bind(command.atIso, command.recordId, command.userId)
      const result = await statement.run()
      return result.meta.changes ? 'applied' : 'unchanged'
    },
  }
}
