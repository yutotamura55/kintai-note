import { spawn } from 'node:child_process'
import { once } from 'node:events'

const cwd = process.cwd()
const wrangler = new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const baseUrl = 'http://127.0.0.1:8788'
const sessionCookie = '__Host-kintai-session=local-test-attendance-session'

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'pipe' })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} ${args.join(' ')} failed:\n${output}`)))
  })
}

async function waitForWorker() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/`, { signal: AbortSignal.timeout(1000) })
      if (response.ok) return
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  throw new Error('Local Worker did not start within 30 seconds.')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { cookie: sessionCookie, 'content-type': 'application/json', ...options.headers },
  })
}

let worker
try {
  await run(npm, ['run', 'build'])
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--file', 'db/schema.sql'])
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--file', 'db/cleanup.local.sql'])
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--file', 'db/seed.local.sql'])

  worker = spawn(process.execPath, [wrangler, 'dev', '--local', '--port', '8788'], { cwd, stdio: 'inherit', detached: process.platform !== 'win32' })
  await waitForWorker()

  const update = await request('/api/attendance/record', {
    method: 'PUT',
    body: JSON.stringify({ id: 'local-test-attendance-record', clockIn: '09:15', clockOut: '18:30' }),
  })
  assert(update.status === 200, `Expected successful update, received ${update.status}.`)

  const month = await request('/api/attendance/month?month=2026-09')
  const monthData = await month.json()
  const record = monthData.results?.find(item => item.id === 'local-test-attendance-record')
  assert(record?.clock_in_at === '2026-09-16T00:15:00.000Z', 'The edited clock-in time was not saved as Japan time.')
  assert(record?.clock_out_at === '2026-09-16T09:30:00.000Z', 'The edited clock-out time was not saved as Japan time.')

  const invalid = await request('/api/attendance/record', {
    method: 'PUT',
    body: JSON.stringify({ id: 'local-test-attendance-record', clockIn: '18:30', clockOut: '09:15' }),
  })
  assert(invalid.status === 400, `Expected invalid time order to be rejected with 400, received ${invalid.status}.`)

  const unauthorized = await fetch(`${baseUrl}/api/attendance/record`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'local-test-attendance-record', clockIn: '09:15', clockOut: '18:30' }),
  })
  assert(unauthorized.status === 401, `Expected unauthenticated edit to be rejected with 401, received ${unauthorized.status}.`)

  console.log('PASS: local attendance edit verification completed.')
} finally {
  if (worker?.pid && worker.exitCode === null) {
    const stopped = once(worker, 'exit')
    if (process.platform === 'win32') worker.kill('SIGTERM')
    else process.kill(-worker.pid, 'SIGTERM')
    await stopped
  }
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--file', 'db/cleanup.local.sql'])
}
