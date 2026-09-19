const HOUR = 60 * 60 * 1000

export interface AttendanceRecord {
  id: string
  work_date: string
  clock_in_at: string | null
  clock_out_at: string | null
  original_clock_in_at: string | null
  original_clock_out_at: string | null
}

// Japan has no daylight saving time. Shift JST back four hours before taking the date.
export function workDateAt(now: Date = new Date()): string {
  return new Date(now.getTime() + (9 - 4) * HOUR).toISOString().slice(0, 10)
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
