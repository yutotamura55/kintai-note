import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { d1AuthRepository } from '../server/utils/auth-repository.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  for (const file of readdirSync(new URL('../migrations/', import.meta.url)).filter(name => name.endsWith('.sql')).sort()) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'))
  }
  sqlite.exec(`INSERT INTO users (id, employee_code, display_name, role, status) VALUES
    ('active', 'e1', 'Active', 'member', 'active'), ('disabled', 'e2', 'Disabled', 'admin', 'disabled')`)
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
    // D1 runs a batch as one transaction; SQLite does the same here.
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) { sqlite.exec('ROLLBACK'); throw error }
    },
  }
  return { sqlite, repository: d1AuthRepository(database as never) }
}

const now = '2026-10-24T00:00:00.000Z'

test('a session returns its user until it expires or is deleted', async () => {
  const { sqlite, repository } = fixture()
  try {
    await repository.createSession('s1', 'active', '2026-10-24T00:00:01.000Z')
    assert.deepEqual({ ...await repository.findSessionUser('s1', now) },
      { id: 'active', employee_code: 'e1', display_name: 'Active', role: 'member', status: 'active' })
    assert.equal(await repository.findSessionUser('s1', '2026-10-24T00:00:01.000Z'), null, 'A session must not be valid at its expiry time.')
    assert.equal(await repository.findSessionUser('unknown', now), null)
    await repository.deleteSession('s1')
    assert.equal(await repository.findSessionUser('s1', now), null)
  } finally { sqlite.close() }
})

test('a session of a disabled user still reports the status for the caller to reject', async () => {
  const { sqlite, repository } = fixture()
  try {
    await repository.createSession('s2', 'disabled', '2030-01-01T00:00:00.000Z')
    assert.equal((await repository.findSessionUser('s2', now))?.status, 'disabled')
  } finally { sqlite.close() }
})

const challenge = (id: string, expiresAt: string) => ({
  id, challenge: `signed-${id}`, purpose: 'login' as const, user_id: null, invitation_id: null, expires_at: expiresAt,
})

test('a saved challenge is returned once and cannot be replayed', async () => {
  const { sqlite, repository } = fixture()
  try {
    await repository.saveChallenge(challenge('challenge-1', '2026-10-24T00:05:00.000Z'), now)
    assert.equal((await repository.consumeChallenge('challenge-1', 'login', now))?.challenge, 'signed-challenge-1')
    assert.equal(await repository.consumeChallenge('challenge-1', 'login', now), null)
  } finally { sqlite.close() }
})

test('expired or wrong-purpose challenges are not consumed as valid', async () => {
  const { sqlite, repository } = fixture()
  try {
    await repository.saveChallenge({ ...challenge('challenge-1', '2026-10-23T00:00:00.000Z'), purpose: 'register' }, '2026-10-22T00:00:00.000Z')
    assert.equal(await repository.consumeChallenge('challenge-1', 'login', '2026-10-22T00:00:00.000Z'), null)
    assert.equal(await repository.consumeChallenge('challenge-1', 'register', '2026-10-23T00:00:00.000Z'), null)
  } finally { sqlite.close() }
})

test('saving a challenge removes at most 100 expired ones and keeps unexpired ones', async () => {
  const { sqlite, repository } = fixture()
  try {
    const insert = sqlite.prepare("INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES (?, 'x', 'login', ?)")
    for (let index = 0; index < 101; index++) insert.run(`expired-${index}`, '2026-10-23T23:59:59.000Z')
    insert.run('unexpired', '2026-10-24T00:00:01.000Z')
    await repository.saveChallenge(challenge('new', '2026-10-24T00:05:00.000Z'), now)
    const remaining = sqlite.prepare("SELECT id FROM auth_challenges WHERE id NOT LIKE 'expired-%' ORDER BY id").all().map(row => row.id)
    assert.deepEqual(remaining, ['new', 'unexpired'])
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auth_challenges WHERE id LIKE 'expired-%'").get()!.count, 1)
  } finally { sqlite.close() }
})

test('attempts are denied over the limit and allowed again after the window', async () => {
  const { sqlite, repository } = fixture()
  try {
    const start = '2026-10-23T00:00:00.000Z'
    const reset = '2026-10-23T00:05:00.000Z'
    assert.equal(await repository.consumeAttempt('login:visitor', start, reset, 2), true)
    assert.equal(await repository.consumeAttempt('login:visitor', start, reset, 2), true)
    const changesAtLimit = sqlite.prepare('SELECT total_changes() AS count').get()!.count
    assert.equal(await repository.consumeAttempt('login:visitor', start, reset, 2), false)
    assert.equal(sqlite.prepare('SELECT total_changes() AS count').get()!.count, changesAtLimit)
    assert.equal(sqlite.prepare('SELECT attempts FROM auth_rate_limits WHERE key=?').get('login:visitor')!.attempts, 2)
    const changesBeforeRetry = sqlite.prepare('SELECT total_changes() AS count').get()!.count
    assert.equal(await repository.consumeAttempt('login:visitor', start, reset, 2), false)
    assert.equal(sqlite.prepare('SELECT total_changes() AS count').get()!.count, changesBeforeRetry)
    assert.equal(await repository.consumeAttempt('login:visitor', reset, '2026-10-23T00:10:00.000Z', 2), true)
    assert.equal(sqlite.prepare('SELECT attempts FROM auth_rate_limits WHERE key=?').get('login:visitor')!.attempts, 1)
  } finally { sqlite.close() }
})
