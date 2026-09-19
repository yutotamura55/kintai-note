import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { ref, computed, proxyRefs, createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compile } from '@vue/compiler-ssr'
import { displayJapanDateTime } from '../shared/utils/attendance.ts'

// Run the actual page script and template; replace only Nuxt/network/lifecycle boundaries.
const source = readFileSync(new URL('../app/pages/dashboard.vue', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^import .*\n/gm, ''))
const render = new Function('require', compile(source.match(/<template>([\s\S]*)<\/template>/)![1], { mode: 'function' }).code)(createRequire(import.meta.url))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
async function page(api: Function, post: Function = async () => ({}), redirect: Function = async () => {}) {
  const dependencies = { ref, computed, useRouter: () => ({ replace: redirect }), useRequestFetch: () => api,
    $fetch: post, displayJapanDateTime, onMounted: () => {}, onUnmounted: () => {} }
  const state = await new AsyncFunction(...Object.keys(dependencies), `${script}\nreturn { me, today, error, busy, displayedRecord, previousOpen, correctionLink, load, clock, logout, displayJapanDateTime, ...(typeof loadError !== 'undefined' ? {loadError} : {}), ...(typeof loading !== 'undefined' ? {loading} : {}) }`)(...Object.values(dependencies))
  return { state: proxyRefs(state), html: () => {
    const app = createSSRApp({ setup: () => state, ssrRender: render })
    app.component('NuxtLink', { template: '<a><slot /></a>' })
    return renderToString(app)
  } }
}
const today = { date: '2026-09-18', record: null, openRecord: { id: 'shift-a', work_date: '2026-09-17', clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: null } }
const success = async (path: string) => path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : today

test('initial API failure displays an alert and retry even without user data', async () => {
  const view = await page(async () => { throw { statusCode: 500 } })
  const html = await view.html()
  assert.match(html, /role="alert"/)
  assert.match(html, /再試行/)
})
test('successful retry removes the load error', async () => {
  let failed = true
  const view = await page(async (path: string) => { if (failed) throw { statusCode: 500 }; return success(path) })
  failed = false
  await view.state.load()
  const html = await view.html()
  assert.doesNotMatch(html, /記録を取得できません/)
  assert.match(html, /こんにちは/)
})
test('successful refresh preserves a clock error', async () => {
  const view = await page(success)
  view.state.error = '打刻に失敗しました。'
  await view.state.load()
  assert.match(await view.html(), /打刻に失敗しました/)
})
test('clock-out sends the displayed record id', async () => {
  let body: unknown
  const view = await page(success, async (_path: string, options: any) => { body = options.body })
  await view.state.clock('out')
  assert.deepEqual(body, { action: 'out', recordId: 'shift-a' })
})
test('unauthorized initial load redirects to login', async () => {
  let destination: unknown
  await page(async () => { throw { statusCode: 401 } }, undefined, async (path: string) => { destination = path })
  assert.equal(destination, '/login')
})
test('clock buttons are disabled while a refresh is in flight', async () => {
  let pending: Promise<void> | undefined
  const view = await page(async (path: string) => { await pending; return success(path) })
  let release!: () => void
  pending = new Promise<void>(resolve => { release = resolve })
  const refresh = view.state.load()
  try {
    const html = await view.html()
    assert.match(html, /<button[^>]*disabled[^>]*>出勤を記録/)
    assert.match(html, /<button[^>]*disabled[^>]*>退勤を記録/)
  } finally { release(); await refresh }
})
