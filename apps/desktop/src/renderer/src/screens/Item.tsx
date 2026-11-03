import { useEffect, useState } from 'react'
import type { FragmentView, ItemView, PayloadView } from '../pim.d.ts'
import { Button, Chip, colors, kindLabel, when } from '../ui.tsx'
import { HtmlViewer } from '../viewers/HtmlViewer.tsx'
import { PdfViewer } from '../viewers/PdfViewer.tsx'
import { TextViewer } from '../viewers/TextViewer.tsx'

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`

/** The source on the left, exactly where a fragment points; the fragments on the right (UI-3). */
export function Item({ item, focusFragment }: { item: ItemView; focusFragment: string | null }) {
  const [payloads, setPayloads] = useState<PayloadView[]>([])
  const [fragments, setFragments] = useState<FragmentView[]>([])
  const [selected, setSelected] = useState<string | null>(focusFragment)
  useEffect(() => {
    void window.pim.payloads(item.id).then(setPayloads)
    void window.pim.fragments(item.id).then(setFragments)
    setSelected(focusFragment)
  }, [item.id, focusFragment])
  const fragment = fragments.find((f) => f.id === selected) ?? null
  const viewer = (() => {
    const readable = payloads.find((p) => p.role === 'normalized' && p.mime === 'text/html')
    const normalizedText = payloads.find((p) => p.role === 'normalized' && p.mime === 'text/plain')
    const raw = payloads.find((p) => p.role === 'raw')
    const sel = fragment?.selector
    if (readable)
      return (
        <HtmlViewer
          blobId={readable.blob_id}
          highlight={sel?.kind === 'block' ? sel.index : null}
        />
      )
    if (normalizedText)
      return (
        <TextViewer blobId={normalizedText.blob_id} highlight={sel?.kind === 'char' ? sel : null} />
      )
    if (!raw) return <p style={{ color: colors.muted, padding: 16 }}>not preserved yet</p>
    if (raw.mime === 'application/pdf')
      return (
        <PdfViewer
          blobId={raw.blob_id}
          highlight={sel?.kind === 'page' ? { page: sel.page, bbox: sel.bbox } : null}
        />
      )
    if (raw.mime.startsWith('image/'))
      return (
        <img
          src={window.pim.blobUrl(raw.blob_id)}
          alt={item.title ?? ''}
          style={{ maxWidth: '100%', display: 'block', margin: '16px auto' }}
        />
      )
    if (raw.mime.startsWith('text/'))
      return <TextViewer blobId={raw.blob_id} highlight={sel?.kind === 'char' ? sel : null} />
    return (
      <p style={{ color: colors.muted, padding: 16 }}>
        No viewer for {raw.mime} yet.{' '}
        <Button onClick={() => void window.pim.openSource(item.id)}>Open original</Button>
      </p>
    )
  })()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ marginBottom: 12 }}>
        <h2 style={{ margin: '0 0 4px' }}>
          {item.title ?? item.source_id}
          <Chip state={item.state} />
        </h2>
        <div
          style={{
            color: colors.muted,
            fontSize: 13,
            display: 'flex',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <span>
            {kindLabel(item)} · captured {item.capture_count} time
            {item.capture_count === 1 ? '' : 's'}, last {when(item.last_captured_at)}
            {item.error && <span style={{ color: colors.bad }}> · {item.error}</span>}
          </span>
          <Button onClick={() => void window.pim.openSource(item.id)}>Open original</Button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: 2,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'auto',
            minWidth: 0,
          }}
        >
          {viewer}
        </div>
        <aside style={{ flex: 1, overflow: 'auto', fontSize: 13, minWidth: 220 }}>
          <strong>Fragments</strong> <span style={{ color: colors.muted }}>{fragments.length}</span>
          {fragments.length === 0 && (
            <p style={{ color: colors.muted }}>none yet; extraction runs after preservation</p>
          )}
          <ol style={{ paddingLeft: 18 }}>
            {fragments.map((f) => (
              <li key={f.id} style={{ margin: '4px 0' }}>
                <button
                  type="button"
                  onClick={() => setSelected(f.id)}
                  style={{
                    background: f.id === selected ? '#fff2a8' : 'none',
                    border: 0,
                    padding: '2px 4px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: 'inherit',
                    borderRadius: 3,
                  }}
                >
                  {f.text.length > 140 ? `${f.text.slice(0, 140)}…` : f.text}
                </button>
              </li>
            ))}
          </ol>
          <details style={{ marginTop: 12 }}>
            <summary style={{ color: colors.muted, cursor: 'pointer' }}>
              payloads ({payloads.length})
            </summary>
            <ul>
              {payloads.map((p) => (
                <li key={p.id}>
                  <strong>{p.role}</strong> · {p.mime} · {kb(p.byte_length)}
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </div>
    </div>
  )
}
