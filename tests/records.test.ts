import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { ref, proxyRefs, createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compile } from '@vue/compiler-ssr'
import * as attendance from '../shared/utils/attendance.ts'
import type { AttendanceRecord } from '../shared/utils/attendance.ts'

const source = readFileSync(new URL('../app/pages/records.vue', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^import .*\n/gm, ''))
const render = new Function('require', compile(source.match(/<template>([\s\S]*)<\/template>/)![1], { mode: 'function' }).code)(createRequire(import.meta.url))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const record = { id: 'shift', work_date: '2026-09-19', clock_in_at: '2026-09-19T01:00:00.000Z', clock_out_at: '2026-09-19T09:00:00.000Z', original_clock_in_at: '2026-09-19T00:00:12.345Z', original_clock_out_at: null }
async function page(rows: AttendanceRecord[] = [record], post: Function = async () => ({})) {
  const dependencies = { ref, ...attendance, useRoute: () => ({ query: { month: '2026-09' } }),
    useRequestFetch: () => async () => ({ results: rows }), $fetch: post, watch: () => {} }
  const state = await new AsyncFunction(...Object.keys(dependencies), `${script}\nreturn { month, records, error, editing, draft, saving, edit, cancel, save, pdf, displayJapanDateTime, calculateBreakMinutes, calculateWorkMinutes, formatDuration, restoreTargetLabel, ...(typeof restore !== 'undefined' ? {restore} : {}), ...(typeof canRestore !== 'undefined' ? {canRestore} : {}) }`)(...Object.values(dependencies))
  return { state: proxyRefs(state), html: () => {
    const app = createSSRApp({ setup: () => state, ssrRender: render })
    app.component('NuxtLink', { template: '<a><slot /></a>' })
    return renderToString(app)
  } }
}
test('records expose the original time and only available restore targets', async () => {
  const view = await page()
  const html = await view.html()
  assert.match(html, /元の打刻時刻に戻す/)
  assert.match(html, /09:00:12/)
  assert.match(html, /出勤のみ/)
})
test('legacy records cannot offer a restore action', async () => {
  const view = await page([{ ...record, original_clock_in_at: null }])
  assert.match(await view.html(), /元の打刻時刻なし/)
  assert.doesNotMatch(await view.html(), /<button[^>]*>元の打刻時刻に戻す/)
})
test('restore sends only the record ID and reloads saved times', async () => {
  const rows = [{ ...record }]
  let body: unknown
  const view = await page(rows, async (url: string, options: any) => {
    assert.equal(url, '/api/attendance/restore')
    assert.equal(options.method, 'POST')
    body = options.body
    rows[0] = { ...record, clock_in_at: record.original_clock_in_at }
  })
  await view.state.restore(record)
  assert.deepEqual(body, { id: 'shift' })
  assert.equal(view.state.records[0].clock_in_at, record.original_clock_in_at)
  assert.equal(view.state.saving, false)
})
test('failed restore displays the server error and preserves the record', async () => {
  const view = await page([record], async () => { throw { data: { statusMessage: '退勤時刻は出勤時刻より後にしてください。' } } })
  await view.state.restore(record)
  assert.match(await view.html(), /退勤時刻は出勤時刻より後/)
  assert.equal(view.state.records[0].clock_in_at, record.clock_in_at)
  assert.equal(view.state.saving, false)
})
test('restore disables mutations while saving', async () => {
  let release!: () => void
  const view = await page([record], () => new Promise<void>(resolve => { release = resolve }))
  const pending = view.state.restore(record)
  try { assert.match(await view.html(), /<button[^>]*disabled[^>]*>元の打刻時刻に戻す/) }
  finally { release(); await pending }
})

test('already restored records disable restoration even when originals are present', async () => {
  const view = await page([{ ...record, clock_in_at: record.original_clock_in_at }])
  assert.match(await view.html(), /<button[^>]*disabled[^>]*>元の打刻時刻に戻す/)
})

test('records display break and actual work times and allow editing break minutes', async () => {
  const testRecord = {
    ...record,
    total_break_seconds: 3600,
    original_total_break_seconds: 3600,
    break_minutes: null,
  }
  let savedBody: any
  const view = await page([testRecord], async (url: string, options: any) => {
    savedBody = options.body
  })
  const html = await view.html()
  // 1:00 break, 7:00 work time (01:00 to 09:00 gross = 8h, minus 1h = 7h)
  assert.match(html, /1:00/)
  assert.match(html, /7:00/)

  // Edit draft
  view.state.edit(testRecord)
  assert.equal(view.state.draft.breakMinutes, 60)
  view.state.draft.breakMinutes = 45
  await view.state.save(testRecord)
  assert.equal(savedBody.breakMinutes, 45)

  // Modified breakMinutes allows restore
  const modifiedRecord = { ...testRecord, break_minutes: 45 }
  const modifiedView = await page([modifiedRecord])
  const modifiedHtml = await modifiedView.html()
  assert.match(modifiedHtml, /復元対象：.*休憩/)
})
