import { db, id } from '~~/server/utils/db'
import { registrationOptions } from '~~/server/utils/webauthn'

// This endpoint only works while there are no users, and requires BOOTSTRAP_TOKEN.
export default defineEventHandler(async (event) => {
  const envToken = event.context.cloudflare?.env?.BOOTSTRAP_TOKEN as string | undefined
  const body = await readBody<{ token: string; employeeCode: string; displayName: string }>(event)
  if (!envToken || !body?.token || body.token !== envToken) throw createError({ statusCode: 403, statusMessage: 'セットアップを許可できません。' })
  if (!body.employeeCode?.trim() || !body.displayName?.trim()) throw createError({ statusCode: 400, statusMessage: '社員番号と表示名を入力してください。' })

  const users = await db(event).prepare(`SELECT u.id, u.employee_code, u.display_name, u.role,
    (SELECT COUNT(*) FROM passkeys p WHERE p.user_id = u.id) AS passkey_count
    FROM users u`).all<{ id: string, employee_code: string, display_name: string, role: string, passkey_count: number }>()
  const pendingAdmin = users.results.length === 1 && users.results[0].role === 'admin' && users.results[0].passkey_count === 0
    ? users.results[0]
    : undefined

  // A transient failure after creating the first administrator must not make
  // setup impossible to complete. This recovery still needs the bootstrap
  // token and applies only while that one admin has no passkey.
  if (pendingAdmin) return registrationOptions(event, pendingAdmin)
  if (users.results.length > 0) throw createError({ statusCode: 409, statusMessage: '初期セットアップは完了済みです。' })

  const user = { id: id(), employee_code: body.employeeCode.trim(), display_name: body.displayName.trim() }
  await db(event).prepare("INSERT INTO users (id, employee_code, display_name, role, status) VALUES (?, ?, ?, 'admin', 'active')").bind(user.id, user.employee_code, user.display_name).run()
  return registrationOptions(event, user)
})
