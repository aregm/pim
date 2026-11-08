import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { useEffect, useRef, useState } from 'react'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfHighlight {
  page: number
  bbox?: [number, number, number, number] | undefined
}

/** Pages rendered by pdf.js; the selected fragment's box is drawn over its page in viewport space. */
export function PdfViewer({
  blobId,
  highlight,
}: {
  blobId: string
  highlight: PdfHighlight | null
}) {
  const host = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    pdfjs
      .getDocument({ url: window.pim.blobUrl(blobId) })
      .promise.then((d) => live && setDoc(d))
      .catch((e: Error) => setError(e.message))
    return () => {
      live = false
    }
  }, [blobId])
  useEffect(() => {
    if (!doc || !host.current) return
    const root = host.current
    root.replaceChildren()
    let cancelled = false
    ;(async () => {
      const width = Math.max(320, root.clientWidth - 32)
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        const page = await doc.getPage(n)
        const scale = width / page.getViewport({ scale: 1 }).width
        const viewport = page.getViewport({ scale })
        const wrap = document.createElement('div')
        wrap.style.cssText = `position:relative;margin:16px auto;width:${viewport.width}px;height:${viewport.height}px;box-shadow:0 1px 4px rgba(0,0,0,.2)`
        const canvas = document.createElement('canvas')
        canvas.width = viewport.width * devicePixelRatio
        canvas.height = viewport.height * devicePixelRatio
        canvas.style.cssText = 'width:100%;height:100%'
        wrap.appendChild(canvas)
        root.appendChild(wrap)
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.scale(devicePixelRatio, devicePixelRatio)
          await page.render({ canvasContext: ctx, viewport, canvas }).promise
        }
        if (highlight && highlight.page === n && highlight.bbox) {
          const [ax, ay] = viewport.convertToViewportPoint(
            highlight.bbox[0],
            highlight.bbox[1],
          ) as [number, number]
          const [bx, by] = viewport.convertToViewportPoint(
            highlight.bbox[2],
            highlight.bbox[3],
          ) as [number, number]
          const [x0, y0, x1, y1] = [ax, ay, bx, by]
          const box = document.createElement('div')
          const left = Math.min(x0, x1)
          const top = Math.min(y0, y1)
          box.style.cssText = `position:absolute;left:${left - 2}px;top:${top - 2}px;width:${Math.abs(x1 - x0) + 4}px;height:${Math.abs(y1 - y0) + 4}px;background:rgba(255,242,168,.45);outline:2px solid #e3b800;border-radius:3px`
          wrap.appendChild(box)
          wrap.scrollIntoView({ block: 'center' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [doc, highlight])
  if (error) return <p style={{ color: '#b00020' }}>cannot render PDF: {error}</p>
  return <div ref={host} style={{ height: '100%', overflow: 'auto', background: '#f4f4f4' }} />
}
