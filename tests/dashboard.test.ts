import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire, stripTypeScriptTypes } from 'node:module'
import { ref, computed, proxyRefs, createSSRApp } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { compile } from '@vue/compiler-ssr'
import {
  displayJapanDateTime,
  attendanceState,
  canPerform,
  calculateOriginalBreakMinutes,
  calculateOriginalWorkMinutes,
  formatDurationHuman,
  punchTimes,
} from '../shared/utils/attendance.ts'
import { apiErrorMessage } from '../app/utils/api-error.ts'

// Run the actual page script and template; replace only Nuxt/network/lifecycle boundaries.
const source = readFileSync(new URL('../app/pages/dashboard.vue', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(
  source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1].replace(/^import [\s\S]*? from '[^']*'\n/gm, ''),
)
const render = new Function(
  'require',
  compile(source.match(/<template>([\s\S]*)<\/template>/)![1], { mode: 'function' }).code,
)(createRequire(import.meta.url))
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
async function page(
  api: Function,
  post: Function = async () => ({}),
  redirect: Function = async () => {},
  lifecycle: Record<string, any> = {},
) {
  const document = {
    visibilityState: 'visible',
    addEventListener: (event: string, callback: Function) => {
      lifecycle[`document:${event}`] = callback
    },
    removeEventListener: () => {},
  }
  lifecycle.document = document
  const dependencies = {
    ref,
    computed,
    useRouter: () => ({ replace: redirect }),
    useRequestFetch: () => api,
    $fetch: post,
    apiErrorMessage,
    displayJapanDateTime,
    attendanceState,
    canPerform,
    calculateOriginalBreakMinutes,
    calculateOriginalWorkMinutes,
    formatDurationHuman,
    punchTimes,
    onMounted: (callback: Function) => {
      lifecycle.mounted = callback
    },
    onUnmounted: (callback: Function) => {
      lifecycle.unmounted = callback
    },
    setInterval: (callback: Function, delay: number) => {
      lifecycle.intervalCalls = (lifecycle.intervalCalls || 0) + 1
      lifecycle.intervalCallback = callback
      lifecycle.intervalDelay = delay
      return 1
    },
    clearInterval: () => {},
    window: {
      addEventListener: (event: string, callback: Function) => {
        lifecycle[`window:${event}`] = callback
      },
      removeEventListener: () => {},
    },
    document,
  }
  const state = await new AsyncFunction(
    ...Object.keys(dependencies),
    `${script}\nreturn { me, today, error, busy, displayedRecord, punchRecord, previousOpen, clockedOutPrevious, correctionLink, load, clock, logout, displayJapanDateTime, currentState, isOnBreak, statusInfo, canPerform, breakMinutes, workMinutes, formatDurationHuman, ...(typeof loadError !== 'undefined' ? {loadError} : {}), ...(typeof loading !== 'undefined' ? {loading} : {}) }`,
  )(...Object.values(dependencies))
  return {
    state: proxyRefs(state),
    html: () => {
      const app = createSSRApp({ setup: () => state, ssrRender: render })
      app.component('NuxtLink', { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' })
      return renderToString(app)
    },
  }
}
const today = {
  date: '2026-09-18',
  record: null,
  openRecord: { id: 'shift-a', work_date: '2026-09-17', clock_in_at: '2026-09-17T00:00:00.000Z', clock_out_at: null },
}
const success = async (path: string) => (path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : today)

test('initial API failure displays an alert and retry even without user data', async () => {
  const view = await page(async () => {
    throw { statusCode: 500 }
  })
  const html = await view.html()
  assert.match(html, /role="alert"/)
  assert.match(html, /再試行/)
})
test('successful retry removes the load error', async () => {
  let failed = true
  const view = await page(async (path: string) => {
    if (failed) throw { statusCode: 500 }
    return success(path)
  })
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
  const view = await page(success, async (_path: string, options: any) => {
    body = options.body
  })
  await view.state.clock('out')
  assert.deepEqual(body, { action: 'out', recordId: 'shift-a' })
})
test('unauthorized initial load redirects to login', async () => {
  let destination: unknown
  await page(
    async () => {
      throw { statusCode: 401 }
    },
    undefined,
    async (path: string) => {
      destination = path
    },
  )
  assert.equal(destination, '/login')
})
test('clock buttons stay enabled while a return refresh is in flight', async () => {
  // The first load passes through; later loads wait until the gate is released.
  const gate: { pending?: Promise<void> } = {}
  const view = await page(async (path: string) => {
    await gate.pending
    return success(path)
  })
  let release!: () => void
  gate.pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const refresh = view.state.load()
  try {
    const html = await view.html()
    assert.match(html, /<button[^>]*disabled[^>]*>\s*出勤を記録/)
    assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>\s*休憩開始を記録/)
    assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>\s*退勤を記録/)
  } finally {
    release()
    await refresh
  }
})

test('a clock during return refresh waits for it and reloads the committed state', async () => {
  const lifecycle: Record<string, any> = {}
  let release!: () => void
  let pending = false
  let onBreak = false
  let posts = 0
  let attendanceRequests = 0
  const view = await page(
    async (path: string) => {
      if (path === '/api/auth/me') return { display_name: 'Test', role: 'member' }
      attendanceRequests++
      const result = {
        ...today,
        openRecord: { ...today.openRecord, break_started_at: onBreak ? '2026-09-18T01:00:00.000Z' : null },
      }
      if (pending)
        await new Promise<void>((resolve) => {
          release = resolve
        })
      return result
    },
    async () => {
      posts++
      onBreak = true
      return {}
    },
    undefined,
    lifecycle,
  )
  lifecycle.mounted()
  pending = true
  lifecycle['window:focus']()
  assert.equal(view.state.loading, true)
  const clock = view.state.clock('break_start')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(posts, 0)
  pending = false
  release()
  await clock
  assert.equal(posts, 1)
  assert.equal(attendanceRequests, 3)
  assert.equal(view.state.currentState, 'on_break')
})

test('rapid repeated clicks submit only one clock request', async () => {
  let release!: () => void
  let posts = 0
  const view = await page(success, async () => {
    posts++
    await new Promise<void>((resolve) => {
      release = resolve
    })
    return {}
  })
  const first = view.state.clock('break_start')
  const second = view.state.clock('break_start')
  assert.equal(posts, 1)
  release()
  await Promise.all([first, second])
  assert.equal(posts, 1)
})

test('dashboard displays original break and work durations without polling the API', async () => {
  const lifecycle: Record<string, any> = {}
  const durationToday = {
    date: '2026-09-18',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-09-17',
      clock_in_at: '2026-09-17T20:00:00.000Z',
      clock_out_at: null,
      original_clock_in_at: '2026-09-17T00:00:00.000Z',
      original_clock_out_at: null,
      original_total_break_seconds: 1800,
      total_break_seconds: 9999,
      break_started_at: null,
      break_minutes: 15,
    },
  }
  const view = await page(
    async (path: string) => (path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : durationToday),
    undefined,
    undefined,
    lifecycle,
  )
  lifecycle.mounted()
  assert.equal(lifecycle.intervalCalls, 1)
  assert.equal(lifecycle.intervalDelay, 60_000)
  const html = await view.html()
  assert.match(html, /休憩時間/)
  assert.match(html, /実労働時間/)
  assert.match(html, /0時間30分/)
  assert.match(html, /実労働時間/)
})

