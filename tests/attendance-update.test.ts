import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

// Execute the real guarded update against SQLite. Only the D1 transport is adapted.
const source = readFileSync(new URL('../server/utils/attendance.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '').replace(/^export /gm, ''))

test('a stale edit or restoration cannot overwrite a concurrent clock-out', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
    }
    sqlite.exec(`INSERT INTO users (id,employee_code,display_name) VALUES ('u','u','U');
      INSERT INTO attendance_records (id,user_id,work_date,clock_in_at)
      VALUES ('a','u','2026-09-19','2026-09-19T00:00:00.000Z')`)
    const snapshot = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('a')
    const binding = { prepare: (sql: string) => ({ bind: (...values: any[]) => ({ run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }) }) }) }
    const save = new Function('db', 'isoNow', 'createError', `${script}\nreturn saveAttendanceTimes`)(
      () => binding, () => '2026-09-19T10:00:00.000Z', (options: any) => Object.assign(new Error(options.statusMessage), options))
    // Simulate clock-out after the handler read its snapshot, before its update.
    sqlite.prepare('UPDATE attendance_records SET clock_out_at=? WHERE id=?').run('2026-09-19T09:00:45.678Z', 'a')
    await assert.rejects(save({}, 'u', snapshot, '2026-09-19T00:01:00.000Z', null), { statusCode: 409 })
    const after = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('a')!
    assert.equal(after.clock_in_at, '2026-09-19T00:00:00.000Z')
    assert.equal(after.clock_out_at, '2026-09-19T09:00:45.678Z')
    // A fresh snapshot can be saved, proving the adapter actually executes writes.
    await save({}, 'u', after, '2026-09-19T00:01:00.000Z', after.clock_out_at)
    assert.equal(sqlite.prepare('SELECT clock_in_at FROM attendance_records WHERE id=?').get('a')!.clock_in_at, '2026-09-19T00:01:00.000Z')

    // Validates breakMinutes
    const latest = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('a')!
    await assert.rejects(save({}, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', -1), { statusCode: 400 })
    await assert.rejects(save({}, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', 70), { statusCode: 400 })
    await save({}, 'u', latest, '2026-09-19T00:00:00.000Z', '2026-09-19T01:00:00.000Z', 30)
    assert.equal(sqlite.prepare('SELECT break_minutes FROM attendance_records WHERE id=?').get('a')!.break_minutes, 30)
  } finally { sqlite.close() }
})

test('unchanged active punch break remains in accumulation mode when edited', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
    }
    const record = {
      break_minutes: null,
      total_break_seconds: 0,
      break_started_at: '2026-09-19T01:00:00.000Z',
    }
    const resolve = new Function(`${script}\nreturn resolveBreakMinutes`)()
    assert.equal(resolve(record, 60, '2026-09-19T02:00:00.000Z', new Date('2026-09-19T02:00:00.000Z')), null)
  } finally { sqlite.close() }
})

test('monthly clock-out edit does not finalize or mutate an active original punch break', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
    }
    sqlite.exec(`INSERT INTO users (id,employee_code,display_name) VALUES ('u2','u2','U2');
      INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,original_clock_in_at,break_started_at,total_break_seconds,original_total_break_seconds)
      VALUES ('active-break','u2','2026-09-19','2026-09-19T00:00:00.000Z','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z',120,300)`)
    const record = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('active-break')
    const binding = { prepare: (sql: string) => ({ bind: (...values: any[]) => ({ run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }) }) }) }
    const save = new Function('db', 'isoNow', 'createError', `${script}\nreturn saveAttendanceTimes`)(
      () => binding, () => '2026-09-19T02:00:00.000Z', (options: any) => Object.assign(new Error(options.statusMessage), options))
    await save({}, 'u2', record, record.clock_in_at, '2026-09-19T02:00:00.000Z')
    const after = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('active-break') as any
    assert.equal(after.break_started_at, '2026-09-19T01:00:00.000Z')
    assert.equal(after.clock_out_at, '2026-09-19T02:00:00.000Z')
    assert.equal(after.total_break_seconds, 120)
    assert.equal(after.original_total_break_seconds, 300)
  } finally { sqlite.close() }
})

test('monthly clock-out edit still finalizes an active break on legacy records', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
    for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
      sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
    }
    sqlite.exec(`INSERT INTO users (id,employee_code,display_name) VALUES ('u3','u3','U3');
      INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,break_started_at,total_break_seconds)
      VALUES ('legacy-break','u3','2026-09-19','2026-09-19T00:00:00.000Z','2026-09-19T01:00:00.000Z',120)`)
    const record = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('legacy-break')
    const binding = { prepare: (sql: string) => ({ bind: (...values: any[]) => ({ run: async () => ({ meta: { changes: sqlite.prepare(sql).run(...values).changes } }) }) }) }
    const save = new Function('db', 'isoNow', 'createError', `${script}\nreturn saveAttendanceTimes`)(
      () => binding, () => '2026-09-19T02:00:00.000Z', (options: any) => Object.assign(new Error(options.statusMessage), options))
    await save({}, 'u3', record, record.clock_in_at, '2026-09-19T02:00:00.000Z')
    const after = sqlite.prepare('SELECT * FROM attendance_records WHERE id=?').get('legacy-break') as any
    assert.equal(after.break_started_at, null)
    assert.equal(after.total_break_seconds, 3720)
  } finally { sqlite.close() }
})
