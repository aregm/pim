import { blockText, selectBlocks } from '@pim/blocks'
import { parseHTML } from 'linkedom'
import type { Extraction } from './types.ts'

/** One fragment per leaf block, addressed by its index in the shared block order. */
export function extractHtml(html: string): Extraction {
  const { document } = parseHTML(html)
  const fragments = selectBlocks(document as unknown as ParentNode)
    .map((el, index) => ({
      ordinal: index,
      selector: { kind: 'block' as const, index },
      text: blockText(el),
    }))
    .filter((f) => f.text.length > 0)
  return { fragments }
}