test('returning to a visible or focused dashboard synchronizes with the server', async () => {
  const lifecycle: Record<string, any> = {}
  let attendanceRequests = 0
  const view = await page(
    async (path: string) => {
      if (path === '/api/auth/me') return { display_name: 'Test', role: 'member' }
      attendanceRequests++
      return today
    },
    undefined,
    undefined,
    lifecycle,
  )
  lifecycle.mounted()
  lifecycle.document.visibilityState = 'hidden'
  lifecycle['document:visibilitychange']()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attendanceRequests, 1)
  lifecycle.document.visibilityState = 'visible'
  lifecycle['document:visibilitychange']()
  await new Promise((resolve) => setImmediate(resolve))
  lifecycle['window:focus']()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(attendanceRequests, 3)
  assert.ok(view.state.today)
})

test('break button toggles and clock-out is disabled when on break', async () => {
  // Working state: break_start available, clock-out available
  const view = await page(success)
  let html = await view.html()
  assert.match(html, /休憩開始を記録/)
  assert.doesNotMatch(html, /<button[^>]*disabled[^>]*>\s*退勤を記録/)

  // Trigger break_start
  let dispatchedBody: any
  const breakStartView = await page(success, async (_path: string, options: any) => {
    dispatchedBody = options.body
  })
  await breakStartView.state.clock('break_start')
  assert.deepEqual(dispatchedBody, { action: 'break_start', recordId: 'shift-a' })

  // Active break state: clock-out must be disabled (Case 2)
  const onBreakToday = {
    date: '2026-09-18',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-09-17',
      clock_in_at: '2026-09-17T00:00:00.000Z',
      clock_out_at: null,
      break_started_at: '2026-09-17T04:00:00.000Z',
    },
  }
  const onBreakView = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : onBreakToday,
  )
  html = await onBreakView.html()
  assert.match(html, /休憩中/)
  assert.match(html, /休憩終了を記録/)
  assert.match(html, /<button[^>]*disabled[^>]*>\s*退勤を記録/)
})

