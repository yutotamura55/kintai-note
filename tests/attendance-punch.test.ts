import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { workDateAt } from '../shared/utils/attendance.ts'

// The punch workflow depends only on the repository contract, so a recording fake stands in for D1.
// The guarded SQL itself is exercised against local D1 by npm run test:local.
const source = readFileSync(new URL('../server/utils/attendance-punch.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import [\s\S]*? from '[^']*'\n/gm, '').replace(/^export /gm, ''))
const recordPunch = new Function('workDateAt', `${script}\nreturn recordPunch`)(workDateAt)

function fakeRepository({ oldestOpen = null, owned = null, outcome = 'applied' }: { oldestOpen?: any; owned?: any; outcome?: string } = {}) {
  const calls: any[] = []
  return {
    calls,
    async findOldestOpen(userId: string) { calls.push(['findOldestOpen', userId]); return oldestOpen },
    async findOwned(userId: string, recordId: string) { calls.push(['findOwned', userId, recordId]); return owned },
    async applyPunch(command: any) { calls.push(['applyPunch', command]); return outcome },
  }
}

test('clock-in takes the work date and stored time from the same instant', async () => {
  // 03:59:59.999 in Japan still belongs to the previous work day.
  const instant = new Date('2026-10-23T18:59:59.999Z')
  const repository = fakeRepository()
  assert.deepEqual(await recordPunch(repository, 'u', 'in', undefined, instant), { ok: true })
  assert.deepEqual(repository.calls, [['applyPunch', { userId: 'u', action: 'in', atIso: '2026-10-23T18:59:59.999Z', workDate: '2026-10-23' }]])
})

test('a rejected clock-in is explained only after the guarded write', async () => {
  const instant = new Date('2026-10-24T00:00:00.000Z')
  const withOpen = fakeRepository({ oldestOpen: { id: 'open' }, outcome: 'unchanged' })
  assert.deepEqual(await recordPunch(withOpen, 'u', 'in', undefined, instant), { ok: false, reason: 'open_shift_exists' })
  assert.deepEqual(withOpen.calls.map(call => call[0]), ['applyPunch', 'findOldestOpen'])
  const finished = fakeRepository({ outcome: 'unchanged' })
  assert.deepEqual(await recordPunch(finished, 'u', 'in', undefined, instant), { ok: false, reason: 'already_clocked_in' })
})

test('breaks without an ID target the oldest open shift; explicit IDs are trimmed and not replaced', async () => {
  const instant = new Date('2026-10-24T03:00:00.000Z')
  const omitted = fakeRepository({ oldestOpen: { id: 'oldest' } })
  assert.deepEqual(await recordPunch(omitted, 'u', 'break_start', '  ', instant), { ok: true })
  assert.deepEqual(omitted.calls, [['findOldestOpen', 'u'], ['applyPunch', { userId: 'u', action: 'break_start', atIso: '2026-10-24T03:00:00.000Z', recordId: 'oldest' }]])

  const explicit = fakeRepository({ oldestOpen: { id: 'oldest' }, outcome: 'unchanged' })
  assert.deepEqual(await recordPunch(explicit, 'u', 'break_end', ' newer ', instant), { ok: false, reason: 'break_end_rejected' })
  assert.deepEqual(explicit.calls, [['applyPunch', { userId: 'u', action: 'break_end', atIso: '2026-10-24T03:00:00.000Z', recordId: 'newer' }]])

  const none = fakeRepository()
  assert.deepEqual(await recordPunch(none, 'u', 'break_start', undefined, instant), { ok: false, reason: 'no_open_shift' })
  assert.deepEqual(none.calls.map(call => call[0]), ['findOldestOpen'])
  const rejected = fakeRepository({ outcome: 'unchanged' })
  assert.deepEqual(await recordPunch(rejected, 'u', 'break_start', 'a', instant), { ok: false, reason: 'break_start_rejected' })
})

test('clock-out requires an explicit ID and reports an ongoing break before writing', async () => {
  const instant = new Date('2026-10-24T09:00:00.000Z')
  const missing = fakeRepository({ oldestOpen: { id: 'oldest' } })
  assert.deepEqual(await recordPunch(missing, 'u', 'out', '', instant), { ok: false, reason: 'clock_out_target_missing' })
  assert.deepEqual(missing.calls, [])

  const onBreak = fakeRepository({ owned: { id: 'a', break_started_at: '2026-10-24T08:00:00.000Z' } })
  assert.deepEqual(await recordPunch(onBreak, 'u', 'out', 'a', instant), { ok: false, reason: 'on_break' })
  assert.deepEqual(onBreak.calls, [['findOwned', 'u', 'a']])

  const working = fakeRepository({ owned: { id: 'a', break_started_at: null } })
  assert.deepEqual(await recordPunch(working, 'u', 'out', 'a', instant), { ok: true })
  assert.deepEqual(working.calls[1], ['applyPunch', { userId: 'u', action: 'out', atIso: '2026-10-24T09:00:00.000Z', recordId: 'a' }])

  // An unknown or another user's ID finds no owned record; the guarded UPDATE decides the result.
  const unknown = fakeRepository({ outcome: 'unchanged' })
  assert.deepEqual(await recordPunch(unknown, 'u', 'out', 'not-owned', instant), { ok: false, reason: 'clock_out_rejected' })
  assert.deepEqual(unknown.calls.map(call => call[0]), ['findOwned', 'applyPunch'])
})
