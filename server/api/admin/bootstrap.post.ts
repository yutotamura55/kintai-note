import { db, id } from '~~/server/utils/db'
import { d1AuthRepository } from '~~/server/utils/auth-repository'
import { requireAuthAttempt } from '~~/server/utils/auth'
import { registrationOptions } from '~~/server/utils/webauthn'

// This endpoint only works while there are no users, and requires BOOTSTRAP_TOKEN.
export default defineEventHandler(async (event) => {
  await requireAuthAttempt(event, 'bootstrap')
  const envToken = event.context.cloudflare?.env?.BOOTSTRAP_TOKEN as string | undefined
  const body = await readBody<{ token: string; employeeCode: string; displayName: string }>(event)
  if (!envToken || !body?.token || body.token !== envToken) throw createError({ statusCode: 403, statusMessage: 'セットアップを許可できません。' })
  if (!body.employeeCode?.trim() || !body.displayName?.trim()) throw createError({ statusCode: 400, statusMessage: '社員番号と表示名を入力してください。' })

  const repository = d1AuthRepository(db(event))
  const users = await repository.listSetupUsers()
  const pendingAdmin = users.length === 1 && users[0].role === 'admin' && users[0].passkey_count === 0
    ? users[0]
    : undefined

  // A transient failure after creating the first administrator must not make
  // setup impossible to complete. This recovery still needs the bootstrap
  // token and applies only while that one admin has no passkey.
  if (pendingAdmin) return registrationOptions(event, pendingAdmin)
  if (users.length > 0) throw createError({ statusCode: 409, statusMessage: '初期セットアップは完了済みです。' })

  const user = { id: id(), employee_code: body.employeeCode.trim(), display_name: body.displayName.trim() }
  const created = await repository.createInitialAdmin(user.id, user.employee_code, user.display_name)
  if (!created) throw createError({ statusCode: 409, statusMessage: '初期セットアップは完了済みです。' })
  return registrationOptions(event, user)
})
