<script setup lang="ts">
import { startAuthentication } from '@simplewebauthn/browser'
const busy = ref(false); const error = ref('')
async function login() {
  busy.value = true; error.value = ''
  try {
    const options = await $fetch('/api/auth/passkeys/login-options', { method: 'POST' })
    const response = await startAuthentication({ optionsJSON: options })
    await $fetch('/api/auth/passkeys/login-verify', { method: 'POST', body: response })
    await navigateTo('/dashboard')
  } catch (cause: any) { error.value = cause?.data?.statusMessage || 'ログインできませんでした。' }
  finally { busy.value = false }
}
</script>
<template>
  <main class="auth-shell"><section class="card auth-card"><p class="eyebrow">KINTAI NOTE</p><h1>おかえりなさい</h1><p>パスキーを使って、安全にログインします。</p><button class="primary" :disabled="busy" @click="login">{{ busy ? '確認しています…' : 'パスキーでログイン' }}</button><p v-if="error" class="error">{{ error }}</p></section></main>
</template>
