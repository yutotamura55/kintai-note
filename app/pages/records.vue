<script setup lang="ts">
import { workDateAt, japanDateTime, displayJapanDateTime, type AttendanceRecord } from '~~/shared/utils/attendance'
type Record = AttendanceRecord
const route = useRoute()
const api = useRequestFetch()
const requestedMonth = typeof route.query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(route.query.month) ? route.query.month : null
const month = ref(requestedMonth || workDateAt().slice(0, 7)); const records = ref<Record[]>([])
const editing = ref<string | null>(null); const draft = ref({ clockIn: '', clockOut: '' }); const saving = ref(false); const error = ref('')
async function load() { const data = await api<any>('/api/attendance/month', { query: { month: month.value } }); records.value = data.results }
function pdf() { window.open(`/api/reports/month.pdf?month=${month.value}`, '_blank') }
function edit(record: Record) { error.value = ''; editing.value = record.id; draft.value = { clockIn: japanDateTime(record.clock_in_at), clockOut: japanDateTime(record.clock_out_at) } }
function cancel() { editing.value = null; error.value = '' }
async function save(record: Record) {
  saving.value = true; error.value = ''
  try { await $fetch('/api/attendance/record', { method: 'PUT', body: { id: record.id, clockIn: draft.value.clockIn, clockOut: draft.value.clockOut } }); await load(); editing.value = null }
  catch (cause: any) { error.value = cause?.data?.statusMessage || '記録を更新できませんでした。' }
  finally { saving.value = false }
}
await load()
const requestedRecord = records.value.find(record => record.id === route.query.edit)
if (requestedRecord) edit(requestedRecord)
watch(month, async () => { cancel(); await load() })
</script>
<template><main class="app-shell"><NuxtLink class="back" to="/dashboard">← ダッシュボード</NuxtLink><header><div><p class="eyebrow">RECORDS</p><h1>月別の勤怠</h1></div><button class="secondary" @click="pdf">PDFをダウンロード</button></header><p>勤務日を基準に月別表示します（日本時間・午前4時区切り）。日時を編集しても勤務日は変更されません。</p><p>翌日以降に退勤した場合は、実際の退勤日も指定してください。</p><input v-model="month" type="month" class="month"/><p v-if="error" class="error">{{ error }}</p><section class="card table-card"><table><thead><tr><th>勤務日</th><th>出勤日時（日本時間）</th><th>退勤日時（日本時間）</th><th></th></tr></thead><tbody><template v-for="record in records" :key="record.id"><tr><td>{{ record.work_date }}</td><td>{{ displayJapanDateTime(record.clock_in_at) }}</td><td>{{ displayJapanDateTime(record.clock_out_at) }}</td><td><button class="text-button" @click="edit(record)">編集</button></td></tr><tr v-if="editing === record.id" class="edit-row"><td>{{ record.work_date }}</td><td><input v-model="draft.clockIn" type="datetime-local" required aria-label="出勤日時（日本時間）" /></td><td><input v-model="draft.clockOut" type="datetime-local" aria-label="退勤日時（日本時間）" /></td><td class="edit-actions"><button class="primary" :disabled="saving" @click="save(record)">{{ saving ? '保存中…' : '保存' }}</button><button class="text-button" :disabled="saving" @click="cancel">取消</button></td></tr></template><tr v-if="!records.length"><td colspan="4">この月の記録はありません。</td></tr></tbody></table></section></main></template>
