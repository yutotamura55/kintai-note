import { currentUser } from '~~/server/utils/auth'
import { db } from '~~/server/utils/db'
import { recordPunch, type PunchFailure } from '~~/server/utils/attendance-punch'
import { d1AttendanceRepository } from '~~/server/utils/attendance-repository'
import type { AttendanceAction } from '~~/shared/utils/attendance'

const PUNCH_FAILURE_RESPONSES: Record<PunchFailure, { statusCode: 400 | 409; statusMessage: string }> = {
  open_shift_exists: { statusCode: 409, statusMessage: '未退勤の勤務があります。勤務中なら退勤を記録し、打刻忘れなら月別記録から実際の退勤日時を入力してください。' },
  already_clocked_in: { statusCode: 409, statusMessage: 'この勤務日はすでに出勤済みです。' },
  no_open_shift: { statusCode: 400, statusMessage: '勤務中の記録がありません。' },
  break_start_rejected: { statusCode: 409, statusMessage: 'すでに休憩中であるか、勤務中でないため休憩を開始できません。' },
  break_end_rejected: { statusCode: 409, statusMessage: '休憩中ではないか、記録が更新されているため休憩を終了できません。' },
  clock_out_target_missing: { statusCode: 400, statusMessage: '退勤対象がありません。画面を再読み込みして確認してください。' },
  on_break: { statusCode: 409, statusMessage: '休憩中のため退勤できません。先に休憩終了を記録してください。' },
  clock_out_rejected: { statusCode: 409, statusMessage: '記録が更新されたか、先に退勤すべき勤務があるか、出勤日時が現在以降です。画面を更新して確認してください。' },
}

export default defineEventHandler(async (event) => {
  const user = await currentUser(event)
  const { action, recordId } = await readBody(event) || {}
  if (!['in', 'out', 'break_start', 'break_end'].includes(action)) {
    throw createError({ statusCode: 400, statusMessage: '不正な打刻です。' })
  }
  const result = await recordPunch(d1AttendanceRepository(db(event)), user.id, action as AttendanceAction, recordId, new Date())
  if (!result.ok) throw createError(PUNCH_FAILURE_RESPONSES[result.reason])
  return { ok: true }
})
