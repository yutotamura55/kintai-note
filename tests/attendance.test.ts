import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workDateAt, japanDateTime, parseJapanDateTime, displayJapanDateTime } from '../shared/utils/attendance.ts'

for (const [instant, expected] of [
  ['2026-09-17T00:00:00+09:00', '2026-09-16'],
  ['2026-09-17T03:59:59.999+09:00', '2026-09-16'],
  ['2026-09-17T04:00:00+09:00', '2026-09-17'],
  ['2026-09-17T23:59:59+09:00', '2026-09-17'],
  ['2026-10-01T03:59:59+09:00', '2026-09-30'],
  ['2026-10-01T04:00:00+09:00', '2026-10-01'],
  ['2027-01-01T03:59:59+09:00', '2026-12-31'],
  ['2027-01-01T04:00:00+09:00', '2027-01-01'],
  ['2028-03-01T03:00:00+09:00', '2028-02-29'],
]) {
  test(`work date: ${instant}`, () => assert.equal(workDateAt(new Date(instant)), expected))
}

test('explicit Japan dates round-trip across midnight, month and year boundaries', () => {
  for (const value of ['2026-09-17T23:00', '2026-09-18T05:00', '2027-01-01T00:00', '2028-02-29T03:59']) {
    assert.equal(japanDateTime(parseJapanDateTime(value)), value)
    assert.equal(displayJapanDateTime(parseJapanDateTime(value)), value.replace('T', ' '))
  }
  assert.equal(parseJapanDateTime('2026-09-18T05:00'), '2026-09-17T20:00:00.000Z')
  assert.equal(parseJapanDateTime(''), null)
})

test('reject invalid or normalized dates and invalid runtime types', () => {
  for (const value of ['2026-02-29T01:00', '2026-04-31T12:00', '2026-09-17T24:00', '2026-09-17T09:60', '2026-13-01T00:00', '09:00', {}, 1]) {
    assert.throws(() => parseJapanDateTime(value))
  }
})
