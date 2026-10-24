import type { AttendanceRecord } from '../../shared/utils/attendance'
import type { AttendanceRepository } from './attendance-repository'

export type AttendanceEditFailure =
  | 'record_id_missing'
  | 'record_not_found'
  | 'clock_in_missing'
  | 'clock_out_not_after_clock_in'
  | 'invalid_break_minutes'
  | 'break_exceeds_shift'
  | 'no_original_times'
  | 'conflict'

type Failed = { ok: false; reason: AttendanceEditFailure }
export type OwnedAttendanceResult = { ok: true; record: AttendanceRecord } | Failed
export type AttendanceEditResult = { ok: true } | Failed

const saved: AttendanceEditResult = { ok: true }
const failed = (reason: AttendanceEditFailure): Failed => ({ ok: false, reason })

export async function findOwnedAttendance(repository: AttendanceRepository, userId: string, recordId: unknown): Promise<OwnedAttendanceResult> {
  if (typeof recordId !== 'string' || !recordId.trim()) return failed('record_id_missing')
  const record = await repository.findOwned(userId, recordId)
  return record ? { ok: true, record } : failed('record_not_found')
}

export function resolveBreakMinutes(
  record: AttendanceRecord,
  requested: number,
  clockOutAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!record.break_started_at) {
    return record.break_minutes === null && requested === Math.floor((record.total_break_seconds || 0) / 60) ? null : requested
  }
  const start = new Date(record.break_started_at).getTime()
  const end = clockOutAt ? new Date(clockOutAt).getTime() : now.getTime()
  const punchMinutes = Math.max(0, Math.floor(((record.total_break_seconds || 0) * 1000 + Math.max(0, end - start)) / 60000))
  return record.break_minutes === null && requested === punchMinutes ? null : requested
}

// Both manual edits and restoration use the same validation and guarded write.
export async function saveAttendanceTimes(
  repository: AttendanceRepository,
  userId: string,
  record: AttendanceRecord,
  clockInAt: string | null,
  clockOutAt: string | null,
  breakMinutes: number | null | undefined,
  instant: Date,
): Promise<AttendanceEditResult> {
  if (!clockInAt) return failed('clock_in_missing')
  if (clockOutAt && clockOutAt <= clockInAt) return failed('clock_out_not_after_clock_in')

  const effectiveBreakMinutes = breakMinutes === undefined ? (record.break_minutes ?? null) : breakMinutes
  if (effectiveBreakMinutes !== null) {
    if (!Number.isInteger(effectiveBreakMinutes) || effectiveBreakMinutes < 0) return failed('invalid_break_minutes')
    if (clockOutAt) {
      const grossMinutes = Math.floor((new Date(clockOutAt).getTime() - new Date(clockInAt).getTime()) / (60 * 1000))
      if (effectiveBreakMinutes > grossMinutes) return failed('break_exceeds_shift')
    }
  }

  // The repository compares the times read here with the stored ones in the same UPDATE.
  const outcome = await repository.saveTimes({
    userId,
    recordId: record.id,
    expectedClockInAt: record.clock_in_at,
    expectedClockOutAt: record.clock_out_at,
    clockInAt,
    clockOutAt,
    breakMinutes: effectiveBreakMinutes,
    atIso: instant.toISOString(),
  })
  return outcome === 'saved' ? saved : failed('conflict')
}

export async function restoreAttendanceTimes(repository: AttendanceRepository, userId: string, recordId: unknown, instant: Date): Promise<AttendanceEditResult> {
  const owned = await findOwnedAttendance(repository, userId, recordId)
  if (!owned.ok) return owned
  const { record } = owned
  if (!record.original_clock_in_at && !record.original_clock_out_at && record.break_minutes === null) return failed('no_original_times')
  // Only use trusted stored originals. Unknown fields keep their current value.
  return saveAttendanceTimes(repository, userId, record,
    record.original_clock_in_at ?? record.clock_in_at,
    record.original_clock_out_at ?? record.clock_out_at,
    null, instant)
}
