import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '../src/extract/index.ts'

const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name))

describe('extract::text', () => {
  it('html: one fragment per leaf block with its index', async () => {
    const html =
      '<html><body><h1>Title</h1><p>First <b>bold</b> para.</p><ul><li><p>Nested</p></li><li>Flat</li></ul><p>   </p></body></html>'
    const { fragments } = await extract('text/html', new TextEncoder().encode(html))
    expect(fragments.map((f) => f.text)).toEqual(['Title', 'First bold para.', 'Nested', 'Flat'])
    expect(fragments[2]?.selector).toEqual({ kind: 'block', index: 2 })
  })
  it('text: paragraphs with exact character spans', async () => {
    const text = 'One para\nstill one.\n\n  Second para.\n\n\nThird'
    const { fragments } = await extract('text/plain', new TextEncoder().encode(text))
    expect(fragments).toHaveLength(3)
    for (const f of fragments) {
      const s = f.selector
      if (s.kind !== 'char') throw new Error('expected char selector')
      expect(text.slice(s.start, s.end)).toBe(f.text)
    }
  })
  it('pdf: page fragments with a bounding box and a span into the page text', async () => {
    const { fragments, pages } = await extract('application/pdf', fixture('sample.pdf'))
    expect(pages).toBe(1)
    expect(fragments).toHaveLength(1)
    expect(fragments[0]?.text).toBe('PIM gate one PDF')
    const s = fragments[0]?.selector
    if (s?.kind !== 'page') throw new Error('expected page selector')
    expect(s.page).toBe(1)
    expect(s.bbox?.length).toBe(4)
    expect(s.end - s.start).toBe('PIM gate one PDF'.length)
  })
  it('eml: headers first, then body paragraphs, all indexing the normalized text', async () => {
    const out = await extract('message/rfc822', fixture('sample.eml'))
    expect(out.fragments[0]?.text).toContain('Subject: Kiosk rollout budget')
    expect(out.fragments.map((f) => f.text)).toContain(
      'The budget for the kiosk rollout is approved.',
    )
    for (const f of out.fragments) {
      const s = f.selector
      if (s.kind !== 'char') throw new Error('expected char selector')
      expect(out.normalized_text?.slice(s.start, s.end)).toBe(f.text)
    }
  })
  it('unknown types yield no fragments', async () => {
    expect((await extract('image/png', new Uint8Array([1, 2, 3]))).fragments).toEqual([])
  })
})
