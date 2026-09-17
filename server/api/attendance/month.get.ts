import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const month = getQuery(event).month as string
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw createError({ statusCode: 400, statusMessage: 'month は YYYY-MM 形式で指定してください。' })
  return db(event).prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date>=? AND work_date<? ORDER BY work_date').bind(user.id, `${month}-01`, `${month}-32`).all()
})
