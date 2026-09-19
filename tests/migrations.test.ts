import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

// Exercise the real SQL against both an empty DB and the pre-feature baseline.
for (const legacy of [false, true]) {
  test(`original-time migration preserves ${legacy ? 'legacy records' : 'fresh database setup'}`, () => {
    const db = new DatabaseSync(':memory:')
    try {
      const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
      db.exec(baseline)
      if (legacy) db.exec(`INSERT INTO users (id,employee_code,display_name) VALUES ('u','u','U');
        INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,clock_out_at)
        VALUES ('a','u','2026-09-19','2026-09-19T00:00:12.345Z','2026-09-19T09:00:45.678Z')`)
      // The production setup reapplies the baseline before pending migrations.
      db.exec(baseline)
      for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
        db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
      }
      const columns = db.prepare('PRAGMA table_info(attendance_records)').all().map(row => row.name)
      assert.ok(columns.includes('original_clock_in_at') && columns.includes('original_clock_out_at'))
      if (legacy) {
        const row = db.prepare('SELECT * FROM attendance_records WHERE id=?').get('a')!
        assert.equal(row.original_clock_in_at, null)
        assert.equal(row.original_clock_out_at, null)
        assert.equal(row.clock_in_at, '2026-09-19T00:00:12.345Z')
        assert.equal(row.clock_out_at, '2026-09-19T09:00:45.678Z')
        assert.equal(row.work_date, '2026-09-19')
      }
    } finally { db.close() }
  })
}
