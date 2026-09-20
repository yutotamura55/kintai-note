<script setup lang="ts">
import { workDateAt, japanDateTime, displayJapanDateTime, calculateBreakMinutes, calculateWorkMinutes, formatDuration, type AttendanceRecord } from '~~/shared/utils/attendance'
type Record = AttendanceRecord
const route = useRoute()
const api = useRequestFetch()
const requestedMonth = typeof route.query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(route.query.month) ? route.query.month : null
const month = ref(requestedMonth || workDateAt().slice(0, 7)); const records = ref<Record[]>([])
const editing = ref<string | null>(null); const draft = ref({ clockIn: '', clockOut: '', breakMinutes: 0 as number | string }); const saving = ref(false); const error = ref('')
async function load() { const data = await api<any>('/api/attendance/month', { query: { month: month.value } }); records.value = data.results }
function pdf() { window.open(`/api/reports/month.pdf?month=${month.value}`, '_blank') }
function edit(record: Record) {
  error.value = ''; editing.value = record.id;
  draft.value = {
    clockIn: japanDateTime(record.clock_in_at),
    clockOut: japanDateTime(record.clock_out_at),
    breakMinutes: record.break_minutes !== null && record.break_minutes !== undefined
      ? record.break_minutes
      : calculateBreakMinutes(record),
  }
}
function cancel() { editing.value = null; error.value = '' }
async function save(record: Record) {
  saving.value = true; error.value = ''
  try {
    await $fetch('/api/attendance/record', {
      method: 'PUT',
      body: {
        id: record.id,
        clockIn: draft.value.clockIn,
        clockOut: draft.value.clockOut,
        breakMinutes: draft.value.breakMinutes,
      }
    })
    await load(); editing.value = null
  }
  catch (cause: any) { error.value = cause?.data?.statusMessage || '記録を更新できませんでした。' }
  finally { saving.value = false }
}
function canRestore(record: Record) {
  return !!((record.original_clock_in_at && record.original_clock_in_at !== record.clock_in_at)
    || (record.original_clock_out_at && record.original_clock_out_at !== record.clock_out_at)
    || (record.break_minutes !== null && record.break_minutes !== undefined))
}
function restoreTargetLabel(record: Record) {
  const parts: string[] = []
  if (record.original_clock_in_at && record.original_clock_out_at) parts.push('出勤・退勤')
  else if (record.original_clock_in_at) parts.push('出勤のみ')
  else if (record.original_clock_out_at) parts.push('退勤のみ')
  if (record.break_minutes !== null && record.break_minutes !== undefined) parts.push('休憩')
  return parts.join('・')
}
async function restore(record: Record) {
  if (saving.value) return
  saving.value = true; error.value = ''
  try {
    await $fetch('/api/attendance/restore', { method: 'POST', body: { id: record.id } })
    await load(); editing.value = null
  } catch (cause: any) {
    error.value = cause?.data?.statusMessage || '元の打刻時刻に戻せませんでした。'
  } finally { saving.value = false }
}
await load()
const requestedRecord = records.value.find(record => record.id === route.query.edit)
if (requestedRecord) edit(requestedRecord)
watch(month, async () => { cancel(); await load() })
</script>
<template>
  <main class="app-shell">
    <NuxtLink class="back" to="/dashboard">← ダッシュボード</NuxtLink>
    <header>
      <div><p class="eyebrow">RECORDS</p><h1>月別の勤怠</h1></div>
      <button class="secondary" @click="pdf">PDFをダウンロード</button>
    </header>
    <p>勤務日を基準に月別表示します（日本時間・午前4時区切り）。日時を編集しても勤務日は変更されません。</p>
    <p>翌日以降に退勤した場合は、実際の退勤日も指定してください。</p>
    <p>元の打刻時刻がある項目は、編集後も元に戻せます。元の時刻がない項目は変更しません。</p>
    <input v-model="month" type="month" class="month" :disabled="saving" />
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section class="card table-card">
      <table>
        <thead>
          <tr>
            <th>勤務日</th>
            <th>出勤日時（日本時間）</th>
            <th>退勤日時（日本時間）</th>
            <th>休憩時間</th>
            <th>実労働時間</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="record in records" :key="record.id">
            <tr>
              <td>{{ record.work_date }}</td>
              <td>
                {{ displayJapanDateTime(record.clock_in_at) }}
                <small class="original-time">{{ record.original_clock_in_at ? `元の打刻：${displayJapanDateTime(record.original_clock_in_at, true)}` : '元の打刻時刻なし' }}</small>
              </td>
              <td>
                {{ displayJapanDateTime(record.clock_out_at) }}
                <small class="original-time">{{ record.original_clock_out_at ? `元の打刻：${displayJapanDateTime(record.original_clock_out_at, true)}` : '元の打刻時刻なし' }}</small>
              </td>
              <td>
                {{ record.clock_in_at ? formatDuration(calculateBreakMinutes(record)) : '—' }}
                <small v-if="record.break_minutes !== null && record.break_minutes !== undefined" class="original-time">元の打刻：{{ formatDuration(Math.floor((record.original_total_break_seconds || 0) / 60)) }}</small>
              </td>
              <td>
                {{ record.clock_in_at ? formatDuration(calculateWorkMinutes(record)) : '—' }}
              </td>
              <td>
                <button class="text-button" :disabled="saving" @click="edit(record)">編集</button>
                <template v-if="record.original_clock_in_at || record.original_clock_out_at || (record.break_minutes !== null && record.break_minutes !== undefined)">
                  <button class="text-button" :disabled="saving || !canRestore(record)" @click="restore(record)">元の打刻時刻に戻す</button>
                  <small class="original-time">復元対象：{{ restoreTargetLabel(record) }}</small>
                </template>
              </td>
            </tr>
            <tr v-if="editing === record.id" class="edit-row">
              <td>{{ record.work_date }}</td>
              <td><input v-model="draft.clockIn" type="datetime-local" required :disabled="saving" aria-label="出勤日時（日本時間）" /></td>
              <td><input v-model="draft.clockOut" type="datetime-local" :disabled="saving" aria-label="退勤日時（日本時間）" /></td>
              <td><input v-model.number="draft.breakMinutes" type="number" min="0" step="1" :disabled="saving" aria-label="休憩時間（分）" placeholder="分" /></td>
              <td>—</td>
              <td class="edit-actions">
                <button class="primary" :disabled="saving" @click="save(record)">{{ saving ? '保存中…' : '保存' }}</button>
                <button class="text-button" :disabled="saving" @click="cancel">取消</button>
              </td>
            </tr>
          </template>
          <tr v-if="!records.length"><td colspan="6">この月の記録はありません。</td></tr>
        </tbody>
      </table>
    </section>
  </main>
</template>

<style scoped>
.original-time { display: block; margin-top: .4rem; font-size: .75rem; color: #526476; }
.edit-row input[type="number"] { min-width: 70px; }
</style>
