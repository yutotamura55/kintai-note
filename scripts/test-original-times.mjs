import assert from 'node:assert/strict'

export async function testOriginalTimes({ request, run, wrangler, current, legacyId }) {
  const restore = (id, extra = {}) => request('/api/attendance/restore', { method: 'POST', body: JSON.stringify({ id, ...extra }) })
  const edit = (id, clockIn, clockOut, extra = {}) => request('/api/attendance/record', { method: 'PUT', body: JSON.stringify({ id, clockIn, clockOut, ...extra }) })
  const read = async (id, month) => (await (await request(`/api/attendance/month?month=${month}`)).json()).results.find(row => row.id === id)
  const month = current.date.slice(0, 7)
  const id = current.record.id
  const original = await read(id, month)
  assert.equal(original.original_clock_in_at, original.clock_in_at, 'Initial clock-in must be saved exactly.')
  assert.equal(original.original_clock_out_at, original.clock_out_at, 'Initial clock-out must be saved exactly.')
  assert.ok(original.original_clock_in_at && original.original_clock_out_at)

  // Editing cannot forge original times; repeated edits must retain the first punch.
  for (const hour of ['09', '10']) {
    assert.equal((await edit(id, `2002-01-01T${hour}:00`, '2002-01-01T18:00', {
      original_clock_in_at: '2002-01-01T00:00:00.000Z', original_clock_out_at: null,
    })).status, 200)
    const edited = await read(id, month)
    assert.equal(edited.original_clock_in_at, original.clock_in_at)
    assert.equal(edited.original_clock_out_at, original.clock_out_at)
  }
  assert.equal((await restore(id, { clockIn: '2000-01-01T00:00' })).status, 200)
  const restored = await read(id, month)
  assert.equal(restored.clock_in_at, original.clock_in_at, 'Restore must preserve sub-minute precision.')
  assert.equal(restored.clock_out_at, original.clock_out_at)
  assert.equal(restored.work_date, original.work_date)
  assert.equal((await restore(id)).status, 200, 'Repeated restore is safe.')

  // Reopening and punching out again must not replace the FIRST clock-out.
  assert.equal((await edit(id, '2002-01-01T09:00', '')).status, 200)
  assert.equal((await request('/api/attendance/clock', { method: 'POST', body: JSON.stringify({ action: 'out', recordId: id }) })).status, 200)
  assert.equal((await read(id, month)).original_clock_out_at, original.clock_out_at)
  assert.equal((await restore(id)).status, 200)

  // A legacy shift gains an original clock-out only when it is actually punched.
  const legacy = await read(legacyId, '2000-12')
  assert.equal(legacy.original_clock_in_at, null)
  assert.ok(legacy.original_clock_out_at)
  assert.equal((await edit(legacyId, '2001-01-01T02:00', '2001-01-01T06:00')).status, 200)
  assert.equal((await restore(legacyId)).status, 200)
  const partial = await read(legacyId, '2000-12')
  assert.equal(partial.clock_in_at, '2000-12-31T17:00:00.000Z', 'Unknown original field must remain unchanged.')
  assert.equal(partial.clock_out_at, legacy.original_clock_out_at)

  // A partial restoration that reverses the order must fail without changing anything.
  assert.equal((await edit(legacyId, '2090-01-01T09:00', '2090-01-01T18:00')).status, 200)
  const before = await read(legacyId, '2000-12')
  assert.equal((await restore(legacyId)).status, 400)
  assert.deepEqual(await read(legacyId, '2000-12'), before)
  assert.equal((await edit(legacyId, '2001-01-01T02:00', '2001-01-01T06:00')).status, 200)

  // Original clock-in only: restore must not erase a manually supplied clock-out.
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--command',
    `INSERT INTO attendance_records (id,user_id,work_date,clock_in_at,clock_out_at,original_clock_in_at) VALUES
    ('local-test-original-in','local-test-attendance-user','2003-01-01','2003-01-01T02:00:00.000Z','2003-01-01T09:00:00.000Z','2003-01-01T00:00:12.345Z')`])
  assert.equal((await restore('local-test-original-in')).status, 200)
  const inOnly = await read('local-test-original-in', '2003-01')
  assert.equal(inOnly.clock_in_at, '2003-01-01T00:00:12.345Z')
  assert.equal(inOnly.clock_out_at, '2003-01-01T09:00:00.000Z')
  assert.equal(inOnly.original_clock_out_at, null)
  assert.equal((await edit('local-test-original-in', '2003-01-01T10:00', '')).status, 200)
  assert.equal((await restore('local-test-original-in')).status, 200)
  assert.equal((await read('local-test-original-in', '2003-01')).clock_out_at, null)

  // Legacy inconsistent data: the guard must also apply during restoration.
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--command',
    "INSERT INTO attendance_records (id,user_id,work_date,clock_in_at) VALUES ('local-test-original-open','local-test-attendance-user','2004-01-01','2004-01-01T00:00:00.000Z')"])
  assert.equal((await restore('local-test-original-in')).status, 409)
  assert.equal((await edit('local-test-original-in', '2003-01-01T09:00', '2003-01-01T18:00')).status, 200)
  assert.equal((await edit('local-test-original-open', '2004-01-01T09:00', '2004-01-01T18:00')).status, 200)

  assert.equal((await restore('not-owned')).status, 404)
  assert.equal((await restore(null)).status, 400)
  assert.equal((await request('/api/attendance/restore', { method: 'POST', body: JSON.stringify({ id }), headers: { cookie: '' } })).status, 401)
  // Real different authenticated user, not just a nonexistent ID.
  await run(process.execPath, [wrangler, 'd1', 'execute', 'kintai-note', '--local', '--command',
    `INSERT INTO users (id,employee_code,display_name,status) VALUES ('local-test-other-user','__local_test_other__','Other','active');
    INSERT INTO sessions (id,user_id,expires_at) VALUES ('local-test-other-session','local-test-other-user','2030-01-01T00:00:00.000Z')`])
  const ownBefore = await read(id, month)
  assert.equal((await request('/api/attendance/restore', { method: 'POST', body: JSON.stringify({ id }), headers: { cookie: '__Host-kintai-session=local-test-other-session' } })).status, 404)
  assert.deepEqual(await read(id, month), ownBefore)
  console.log('PASS: original punches, repeated edits and clock-outs, exact and partial restore, validation and ownership.')
}
