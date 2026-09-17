<script setup lang="ts">
import { startRegistration } from '@simplewebauthn/browser'
const busy = ref(false); const message = ref('')
async function add() { busy.value = true; message.value = ''; try { const options = await $fetch('/api/auth/passkeys/register-options', { method: 'POST' }); const response = await startRegistration({ optionsJSON: options }); await $fetch('/api/auth/passkeys/register-verify', { method: 'POST', body: response }); message.value = 'パスキーを追加しました。' } catch (e: any) { message.value = e?.data?.statusMessage || '追加できませんでした。' } finally { busy.value = false } }
</script>
<template><main class="app-shell"><NuxtLink class="back" to="/dashboard">← ダッシュボード</NuxtLink><section class="card"><p class="eyebrow">SECURITY</p><h1>パスキー</h1><p>PCやスマートフォンなど、別の端末にもパスキーを追加できます。</p><button class="primary" :disabled="busy" @click="add">{{ busy ? '追加しています…' : 'パスキーを追加' }}</button><p v-if="message" class="notice">{{ message }}</p></section></main></template>
