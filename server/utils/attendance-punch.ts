import { createError } from 'h3'
import { id } from './db'
import { openAttendance, OPEN_SHIFT_SQL, OPEN_SHIFT_ORDER_SQL, EFFECTIVE_CLOCK_IN_SQL } from './attendance'
import { workDateAt, type AttendanceAction } from '../../shared/utils/attendance'

// Every non-start punch must target the oldest unfinished shift, including legacy rows.
// Keep this check inside each UPDATE so a concurrent request cannot change the target
// between a read and the write.
// All three UPDATEs bind (now, targetId, userId), so the subquery uses ?3 for userId.
const OLDEST_OPEN_ID_SQL = `(SELECT id FROM attendance_records
  WHERE user_id=?3 AND ${OPEN_SHIFT_SQL}
  ORDER BY ${OPEN_SHIFT_ORDER_SQL} LIMIT 1)`

async function clockIn(database: D1Database, userId: string, instant: Date) {
  const now = instant.toISOString()
  const result = await database.prepare(`INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, original_clock_in_at, updated_at)
    SELECT ?1, ?2, ?3, ?4, ?4, ?4 WHERE NOT EXISTS (
      SELECT 1 FROM attendance_records WHERE user_id=?2 AND ${OPEN_SHIFT_SQL}
    ) ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in_at=excluded.clock_in_at, original_clock_in_at=COALESCE(attendance_records.original_clock_in_at, excluded.original_clock_in_at), updated_at=excluded.updated_at
    WHERE attendance_records.clock_in_at IS NULL`).bind(id(), userId, workDateAt(instant), now).run()
  if (!result.meta.changes) {
    const open = await openAttendance(database, userId)
    throw createError({ statusCode: 409, statusMessage: open
      ? '未退勤の勤務があります。勤務中なら退勤を記録し、打刻忘れなら月別記録から実際の退勤日時を入力してください。'
      : 'この勤務日はすでに出勤済みです。' })
  }
}

async function breakTargetId(database: D1Database, userId: string, recordId: unknown) {
  const targetId = typeof recordId === 'string' && recordId.trim() ? recordId.trim() : (await openAttendance(database, userId))?.id
  if (!targetId) throw createError({ statusCode: 400, statusMessage: '勤務中の記録がありません。' })
  return targetId
}

async function startBreak(database: D1Database, userId: string, recordId: unknown, now: string) {
  const targetId = await breakTargetId(database, userId, recordId)
  const result = await database.prepare(`UPDATE attendance_records SET break_started_at=?1, updated_at=?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL}
    AND break_started_at IS NULL AND ${EFFECTIVE_CLOCK_IN_SQL} <= ?1
    AND id=${OLDEST_OPEN_ID_SQL}`).bind(now, targetId, userId).run()
  if (!result.meta.changes) {
    throw createError({ statusCode: 409, statusMessage: 'すでに休憩中であるか、勤務中でないため休憩を開始できません。' })
  }
}

async function endBreak(database: D1Database, userId: string, recordId: unknown, now: string) {
  const targetId = await breakTargetId(database, userId, recordId)
  const result = await database.prepare(`UPDATE attendance_records SET
    total_break_seconds = total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
    original_total_break_seconds = original_total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
    break_started_at = NULL,
    updated_at = ?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND break_started_at IS NOT NULL
    AND break_started_at <= ?1
    AND id=${OLDEST_OPEN_ID_SQL}`).bind(now, targetId, userId).run()
  if (!result.meta.changes) {
    throw createError({ statusCode: 409, statusMessage: '休憩中ではないか、記録が更新されているため休憩を終了できません。' })
  }
}

async function clockOut(database: D1Database, userId: string, recordId: unknown, now: string) {
  if (typeof recordId !== 'string' || !recordId.trim()) {
    throw createError({ statusCode: 400, statusMessage: '退勤対象がありません。画面を再読み込みして確認してください。' })
  }
  const current = await database.prepare('SELECT break_started_at FROM attendance_records WHERE id=? AND user_id=?').bind(recordId, userId).first<{ break_started_at: string | null }>()
  if (current?.break_started_at) {
    throw createError({ statusCode: 409, statusMessage: '休憩中のため退勤できません。先に休憩終了を記録してください。' })
  }
  const result = await database.prepare(`UPDATE attendance_records SET clock_out_at=?1, original_clock_out_at=COALESCE(original_clock_out_at, ?1), updated_at=?1
    WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND ${EFFECTIVE_CLOCK_IN_SQL} < ?1 AND break_started_at IS NULL
    AND id=${OLDEST_OPEN_ID_SQL}`).bind(now, recordId, userId).run()
  if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: '記録が更新されたか、先に退勤すべき勤務があるか、出勤日時が現在以降です。画面を更新して確認してください。' })
}

export async function recordPunch(database: D1Database, userId: string, action: AttendanceAction, recordId: unknown, instant: Date) {
  if (action === 'in') return clockIn(database, userId, instant)
  const now = instant.toISOString()
  if (action === 'break_start') return startBreak(database, userId, recordId, now)
  if (action === 'break_end') return endBreak(database, userId, recordId, now)
  return clockOut(database, userId, recordId, now)
}
