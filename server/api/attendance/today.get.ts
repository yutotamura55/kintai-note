import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date())
  return { date, record: await db(event).prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').bind(user.id, date).first() }
})