test('action panel uses distinct visual groups for start, break and end actions', async () => {
  const onBreakToday = {
    date: '2026-09-18',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-09-17',
      clock_in_at: '2026-09-17T00:00:00.000Z',
      clock_out_at: null,
      break_started_at: '2026-09-17T04:00:00.000Z',
    },
  }
  const view = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : onBreakToday,
  )
  const html = await view.html()
  assert.match(html, /主要操作/)
  assert.match(html, /class="[^"]*clock-action[^"]*primary[^"]*"/)
  assert.match(html, /class="[^"]*clock-action[^"]*break-action[^"]*"/)
  assert.match(html, /class="[^"]*clock-action[^"]*danger[^"]*"/)
  assert.match(html, /休憩中は「休憩終了」を押して勤務を再開してください/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="出勤を記録"/)
})

test('done state keeps the clock-in button disabled (idle vs done regression)', async () => {
  const completedToday = {
    date: '2026-09-18',
    record: {
      id: 'shift-a',
      work_date: '2026-09-18',
      clock_in_at: '2026-09-18T00:00:00.000Z',
      clock_out_at: '2026-09-18T08:00:00.000Z',
    },
    openRecord: null,
  }
  const view = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : completedToday,
  )
  const html = await view.html()
  assert.equal(view.state.currentState, 'done')
  assert.match(html, /退勤済み/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="出勤を記録"/)
})

test('a real clock-out stays done even if clock_out_at is later cleared by a month-page edit', async () => {
  const editedOutToday = {
    date: '2026-09-18',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-09-18',
      clock_in_at: '2026-09-18T00:00:00.000Z',
      clock_out_at: null,
      original_clock_in_at: '2026-09-18T00:00:00.000Z',
      original_clock_out_at: '2026-09-18T08:00:00.000Z',
      break_started_at: null,
    },
  }
  const view = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : editedOutToday,
  )
  const html = await view.html()
  assert.equal(view.state.currentState, 'done')
  assert.match(html, /退勤済み/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="出勤を記録"/)
  assert.match(html, /<button[^>]*disabled[^>]*aria-label="退勤を記録"/)
})

test('dashboard uses original punch times after a manual edit', async () => {
  const today = {
    date: '2026-09-18',
    record: {
      id: 'shift-a',
      work_date: '2026-09-18',
      clock_in_at: '2026-09-18T00:00:00.000Z',
      clock_out_at: '2026-09-18T08:00:00.000Z',
      original_clock_in_at: '2026-09-18T01:00:00.000Z',
      original_clock_out_at: '2026-09-18T09:00:00.000Z',
      total_break_seconds: 0,
      original_total_break_seconds: 0,
    },
    openRecord: null,
  }
  const view = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : today,
  )
  const html = await view.html()
  assert.match(html, /2026-09-18 10:00/)
  assert.match(html, /2026-09-18 18:00/)
  assert.doesNotMatch(html, /2026-09-18 09:00/)
  assert.doesNotMatch(html, /2026-09-18 17:00/)
})

