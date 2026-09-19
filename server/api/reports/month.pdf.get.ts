import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { japanDateTime } from '~~/shared/utils/attendance'
export default defineEventHandler(async (event) => {
  const user = await currentUser(event); const month = getQuery(event).month as string
  if (!/^\d{4}-\d{2}$/.test(month || '')) throw createError({ statusCode: 400, statusMessage: 'month は YYYY-MM 形式で指定してください。' })
  const rows = await db(event).prepare('SELECT work_date, clock_in_at, clock_out_at FROM attendance_records WHERE user_id=? AND work_date>=? AND work_date<? ORDER BY work_date').bind(user.id, `${month}-01`, `${month}-32`).all<any>()
  const pdf = await PDFDocument.create(); const page = pdf.addPage([595, 842]); const font = await pdf.embedFont(StandardFonts.Helvetica)
  page.drawText(`Kintai Note | ${user.display_name} | ${month}`, { x: 48, y: 790, size: 16, font })
  page.drawText('Work date             Clock in (JST)                         Clock out (JST)', { x: 48, y: 755, size: 11, font })
  rows.results.forEach((r, index) => {
    const format = (value: string | null) => japanDateTime(value).replace('T', ' ') || '-'
    for (const [column, text] of [r.work_date, format(r.clock_in_at), format(r.clock_out_at)].entries()) {
      page.drawText(text, { x: [48, 160, 350][column], y: 730 - index * 20, size: 10, font, color: rgb(0.12, 0.15, 0.2) })
    }
  })
  setHeader(event, 'Content-Type', 'application/pdf'); setHeader(event, 'Content-Disposition', `attachment; filename="kintai-${month}.pdf"`)
  return await pdf.save()
})
