import type { H3Event } from 'h3'
import { db } from './db'
import type { AttendanceRecord } from '../../shared/utils/attendance'

export function openAttendance(event: H3Event, userId: string) {
  // Old data may contain multiple unfinished records; resolve oldest first.
  return db(event).prepare(`SELECT * FROM attendance_records
    WHERE user_id=? AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
    ORDER BY clock_in_at, id LIMIT 1`).bind(userId).first<AttendanceRecord>()
}
