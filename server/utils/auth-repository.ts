import type { User } from './types'

export interface AuthChallenge {
  id: string
  challenge: string
  purpose: 'login' | 'register'
  user_id: string | null
  invitation_id: string | null
  expires_at: string
}

export interface NewPasskey {
  passkeyId: string
  userId: string
  credentialId: string
  publicKey: string
  counter: number
  transports: string
  deviceType: string
  backedUp: number
}

export interface InvitationPasskey extends NewPasskey {
  invitationId: string
  now: string
}

export interface LoginPasskey {
  id: string
  user_id: string
  credential_id: string
  public_key: string
  counter: number
  transports: string | null
  status: User['status']
}

export interface PasskeyCredential {
  credential_id: string
  transports: string | null
}

export interface InvitedUser {
  invitation_id: string
  id: string
  employee_code: string
  display_name: string
}

export interface NewInvitation {
  invitationId: string
  userId: string
  employeeCode: string
  displayName: string
  tokenHash: string
  expiresAt: string
}

export interface SetupUser {
  id: string
  employee_code: string
  display_name: string
  role: User['role']
  passkey_count: number
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
  // The passkey with its owner's status; the caller rejects users who are not active.
  findPasskeyForLogin(credentialId: string): Promise<LoginPasskey | null>
  recordPasskeyUse(passkeyId: string, counter: number, usedAt: string): Promise<void>
  listPasskeyCredentials(userId: string): Promise<PasskeyCredential[]>
  addPasskey(passkey: NewPasskey): Promise<void>
  createInvitation(invitation: NewInvitation): Promise<void>
  // An unused, unexpired invitation whose user has not activated yet.
  findUsableInvitation(tokenHash: string, now: string): Promise<InvitedUser | null>
  // true only if the invitation was claimed, the passkey added and the user activated together.
  completeInvitation(passkey: InvitationPasskey): Promise<boolean>
  listSetupUsers(): Promise<SetupUser[]>
  // true only for the request that creates the first user of the system.
  createInitialAdmin(userId: string, employeeCode: string, displayName: string): Promise<boolean>
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
    findPasskeyForLogin: credentialId => database.prepare('SELECT p.*, u.status FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.credential_id=?')
      .bind(credentialId).first<LoginPasskey>(),
    async recordPasskeyUse(passkeyId, counter, usedAt) {
      await database.prepare('UPDATE passkeys SET counter=?, last_used_at=? WHERE id=?').bind(counter, usedAt, passkeyId).run()
    },
    async listPasskeyCredentials(userId) {
      return (await database.prepare('SELECT credential_id, transports FROM passkeys WHERE user_id=?').bind(userId).all<PasskeyCredential>()).results
    },
    async addPasskey(passkey) {
      await database.prepare(`INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(passkey.passkeyId, passkey.userId, passkey.credentialId, passkey.publicKey, passkey.counter,
          passkey.transports, passkey.deviceType, passkey.backedUp).run()
    },
    async createInvitation(invitation) {
      await database.batch([
        database.prepare("INSERT INTO users (id, employee_code, display_name) VALUES (?, ?, ?)").bind(invitation.userId, invitation.employeeCode, invitation.displayName),
        database.prepare('INSERT INTO invitations (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)').bind(invitation.invitationId, invitation.userId, invitation.tokenHash, invitation.expiresAt),
      ])
    },
    findUsableInvitation: (tokenHash, now) => database.prepare(`SELECT i.id invitation_id, u.id, u.employee_code, u.display_name FROM invitations i JOIN users u ON u.id=i.user_id
      WHERE i.token_hash=? AND i.used_at IS NULL AND i.expires_at>? AND u.status='invited'`).bind(tokenHash, now).first<InvitedUser>(),
    // D1 batch executes these statements as one transaction. The first write
    // claims an unused, unexpired invitation; later writes require that claim.
    async completeInvitation(passkey) {
      const { invitationId, userId, passkeyId, credentialId, publicKey, counter, transports, deviceType, backedUp, now } = passkey
      const results = await database.batch([
        database.prepare(`INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up)
          SELECT ?, i.user_id, ?, ?, ?, ?, ?, ? FROM invitations i JOIN users u ON u.id=i.user_id
          WHERE i.id=? AND i.user_id=? AND i.used_at IS NULL AND i.expires_at>? AND u.status='invited'`)
          .bind(passkeyId, credentialId, publicKey, counter, transports, deviceType, backedUp, invitationId, userId, now),
        database.prepare(`UPDATE invitations SET used_at=? WHERE id=? AND user_id=? AND used_at IS NULL
          AND EXISTS (SELECT 1 FROM passkeys WHERE id=? AND user_id=?)`)
          .bind(now, invitationId, userId, passkeyId, userId),
        database.prepare(`UPDATE users SET status='active' WHERE id=? AND status='invited'
          AND EXISTS (SELECT 1 FROM invitations WHERE id=? AND user_id=? AND used_at=?)
          AND EXISTS (SELECT 1 FROM passkeys WHERE id=? AND user_id=?)`)
          .bind(userId, invitationId, userId, now, passkeyId, userId),
      ])
      if (results.length !== 3) throw new Error('Invitation registration returned an unexpected number of results.')
      if (results.every(result => result.meta.changes === 0)) return false
      if (results.every(result => result.meta.changes === 1)) return true
      throw new Error('Invitation registration changed only part of the expected state.')
    },
    async listSetupUsers() {
      return (await database.prepare(`SELECT u.id, u.employee_code, u.display_name, u.role,
        (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkey_count
        FROM users u`).all<SetupUser>()).results
    },
    async createInitialAdmin(userId, employeeCode, displayName) {
      const result = await database.prepare(`INSERT INTO users (id, employee_code, display_name, role, status)
        SELECT ?, ?, ?, 'admin', 'active' WHERE NOT EXISTS (SELECT 1 FROM users)`)
        .bind(userId, employeeCode, displayName).run()
      return result.meta.changes === 1
    },
  }
}
