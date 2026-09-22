const HOUR = 60 * 60 * 1000

export interface AttendanceRecord {
  id: string
  work_date: string
  clock_in_at: string | null
  clock_out_at: string | null
  original_clock_in_at: string | null
  original_clock_out_at: string | null
  break_started_at?: string | null
  total_break_seconds?: number
  original_total_break_seconds?: number
  break_minutes?: number | null
}

// Japan has no daylight saving time. Shift JST back four hours before taking the date.
export function workDateAt(now: Date = new Date()): string {
  return new Date(now.getTime() + (9 - 4) * HOUR).toISOString().slice(0, 10)
}

// The four attendance states and their allowed transitions, kept in one place so the
// dashboard UI and any future callers can never derive them inconsistently.
//
//   idle --(in)--> working --(break_start)--> on_break
//                     ^                            |
//                     |------------(break_end)------|
//                     |
//                     '--(out)--> done
//
// A new work day (JST 04:00 boundary, see workDateAt) starts a fresh record, so `done`
// has no outgoing action from this table; the next `idle` comes from a brand-new record.
export type AttendanceState = 'idle' | 'working' | 'on_break' | 'done'
export type AttendanceAction = 'in' | 'break_start' | 'break_end' | 'out'

export const ATTENDANCE_TRANSITIONS: Record<AttendanceState, Partial<Record<AttendanceAction, AttendanceState>>> = {
  idle: { in: 'working' },
  working: { break_start: 'on_break', out: 'done' },
  on_break: { break_end: 'working' },
  done: {},
}

// Derives the current state from a record's punch fields (no state column exists).
//
// `clock_in_at`/`clock_out_at` double as an editable display/PDF value (see records.vue)
// and are NOT a reliable source of truth for state: editing or clearing them must never
// resurrect a completed shift, and pre-filling a future clock-out must never end one early.
// `original_clock_in_at`/`original_clock_out_at` are only ever set by an actual clock.post.ts
// punch and are never modified by an edit, so once a real clock-in is tracked, only a real
// clock-out (`original_clock_out_at`) can move the shift to `done` here.
//
// Rows created before original-time tracking existed (migration 0001) have
// `original_clock_in_at === null` forever; for those legacy rows only, we fall back to the
// editable fields since there is no tracked punch history to trust instead.
export function attendanceState(
  record: Pick<AttendanceRecord, 'clock_in_at' | 'clock_out_at' | 'original_clock_in_at' | 'original_clock_out_at' | 'break_started_at'> | null | undefined,
): AttendanceState {
  const trackedIn = record?.original_clock_in_at ?? null
  const effectiveIn = trackedIn ?? record?.clock_in_at ?? null
  if (!effectiveIn) return 'idle'
  const effectiveOut = trackedIn ? (record?.original_clock_out_at ?? null) : (record?.clock_out_at ?? null)
  if (effectiveOut) return 'done'
  if (record?.break_started_at) return 'on_break'
  return 'working'
}

export function canPerform(state: AttendanceState, action: AttendanceAction): boolean {
  return action in ATTENDANCE_TRANSITIONS[state]
}

export function japanDateTime(value: string | null | undefined): string {
  return value ? new Date(new Date(value).getTime() + 9 * HOUR).toISOString().slice(0, 16) : ''
}

export function displayJapanDateTime(value: string | null | undefined, includeSeconds = false): string {
  if (value && includeSeconds) return new Date(new Date(value).getTime() + 9 * HOUR).toISOString().slice(0, 23).replace('T', ' ')
  return japanDateTime(value).replace('T', ' ') || '—'
}

// Explicit calendar date, independent of work_date (also preserves legacy records).
export function parseJapanDateTime(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new Error('日時は YYYY-MM-DDTHH:MM 形式で入力してください。')
  }
  const timestamp = new Date(`${value}:00+09:00`)
  if (!Number.isFinite(timestamp.getTime()) || japanDateTime(timestamp.toISOString()) !== value) {
    throw new Error('正しい日時を入力してください。')
  }
  return timestamp.toISOString()
}

export function calculateBreakMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  if (record.break_minutes !== null && record.break_minutes !== undefined) {
    return Math.max(0, record.break_minutes)
  }
  return calculatePunchBreakMinutes(record, now)
}

export function calculatePunchBreakMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  let seconds = record.total_break_seconds || 0
  if (record.break_started_at) {
    const start = new Date(record.break_started_at).getTime()
    const end = record.clock_out_at ? new Date(record.clock_out_at).getTime() : now.getTime()
    if (end > start) {
      seconds += Math.floor((end - start) / 1000)
    }
  }
  return Math.max(0, Math.floor(seconds / 60))
}

export function calculateWorkMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  if (record.break_minutes !== null && record.break_minutes !== undefined) {
    return Math.max(0, calculatePunchWorkMinutes(record, now) + calculatePunchBreakMinutes(record, now) - record.break_minutes)
  }
  return calculatePunchWorkMinutes(record, now)
}

export function calculatePunchWorkMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  if (!record.clock_in_at) return 0
  const start = new Date(record.clock_in_at).getTime()
  const end = record.clock_out_at
    ? new Date(record.clock_out_at).getTime()
    : (record.break_started_at ? new Date(record.break_started_at).getTime() : now.getTime())
  if (end <= start) return 0
  const grossMinutes = Math.floor((end - start) / (60 * 1000))
  const breakMinutes = record.break_started_at && !record.clock_out_at
    ? Math.floor((record.total_break_seconds || 0) / 60)
    : calculatePunchBreakMinutes(record, now)
  return Math.max(0, grossMinutes - breakMinutes)
}

/** Duration used by the live dashboard. Once original punch tracking exists, editable
 * month-page values are deliberately ignored. Legacy rows fall back to their stored fields. */
export function calculateOriginalBreakMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  let seconds = record.original_clock_in_at ? (record.original_total_break_seconds || 0) : (record.total_break_seconds || 0)
  if (record.break_started_at) {
    const start = new Date(record.break_started_at).getTime()
    if (now.getTime() > start) seconds += Math.floor((now.getTime() - start) / 1000)
  }
  return Math.max(0, Math.floor(seconds / 60))
}

export function calculateOriginalWorkMinutes(record: AttendanceRecord, now: Date = new Date()): number {
  const startValue = record.original_clock_in_at ?? record.clock_in_at
  if (!startValue) return 0
  const start = new Date(startValue).getTime()
  const endValue = record.original_clock_in_at ? record.original_clock_out_at : record.clock_out_at
  const end = endValue
    ? new Date(endValue).getTime()
    : (record.break_started_at ? new Date(record.break_started_at).getTime() : now.getTime())
  if (end <= start) return 0
  const grossMinutes = Math.floor((end - start) / (60 * 1000))
  const breakMinutes = record.break_started_at
    ? Math.floor((record.original_clock_in_at ? (record.original_total_break_seconds || 0) : (record.total_break_seconds || 0)) / 60)
    : calculateOriginalBreakMinutes(record, now)
  return Math.max(0, grossMinutes - breakMinutes)
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}:${String(m).padStart(2, '0')}`
}

export function formatDurationHuman(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}時間${m}分`
}
