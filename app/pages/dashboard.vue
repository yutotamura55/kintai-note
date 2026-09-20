<script setup lang="ts">
import { displayJapanDateTime } from '~~/shared/utils/attendance'
const router = useRouter(); const today = ref<any>(); const me = ref<any>(); const error = ref(''); const busy = ref(false)
const loadError = ref(''); const loading = ref(false)
const api = useRequestFetch()
const displayedRecord = computed(() => today.value?.openRecord || today.value?.record)
const punchRecord = computed(() => {
  const record = displayedRecord.value
  if (!record) return null
  return {
    ...record,
    clock_in_at: record.original_clock_in_at ?? record.clock_in_at,
    clock_out_at: record.original_clock_out_at ?? record.clock_out_at,
  }
})
const previousOpen = computed(() => today.value?.openRecord && today.value.openRecord.work_date !== today.value.date)
const correctionLink = computed(() => ({ path: '/records', query: {
  month: today.value?.openRecord?.work_date.slice(0, 7), edit: today.value?.openRecord?.id,
} }))
const isOnBreak = computed(() => !!punchRecord.value?.break_started_at && !punchRecord.value?.clock_out_at)
const statusInfo = computed(() => {
  if (!punchRecord.value?.clock_in_at) return { label: '未出勤', class: 'status-default' }
  if (punchRecord.value?.clock_out_at) return { label: '退勤済み', class: 'status-done' }
  if (isOnBreak.value) return { label: '休憩中', class: 'status-break' }
  return { label: '勤務中', class: 'status-working' }
})
async function load() {
  if (loading.value) return
  loading.value = true
  try {
    [me.value, today.value] = await Promise.all([api('/api/auth/me'), api('/api/attendance/today')])
    loadError.value = ''
  }
  catch (cause: any) {
    if (cause?.statusCode === 401 || cause?.response?.status === 401) await router.replace('/login')
    else loadError.value = '記録を取得できませんでした。再試行してください。'
  }
  finally { loading.value = false }
}
async function clock(action: 'in' | 'out' | 'break_start' | 'break_end') {
  busy.value = true; error.value = '';
  try {
    const targetRecordId = today.value?.openRecord?.id || today.value?.record?.id
    await $fetch('/api/attendance/clock', {
      method: 'POST',
      body: { action, ...(action !== 'in' ? { recordId: targetRecordId } : {}) }
    })
    await load()
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || '打刻に失敗しました。'
    await load()
  } finally { busy.value = false }
}
async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await router.replace('/login') }
await load()
function refreshAfterReturn() { if (!busy.value && document.visibilityState === 'visible') void load() }
onMounted(() => {
  window.addEventListener('focus', refreshAfterReturn)
  document.addEventListener('visibilitychange', refreshAfterReturn)
})
onUnmounted(() => {
  window.removeEventListener('focus', refreshAfterReturn)
  document.removeEventListener('visibilitychange', refreshAfterReturn)
})
</script>
<template>
  <main class="app-shell">
    <section v-if="loadError" class="card">
      <p class="error" role="alert">{{ loadError }}</p>
      <button class="secondary" :disabled="loading || busy" @click="load">{{ loading ? '取得中…' : '再試行' }}</button>
    </section>
    <p v-else-if="!me || !today" role="status">記録を取得しています…</p>
    <template v-if="me && today">
    <header><div><p class="eyebrow">KINTAI NOTE</p><h1>こんにちは、{{ me.display_name }}さん</h1></div><button class="text-button" @click="logout">ログアウト</button></header>
    <section class="card clock-card">
      <div class="clock-status-bar">
        <p class="today">現在の勤務日：{{ today.date }}</p>
        <span class="status-badge" :class="statusInfo.class">{{ statusInfo.label }}</span>
      </div>
      <p>勤務日は日本時間の午前4時に切り替わります。</p>
      <div v-if="previousOpen" class="attendance-warning" role="status">
        <p><strong>前回の勤務が未退勤です（勤務日：{{ today.openRecord.work_date }}）。</strong></p>
        <p>今まで勤務していた場合は「退勤を記録」を押してください。打刻を忘れていた場合は、実際の退勤日時を入力してください。</p>
        <NuxtLink :to="correctionLink">月別記録で退勤日時を入力する</NuxtLink>
      </div>
      <p v-if="displayedRecord">表示中の勤務日：{{ displayedRecord.work_date }}</p>
      <div class="times">
        <div><span>出勤（日本時間）</span><strong>{{ displayJapanDateTime(punchRecord?.clock_in_at) }}</strong></div>
        <div><span>退勤（日本時間）</span><strong>{{ displayJapanDateTime(punchRecord?.clock_out_at) }}</strong></div>
      </div>
      <div class="actions">
        <button class="primary" :disabled="busy || loading || !!today.record?.clock_in_at" @click="clock('in')">出勤を記録</button>
        <button class="secondary" :disabled="busy || loading || !today.openRecord" @click="clock(isOnBreak ? 'break_end' : 'break_start')">{{ isOnBreak ? '休憩終了を記録' : '休憩開始を記録' }}</button>
        <button class="secondary" :disabled="busy || loading || !today.openRecord || isOnBreak" @click="clock('out')">退勤を記録</button>
      </div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
    <section class="links"><NuxtLink :to="{ path: '/records', query: { month: today.date.slice(0, 7) } }">月別の記録・PDF</NuxtLink><NuxtLink to="/settings/security/passkeys">パスキーを管理</NuxtLink><NuxtLink v-if="me.role === 'admin'" to="/admin/users">利用者を管理</NuxtLink></section>
    </template>
  </main>
</template>

<style scoped>
.clock-status-bar { display: flex; align-items: center; justify-content: center; gap: 12px; }
.status-badge { display: inline-block; padding: 4px 12px; border-radius: 9999px; font-size: .85rem; font-weight: 700; }
.status-default { background: #eef2f7; color: #59647a; }
.status-working { background: #e6f7ec; color: #167a3a; }
.status-break { background: #fff4e5; color: #b45309; }
.status-done { background: #e9efff; color: #315dc5; }
@media (max-width: 520px) {
  .clock-status-bar { flex-direction: column; gap: 6px; }
}
</style>