test('a clock-out entered on the month page is not shown until the shift is really clocked out', async () => {
  const prefilledToday = {
    date: '2026-09-18',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-09-18',
      clock_in_at: '2026-09-18T00:00:00.000Z',
      clock_out_at: '2026-09-18T09:00:00.000Z',
      original_clock_in_at: '2026-09-18T00:00:00.000Z',
      original_clock_out_at: null,
      total_break_seconds: 0,
      original_total_break_seconds: 0,
      break_started_at: null,
    },
  }
  const view = await page(async (path: string) =>
    path === '/api/auth/me' ? { display_name: 'Test', role: 'member' } : prefilledToday,
  )
  const html = await view.html()
  assert.equal(view.state.currentState, 'working')
  assert.equal(view.state.punchRecord.clock_out_at, null)
  assert.doesNotMatch(html, /2026-09-18 18:00/, 'The edited clock-out must not appear as the punched clock-out.')
})

// Links to the month page that open a record's edit form, read from the NuxtLink stub.
function editLinks(html: string) {
  return [...html.matchAll(/<a data-to="([^"]*)"/g)]
    .map((match) => JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')))
    .filter((to) => typeof to === 'object' && to?.query?.edit)
}
// A shift left open on the last day of the previous month, so its month differs from today's.
// By default the clock request succeeds and closes the shift; `post` can replace that.
function forgottenShiftView(post: (close: () => void) => Promise<unknown> = async (close) => close()) {
  let clockedOut = false
  const unfinished = {
    date: '2026-09-01',
    record: null,
    openRecord: {
      id: 'shift-a',
      work_date: '2026-08-31',
      clock_in_at: '2026-08-31T00:00:00.000Z',
      clock_out_at: null,
      original_clock_in_at: '2026-08-31T00:00:00.000Z',
      original_clock_out_at: null,
      break_started_at: null,
    },
  }
  return page(
    async (path: string) =>
      path === '/api/auth/me'
        ? { display_name: 'Test', role: 'member' }
        : clockedOut
          ? { date: '2026-09-01', record: null, openRecord: null }
          : unfinished,
    async () =>
      post(() => {
        clockedOut = true
      }),
  )
}

test('the unfinished-shift notice offers no edit link before the shift is clocked out', async () => {
  // Editing the clock-out first neither ends the shift nor survives the later clock-out.
  const view = await forgottenShiftView()
  const html = await view.html()
  assert.match(html, /前回の勤務が未退勤です/)
  assert.deepEqual(editLinks(html), [])
})

test('clocking out a previous-day shift then links to editing that shift', async () => {
  const view = await forgottenShiftView()
  await view.state.clock('out')
  const html = await view.html()
  assert.doesNotMatch(html, /前回の勤務が未退勤です/)
  assert.deepEqual(editLinks(html), [{ path: '/records', query: { month: '2026-08', edit: 'shift-a' } }])
})

test('a rejected clock-out shows no edit link even when the shift was closed elsewhere', async () => {
  // Another tab clocked the shift out first, so this request is rejected and the reload shows
  // no open shift. This page did not record the clock-out, so it must not claim it did.
  const view = await forgottenShiftView(async (close) => {
    close()
    throw { data: { statusMessage: '記録が更新されたか、先に退勤すべき勤務があるか、出勤日時が現在以降です。' } }
  })
  await view.state.clock('out')
  const html = await view.html()
  assert.doesNotMatch(html, /前回の勤務が未退勤です/)
  assert.match(html, /記録が更新されたか/)
  assert.deepEqual(editLinks(html), [])
})

test('clocking out a shift of the current work day shows no edit link', async () => {
  let clockedOut = false
  const open = {
    id: 'shift-b',
    work_date: '2026-09-18',
    clock_in_at: '2026-09-18T00:00:00.000Z',
    clock_out_at: null,
    original_clock_in_at: '2026-09-18T00:00:00.000Z',
    original_clock_out_at: null,
  }
  const view = await page(
    async (path: string) =>
      path === '/api/auth/me'
        ? { display_name: 'Test', role: 'member' }
        : clockedOut
          ? {
              date: '2026-09-18',
              record: { ...open, original_clock_out_at: '2026-09-18T08:00:00.000Z' },
              openRecord: null,
            }
          : { date: '2026-09-18', record: open, openRecord: open },
    async () => {
      clockedOut = true
      return {}
    },
  )
  await view.state.clock('out')
  assert.equal(view.state.currentState, 'done')
  assert.deepEqual(editLinks(await view.html()), [])
})
