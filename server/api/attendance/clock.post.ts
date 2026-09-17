import { currentUser } from '~~/server/utils/auth'
import { db, id } from '~~/server/utils/db'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const { action } = await readBody<{ action: 'in' | 'out' }>(event)
  if (!['in', 'out'].includes(action)) throw createError({ statusCode: 400, statusMessage: '不正な打刻です。' })
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date()); const now = new Date().toISOString()
  const record = await db(event).prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').bind(user.id, date).first<any>()
  if (action === 'in') {
    if (record?.clock_in_at) throw createError({ statusCode: 409, statusMessage: '本日はすでに出勤済みです。' })
    await db(event).prepare(`INSERT INTO attendance_records (id, user_id, work_date, clock_in_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, work_date) DO UPDATE SET clock_in_at=excluded.clock_in_at, updated_at=excluded.updated_at`).bind(record?.id || id(), user.id, date, now, now).run()
  } else {
    if (!record?.clock_in_at || record.clock_out_at) throw createError({ statusCode: 409, statusMessage: '退勤を記録できる状態ではありません。' })
    await db(event).prepare('UPDATE attendance_records SET clock_out_at=?, updated_at=? WHERE id=?').bind(now, now, record.id).run()
  }
  return { ok: true }
})
