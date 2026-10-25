import { workDateAt, type AttendanceAction } from '../../shared/utils/attendance'
import type { AttendanceRepository } from './attendance-repository'

export type PunchFailure =
  | 'open_shift_exists'
  | 'already_clocked_in'
  | 'no_open_shift'
  | 'break_start_rejected'
  | 'break_end_rejected'
  | 'clock_out_target_missing'
  | 'on_break'
  | 'clock_out_rejected'

export type PunchResult = { ok: true } | { ok: false; reason: PunchFailure }

const applied: PunchResult = { ok: true }
const failed = (reason: PunchFailure): PunchResult => ({ ok: false, reason })

async function clockIn(repository: AttendanceRepository, userId: string, instant: Date) {
  // The work date and stored time come from the same instant.
  const command = { userId, action: 'in' as const, atIso: instant.toISOString(), workDate: workDateAt(instant) }
  if ((await repository.applyPunch(command)) === 'applied') return applied
  // Read only after the guarded INSERT failed, to explain why.
  return failed((await repository.findOldestOpen(userId)) ? 'open_shift_exists' : 'already_clocked_in')
}

async function changeBreak(
  repository: AttendanceRepository,
  userId: string,
  action: 'break_start' | 'break_end',
  recordId: unknown,
  atIso: string,
) {
  // An omitted ID means the oldest open shift; the UPDATE re-checks that it still is.
  const targetId =
    typeof recordId === 'string' && recordId.trim() ? recordId.trim() : (await repository.findOldestOpen(userId))?.id
  if (!targetId) return failed('no_open_shift')
  if ((await repository.applyPunch({ userId, action, atIso, recordId: targetId })) === 'applied') return applied
  return failed(action === 'break_start' ? 'break_start_rejected' : 'break_end_rejected')
}

async function clockOut(repository: AttendanceRepository, userId: string, recordId: unknown, atIso: string) {
  // Clock-out never falls back to another shift, so the ID is required.
  if (typeof recordId !== 'string' || !recordId.trim()) return failed('clock_out_target_missing')
  // This read only selects the message; the UPDATE itself also rejects a shift on break.
  if ((await repository.findOwned(userId, recordId))?.break_started_at) return failed('on_break')
  if ((await repository.applyPunch({ userId, action: 'out', atIso, recordId })) === 'applied') return applied
  return failed('clock_out_rejected')
}

export async function recordPunch(
  repository: AttendanceRepository,
  userId: string,
  action: AttendanceAction,
  recordId: unknown,
  instant: Date,
): Promise<PunchResult> {
  if (action === 'in') return clockIn(repository, userId, instant)
  const atIso = instant.toISOString()
  if (action === 'out') return clockOut(repository, userId, recordId, atIso)
  return changeBreak(repository, userId, action, recordId, atIso)
}
