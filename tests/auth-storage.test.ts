import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createInitialAdmin } from '../server/utils/auth-storage.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  const database = {
    prepare(sql: string) {
      return { bind(...args: unknown[]) {
        const statement = sqlite.prepare(sql)
        return {
          first: async () => statement.get(...args as []) ?? null,
          run: async () => ({ meta: { changes: statement.run(...args as []).changes } }),
        }
      } }
    },
  }
  return { sqlite, database: database as never }
}

test('only the first concurrent bootstrap request creates an administrator', async () => {
  const { sqlite, database } = fixture()
  try {
    const outcomes = await Promise.all([
      createInitialAdmin(database, 'admin-1', 'e1', 'First'),
      createInitialAdmin(database, 'admin-2', 'e2', 'Second'),
    ])
    assert.deepEqual(outcomes.sort(), [false, true])
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()!.count, 1)
    assert.equal(sqlite.prepare('SELECT role FROM users').get()!.role, 'admin')
  } finally { sqlite.close() }
})
