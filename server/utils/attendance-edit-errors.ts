import { createError } from 'h3'
import type { AttendanceEditFailure } from './attendance-edit'

const ATTENDANCE_EDIT_FAILURE_RESPONSES: Record<AttendanceEditFailure, { statusCode: 400 | 404 | 409; statusMessage: string }> = {
  record_id_missing: { statusCode: 400, statusMessage: '対象の記録が見つかりません。' },
  record_not_found: { statusCode: 404, statusMessage: '対象の記録が見つかりません。' },
  clock_in_missing: { statusCode: 400, statusMessage: '出勤時刻を入力してください。' },
  clock_out_not_after_clock_in: { statusCode: 400, statusMessage: '退勤時刻は出勤時刻より後にしてください。' },
  invalid_break_minutes: { statusCode: 400, statusMessage: '休憩時間は0分以上の整数で入力してください。' },
  break_exceeds_shift: { statusCode: 400, statusMessage: '休憩時間は出勤から退勤までの総時間以内で入力してください。' },
  no_original_times: { statusCode: 409, statusMessage: '元の打刻時刻が保存されていないため、復元できません。' },
  conflict: { statusCode: 409, statusMessage: '記録が更新されたか、ほかに未退勤の勤務があります。画面を再読み込みして確認してください。' },
}

// Shared by the edit and restore APIs so both report a failure the same way.
export function attendanceEditError(reason: AttendanceEditFailure) {
  return createError(ATTENDANCE_EDIT_FAILURE_RESPONSES[reason])
}
