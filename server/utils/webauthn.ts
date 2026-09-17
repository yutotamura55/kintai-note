import type { H3Event } from 'h3'
import { db, fromBase64URL, id, isoNow, plusMinutes, toBase64URL } from './db'

// @peculiar/x509 (used by SimpleWebAuthn when verifying attestations) requires
// Reflect metadata. Load it before dynamically loading SimpleWebAuthn so the
// Worker bundle cannot initialise x509 ahead of the polyfill.
let webauthnModule: Promise<typeof import('@simplewebauthn/server')> | undefined
function webauthn() {
  webauthnModule ??= import('reflect-metadata').then(() => import('@simplewebauthn/server'))
  return webauthnModule
}

function config(event: H3Event) {
  const url = getRequestURL(event)
  const rpID = event.context.cloudflare?.env?.RP_ID || url.hostname
  return { rpID, rpName: 'Kintai Note', origin: url.origin }
}

export async function saveChallenge(event: H3Event, challenge: string, purpose: 'login' | 'register', userId?: string, invitationId?: string) {
  const challengeId = id()
  await db(event).prepare('INSERT INTO auth_challenges (id, challenge, purpose, user_id, invitation_id, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(challengeId, challenge, purpose, userId ?? null, invitationId ?? null, plusMinutes(5)).run()
  const secure = getRequestURL(event).hostname !== 'localhost'
  setCookie(event, 'kintai-challenge', challengeId, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: 300 })
}

export async function consumeChallenge(event: H3Event, purpose: 'login' | 'register') {
  const challengeId = getCookie(event, 'kintai-challenge')
  if (!challengeId) throw createError({ statusCode: 400, statusMessage: '認証の有効期限が切れました。もう一度お試しください。' })
  const row = await db(event).prepare('SELECT * FROM auth_challenges WHERE id=? AND purpose=? AND expires_at>?').bind(challengeId, purpose, isoNow()).first<any>()
  await db(event).prepare('DELETE FROM auth_challenges WHERE id=?').bind(challengeId).run()
  deleteCookie(event, 'kintai-challenge', { path: '/' })
  if (!row) throw createError({ statusCode: 400, statusMessage: '認証の有効期限が切れました。もう一度お試しください。' })
  return row
}

export async function loginOptions(event: H3Event) {
  const { generateAuthenticationOptions } = await webauthn()
  const options = await generateAuthenticationOptions({ rpID: config(event).rpID, userVerification: 'required' })
  await saveChallenge(event, options.challenge, 'login')
  return options
}

export async function verifyLogin(event: H3Event, response: any) {
  const { verifyAuthenticationResponse } = await webauthn()
  const challenge = await consumeChallenge(event, 'login')
  const passkey = await db(event).prepare('SELECT p.*, u.status FROM passkeys p JOIN users u ON u.id=p.user_id WHERE p.credential_id=?').bind(response.id).first<any>()
  if (!passkey || passkey.status !== 'active') throw createError({ statusCode: 401, statusMessage: 'このパスキーは使用できません。' })
  const verification = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: config(event).origin, expectedRPID: config(event).rpID,
    credential: { id: passkey.credential_id, publicKey: fromBase64URL(passkey.public_key), counter: passkey.counter, transports: passkey.transports ? JSON.parse(passkey.transports) : undefined }, requireUserVerification: true })
  if (!verification.verified) throw createError({ statusCode: 401, statusMessage: 'パスキーを確認できませんでした。' })
  await db(event).batch([
    db(event).prepare('UPDATE passkeys SET counter=?, last_used_at=? WHERE id=?').bind(verification.authenticationInfo.newCounter, isoNow(), passkey.id),
    db(event).prepare('DELETE FROM auth_challenges WHERE expires_at<?').bind(isoNow()),
  ])
  return passkey.user_id as string
}

export async function registrationOptions(event: H3Event, user: { id: string; employee_code: string; display_name: string }, invitationId?: string) {
  const { generateRegistrationOptions } = await webauthn()
  const existing = await db(event).prepare('SELECT credential_id, transports FROM passkeys WHERE user_id=?').bind(user.id).all<any>()
  const options = await generateRegistrationOptions({ rpID: config(event).rpID, rpName: config(event).rpName, userID: new TextEncoder().encode(user.id), userName: user.employee_code, userDisplayName: user.display_name,
    attestationType: 'none', authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, excludeCredentials: existing.results.map(key => ({ id: key.credential_id, transports: key.transports ? JSON.parse(key.transports) : undefined })) })
  await saveChallenge(event, options.challenge, 'register', user.id, invitationId)
  return options
}

export async function verifyRegistration(event: H3Event, response: any) {
  const { verifyRegistrationResponse } = await webauthn()
  const challenge = await consumeChallenge(event, 'register')
  const verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: config(event).origin, expectedRPID: config(event).rpID, requireUserVerification: true })
  if (!verification.verified || !verification.registrationInfo) throw createError({ statusCode: 400, statusMessage: 'パスキーを登録できませんでした。' })
  const credential = verification.registrationInfo.credential
  await db(event).prepare(`INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, transports, device_type, backed_up)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id(), challenge.user_id, credential.id, toBase64URL(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), verification.registrationInfo.credentialDeviceType, verification.registrationInfo.credentialBackedUp ? 1 : 0).run()
  return { userId: challenge.user_id as string, invitationId: challenge.invitation_id as string | null }
}
