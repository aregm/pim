import { describe, expect, it } from 'vitest'
import { chunk, merge, validate } from './extract.ts'

describe('schema extraction (PRS-6, specification 6.4)', () => {
  it('cuts fragments into bounded chunks with one fragment of overlap', () => {
    const frags = Array.from({ length: 6 }, (_, i) => ({ id: `f${i + 1}`, text: 'x'.repeat(40) }))
    const out = chunk(frags, 120)
    expect(out.map((c) => c.ids)).toEqual([
      ['f1', 'f2'],
      ['f2', 'f3'],
      ['f3', 'f4'],
      ['f4', 'f5'],
      ['f5', 'f6'],
    ])
  })

  it('drops evidence ids that were not in the chunk, normalises, and rejects malformed answers', () => {
    const allowed = new Set(['f1', 'f2'])
    const ok = validate(
      JSON.stringify({
        entities: [
          {
            name: ' Priya Raman ',
            kind: 'person',
            aliases: ['P. Raman', 'priya raman'],
            evidence: ['f1', 'f9'],
          },
        ],
        tags: [{ label: ' Kiosk Rollout ', evidence: ['f2'] }],
        dates: [
          { iso: '2026-03-01', evidence: ['f1'] },
          { iso: 'next week', evidence: ['f1'] },
        ],
        summary: { text: ' A summary. ', evidence: ['f3'] },
        title: '  ',
      }),
      allowed,
    )
    expect(ok.entities).toEqual([
      { name: 'Priya Raman', kind: 'person', aliases: ['P. Raman'], evidence: ['f1'] },
    ])
    expect(ok.tags).toEqual([{ label: 'kiosk rollout', evidence: ['f2'] }])
    expect(ok.dates).toEqual([{ iso: '2026-03-01', evidence: ['f1'] }])
    expect(ok.summary).toEqual({ text: 'A summary.', evidence: [] })
    expect(ok.title).toBeNull()
    expect(() => validate('not json', allowed)).toThrow()
    expect(() =>
      validate(
        JSON.stringify({
          entities: [],
          tags: [{ label: '', evidence: [] }],
          dates: [],
          summary: null,
          title: null,
        }),
        allowed,
      ),
    ).toThrow()
    expect(() =>
      validate(
        JSON.stringify({
          entities: [{ name: 'x', kind: 'robot', aliases: [], evidence: [] }],
          tags: [],
          dates: [],
          summary: null,
          title: null,
        }),
        allowed,
      ),
    ).toThrow()
  })

  it('merges chunk answers by normalised name and keeps every evidence id', () => {
    const a = validate(
      JSON.stringify({
        entities: [
          { name: 'Northwind Retail', kind: 'organisation', aliases: [], evidence: ['f1'] },
        ],
        tags: [{ label: 'kiosk', evidence: ['f1'] }],
        dates: [],
        summary: { text: 'First part.', evidence: ['f1'] },
        title: 'Kiosk rollout',
      }),
      new Set(['f1']),
    )
    const b = validate(
      JSON.stringify({
        entities: [
          {
            name: 'northwind retail',
            kind: 'organisation',
            aliases: ['Northwind'],
            evidence: ['f2'],
          },
        ],
        tags: [{ label: 'Kiosk', evidence: ['f2'] }],
        dates: [{ iso: '2026', evidence: ['f2'] }],
        summary: { text: 'Second part.', evidence: ['f2'] },
        title: null,
      }),
      new Set(['f2']),
    )
    const m = merge([a, b])
    expect(m.entities).toEqual([
      {
        name: 'Northwind Retail',
        kind: 'organisation',
        aliases: ['Northwind'],
        evidence: ['f1', 'f2'],
      },
    ])
    expect(m.tags).toEqual([{ label: 'kiosk', evidence: ['f1', 'f2'] }])
    expect(m.dates).toEqual([{ iso: '2026', evidence: ['f2'] }])
    expect(m.summary).toEqual({ text: 'First part. Second part.', evidence: ['f1', 'f2'] })
    expect(m.title).toBe('Kiosk rollout')
  })
})
