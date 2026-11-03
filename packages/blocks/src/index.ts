/**
 * The one rule for "the nth block of an HTML document", shared by the parse worker (linkedom) and the
 * viewer (browser DOM), so a `block` selector written by one resolves in the other (PRS-1, UI-3).
 */
export const BLOCK_SELECTOR =
  'p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, td, th, figcaption, dt, dd'

/** Leaf blocks in document order: an element from the set that contains no other element from the set. */
export function selectBlocks(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll(BLOCK_SELECTOR))
  return all.filter(
    (el) => el.querySelector(BLOCK_SELECTOR) === null && (el.textContent ?? '').trim().length > 0,
  )
}

export const blockText = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
