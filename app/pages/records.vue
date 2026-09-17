<script setup lang="ts">
type Record = { id: string, work_date: string, clock_in_at: string | null, clock_out_at: string | null }
const month = ref(new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7)); const records = ref<Record[]>([])
const timeFormat = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }); const time = (value?: string) => value ? timeFormat.format(new Date(value)) : '—'
const inputTimeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const inputTime = (value: string | null) => value ? inputTimeFormat.format(new Date(value)) : ''
const editing = ref<string | null>(null); const draft = ref({ clockIn: '', clockOut: '' }); const saving = ref(false); const error = ref('')
async function load() { const data = await $fetch<any>('/api/attendance/month', { query: { month: month.value } }); records.value = data.results }
function pdf() { window.open(`/api/reports/month.pdf?month=${month.value}`, '_blank') }
function edit(record: Record) { error.value = ''; editing.value = record.id; draft.value = { clockIn: inputTime(record.clock_in_at), clockOut: inputTime(record.clock_out_at) } }
function cancel() { editing.value = null; error.value = '' }
async function save(record: Record) {
  saving.value = true; error.value = ''
  try { await $fetch('/api/attendance/record', { method: 'PUT', body: { id: record.id, clockIn: draft.value.clockIn, clockOut: draft.value.clockOut } }); await load(); editing.value = null }
  catch (cause: any) { error.value = cause?.data?.statusMessage || '記録を更新できませんでした。' }
  finally { saving.value = false }
}
await load(); watch(month, load)
</script>
<template><main class="app-shell"><NuxtLink class="back" to="/dashboard">← ダッシュボード</NuxtLink><header><div><p class="eyebrow">RECORDS</p><h1>月別の勤怠</h1></div><button class="secondary" @click="pdf">PDFをダウンロード</button></header><input v-model="month" type="month" class="month"/><p v-if="error" class="error">{{ error }}</p><section class="card table-card"><table><thead><tr><th>日付</th><th>出勤</th><th>退勤</th><th></th></tr></thead><tbody><template v-for="record in records" :key="record.id"><tr><td>{{ record.work_date }}</td><td>{{ time(record.clock_in_at) }}</td><td>{{ time(record.clock_out_at) }}</td><td><button class="text-button" @click="edit(record)">編集</button></td></tr><tr v-if="editing === record.id" class="edit-row"><td>{{ record.work_date }}</td><td><input v-model="draft.clockIn" type="time" required aria-label="出勤時刻" /></td><td><input v-model="draft.clockOut" type="time" aria-label="退勤時刻" /></td><td class="edit-actions"><button class="primary" :disabled="saving" @click="save(record)">{{ saving ? '保存中…' : '保存' }}</button><button class="text-button" :disabled="saving" @click="cancel">取消</button></td></tr></template><tr v-if="!records.length"><td colspan="4">この月の記録はありません。</td></tr></tbody></table></section></main></template>
