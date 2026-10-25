import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { d1AuthRepository } from '../server/utils/auth-repository.ts'

const now = '2026-10-23T00:00:00.000Z'
const expiry = '2026-10-24T00:00:00.000Z'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
  sqlite.prepare("INSERT INTO users (id, employee_code, display_name) VALUES ('user-1', 'e1', 'Test')").run()
  sqlite
    .prepare('INSERT INTO invitations (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
    .run('invite-1', 'user-1', 'hash-1', expiry)
  const database = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { sql, args }
        },
      }
    },
    async batch(statements: { sql: string; args: unknown[] }[]) {
      sqlite.exec('BEGIN IMMEDIATE')
      try {
        const results = statements.map(({ sql, args }) => ({
          meta: { changes: sqlite.prepare(sql).run(...(args as [])).changes },
        }))
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  function register(keyId: string, overrides: Record<string, string> = {}) {
    return d1AuthRepository(database as never).completeInvitation({
      invitationId: 'invite-1',
      userId: 'user-1',
      passkeyId: keyId,
      credentialId: `credential-${keyId}`,
      publicKey: 'public-key',
      counter: 0,
      transports: '[]',
      deviceType: 'singleDevice',
      backedUp: 0,
      now,
      ...overrides,
    })
  }
  return { sqlite, register }
}

test('a completed invitation creates one passkey and rejects a second registration', async () => {
  const { sqlite, register } = fixture()
  try {
    assert.equal(await register('key-1'), true)
    assert.equal(await register('key-2'), false)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM passkeys').get()!.count, 1)
    assert.equal(sqlite.prepare('SELECT status FROM users WHERE id=?').get('user-1')!.status, 'active')
    assert.equal(sqlite.prepare('SELECT used_at FROM invitations WHERE id=?').get('invite-1')!.used_at, now)
  } finally {
    sqlite.close()
  }
})

test('expired invitation cannot register a passkey or activate a user', async () => {
  const { sqlite, register } = fixture()
  try {
    assert.equal(await register('key-1', { now: '2026-10-25T00:00:00.000Z' }), false)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM passkeys').get()!.count, 0)
    assert.equal(sqlite.prepare('SELECT status FROM users WHERE id=?').get('user-1')!.status, 'invited')
  } finally {
    sqlite.close()
  }
})

test('a used invitation stays unusable even if the user returns to invited status', async () => {
  const { sqlite, register } = fixture()
  try {
    assert.equal(await register('key-1'), true)
    sqlite.prepare("UPDATE users SET status='invited' WHERE id='user-1'").run()
    assert.equal(await register('key-2'), false)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM passkeys').get()!.count, 1)
  } finally {
    sqlite.close()
  }
})

test('simultaneous registrations with one invitation produce one passkey', async () => {
  const { sqlite, register } = fixture()
  try {
    const outcomes = await Promise.all([register('key-1'), register('key-2')])
    assert.deepEqual(outcomes.sort(), [false, true])
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM passkeys').get()!.count, 1)
    assert.equal(sqlite.prepare('SELECT used_at FROM invitations WHERE id=?').get('invite-1')!.used_at, now)
    assert.equal(sqlite.prepare('SELECT status FROM users WHERE id=?').get('user-1')!.status, 'active')
  } finally {
    sqlite.close()
  }
})

test('an invitation cannot register a passkey for another user', async () => {
  const { sqlite, register } = fixture()
  try {
    assert.equal(await register('key-1', { userId: 'other-user' }), false)
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM passkeys').get()!.count, 0)
    assert.equal(sqlite.prepare('SELECT used_at FROM invitations WHERE id=?').get('invite-1')!.used_at, null)
  } finally {
    sqlite.close()
  }
})
