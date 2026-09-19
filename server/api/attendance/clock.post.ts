import { currentUser } from '~~/server/utils/auth'
import { db, id } from '~~/server/utils/db'
import { openAttendance } from '~~/server/utils/attendance'
import { workDateAt } from '~~/shared/utils/attendance'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const { action, recordId } = await readBody(event) || {}
  if (!['in', 'out'].includes(action)) throw createError({ statusCode: 400, statusMessage: '不正な打刻です。' })
  const instant = new Date(); const date = workDateAt(instant); const now = instant.toISOString()
  if (action === 'in') {
    // Guard and write in one statement: concurrent requests cannot overwrite a clock-in.
    const result = await db(event).prepare(`INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, updated_at)
      SELECT ?1, ?2, ?3, ?4, ?4 WHERE NOT EXISTS (
        SELECT 1 FROM attendance_records WHERE user_id=?2 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
      ) ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in_at=excluded.clock_in_at, updated_at=excluded.updated_at
      WHERE attendance_records.clock_in_at IS NULL`).bind(id(), user.id, date, now).run()
    if (!result.meta.changes) {
      const open = await openAttendance(event, user.id)
      throw createError({ statusCode: 409, statusMessage: open
        ? '未退勤の勤務があります。勤務中なら退勤を記録し、打刻忘れなら月別記録から実際の退勤日時を入力してください。'
        : 'この勤務日はすでに出勤済みです。' })
    }
  } else {
    if (typeof recordId !== 'string' || !recordId.trim()) {
      throw createError({ statusCode: 400, statusMessage: '退勤対象がありません。画面を再読み込みして確認してください。' })
    }
    // Keep the requested ID and enforce oldest-first atomically (same ordering as openAttendance).
    const result = await db(event).prepare(`UPDATE attendance_records SET clock_out_at=?1, updated_at=?1
      WHERE id=?2 AND user_id=?3 AND clock_out_at IS NULL AND clock_in_at < ?1
      AND id=(SELECT id FROM attendance_records
        WHERE user_id=?3 AND clock_in_at IS NOT NULL AND clock_out_at IS NULL
        ORDER BY clock_in_at, id LIMIT 1)`).bind(now, recordId, user.id).run()
    if (!result.meta.changes) throw createError({ statusCode: 409, statusMessage: '記録が更新されたか、先に退勤すべき勤務があるか、出勤日時が現在以降です。画面を更新して確認してください。' })
  }
  return { ok: true }
})
