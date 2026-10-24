import type { User } from './types'

export interface AuthChallenge {
  id: string
  challenge: string
  purpose: 'login' | 'register'
  user_id: string | null
  invitation_id: string | null
  expires_at: string
}

// Authentication persistence. Callers own cookies, the clock and HTTP errors, and decide
// whether a returned user may sign in.
export interface AuthRepository {
  findSessionUser(sessionId: string, now: string): Promise<User | null>
  createSession(sessionId: string, userId: string, expiresAt: string): Promise<void>
  deleteSession(sessionId: string): Promise<void>
  // true while the key stays within the limit for the current window.
  consumeAttempt(key: string, now: string, resetAt: string, limit: number): Promise<boolean>
  saveChallenge(challenge: AuthChallenge, now: string): Promise<void>
  // Returns a valid challenge at most once.
  consumeChallenge(challengeId: string, purpose: 'login' | 'register', now: string): Promise<AuthChallenge | null>
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
    async consumeAttempt(key, now, resetAt, limit) {
      // Keep cleanup work bounded even when many old visitor keys exist.
      await database.prepare(`DELETE FROM auth_rate_limits WHERE key IN
        (SELECT key FROM auth_rate_limits WHERE reset_at<=? LIMIT 100)`).bind(now).run()
      const row = await database.prepare(`INSERT INTO auth_rate_limits (key, attempts, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET
          attempts=CASE WHEN auth_rate_limits.reset_at<=? THEN 1
            WHEN auth_rate_limits.attempts<? THEN auth_rate_limits.attempts+1
            ELSE auth_rate_limits.attempts END,
          reset_at=CASE WHEN auth_rate_limits.reset_at<=? THEN excluded.reset_at ELSE auth_rate_limits.reset_at END
        WHERE auth_rate_limits.reset_at<=? OR auth_rate_limits.attempts<?
        RETURNING attempts`)
        .bind(key, resetAt, now, limit, now, now, limit).first<{ attempts: number }>()
      return !!row && row.attempts <= limit
    },
    // Also removes up to 100 expired challenges; an unexpired one is only removed when consumed.
    async saveChallenge(challenge, now) {
      await database.batch([
        database.prepare(`DELETE FROM auth_challenges WHERE id IN
          (SELECT id FROM auth_challenges WHERE expires_at<=? LIMIT 100)`).bind(now),
        database.prepare('INSERT INTO auth_challenges (id, challenge, purpose, user_id, invitation_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(challenge.id, challenge.challenge, challenge.purpose, challenge.user_id, challenge.invitation_id, challenge.expires_at),
      ])
    },
    consumeChallenge: (challengeId, purpose, now) => database.prepare('DELETE FROM auth_challenges WHERE id=? AND purpose=? AND expires_at>? RETURNING *')
      .bind(challengeId, purpose, now).first<AuthChallenge>(),
  }
}
