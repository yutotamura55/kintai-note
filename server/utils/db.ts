import type { H3Event } from 'h3'
import type { Env } from './types'

export function db(event: H3Event) {
  const binding = event.context.cloudflare?.env?.DB as Env['DB'] | undefined
  if (!binding) throw createError({ statusCode: 500, statusMessage: 'D1 database binding is not configured.' })
  return binding
}

export function id() { return crypto.randomUUID() }
export function isoNow() { return new Date().toISOString() }
export function plusMinutes(minutes: number) { return new Date(Date.now() + minutes * 60_000).toISOString() }
export async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export function toBase64URL(bytes: Uint8Array) {
  let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}
export function fromBase64URL(value: string) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}
