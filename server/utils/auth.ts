import type { H3Event } from 'h3'
import { db, id, plusMinutes, sha256 } from './db'
import { consumeAuthLimit } from './auth-storage'
import type { User } from './types'

const cookieName = '__Host-kintai-session'

export async function currentUser(event: H3Event): Promise<User> {
  const sessionId = getCookie(event, cookieName)
  if (!sessionId) throw createError({ statusCode: 401, statusMessage: 'ログインが必要です。' })
  const row = await db(event).prepare(`SELECT u.id, u.employee_code, u.display_name, u.role, u.status
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>?`).bind(sessionId, new Date().toISOString()).first<User>()
  if (!row || row.status !== 'active') throw createError({ statusCode: 401, statusMessage: 'セッションが無効です。' })
  return row
}

export async function requireAdmin(event: H3Event) {
  const user = await currentUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: '管理者権限が必要です。' })
  return user
}

export async function requireAuthAttempt(event: H3Event, action: 'login' | 'invitation' | 'bootstrap' | 'verification') {
  const limits = { login: 10, invitation: 10, bootstrap: 5, verification: 20 }
  const visitor = getRequestHeader(event, 'cf-connecting-ip') || getRequestIP(event) || 'unknown'
  const now = new Date()
  const key = await sha256(`${action}:${visitor}`)
  const allowed = await consumeAuthLimit(db(event), key, now.toISOString(), new Date(now.getTime() + 5 * 60_000).toISOString(), limits[action])
  if (!allowed) throw createError({ statusCode: 429, statusMessage: 'しばらく待ってから再試行してください。' })
}

export async function createSession(event: H3Event, userId: string) {
  const sessionId = id(); const expiresAt = plusMinutes(60 * 24 * 14)
  await db(event).prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, userId, expiresAt).run()
  setCookie(event, cookieName, sessionId, { ...sessionCookieOptions(), expires: new Date(expiresAt) })
}

// The __Host- prefix requires Secure even on http://localhost, or browsers drop the cookie.
function sessionCookieOptions() {
  return { httpOnly: true, secure: true, sameSite: 'strict' as const, path: '/' }
}

export async function destroySession(event: H3Event) {
  const sessionId = getCookie(event, cookieName)
  if (sessionId) await db(event).prepare('DELETE FROM sessions WHERE id=?').bind(sessionId).run()
  deleteCookie(event, cookieName, sessionCookieOptions())
}
