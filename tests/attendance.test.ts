import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workDateAt, japanDateTime, parseJapanDateTime, displayJapanDateTime,
  calculateBreakMinutes, calculateWorkMinutes, calculatePunchBreakMinutes, calculatePunchWorkMinutes,
  calculateOriginalBreakMinutes, calculateOriginalWorkMinutes,
  formatDuration, formatDurationHuman, attendanceState, canPerform } from '../shared/utils/attendance.ts'

for (const [instant, expected] of [
  ['2026-09-17T00:00:00+09:00', '2026-09-16'],
  ['2026-09-17T03:59:59.999+09:00', '2026-09-16'],
  ['2026-09-17T04:00:00+09:00', '2026-09-17'],
  ['2026-09-17T23:59:59+09:00', '2026-09-17'],
  ['2026-10-01T03:59:59+09:00', '2026-09-30'],
  ['2026-10-01T04:00:00+09:00', '2026-10-01'],
  ['2027-01-01T03:59:59+09:00', '2026-12-31'],
  ['2027-01-01T04:00:00+09:00', '2027-01-01'],
  ['2028-03-01T03:00:00+09:00', '2028-02-29'],
]) {
  test(`work date: ${instant}`, () => assert.equal(workDateAt(new Date(instant)), expected))
}

test('attendanceState derives idle/working/on_break/done from punch fields alone (legacy rows with no original_* tracking)', () => {
  assert.equal(attendanceState(null), 'idle')
  assert.equal(attendanceState({ clock_in_at: null, clock_out_at: null, original_clock_in_at: null, original_clock_out_at: null, break_started_at: null }), 'idle')
  assert.equal(attendanceState({ clock_in_at: '2026-09-17T00:00:00Z', clock_out_at: null, original_clock_in_at: null, original_clock_out_at: null, break_started_at: null }), 'working')
  assert.equal(attendanceState({ clock_in_at: '2026-09-17T00:00:00Z', clock_out_at: null, original_clock_in_at: null, original_clock_out_at: null, break_started_at: '2026-09-17T04:00:00Z' }), 'on_break')
  assert.equal(attendanceState({ clock_in_at: '2026-09-17T00:00:00Z', clock_out_at: '2026-09-17T08:00:00Z', original_clock_in_at: null, original_clock_out_at: null, break_started_at: null }), 'done')
  // Regression guard: idle and done must never collapse to the same state.
  assert.notEqual(
    attendanceState({ clock_in_at: null, clock_out_at: null, original_clock_in_at: null, original_clock_out_at: null, break_started_at: null }),
    attendanceState({ clock_in_at: '2026-09-17T00:00:00Z', clock_out_at: '2026-09-17T08:00:00Z', original_clock_in_at: null, original_clock_out_at: null, break_started_at: null }),
  )
})

test('attendanceState prefers original_* over the editable fields once a real clock-in is tracked', () => {
  const trackedWorking = { clock_in_at: '2026-09-17T00:00:00Z', clock_out_at: null, original_clock_in_at: '2026-09-17T00:00:00Z', original_clock_out_at: null, break_started_at: null }
  assert.equal(attendanceState(trackedWorking), 'working')

  // Pre-filling clock_out_at via a month-page edit, before actually punching out, must not
  // end the shift early (this was the root cause of the Copilot-flagged Medium finding).
  assert.equal(attendanceState({ ...trackedWorking, clock_out_at: '2026-09-17T05:00:00Z' }), 'working')

  const trackedDone = { ...trackedWorking, clock_out_at: '2026-09-17T08:00:00Z', original_clock_out_at: '2026-09-17T08:00:00Z' }
  assert.equal(attendanceState(trackedDone), 'done')

  // Clearing clock_out_at via a month-page edit must not reopen an already-punched-out shift;
  // original_clock_out_at is immutable once a real clock-out has happened.
  assert.equal(attendanceState({ ...trackedDone, clock_out_at: null }), 'done')
})

test('canPerform only allows the modeled transitions per state', () => {
  assert.deepEqual(
    (['idle', 'working', 'on_break', 'done'] as const).map(state => ({
      state,
      in: canPerform(state, 'in'),
      break_start: canPerform(state, 'break_start'),
      break_end: canPerform(state, 'break_end'),
      out: canPerform(state, 'out'),
    })),
    [
      { state: 'idle', in: true, break_start: false, break_end: false, out: false },
      { state: 'working', in: false, break_start: true, break_end: false, out: true },
      { state: 'on_break', in: false, break_start: false, break_end: true, out: false },
      { state: 'done', in: false, break_start: false, break_end: false, out: false },
    ],
  )
})

test('explicit Japan dates round-trip across midnight, month and year boundaries', () => {
  for (const value of ['2026-09-17T23:00', '2026-09-18T05:00', '2027-01-01T00:00', '2028-02-29T03:59']) {
    assert.equal(japanDateTime(parseJapanDateTime(value)), value)
    assert.equal(displayJapanDateTime(parseJapanDateTime(value)), value.replace('T', ' '))
  }
  assert.equal(parseJapanDateTime('2026-09-18T05:00'), '2026-09-17T20:00:00.000Z')
  assert.equal(parseJapanDateTime(''), null)
})

