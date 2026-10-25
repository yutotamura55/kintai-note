import type { H3Event } from 'h3'
import { db, fromBase64URL, id, isoNow, plusMinutes, toBase64URL } from './db'
import { d1AuthRepository } from './auth-repository'
import { requireAuthAttempt } from './auth'

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

export async function saveChallenge(
  event: H3Event,
  challenge: string,
  purpose: 'login' | 'register',
  userId?: string,
  invitationId?: string,
) {
  const challengeId = id()
  await d1AuthRepository(db(event)).saveChallenge(
    {
      id: challengeId,
      challenge,
      purpose,
      user_id: userId ?? null,
      invitation_id: invitationId ?? null,
      expires_at: plusMinutes(5),
    },
    isoNow(),
  )
  const secure = getRequestURL(event).hostname !== 'localhost'
  setCookie(event, 'kintai-challenge', challengeId, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: 300,
  })
}

export async function consumeChallenge(event: H3Event, purpose: 'login' | 'register') {
  const challengeId = getCookie(event, 'kintai-challenge')
  if (!challengeId)
    throw createError({ statusCode: 400, statusMessage: '認証の有効期限が切れました。もう一度お試しください。' })
  const row = await d1AuthRepository(db(event)).consumeChallenge(challengeId, purpose, isoNow())
  deleteCookie(event, 'kintai-challenge', { path: '/' })
  if (!row)
    throw createError({ statusCode: 400, statusMessage: '認証の有効期限が切れました。もう一度お試しください。' })
  return row
}

export async function loginOptions(event: H3Event) {
  await requireAuthAttempt(event, 'login')
  const { generateAuthenticationOptions } = await webauthn()
  const options = await generateAuthenticationOptions({ rpID: config(event).rpID, userVerification: 'required' })
  await saveChallenge(event, options.challenge, 'login')
  return options
}

export async function verifyLogin(event: H3Event, response: any) {
  const { verifyAuthenticationResponse } = await webauthn()
  const challenge = await consumeChallenge(event, 'login')
  const repository = d1AuthRepository(db(event))
  const passkey = await repository.findPasskeyForLogin(response.id)
  if (!passkey || passkey.status !== 'active')
    throw createError({ statusCode: 401, statusMessage: 'このパスキーは使用できません。' })
  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config(event).origin,
    expectedRPID: config(event).rpID,
    credential: {
      id: passkey.credential_id,
      publicKey: fromBase64URL(passkey.public_key),
      counter: passkey.counter,
      transports: passkey.transports ? JSON.parse(passkey.transports) : undefined,
    },
    requireUserVerification: true,
  })
  if (!verification.verified) throw createError({ statusCode: 401, statusMessage: 'パスキーを確認できませんでした。' })
  await repository.recordPasskeyUse(passkey.id, verification.authenticationInfo.newCounter, isoNow())
  return passkey.user_id
}

export async function registrationOptions(
  event: H3Event,
  user: { id: string; employee_code: string; display_name: string },
  invitationId?: string,
) {
  const { generateRegistrationOptions } = await webauthn()
  const existing = await d1AuthRepository(db(event)).listPasskeyCredentials(user.id)
  const options = await generateRegistrationOptions({
    rpID: config(event).rpID,
    rpName: config(event).rpName,
    userID: new TextEncoder().encode(user.id),
    userName: user.employee_code,
    userDisplayName: user.display_name,
    attestationType: 'none',
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    excludeCredentials: existing.map((key) => ({
      id: key.credential_id,
      transports: key.transports ? JSON.parse(key.transports) : undefined,
    })),
  })
  await saveChallenge(event, options.challenge, 'register', user.id, invitationId)
  return options
}

export async function verifyRegistration(event: H3Event, response: any, flow: 'invitation' | 'account') {
  const { verifyRegistrationResponse } = await webauthn()
  const challenge = await consumeChallenge(event, 'register')
  if ((flow === 'invitation' && !challenge.invitation_id) || (flow === 'account' && challenge.invitation_id)) {
    throw createError({ statusCode: 400, statusMessage: '登録手順が一致しません。' })
  }
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config(event).origin,
    expectedRPID: config(event).rpID,
    requireUserVerification: true,
  })
  if (!verification.verified || !verification.registrationInfo)
    throw createError({ statusCode: 400, statusMessage: 'パスキーを登録できませんでした。' })
  const credential = verification.registrationInfo.credential
  const passkey = {
    passkeyId: id(),
    userId: challenge.user_id as string,
    credentialId: credential.id,
    publicKey: toBase64URL(credential.publicKey),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    deviceType: verification.registrationInfo.credentialDeviceType,
    backedUp: verification.registrationInfo.credentialBackedUp ? 1 : 0,
  }
  if (flow === 'invitation') {
    const completed = await d1AuthRepository(db(event)).completeInvitation({
      ...passkey,
      invitationId: challenge.invitation_id as string,
      now: isoNow(),
    })
    if (!completed)
      throw createError({ statusCode: 409, statusMessage: '招待URLが無効、使用済み、または期限切れです。' })
  } else {
    await d1AuthRepository(db(event)).addPasskey(passkey)
  }
  return { userId: passkey.userId }
}
