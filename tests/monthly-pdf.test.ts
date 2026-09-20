import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import * as pdfLib from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { japanDateTime, calculateBreakMinutes, calculateWorkMinutes, formatDuration } from '../shared/utils/attendance.ts'

// Run the actual route and PDF libraries, adapting only Nuxt, auth, DB and asset I/O.
const source = readFileSync(new URL('../server/api/reports/month.pdf.get.ts', import.meta.url), 'utf8')
const script = stripTypeScriptTypes(source.replace(/^import .*\n/gm, '')).replace('export default ', 'return ')
const fontBytes = readFileSync(new URL('../app/public/fonts/NotoSansJP-Regular.ttf', import.meta.url))
const rows = [{ work_date: '2026-09-16', clock_in_at: '2026-09-16T16:00:00.000Z', clock_out_at: '2026-09-16T20:00:00.000Z', total_break_seconds: 3600, break_minutes: null }]
async function report(displayName: string, records = rows, options = { cloudflare: true, assetStatus: 200 }) {
  const headers: Record<string, string> = {}
  const asset = async (url: string) => {
    assert.equal(new URL(url, 'https://assets.local').pathname, '/fonts/NotoSansJP-Regular.ttf')
    return new Response(fontBytes, { status: options.assetStatus })
  }
  const dependencies = { PDFDocument: pdfLib.PDFDocument, StandardFonts: pdfLib.StandardFonts, rgb: pdfLib.rgb, fontkit,
    japanDateTime, calculateBreakMinutes, calculateWorkMinutes, formatDuration,
    defineEventHandler: (handler: Function) => handler,
    currentUser: async () => ({ id: 'user', display_name: displayName }),
    getQuery: () => ({ month: '2026-09' }),
    db: () => ({ prepare: () => ({ bind: () => ({ all: async () => ({ results: records }) }) }) }),
    setHeader: (_event: unknown, name: string, value: string) => { headers[name] = value },
    createError: (options: any) => Object.assign(new Error(options.statusMessage), options),
    $fetch: async (url: string) => (await asset(url)).arrayBuffer(),
  }
  const handler = new Function(...Object.keys(dependencies), script)(...Object.values(dependencies))
  const event = { context: options.cloudflare ? { cloudflare: { env: { ASSETS: { fetch: asset } } } } : {} }
  const bytes = await handler(event)
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false })
  try {
    const pdf = await task.promise
    const page = await pdf.getPage(1)
    const text = (await page.getTextContent()).items.map((item: any) => item.str || '').join(' ')
    return { text, pages: pdf.numPages, headers, bytes }
  } finally { await task.destroy() }
}
for (const name of ['Local Test User', '山田 太郎', '髙橋 﨑子 𠮷田', 'たなか タロウ']) {
  test(`monthly PDF retains name and overnight Japan dates: ${name}`, async () => {
    const result = await report(name)
    assert.ok(result.text.includes(name), result.text)
    assert.ok(result.text.includes('2026-09-16'))
    assert.ok(result.text.includes('2026-09-17 01:00'))
    assert.ok(result.text.includes('2026-09-17 05:00'))
    assert.ok(result.text.includes('Break'))
    assert.ok(result.text.includes('Actual work'))
    assert.ok(result.text.includes('1:00'))
    assert.ok(result.text.includes('3:00'))
    assert.equal(result.pages, 1)
    assert.equal(result.headers['Content-Type'], 'application/pdf')
    assert.equal(result.headers['Content-Disposition'], 'attachment; filename="kintai-2026-09.pdf"')
    assert.ok(result.bytes.length < 100_000, 'Embed only the glyphs used in the PDF, not the entire font.')
  })
}
test('empty month still produces a PDF with Japanese name', async () => {
  const result = await report('山田 太郎', [])
  assert.ok(result.text.includes('山田 太郎'))
  assert.ok(result.text.includes('2026-09'))
})
test('Nuxt development loads the same bundled font without a Workers binding', async () => {
  const result = await report('山田 太郎', rows, { cloudflare: false, assetStatus: 200 })
  assert.ok(result.text.includes('山田 太郎'))
})
test('missing deployed font produces a controlled server error', async () => {
  await assert.rejects(report('山田 太郎', rows, { cloudflare: true, assetStatus: 404 }), { statusCode: 503 })
})

test('embedded glyph outlines remain drawable after subsetting', async () => {
  const result = await report('山田 太郎 / 髙橋 﨑子 𠮷田')
  const pdf = await pdfLib.PDFDocument.load(result.bytes)
  let checked = false
  for (const [, object] of pdf.context.enumerateIndirectObjects()) {
    if (!(object instanceof pdfLib.PDFDict)) continue
    const ref = object.get(pdfLib.PDFName.of('FontFile2'))
    if (!ref) continue
    const stream = pdf.context.lookup(ref, pdfLib.PDFRawStream)
    const font = fontkit.create(pdfLib.decodePDFRawStream(stream).decode())
    let empty = 0
    for (let id = 0; id < font.numGlyphs; id++) {
      if (font.getGlyph(id).path.commands.length === 0) empty++
    }
    // This title has exactly one unique whitespace glyph; every other glyph must draw.
    assert.equal(empty, 1, 'Text extraction alone can pass even when visible glyphs are corrupt.')
    checked = true
  }
  assert.ok(checked, 'The PDF must contain an embedded TrueType font.')
})
