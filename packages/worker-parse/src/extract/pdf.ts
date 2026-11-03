import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { Extraction, Fragment } from './types.ts'

interface Item {
  str: string
  x: number
  y: number
  w: number
  h: number
}

/**
 * Text per page from pdf.js, grouped into lines by baseline and into paragraphs by vertical gaps.
 * Selectors carry the page, a character span in the page text, and a bounding box in PDF user space
 * (origin bottom-left) that the viewer converts with the page viewport.
 */
export async function extractPdf(bytes: Uint8Array): Promise<Extraction> {
  // pdf.js refuses a Node Buffer; hand it a plain Uint8Array view of the same bytes.
  const data = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const doc = await getDocument({ data, useSystemFonts: true }).promise
  const fragments: Fragment[] = []
  for (let page = 1; page <= doc.numPages; page++) {
    const p = await doc.getPage(page)
    const content = await p.getTextContent()
    const items: Item[] = []
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const [a, , , d, e, f] = it.transform as number[]
      items.push({
        str: it.str,
        x: e ?? 0,
        y: f ?? 0,
        w: it.width ?? Math.abs(a ?? 0),
        h: it.height ?? Math.abs(d ?? 0),
      })
    }
    // lines: items sharing a baseline (within half a line height), left to right
    items.sort((m, n) => n.y - m.y || m.x - n.x)
    const lines: Item[][] = []
    for (const it of items) {
      const line = lines.at(-1)
      const ref = line?.[0]
      if (line && ref && Math.abs(ref.y - it.y) <= Math.max(ref.h, it.h) * 0.5) line.push(it)
      else lines.push([it])
    }
    for (const line of lines) line.sort((m, n) => m.x - n.x)
    // paragraphs: a gap larger than 1.5 line heights starts a new one
    const paragraphs: Item[][][] = []
    for (const line of lines) {
      const prev = paragraphs.at(-1)?.at(-1)
      const h = line[0]?.h ?? 10
      if (prev?.[0] && prev[0].y - (line[0]?.y ?? 0) <= h * 1.8) paragraphs.at(-1)?.push(line)
      else paragraphs.push([line])
    }
    let offset = 0
    for (const para of paragraphs) {
      const text = para
        .map((line) => line.map((i) => i.str).join(' '))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!text) continue
      const all = para.flat()
      const x0 = Math.min(...all.map((i) => i.x))
      const y0 = Math.min(...all.map((i) => i.y))
      const x1 = Math.max(...all.map((i) => i.x + i.w))
      const y1 = Math.max(...all.map((i) => i.y + i.h))
      fragments.push({
        ordinal: fragments.length,
        selector: {
          kind: 'page',
          page,
          start: offset,
          end: offset + text.length,
          bbox: [x0, y0, x1, y1],
        },
        text,
      })
      offset += text.length + 1
    }
  }
  const pages = doc.numPages
  await doc.cleanup?.()
  return { fragments, pages }
}
