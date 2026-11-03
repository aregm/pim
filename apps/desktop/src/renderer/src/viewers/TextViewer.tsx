import { useEffect, useRef, useState } from 'react'

/** Plain text with the selected span highlighted and scrolled into view. */
export function TextViewer({
  blobId,
  highlight,
}: {
  blobId: string
  highlight: { start: number; end: number } | null
}) {
  const [text, setText] = useState<string | null>(null)
  const mark = useRef<HTMLElement>(null)
  useEffect(() => {
    let live = true
    fetch(window.pim.blobUrl(blobId))
      .then((r) => r.text())
      .then((t) => live && setText(t))
    return () => {
      live = false
    }
  }, [blobId])
  useEffect(() => {
    mark.current?.scrollIntoView({ block: 'center' })
  }, [])
  if (text === null) return <p>loading…</p>
  const h = highlight && highlight.end > highlight.start ? highlight : null
  return (
    <pre
      style={{
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, Menlo, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        margin: 0,
        padding: 16,
      }}
    >
      {h ? text.slice(0, h.start) : text}
      {h && (
        <mark
          ref={mark}
          style={{ background: '#fff2a8', outline: '2px solid #e3b800', borderRadius: 3 }}
        >
          {text.slice(h.start, h.end)}
        </mark>
      )}
      {h ? text.slice(h.end) : null}
    </pre>
  )
}
