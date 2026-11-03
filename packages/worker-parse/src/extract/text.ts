import type { Extraction } from './types.ts'

/** Paragraphs separated by blank lines; selectors are character spans in the original text. */
export function extractText(text: string): Extraction {
  const fragments = []
  const re = /[^\n][\s\S]*?(?=\n\s*\n|$)/g
  for (const m of text.matchAll(re)) {
    const body = m[0]
    const trimmedStart = body.length - body.trimStart().length
    const value = body.trim()
    if (!value) continue
    const start = m.index + trimmedStart
    fragments.push({
      ordinal: fragments.length,
      selector: { kind: 'char' as const, start, end: start + value.length },
      text: value,
    })
  }
  return { fragments }
}
