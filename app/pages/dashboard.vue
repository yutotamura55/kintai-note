<script setup lang="ts">
import { displayJapanDateTime } from '~~/shared/utils/attendance'
const router = useRouter(); const today = ref<any>(); const me = ref<any>(); const error = ref(''); const busy = ref(false)
const api = useRequestFetch()
const displayedRecord = computed(() => today.value?.openRecord || today.value?.record)
const previousOpen = computed(() => today.value?.openRecord && today.value.openRecord.work_date !== today.value.date)
const correctionLink = computed(() => ({ path: '/records', query: {
  month: today.value?.openRecord?.work_date.slice(0, 7), edit: today.value?.openRecord?.id,
} }))
async function load() {
  try { [me.value, today.value] = await Promise.all([api('/api/auth/me'), api('/api/attendance/today')]) }
  catch (cause: any) {
    if (cause?.statusCode === 401 || cause?.response?.status === 401) await router.replace('/login')
    else error.value = '記録を取得できませんでした。画面を再読み込みしてください。'
  }
}
async function clock(action: 'in' | 'out') { busy.value = true; error.value = ''; try { await $fetch('/api/attendance/clock', { method: 'POST', body: { action } }); await load() } catch (cause: any) { error.value = cause?.data?.statusMessage || '打刻に失敗しました。'; await load() } finally { busy.value = false } }
async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await router.replace('/login') }
await load()
let refreshTimer: ReturnType<typeof setInterval> | undefined
function refresh() { if (!busy.value && document.visibilityState === 'visible') void load() }
onMounted(() => { refreshTimer = setInterval(refresh, 30_000); window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', refresh) })
onUnmounted(() => { clearInterval(refreshTimer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) })
</script>
<template>
  <main class="app-shell" v-if="me && today">
    <header><div><p class="eyebrow">KINTAI NOTE</p><h1>こんにちは、{{ me.display_name }}さん</h1></div><button class="text-button" @click="logout">ログアウト</button></header>
    <section class="card clock-card">
      <p class="today">現在の勤務日：{{ today.date }}</p>
      <p>勤務日は日本時間の午前4時に切り替わります。</p>
      <div v-if="previousOpen" class="attendance-warning" role="status">
        <p><strong>前回の勤務が未退勤です（勤務日：{{ today.openRecord.work_date }}）。</strong></p>
        <p>今まで勤務していた場合は「退勤を記録」を押してください。打刻を忘れていた場合は、実際の退勤日時を入力してください。</p>
        <NuxtLink :to="correctionLink">月別記録で退勤日時を入力する</NuxtLink>
      </div>
      <p v-if="displayedRecord">表示中の勤務日：{{ displayedRecord.work_date }}</p>
      <div class="times"><div><span>出勤（日本時間）</span><strong>{{ displayJapanDateTime(displayedRecord?.clock_in_at) }}</strong></div><div><span>退勤（日本時間）</span><strong>{{ displayJapanDateTime(displayedRecord?.clock_out_at) }}</strong></div></div>
      <div class="actions"><button class="primary" :disabled="busy || !!today.record?.clock_in_at" @click="clock('in')">出勤を記録</button><button class="secondary" :disabled="busy || !today.openRecord" @click="clock('out')">退勤を記録</button></div>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
    </section>
    <section class="links"><NuxtLink :to="{ path: '/records', query: { month: today.date.slice(0, 7) } }">月別の記録・PDF</NuxtLink><NuxtLink to="/settings/security/passkeys">パスキーを管理</NuxtLink><NuxtLink v-if="me.role === 'admin'" to="/admin/users">利用者を管理</NuxtLink></section>
  </main>
</template>
