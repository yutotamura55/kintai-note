<script setup lang="ts">
const router = useRouter(); const today = ref<any>(); const me = ref<any>(); const error = ref(''); const busy = ref(false)
const dateFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false })
const time = (value?: string) => value ? dateFormat.format(new Date(value)) : '—'
async function load() { try { [me.value, today.value] = await Promise.all([$fetch('/api/auth/me'), $fetch('/api/attendance/today')]) } catch { await router.replace('/login') } }
async function clock(action: 'in' | 'out') { busy.value = true; error.value = ''; try { await $fetch('/api/attendance/clock', { method: 'POST', body: { action } }); await load() } catch (cause: any) { error.value = cause?.data?.statusMessage || '打刻に失敗しました。' } finally { busy.value = false } }
async function logout() { await $fetch('/api/auth/logout', { method: 'POST' }); await router.replace('/login') }
await load()
</script>
<template><main class="app-shell" v-if="me && today"><header><div><p class="eyebrow">KINTAI NOTE</p><h1>こんにちは、{{ me.display_name }}さん</h1></div><button class="text-button" @click="logout">ログアウト</button></header><section class="card clock-card"><p class="today">{{ today.date }}</p><div class="times"><div><span>出勤</span><strong>{{ time(today.record?.clock_in_at) }}</strong></div><div><span>退勤</span><strong>{{ time(today.record?.clock_out_at) }}</strong></div></div><div class="actions"><button class="primary" :disabled="busy || !!today.record?.clock_in_at" @click="clock('in')">出勤を記録</button><button class="secondary" :disabled="busy || !today.record?.clock_in_at || !!today.record?.clock_out_at" @click="clock('out')">退勤を記録</button></div><p v-if="error" class="error">{{ error }}</p></section><section class="links"><NuxtLink to="/records">月別の記録・PDF</NuxtLink><NuxtLink to="/settings/security/passkeys">パスキーを管理</NuxtLink><NuxtLink v-if="me.role === 'admin'" to="/admin/users">利用者を管理</NuxtLink></section></main></template>
