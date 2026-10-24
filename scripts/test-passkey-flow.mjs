import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { rm } from 'node:fs/promises'
import assert from 'node:assert/strict'

// Passkey success paths through the real pages: first administrator setup, invitation,
// login, adding a passkey and the guards around them. A virtual authenticator in headless
// Chromium answers WebAuthn. The Worker uses its own empty D1 directory, because setup
// only works while no user exists and must not touch the developer's local data.
const port = 8789
const baseUrl = `http://localhost:${port}`
const persistTo = '.wrangler/test-passkey-flow'
const bootstrapToken = 'local-test-passkey-bootstrap-token'

async function respondsOk() {
  try { return (await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1000) })).ok } catch { return false }
}

async function startWorker({ cwd, wrangler }) {
  // Never run the test against another server that already listens on this port.
  if (await respondsOk()) throw new Error(`Port ${port} is already in use; stop that server before running the passkey test.`)
  const worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', String(port), '--persist-to', persistTo,
    '--var', `BOOTSTRAP_TOKEN:${bootstrapToken}`, '--var', 'RP_ID:localhost'],
  { cwd, stdio: 'inherit', detached: process.platform !== 'win32' })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && worker.exitCode === null) {
    if (await respondsOk()) return worker
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  // The caller never receives this handle, so stop it here before failing.
  await stopWorker(worker)
  throw new Error('Passkey test Worker did not start within 30 seconds.')
}

async function stopWorker(worker) {
  if (!worker?.pid || worker.exitCode !== null) return
  const stopped = once(worker, 'exit')
  const signal = name => process.platform === 'win32' ? worker.kill(name) : process.kill(-worker.pid, name)
  signal('SIGTERM')
  // Escalate if Wrangler does not shut down, so cleanup cannot hang.
  const timer = setTimeout(() => signal('SIGKILL'), 10_000)
  await stopped
  clearTimeout(timer)
}

// Each browser context stands for one device with its own authenticator.
async function device(browser) {
  const context = await browser.newContext({ baseURL: baseUrl })
  // Fail a missing element or navigation within a bounded time so cleanup still runs.
  context.setDefaultTimeout(15_000)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } })
  const credentials = async () => (await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials
  return { context, page, credentials }
}

async function me(page) {
  const response = await page.request.get('/api/auth/me')
  return response.ok() ? response.json() : response.status()
}

async function logout(page) {
  assert.equal((await page.request.post('/api/auth/logout')).status(), 200)
  assert.equal(await me(page), 401)
}

