import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'
import { openAttendance, OPEN_SHIFT_SQL, OPEN_SHIFT_ORDER_SQL, EFFECTIVE_CLOCK_IN_SQL } from '../server/utils/attendance.ts'

// Execute the real edit workflow and guarded UPDATE against SQLite. Only the D1 transport is adapted.
const strip = (path: string) => stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace(/^import [\s\S]*? from '[^']*'\n/gm, '').replace(/^export /gm, ''))
const { saveAttendanceTimes: save, resolveBreakMinutes: resolve } = new Function(
  `${strip('../server/utils/attendance-edit.ts')}\nreturn { saveAttendanceTimes, resolveBreakMinutes }`)()
const d1AttendanceRepository = new Function('id', 'openAttendance', 'OPEN_SHIFT_SQL', 'OPEN_SHIFT_ORDER_SQL', 'EFFECTIVE_CLOCK_IN_SQL',
  `${strip('../server/utils/attendance-repository.ts')}\nreturn d1AttendanceRepository`)(
  () => crypto.randomUUID(), openAttendance, OPEN_SHIFT_SQL, OPEN_SHIFT_ORDER_SQL, EFFECTIVE_CLOCK_IN_SQL)

function fixture(rows: string) {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
  sqlite.exec(rows)
  const binding = { prepare: (sql: string) => ({ bind: (...values: any[]) => ({
    run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }),
    first: async () => sqlite.prepare(sql).get(...values) ?? null,
  }) }) }
  const read = (id: string) => sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get(id) as any
  return { sqlite, repository: d1AttendanceRepository(binding), read }
}

test('a stale edit or restoration cannot overwrite a concurrent clock-out', async () => {
  const { sqlite, repository, read } = fixture(`INSERT INTO users (id,employee_code,display_name) VALUES ('u','u','U');
    INSERT INTO attendance_records (id,user_id,work_date,clock_in_at)
    VALUES ('a','u','2026-09-19','2026-09-19T00:00:00.000Z')`)
  try {
    const now = new Date('2026-09-19T10:00:00.000Z')
    const snapshot = read('a')
    // Simulate clock-out after the handler read its snapshot, before its update.
    sqlite.prepare('UPDATE attendance_records SET clock_out_at=? WHERE id=?').run('2026-09-19T09:00:45.678Z', 'a')
    assert.deepEqual(await save(repository, 'u', snapshot, '2026-09-19T00:01:00.000Z', null, undefined, now), { ok: false, reason: 'conflict' })
    const after = read('a')
    assert.equal(after.clock_in_at, '2026-09-19T00:00:00.000Z')
    assert.equal(after.clock_out_at, '2026-09-19T09:00:45.678Z')
    // A fresh snapshot can be saved, proving the adapter actually executes writes.
    assert.deepEqual(await save(repository, 'u', after, '2026-09-19T00:01:00.000Z', after.clock_out_at, undefined, now), { ok: true })
    assert.equal(read('a').clock_in_at, '2026-09-19T00:01:00.000Z')
    assert.equal(read('a').updated_at, '2026-09-19T10:00:00.000Z')

    // Validates breakMinutes
    const latest = read('a')
    assert.deepEqual(await save(repository, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', -1, now), { ok: false, reason: 'invalid_break_minutes' })
    assert.deepEqual(await save(repository, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', 70, now), { ok: false, reason: 'break_exceeds_shift' })
    await save(repository, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', 30, now)
    assert.equal(read('a').break_minutes, 30)
  } finally { sqlite.close() }
})

test('unchanged active punch break remains in accumulation mode when edited', () => {
  const record = {
    break_minutes: null,
    total_break_seconds: 0,
    break_started_at: '2026-09-19T01:00:00.000Z',
  }
  assert.equal(resolve(record, 60, '2026-09-19T02:00:00.000Z', new Date('2026-09-19T02:00:00.000Z')), null)
})

test('monthly clock-out edit does not finalize or mutate an active original punch break', async () => {
  const { sqlite, repository, read } = fixture(`INSERT INTO users (id,employee_code,display_name) VALUES ('u2','u2','U2');
    INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,original_clock_in_at,break_started_at,total_break_seconds,original_total_break_seconds)
    VALUES ('active-break','u2','2026-09-19','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z',120,300)`)
  try {
    const record = read('active-break')
    await save(repository, 'u2', record, record.clock_in_at, '2026-09-19T02:00:00.000Z', undefined, new Date('2026-09-19T02:00:00.000Z'))
    const after = read('active-break')
    assert.equal(after.break_started_at, '2026-09-19T01:00:00.000Z')
    assert.equal(after.clock_out_at, '2026-09-19T02:00:00.000Z')
    assert.equal(after.total_break_seconds, 120)
    assert.equal(after.original_total_break_seconds, 300)
  } finally { sqlite.close() }
})

test('monthly clock-out edit still finalizes an active break on legacy records', async () => {
  const { sqlite, repository, read } = fixture(`INSERT INTO users (id,employee_code,display_name) VALUES ('u3','u3','U3');
    INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,break_started_at,total_break_seconds)
    VALUES ('legacy-break','u3','2026-09-19','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z',120)`)
  try {
    const record = read('legacy-break')
    await save(repository, 'u3', record, record.clock_in_at, '2026-09-19T02:00:00.000Z', undefined, new Date('2026-09-19T02:00:00.000Z'))
    const after = read('legacy-break')
    assert.equal(after.break_started_at, null)
    assert.equal(after.total_break_seconds, 3720)
  } finally { sqlite.close() }
})
