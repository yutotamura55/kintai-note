import { currentUser } from '~~/server/utils/auth'
import { db, id } from '~~/server/utils/db'
import { openAttendance, OPEN_SHIFT_SQL, EFFECTIVE_CLOCK_IN_SQL } from '~~/server/utils/attendance'
import { workDateAt } from '~~/shared/utils/attendance'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const { action, recordId } = await readBody(event) || {}
  if (!['in', 'out', 'break_start', 'break_end'].includes(action)) throw createError({ statusCode: 400, statusMessage: '不正な打刻です。' })
  const instant = new Date(); const date = workDateAt(instant); const now = instant.toISOString()
  if (action === 'in') {
    // Guard and write in one statement: concurrent requests cannot overwrite a clock-in.
    const result = await db(event).prepare(`INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, original_clock_in_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?4, ?4 WHERE NOT EXISTS (
        SELECT 1 FROM attendance_records WHERE user_id=?2 AND ${OPEN_SHIFT_SQL}
      ) ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in_at=excluded.clock_in_at, original_clock_in_at=COALESCE(attendance_records.original_clock_in_at, excluded.original_clock_in_at), updated_at=excluded.updated_at
      WHERE attendance_records.clock_in_at IS NULL`).bind(id(), user.id, date, now).run()
    if (!result.meta.changes) {
      const open = await openAttendance(event, user.id)
      throw createError({ statusCode: 409, statusMessage: open
        ? '未退勤の勤務があります。勤務中なら退勤を記録し、打刻忘れなら月別記録から実際の退勤日時を入力してください。'
        : 'この勤務日はすでに出勤済みです。' })
    }
  } else if (action === 'break_start') {
    const targetId = typeof recordId === 'string' && recordId.trim() ? recordId.trim() : (await openAttendance(event, user.id))?.id
    if (!targetId) throw createError({ statusCode: 400, statusMessage: '勤務中の記録がありません。' })
    const result = await db(event).prepare(`UPDATE attendance_records SET break_started_at=?1, updated_at=?1
      WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL}
      AND break_started_at IS NULL AND ${EFFECTIVE_CLOCK_IN_SQL} <= ?1
      AND id=(SELECT id FROM attendance_records
        WHERE user_id=?3 AND ${OPEN_SHIFT_SQL}
        ORDER BY ${EFFECTIVE_CLOCK_IN_SQL}, id LIMIT 1)`).bind(now, targetId, user.id).run()
    if (!result.meta.changes) {
      throw createError({ statusCode: 409, statusMessage: 'すでに休憩中であるか、勤務中でないため休憩を開始できません。' })
    }
  } else if (action === 'break_end') {
    const targetId = typeof recordId === 'string' && recordId.trim() ? recordId.trim() : (await openAttendance(event, user.id))?.id
    if (!targetId) throw createError({ statusCode: 400, statusMessage: '勤務中の記録がありません。' })
    const result = await db(event).prepare(`UPDATE attendance_records SET
      total_break_seconds = total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
      original_total_break_seconds = original_total_break_seconds + max(0, strftime('%s', ?1) - strftime('%s', break_started_at)),
      break_started_at = NULL,
      updated_at = ?1
      WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND break_started_at IS NOT NULL
      AND break_started_at <= ?1
      AND id=(SELECT id FROM attendance_records
        WHERE user_id=?3 AND ${OPEN_SHIFT_SQL}
        ORDER BY ${EFFECTIVE_CLOCK_IN_SQL}, id LIMIT 1)`).bind(now, targetId, user.id).run()
    if (!result.meta.changes) {
      throw createError({ statusCode: 409, statusMessage: '休憩中ではないか、記録が更新されているため休憩を終了できません。' })
    }
  } else {
    if (typeof recordId !== 'string' || !recordId.trim()) {
      throw createError({ statusCode: 400, statusMessage: '退勤対象がありません。画面を再読み込みして確認してください。' })
    }
    // Block clock-out if break is currently active (Case 2)
    const current = await db(event).prepare('SELECT break_started_at FROM attendance_records WHERE id=? AND user_id=?').bind(recordId, user.id).first<{ break_started_at: string | null }>()
    if (current?.break_started_at) {
      throw createError({ statusCode: 409, statusMessage: '休憩中のため退勤できません。先に休憩終了を記録してください。' })
    }
    // Keep the requested ID and enforce oldest-first atomically (same ordering as openAttendance).
    const result = await db(event).prepare(`UPDATE attendance_records SET clock_out_at=?1, original_clock_out_at=COALESCE(original_clock_out_at, ?1), updated_at=?1
      WHERE id=?2 AND user_id=?3 AND ${OPEN_SHIFT_SQL} AND ${EFFECTIVE_CLOCK_IN_SQL} < ?1 AND break_started_at IS NULL
      AND id=(SELECT id FROM attendance_records
        WHERE user_id=?3 AND ${OPEN_SHIFT_SQL}
        ORDER BY ${EFFECTIVE_CLOCK_IN_SQL}, id LIMIT 1)`).bind(now, recordId, user.id).run()
    if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: '記録が更新されたか、先に退勤すべき勤務があるか、出勤日時が現在以降です。画面を更新して確認してください。' })
  }
  return { ok: true }
})