test('reject invalid or normalized dates and invalid runtime types', () => {
  for (const value of ['2026-02-29T01:00', '2026-04-31T12:00', '2026-09-17T24:00', '2026-09-17T09:60', '2026-13-01T00:00', '09:00', {}, 1]) {
    assert.throws(() => parseJapanDateTime(value))
  }
})

test('calculate break and work duration with various break states', () => {
  // 1. Finished shift without break
  const noBreak = {
    id: '1', work_date: '2026-09-17',
    clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: '2026-09-17T09:00:00.000Z',
    original_clock_in_at: null, original_clock_out_at: null,
  }
  assert.equal(calculateBreakMinutes(noBreak), 0)
  assert.equal(calculateWorkMinutes(noBreak), 540)

  // 2. Finished shift with accumulated 60m break
  const withBreak = {
    ...noBreak,
    total_break_seconds: 3600,
  }
  assert.equal(calculateBreakMinutes(withBreak), 60)
  assert.equal(calculateWorkMinutes(withBreak), 480)

  // 3. Manual break override (e.g. 45m) takes precedence over accumulated seconds
  const manualOverride = {
    ...withBreak,
    break_minutes: 45,
  }
  assert.equal(calculateBreakMinutes(manualOverride), 45)
  assert.equal(calculateWorkMinutes(manualOverride), 495)

  // 4. In-flight shift, not currently taking a break
  const inFlightWorking = {
    id: '2', work_date: '2026-09-17',
    clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: null,
    total_break_seconds: 1800, break_started_at: null,
    original_clock_in_at: null, original_clock_out_at: null,
  }
  const nowA = new Date('2026-09-17T04:00:00.000Z') // 4 hours after in
  assert.equal(calculateBreakMinutes(inFlightWorking, nowA), 30)
  assert.equal(calculateWorkMinutes(inFlightWorking, nowA), 210) // 240 - 30 = 210m

  // 5. In-flight shift, currently on break
  const inFlightOnBreak = {
    ...inFlightWorking,
    break_started_at: '2026-09-17T03:30:00.000Z',
  }
  assert.equal(calculateBreakMinutes(inFlightOnBreak, nowA), 60) // 30m prior + 30m active
  assert.equal(calculateWorkMinutes(inFlightOnBreak, nowA), 180) // Gross stopped at break_start: 210m - 30m prior = 180m

  // 6. Overnight shift
  const overnight = {
    id: '3', work_date: '2026-09-17',
    clock_in_at: '2026-09-17T13:00:00.000Z', clock_out_at: '2026-09-17T22:00:00.000Z', // 22:00 to 07:00 JST (9 hrs)
    total_break_seconds: 3600,
    original_clock_in_at: null, original_clock_out_at: null,
  }
  assert.equal(calculateBreakMinutes(overnight), 60)
  assert.equal(calculateWorkMinutes(overnight), 480)
})

test('punch duration calculations ignore manual break overrides', () => {
  const record = {
    id: 'override', work_date: '2026-09-17',
    clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: '2026-09-17T09:00:00.000Z',
    total_break_seconds: 3600, break_minutes: 45,
    original_clock_in_at: null, original_clock_out_at: null,
  }
  assert.equal(calculatePunchBreakMinutes(record), 60)
  assert.equal(calculatePunchWorkMinutes(record), 480)
})

test('original punch duration calculations ignore monthly edits', () => {
  const record = {
    id: 'original', work_date: '2026-09-17',
    clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: '2026-09-17T20:00:00.000Z',
    original_clock_in_at: '2026-09-17T01:00:00.000Z', original_clock_out_at: '2026-09-17T09:00:00.000Z',
    total_break_seconds: 9999, original_total_break_seconds: 3600, break_minutes: 15,
  }
  assert.equal(calculateOriginalBreakMinutes(record), 60)
  assert.equal(calculateOriginalWorkMinutes(record), 420)
})

test('original punch duration keeps updating in the browser while working or on break', () => {
  const now = new Date('2026-09-17T04:00:00.000Z')
  const working = {
    id: 'working', work_date: '2026-09-17', clock_in_at: null, clock_out_at: null,
    original_clock_in_at: '2026-09-17T00:00:00.000Z', original_clock_out_at: null,
    original_total_break_seconds: 1800, total_break_seconds: 0, break_started_at: null,
  }
  assert.equal(calculateOriginalBreakMinutes(working, now), 30)
  assert.equal(calculateOriginalWorkMinutes(working, now), 210)
  const onBreak = { ...working, break_started_at: '2026-09-17T03:30:00.000Z' }
  assert.equal(calculateOriginalBreakMinutes(onBreak, now), 60)
  assert.equal(calculateOriginalWorkMinutes(onBreak, now), 180)
})

test('formatDuration formats minutes cleanly', () => {
  assert.equal(formatDuration(null), '—')
  assert.equal(formatDuration(undefined), '—')
  assert.equal(formatDuration(0), '0:00')
  assert.equal(formatDuration(45), '0:45')
  assert.equal(formatDuration(480), '8:00')
  assert.equal(formatDuration(495), '8:15')

  assert.equal(formatDurationHuman(null), '—')
  assert.equal(formatDurationHuman(0), '0時間0分')
  assert.equal(formatDurationHuman(495), '8時間15分')
})
