import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { consumeChallengeRow, createInitialAdmin, consumeAuthLimit } from '../server/utils/auth-storage.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  sqlite.exec(readFileSync(new URL('../migrations/0003_auth_rate_limits.sql', import.meta.url), 'utf8'))
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

test('a challenge is returned once and cannot be replayed', async () => {
  const { sqlite, database } = fixture()
  try {
    sqlite.prepare('INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)')
      .run('challenge-1', 'signed-data', 'login', '2026-10-24T00:00:00.000Z')
    const now = '2026-10-23T00:00:00.000Z'
    assert.equal((await consumeChallengeRow(database, 'challenge-1', 'login', now))?.challenge, 'signed-data')
    assert.equal(await consumeChallengeRow(database, 'challenge-1', 'login', now), null)
  } finally { sqlite.close() }
})

test('expired or wrong-purpose challenges are not consumed as valid', async () => {
  const { sqlite, database } = fixture()
  try {
    sqlite.prepare('INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES (?, ?, ?, ?)')
      .run('challenge-1', 'signed-data', 'register', '2026-10-23T00:00:00.000Z')
    assert.equal(await consumeChallengeRow(database, 'challenge-1', 'login', '2026-10-22T00:00:00.000Z'), null)
    assert.equal(await consumeChallengeRow(database, 'challenge-1', 'register', '2026-10-23T00:00:00.000Z'), null)
  } finally { sqlite.close() }
})

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

test('auth limiter denies excess attempts and resets after the window', async () => {
  const { sqlite, database } = fixture()
  try {
    const start = '2026-10-23T00:00:00.000Z'
    const reset = '2026-10-23T00:05:00.000Z'
    assert.equal(await consumeAuthLimit(database, 'login:visitor', start, reset, 2), true)
    assert.equal(await consumeAuthLimit(database, 'login:visitor', start, reset, 2), true)
    assert.equal(await consumeAuthLimit(database, 'login:visitor', start, reset, 2), false)
    const changesBeforeRetry = sqlite.prepare('SELECT total_changes() AS count').get()!.count
    assert.equal(await consumeAuthLimit(database, 'login:visitor', start, reset, 2), false)
    assert.equal(sqlite.prepare('SELECT total_changes() AS count').get()!.count, changesBeforeRetry)
    assert.equal(await consumeAuthLimit(database, 'login:visitor', reset, '2026-10-23T00:10:00.000Z', 2), true)
    assert.equal(sqlite.prepare('SELECT attempts FROM auth_rate_limits WHERE key=?').get('login:visitor')!.attempts, 1)
  } finally { sqlite.close() }
})