export async function testPasskeyFlow({ cwd, run, wrangler }) {
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= '0'
  await run(process.execPath, ['node_modules/playwright/cli.js', 'install', '--only-shell', 'chromium'])
  const { chromium } = await import('playwright')
  const sql = command => run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--persist-to', persistTo, '--json', '--command', command])
  const query = async command => JSON.parse(await sql(command))[0].results

  await rm(persistTo, { recursive: true, force: true })
  let worker; let browser
  try {
    await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--persist-to', persistTo, '--file', 'db/schema.sql'])
    await run(process.execPath, [wrangler, 'd1', 'migrations', 'apply', 'kintai-note', '--local', '--persist-to', persistTo])
    worker = await startWorker({ cwd, wrangler })
    browser = await chromium.launch()

    // First administrator: a wrong token is refused, the right one registers a passkey.
    const admin = await device(browser)
    await admin.page.goto('/setup')
    await admin.page.getByLabel('セットアップトークン').fill('wrong-token')
    await admin.page.getByLabel('表示名').fill('Local Admin')
    await admin.page.getByRole('button', { name: '管理者パスキーを登録' }).click()
    await admin.page.getByText('セットアップを許可できません。').waitFor()
    assert.equal((await admin.credentials()).length, 0)
    await admin.page.getByLabel('セットアップトークン').fill(bootstrapToken)
    await admin.page.getByRole('button', { name: '管理者パスキーを登録' }).click()
    await admin.page.waitForURL('**/dashboard')
    const adminUser = await me(admin.page)
    assert.equal(adminUser.role, 'admin')
    assert.equal((await admin.credentials()).length, 1)
    const repeatedSetup = await admin.page.request.post('/api/admin/bootstrap', { data: { token: bootstrapToken, employeeCode: 'admin2', displayName: 'Second' } })
    assert.equal(repeatedSetup.status(), 409, 'Setup must not run again once the administrator has a passkey.')

    // The administrator invites an employee from the admin page.
    await admin.page.goto('/admin/users')
    await admin.page.getByLabel('社員番号').fill('E001')
    await admin.page.getByLabel('表示名').fill('Local Employee')
    await admin.page.getByRole('button', { name: '招待URLを作成' }).click()
    const invitationUrl = await admin.page.locator('.invite code').textContent()
    assert.match(invitationUrl, new RegExp(`^${baseUrl}/activate/`))

    // The employee activates the account on their own device and stays a member.
    const employee = await device(browser)
    await employee.page.goto(invitationUrl)
    await employee.page.getByRole('button', { name: 'パスキーを登録する' }).click()
    await employee.page.waitForURL('**/dashboard')
    const employeeUser = await me(employee.page)
    assert.equal(employeeUser.employee_code, 'E001')
    assert.equal(employeeUser.role, 'member')
    assert.equal((await employee.page.request.post('/api/admin/invitations', { data: { employeeCode: 'E002', displayName: 'X' } })).status(), 403)

    // The invitation is single use, also from another device.
    const reuse = await device(browser)
    await reuse.page.goto(invitationUrl)
    await reuse.page.getByRole('button', { name: 'パスキーを登録する' }).click()
    await reuse.page.getByText('招待URLが無効、使用済み、または期限切れです。').waitFor()
    assert.equal((await reuse.credentials()).length, 0)

    // Login with the discoverable credential records its use.
    await logout(employee.page)
    await employee.page.goto('/login')
    await employee.page.getByRole('button', { name: 'パスキーでログイン' }).click()
    await employee.page.waitForURL('**/dashboard')
    assert.equal((await me(employee.page)).id, employeeUser.id)
    const [used] = await query(`SELECT last_used_at FROM passkeys WHERE user_id='${employeeUser.id}'`)
    assert.ok(used.last_used_at, 'Login must record when the passkey was used.')

    // Adding a passkey: the same authenticator is excluded, a second device is added.
    await employee.page.goto('/settings/security/passkeys')
    await employee.page.getByRole('button', { name: 'パスキーを追加' }).click()
    await employee.page.getByText('追加できませんでした。').waitFor()
    assert.equal((await employee.credentials()).length, 1, 'An existing passkey on this device must be excluded.')
    const secondDevice = await device(browser)
    await secondDevice.context.addCookies(await employee.context.cookies())
    await secondDevice.page.goto('/settings/security/passkeys')
    await secondDevice.page.getByRole('button', { name: 'パスキーを追加' }).click()
    await secondDevice.page.getByText('パスキーを追加しました。').waitFor()
    const passkeys = await query(`SELECT COUNT(*) AS count FROM passkeys WHERE user_id='${employeeUser.id}'`)
    assert.equal(passkeys[0].count, 2)
    await logout(secondDevice.page)
    await secondDevice.page.goto('/login')
    await secondDevice.page.getByRole('button', { name: 'パスキーでログイン' }).click()
    await secondDevice.page.waitForURL('**/dashboard')
    assert.equal((await me(secondDevice.page)).id, employeeUser.id)

    // A disabled user's passkey can no longer log in.
    await logout(secondDevice.page)
    await sql(`UPDATE users SET status='disabled' WHERE id='${employeeUser.id}'`)
    await secondDevice.page.goto('/login')
    await secondDevice.page.getByRole('button', { name: 'パスキーでログイン' }).click()
    await secondDevice.page.getByText('このパスキーは使用できません。').waitFor()
    assert.equal(await me(secondDevice.page), 401)

    // The administrator's session and passkey are unaffected by the employee's actions.
    assert.equal((await me(admin.page)).id, adminUser.id)
    console.log('PASS: passkey setup, invitation, login, added passkey, excluded duplicate and disabled user.')
  } finally {
    // Attempt every cleanup step even if an earlier one fails.
    try { await browser?.close() } finally {
      try { await stopWorker(worker) } finally { await rm(persistTo, { recursive: true, force: true }) }
    }
  }
}
