export interface ChallengeRow {
  id: string
  challenge: string
  purpose: 'login' | 'register'
  user_id: string | null
  invitation_id: string | null
  expires_at: string
}

export async function consumeChallengeRow(database: D1Database, challengeId: string, purpose: 'login' | 'register', now: string) {
  return database.prepare('DELETE FROM auth_challenges WHERE id=? AND purpose=? AND expires_at>? RETURNING *')
    .bind(challengeId, purpose, now).first<ChallengeRow>()
}

export async function createInitialAdmin(database: D1Database, userId: string, employeeCode: string, displayName: string) {
  const result = await database.prepare(`INSERT INTO users (id, employee_code, display_name, role, status)
    SELECT ?, ?, ?, 'admin', 'active' WHERE NOT EXISTS (SELECT 1 FROM users)`)
    .bind(userId, employeeCode, displayName).run()
  return result.meta.changes === 1
}

export async function consumeAuthLimit(database: D1Database, key: string, now: string, resetAt: string, limit: number) {
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
}
