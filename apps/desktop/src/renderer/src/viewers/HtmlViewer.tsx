import { selectBlocks } from '@pim/blocks'
import { useEffect, useState } from 'react'

const STYLE = `<style>body{font-family:system-ui;max-width:72ch;margin:24px auto;padding:0 16px;line-height:1.5}img{max-width:100%}
[data-pim-block]{scroll-margin-top:24px}.pim-hl{background:#fff2a8;outline:2px solid #e3b800;border-radius:3px}</style>`

/** Readable HTML in a frame with no scripts, no navigation and no remote loads; the selected block is marked and focused. */
export function HtmlViewer({ blobId, highlight }: { blobId: string; highlight: number | null }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    fetch(window.pim.blobUrl(blobId))
      .then((r) => r.text())
      .then((t) => live && setHtml(t))
    return () => {
      live = false
    }
  }, [blobId])
  if (html === null) return <p>loading…</p>
  const doc = new DOMParser().parseFromString(html, 'text/html')
  selectBlocks(doc).forEach((el, i) => {
    el.setAttribute('data-pim-block', String(i))
    if (i === highlight) {
      el.classList.add('pim-hl')
      el.setAttribute('tabindex', '-1')
      el.setAttribute('autofocus', '')
    }
  })
  for (const a of Array.from(doc.querySelectorAll('a'))) a.removeAttribute('href')
  const srcdoc = `<!doctype html><html><head><meta charset="utf-8">${STYLE}</head><body>${doc.body.innerHTML}</body></html>`
  return (
    <iframe
      title="source"
      sandbox=""
      srcDoc={srcdoc}
      style={{ width: '100%', height: '100%', border: 0, background: 'white' }}
    />
  )
}
