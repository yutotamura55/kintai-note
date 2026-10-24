import type { User } from './types'

// Authentication persistence. Callers own cookies, the clock and HTTP errors, and decide
// whether a returned user may sign in.
export interface AuthRepository {
  findSessionUser(sessionId: string, now: string): Promise<User | null>
  createSession(sessionId: string, userId: string, expiresAt: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
}

export function d1AuthRepository(database: D1Database): AuthRepository {
  return {
    // Expired sessions are never returned; the user's status is returned for the caller to check.
    findSessionUser: (sessionId, now) => database.prepare(`SELECT u.id, u.employee_code, u.display_name, u.role, u.status
      FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).bind(sessionId, now).first<User>(),
    async createSession(sessionId, userId, expiresAt) {
      await database.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, userId, expiresAt).run()
    },
    async deleteSession(sessionId) {
      await database.prepare('DELETE FROM sessions WHERE id=?').bind(sessionId).run()
    },
  }
}
