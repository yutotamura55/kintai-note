<script setup lang="ts">
import { startRegistration } from '@simplewebauthn/browser'
const route = useRoute(); const busy = ref(false); const error = ref('')
function messageForRegistrationError(cause: any) {
  if (cause?.data?.statusMessage) return cause.data.statusMessage
  if (cause?.name === 'NotAllowedError') return '端末側でパスキー登録が中断または拒否されました。Chrome または Safari の通常タブで招待URLを開き、画面ロック解除を完了してください。'
  if (cause?.name === 'SecurityError') return 'このブラウザでは安全なパスキー登録を開始できません。Chrome または Safari の通常タブで招待URLを開いてください。'
  return cause?.message || 'パスキーを登録できませんでした。'
}
async function activate() {
  busy.value = true; error.value = ''
  try {
    const options = await $fetch('/api/auth/activate-options', { method: 'POST', body: { token: route.params.token } })
    const response = await startRegistration({ optionsJSON: options })
    await $fetch('/api/auth/activate-verify', { method: 'POST', body: response })
    await navigateTo('/dashboard')
  } catch (cause: any) { error.value = messageForRegistrationError(cause) }
  finally { busy.value = false }
}
</script>
<template><main class="auth-shell"><section class="card auth-card"><p class="eyebrow">KINTAI NOTE</p><h1>アカウントを有効化</h1><p>この端末にパスキーを登録します。</p><button class="primary" :disabled="busy" @click="activate">{{ busy ? '登録しています…' : 'パスキーを登録する' }}</button><p v-if="error" class="error">{{ error }}</p></section></main></template>
