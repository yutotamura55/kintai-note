import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { DatabaseSync } from 'node:sqlite'

// Execute the real guarded update against SQLite. Only the D1 transport is adapted.
const source = readFileSync(new URL('../server/utils/attendance.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '').replace(/^export /gm, ''))

test('a stale edit or restoration cannot overwrite a concurrent clock-out', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
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
  } finally { sqlite.close() }
})
