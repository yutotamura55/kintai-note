<script setup lang="ts">
import { startRegistration } from '@simplewebauthn/browser'
const token = ref(''); const employeeCode = ref('admin'); const displayName = ref(''); const busy = ref(false); const error = ref('')
async function setup() {
  busy.value = true; error.value = ''
  try {
    const options = await $fetch('/api/admin/bootstrap', { method: 'POST', body: { token: token.value, employeeCode: employeeCode.value, displayName: displayName.value } })
    const response = await startRegistration({ optionsJSON: options })
    await $fetch('/api/auth/passkeys/register-verify', { method: 'POST', body: response })
    await navigateTo('/dashboard')
  } catch (cause: any) { error.value = cause?.data?.statusMessage || '初期設定に失敗しました。' }
  finally { busy.value = false }
}
</script>
<template><main class="auth-shell"><section class="card auth-card"><p class="eyebrow">KINTAI NOTE</p><h1>初期セットアップ</h1><p>最初の管理者アカウントを作成します。完了後は環境変数のセットアップトークンを削除してください。</p><form @submit.prevent="setup"><label>セットアップトークン<input v-model="token" required type="password" /></label><label>社員番号<input v-model="employeeCode" required /></label><label>表示名<input v-model="displayName" required /></label><button class="primary" :disabled="busy">{{ busy ? '登録しています…' : '管理者パスキーを登録' }}</button></form><p v-if="error" class="error">{{ error }}</p></section></main></template>
