export interface InvitationPasskey {
  invitationId: string
  userId: string
  passkeyId: string
  credentialId: string
  publicKey: string
  counter: number
  transports: string
  deviceType: string
  backedUp: number
  now: string
}

// D1 batch executes these statements as one transaction. The first write
// claims an unused, unexpired invitation; later writes require that claim.
export async function completeInvitation(database: D1Database, passkey: InvitationPasskey): Promise<boolean> {
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
}
