import { currentUser } from '~~/server/utils/auth'
import { db, isoNow } from '~~/server/utils/db'

function toJapanTime(workDate: string, value: string | null) {
  if (value === null || value === '') return null
  if (!/^\d{2}:\d{2}$/.test(value)) throw createError({ statusCode: 400, statusMessage: '時刻は HH:MM 形式で入力してください。' })
  const timestamp = new Date(`${workDate}T${value}:00+09:00`)
  if (Number.isNaN(timestamp.getTime())) throw createError({ statusCode: 400, statusMessage: '正しい時刻を入力してください。' })
  return timestamp.toISOString()
}

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const body = await readBody<{ id?: string, clockIn?: string | null, clockOut?: string | null }>(event)
  if (!body?.id) throw createError({ statusCode: 400, statusMessage: '編集対象の記録が見つかりません。' })

  const record = await db(event).prepare('SELECT id, work_date FROM attendance_records WHERE id=? AND user_id=?').bind(body.id, user.id).first<{ id: string, work_date: string }>()
  if (!record) throw createError({ statusCode: 404, statusMessage: '編集対象の記録が見つかりません。' })

  const clockInAt = toJapanTime(record.work_date, body.clockIn ?? null)
  const clockOutAt = toJapanTime(record.work_date, body.clockOut ?? null)
  if (!clockInAt) throw createError({ statusCode: 400, statusMessage: '出勤時刻を入力してください。' })
  if (clockOutAt && clockOutAt <= clockInAt) throw createError({ statusCode: 400, statusMessage: '退勤時刻は出勤時刻より後にしてください。' })

  await db(event).prepare('UPDATE attendance_records SET clock_in_at=?, clock_out_at=?, updated_at=? WHERE id=? AND user_id=?')
    .bind(clockInAt, clockOutAt, isoNow(), record.id, user.id).run()
  return { ok: true }
})
