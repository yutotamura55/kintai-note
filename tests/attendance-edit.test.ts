import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

// The edit workflow depends only on the repository contract, so a recording fake stands in for D1.
// The guarded UPDATE runs against SQLite in attendance-update.test.ts and against local D1 in npm run test:local.
const source = readFileSync(new URL('../server/utils/attendance-edit.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import [\s\S]*? from '[^']*'\n/gm, '').replace(/^export /gm, ''))
const { findOwnedAttendance, saveAttendanceTimes, editAttendanceTimes, restoreAttendanceTimes } = new Function(
  `${script}\nreturn { findOwnedAttendance, saveAttendanceTimes, editAttendanceTimes, restoreAttendanceTimes }`)()

function fakeRepository({ owned = null, outcome = 'saved' }: { owned?: any; outcome?: string } = {}) {
  const calls: any[] = []
  return {
    calls,
    async findOwned(userId: string, recordId: string) { calls.push(['findOwned', userId, recordId]); return owned },
    async saveTimes(command: any) { calls.push(['saveTimes', command]); return outcome },
  }
}

const instant = new Date('2026-10-24T12:00:00.000Z')
const record = {
  id: 'a', work_date: '2026-10-24', clock_in_at: '2026-10-24T00:10:00.000Z', clock_out_at: '2026-10-24T09:10:00.000Z',
  original_clock_in_at: '2026-10-24T00:00:00.000Z', original_clock_out_at: '2026-10-24T09:00:00.000Z', break_minutes: 45,
}

test('an owned record needs an ID and is looked up only for the signed-in user', async () => {
  const empty = fakeRepository()
  assert.deepEqual(await findOwnedAttendance(empty, 'u', ' '), { ok: false, reason: 'record_id_missing' })
  assert.deepEqual(empty.calls, [])
  const missing = fakeRepository()
  assert.deepEqual(await findOwnedAttendance(missing, 'u', 'other'), { ok: false, reason: 'record_not_found' })
  assert.deepEqual(missing.calls, [['findOwned', 'u', 'other']])
  assert.deepEqual(await findOwnedAttendance(fakeRepository({ owned: record }), 'u', 'a'), { ok: true, record })
})

test('invalid times are rejected before any write', async () => {
  const repository = fakeRepository()
  assert.deepEqual(await saveAttendanceTimes(repository, 'u', record, null, null, undefined, instant), { ok: false, reason: 'clock_in_missing' })
  assert.deepEqual(await saveAttendanceTimes(repository, 'u', record, '2026-10-24T09:00:00.000Z', '2026-10-24T09:00:00.000Z', undefined, instant),
    { ok: false, reason: 'clock_out_not_after_clock_in' })
  // The stored break of 45 minutes is kept when the request omits it, so it must still fit.
  assert.deepEqual(await saveAttendanceTimes(repository, 'u', record, '2026-10-24T09:00:00.000Z', '2026-10-24T09:30:00.000Z', undefined, instant),
    { ok: false, reason: 'break_exceeds_shift' })
  assert.deepEqual(await saveAttendanceTimes(repository, 'u', record, '2026-10-24T09:00:00.000Z', null, 1.5, instant),
    { ok: false, reason: 'invalid_break_minutes' })
  assert.deepEqual(repository.calls, [])
})

test('a save compares against the times that were read and reports a conflict', async () => {
  const repository = fakeRepository({ outcome: 'conflict' })
  assert.deepEqual(await saveAttendanceTimes(repository, 'u', record, '2026-10-24T00:05:00.000Z', null, null, instant), { ok: false, reason: 'conflict' })
  assert.deepEqual(repository.calls, [['saveTimes', {
    userId: 'u', recordId: 'a', expectedClockInAt: '2026-10-24T00:10:00.000Z', expectedClockOutAt: '2026-10-24T09:10:00.000Z',
    clockInAt: '2026-10-24T00:05:00.000Z', clockOutAt: null, breakMinutes: null, atIso: '2026-10-24T12:00:00.000Z',
  }]])
})

test('restoration writes the stored originals and clears the manual break', async () => {
  const repository = fakeRepository({ owned: record })
  assert.deepEqual(await restoreAttendanceTimes(repository, 'u', 'a', instant), { ok: true })
  assert.deepEqual(repository.calls[1][1], {
    userId: 'u', recordId: 'a', expectedClockInAt: '2026-10-24T00:10:00.000Z', expectedClockOutAt: '2026-10-24T09:10:00.000Z',
    clockInAt: '2026-10-24T00:00:00.000Z', clockOutAt: '2026-10-24T09:00:00.000Z', breakMinutes: null, atIso: '2026-10-24T12:00:00.000Z',
  })

  const legacy = fakeRepository({ owned: { ...record, original_clock_in_at: null, original_clock_out_at: null, break_minutes: null } })
  assert.deepEqual(await restoreAttendanceTimes(legacy, 'u', 'a', instant), { ok: false, reason: 'no_original_times' })
  const notOwned = fakeRepository()
  assert.deepEqual(await restoreAttendanceTimes(notOwned, 'u', 'other', instant), { ok: false, reason: 'record_not_found' })
  assert.deepEqual([...legacy.calls, ...notOwned.calls].map(call => call[0]), ['findOwned', 'findOwned'])
})

test('an edit checks the running break before the requested break minutes', async () => {
  const onBreak = { ...record, clock_out_at: null, original_clock_out_at: null, break_started_at: '2026-10-24T03:00:00.000Z', total_break_seconds: 0 }
  const repository = fakeRepository()
  assert.deepEqual(await editAttendanceTimes(repository, 'u', onBreak, onBreak.clock_in_at, '2026-10-24T02:00:00.000Z', 'abc', instant),
    { ok: false, reason: 'clock_out_before_break_start' })
  assert.deepEqual(await editAttendanceTimes(repository, 'u', onBreak, onBreak.clock_in_at, null, 'abc', instant), { ok: false, reason: 'invalid_break_minutes' })
  assert.deepEqual(await editAttendanceTimes(repository, 'u', onBreak, onBreak.clock_in_at, null, -5, instant), { ok: false, reason: 'invalid_break_minutes' })
  assert.deepEqual(repository.calls, [])
})

test('an edit keeps an omitted break, clears null or empty input, and saves a given number', async () => {
  const breaks = []
  for (const requested of [undefined, null, '', '30']) {
    const repository = fakeRepository()
    assert.deepEqual(await editAttendanceTimes(repository, 'u', record, record.clock_in_at, record.clock_out_at, requested, instant), { ok: true })
    breaks.push(repository.calls[0][1].breakMinutes)
  }
  assert.deepEqual(breaks, [45, null, null, 30])
})
