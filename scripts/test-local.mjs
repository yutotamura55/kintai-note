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
  await run(npm, ['run', 'test:unit'])
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

  // Explicit calendar dates support overnight shifts and preserve the historical work date.
  const overnight = await request('/api/attendance/record', {
    method: 'PUT', body: JSON.stringify({ id: record.id, clockIn: '2026-09-17T01:00', clockOut: '2026-09-17T05:00' }),
  })
  assert(overnight.status === 200, 'Overnight edit failed.')
  const edited = (await (await request('/api/attendance/month?month=2026-09')).json()).results.find(item => item.id === record.id)
  assert(edited.work_date === '2026-09-16', 'Editing changed the historical work date.')
  assert(edited.clock_in_at === '2026-09-16T16:00:00.000Z' && edited.clock_out_at === '2026-09-16T20:00:00.000Z', 'Overnight calendar dates were lost.')
  for (const invalidTime of ['2026-02-30T05:00', '2026-09-17T24:00', {}]) {
    const response = await request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id: record.id, clockIn: invalidTime }) })
    assert(response.status === 400, 'Invalid datetime must return 400.')
  }
  const notOwned = await request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id: 'not-owned', clockIn: '2026-09-17T01:00' }) })
  assert(notOwned.status === 404, 'Editing a record not owned by the user must fail.')
  const pdf = await request('/api/reports/month.pdf?month=2026-09')
  assert(pdf.status === 200 && pdf.headers.get('content-type')?.includes('application/pdf'), 'Monthly PDF failed.')
  assert((await pdf.text()).startsWith('%PDF-'), 'PDF response is not a PDF.')

  // Seed a pre-change unfinished shift; only the deterministic test fixture is modified.
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--command',
    "UPDATE attendance_records SET work_date='2000-12-31', clock_in_at='2000-12-31T16:00:00.000Z', clock_out_at=NULL WHERE id='local-test-attendance-record'"])
  const old = await (await request('/api/attendance/today')).json()
  assert(old.openRecord?.id === record.id && old.openRecord.work_date === '2000-12-31', 'Previous unfinished shift not exposed on dashboard.')
  const dashboard = await request('/dashboard')
  const dashboardHtml = await dashboard.text()
  assert(dashboard.status === 200 && dashboardHtml.includes('前回の勤務が未退勤です') && dashboardHtml.includes('month=2000-12'), 'Dashboard must render unfinished notice and link to its month.')
  const correctionPage = await request(`/records?month=2000-12&edit=${record.id}`)
  const correctionHtml = await correctionPage.text()
  assert(correctionPage.status === 200 && correctionHtml.includes('datetime-local') && correctionHtml.includes('2001-01-01T01:00'), 'Correction link must open the actual calendar datetime editor.')
  const clock = action => request('/api/attendance/clock', { method: 'POST', body: JSON.stringify({ action }) })
  assert((await clock('in')).status === 409, 'New shift must be blocked while a previous one is unfinished.')
  assert((await clock('out')).status === 200, 'Clock-out must close the previous shift across the 4am boundary.')
  const legacy = (await (await request('/api/attendance/month?month=2000-12')).json()).results.find(item => item.id === record.id)
  assert(legacy.work_date === '2000-12-31' && legacy.clock_in_at === '2000-12-31T16:00:00.000Z' && legacy.clock_out_at, 'Legacy clock-out must preserve original work date and clock-in.')
  assert((await clock('out')).status === 409, 'Repeated clock-out must be rejected.')

  // Correcting a forgotten clock-out also unblocks the next shift.
  const reopen = await request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id: record.id, clockIn: '2001-01-01T01:00', clockOut: '' }) })
  assert(reopen.status === 200 && (await clock('in')).status === 409, 'Clearing clock-out must block new clock-in.')
  const correct = await request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id: record.id, clockIn: '2001-01-01T01:00', clockOut: '2001-01-01T05:00' }) })
  assert(correct.status === 200, 'Forgotten overnight clock-out correction failed.')
  const concurrent = await Promise.all([clock('in'), clock('in')])
  assert(concurrent.map(r => r.status).sort().join(',') === '200,409', 'Concurrent clock-ins must create exactly one shift.')
  const current = await (await request('/api/attendance/today')).json()
  assert(current.record?.work_date === current.date && current.openRecord?.id === current.record.id, 'New shift does not match current work date.')
  const anotherOpen = await request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id: record.id, clockIn: '2001-01-01T01:00', clockOut: '' }) })
  assert(anotherOpen.status === 409, 'Editing must not create a second unfinished shift.')
  assert((await clock('out')).status === 200, 'Current shift clock-out failed.')
  assert((await clock('in')).status === 409, 'Completed shift must not be overwritten by clock-in.')
  const noAuthClock = await fetch(`${baseUrl}/api/attendance/clock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'in' }) })
  assert(noAuthClock.status === 401, 'Clock-in must require authentication.')
  console.log('PASS: unit boundaries, attendance edits, overnight/legacy shifts, unfinished guards, concurrent clock-in, monthly PDF and authentication.')
} finally {
  if (worker?.pid && worker.exitCode === null) {
    const stopped = once(worker, 'exit')
    if (process.platform === 'win32') worker.kill('SIGTERM')
    else process.kill(-worker.pid, 'SIGTERM')
    await stopped
  }
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--file', 'db/cleanup.local.sql'])
}
