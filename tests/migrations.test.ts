import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const baseline = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8')
const migrationFiles = () =>
  readdirSync(new URL('../migrations/', import.meta.url))
    .filter((name) => name.endsWith('.sql'))
    .sort()
const readMigration = (file: string) => readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8')

// Exercise the real SQL against both an empty DB and the pre-feature baseline.
for (const legacy of [false, true]) {
  test(`original-time migration preserves ${legacy ? 'legacy records' : 'fresh database setup'}`, () => {
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(baseline)
      if (legacy)
        db.exec(`INSERT INTO users (id,employee_code,display_name) VALUES ('u','u','U');
        INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,clock_out_at)
        VALUES ('a','u','2026-09-19','2026-09-19T00:00:12.345Z','2026-09-19T09:00:45.678Z')`)
      // The production setup reapplies the baseline before pending migrations.
      db.exec(baseline)
      for (const file of migrationFiles()) db.exec(readMigration(file))
      const columns = db
        .prepare('PRAGMA table_info(attendance_records)')
        .all()
        .map((row) => row.name)
      assert.ok(columns.includes('original_clock_in_at') && columns.includes('original_clock_out_at'))
      assert.ok(
        columns.includes('break_started_at') &&
          columns.includes('total_break_seconds') &&
          columns.includes('original_total_break_seconds') &&
          columns.includes('break_minutes'),
      )
      if (legacy) {
        const row = db.prepare('SELECT * FROM attendance_records WHERE id=?').get('a')!
        assert.equal(row.original_clock_in_at, null)
        assert.equal(row.original_clock_out_at, null)
        assert.equal(row.break_started_at, null)
        assert.equal(row.total_break_seconds, 0)
        assert.equal(row.original_total_break_seconds, 0)
        assert.equal(row.break_minutes, null)
        assert.equal(row.clock_in_at, '2026-09-19T00:00:12.345Z')
        assert.equal(row.clock_out_at, '2026-09-19T09:00:45.678Z')
        assert.equal(row.work_date, '2026-09-19')
      }
    } finally {
      db.close()
    }
  })
}

// One row per table, parents first. A new table must add its row here.
const seedRows: Record<string, string> = {
  users: `INSERT INTO users (id,employee_code,display_name) VALUES ('u','u','U')`,
  invitations: `INSERT INTO invitations (id,user_id,token_hash,expires_at) VALUES ('i','u','h','2026-01-01T00:00:00.000Z')`,
  passkeys: `INSERT INTO passkeys (id,user_id,credential_id,public_key) VALUES ('p','u','c','k')`,
  auth_challenges: `INSERT INTO auth_challenges (id,challenge,purpose,user_id,invitation_id,expires_at)
    VALUES ('c','c','register','u','i','2026-01-01T00:00:00.000Z')`,
  sessions: `INSERT INTO sessions (id,user_id,expires_at) VALUES ('s','u','2026-01-01T00:00:00.000Z')`,
  attendance_records: `INSERT INTO attendance_records (id,user_id,work_date) VALUES ('a','u','2026-01-01')`,
  auth_rate_limits: `INSERT INTO auth_rate_limits (key,attempts,reset_at) VALUES ('k',1,'2026-01-01T00:00:00.000Z')`,
}

test('every migration keeps the existing rows of every table', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(baseline)
    const seeded = new Set<string>()
    const seedNewTables = () => {
      const tables = db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all()
        .map((row) => String(row.name))
      for (const table of tables) assert.ok(Object.hasOwn(seedRows, table), `add a row for table ${table} to seedRows`)
      for (const [table, sql] of Object.entries(seedRows)) {
        if (tables.includes(table) && !seeded.has(table)) {
          db.exec(sql)
          seeded.add(table)
        }
      }
    }
    const rowCount = (table: string) => db.prepare(`SELECT count(*) AS n FROM "${table}"`).get()!.n
    for (const file of migrationFiles()) {
      seedNewTables()
      // The production setup reapplies the baseline before pending migrations.
      db.exec(baseline)
      const migration = readMigration(file)
      // D1 ignores this pragma, so a rebuild that relies on it passes here but deletes rows in production.
      assert.doesNotMatch(migration, /\bforeign_keys\b/i, `${file} must not set foreign_keys`)
      db.exec(migration)
      for (const table of seeded) assert.equal(rowCount(table), 1, `${file} changed the rows of ${table}`)
    }
    // Checks that the last migration's tables have a seed and that the next deploy can reapply the baseline.
    seedNewTables()
    db.exec(baseline)
  } finally {
    db.close()
  }
})
