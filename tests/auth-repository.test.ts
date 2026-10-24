import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { d1AuthRepository } from '../server/utils/auth-repository.ts'

function fixture() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'))
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
