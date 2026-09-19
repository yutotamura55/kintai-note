import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { openAttendance } from '~~/server/utils/attendance'
import { workDateAt } from '~~/shared/utils/attendance'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const date = workDateAt()
  const [record, openRecord] = await Promise.all([
    db(event).prepare('SELECT * FROM attendance_records WHERE user_id=? AND work_date=?').bind(user.id, date).first(),
    openAttendance(event, user.id),
  ])
  setHeader(event, 'Cache-Control', 'no-store')
  return { date, record, openRecord }
})
