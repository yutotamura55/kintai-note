import type { H3Event } from 'h3'
import { db, id, plusMinutes } from './db'
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

export async function createSession(event: H3Event, userId: string) {
  const sessionId = id(); const expiresAt = plusMinutes(60 * 24 * 14)
  await db(event).prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(sessionId, userId, expiresAt).run()
  const secure = getRequestURL(event).hostname !== 'localhost'
  setCookie(event, cookieName, sessionId, { httpOnly: true, secure, sameSite: 'strict', path: '/', expires: new Date(expiresAt) })
}

export function destroySession(event: H3Event) { deleteCookie(event, cookieName, { path: '/' }) }
