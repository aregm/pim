import { useEffect, useState } from 'react'
import type { FragmentView, ItemView, PayloadView, RelationView, TagView } from '../pim.d.ts'
import { Button, Chip, colors, kindLabel, when } from '../ui.tsx'
import { HtmlViewer } from '../viewers/HtmlViewer.tsx'
import { ImageViewer } from '../viewers/ImageViewer.tsx'
import { MediaViewer } from '../viewers/MediaViewer.tsx'
import { PdfViewer } from '../viewers/PdfViewer.tsx'
import { TextViewer } from '../viewers/TextViewer.tsx'

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`

/** The source on the left, exactly where a fragment points; the fragments on the right (UI-3). */
export function Item({
  item,
  focusFragment,
  onShowInGraph,
  onOpenItem,
}: {
  item: ItemView
  focusFragment: string | null
  onShowInGraph: (id: string) => void
  onOpenItem: (id: string, fragment?: string | null) => void
}) {
  const [payloads, setPayloads] = useState<PayloadView[]>([])
  const [fragments, setFragments] = useState<FragmentView[]>([])
  const [selected, setSelected] = useState<string | null>(focusFragment)
  const [tags, setTags] = useState<TagView[]>([])
  const [relations, setRelations] = useState<RelationView[]>([])
  const [newTag, setNewTag] = useState('')
  useEffect(() => {
    void window.pim.payloads(item.id).then(setPayloads)
    void window.pim.fragments(item.id).then(setFragments)
    setSelected(focusFragment)
    const loadGraph = () => {
      void window.pim.tags(item.id).then(setTags)
      void window.pim.relations(item.id).then(setRelations)
    }
    loadGraph()
    return window.pim.onItemsChanged(loadGraph)
  }, [item.id, focusFragment])
  const addTag = async () => {
    const label = newTag.trim()
    if (!label) return
    await window.pim.tag(item.id, label)
    setNewTag('')
  }
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
        <ImageViewer
          blobId={raw.blob_id}
          alt={item.title ?? ''}
          fragments={fragments}
          selected={selected}
          onSelect={setSelected}
        />
      )
    if (raw.mime.startsWith('audio/') || raw.mime.startsWith('video/'))
      return (
        <MediaViewer
          blobId={raw.blob_id}
          mime={raw.mime}
          fragments={fragments}
          selected={selected}
          onSelect={setSelected}
          keyframesBlobId={payloads.find((p) => p.role === 'keyframes')?.blob_id}
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
          <Button onClick={() => onShowInGraph(item.id)}>Show in graph</Button>
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
          <strong>Fragments</strong>{' '}
          <span style={{ color: colors.muted }}>
            {fragments.filter((f) => f.selector.kind !== 'time').length || fragments.length}
          </span>
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
                  {f.selector.kind === 'time' && (
                    <span
                      style={{ color: colors.muted, marginRight: 6 }}
                    >{`${Math.floor(f.selector.start_ms / 60000)}:${String(Math.floor(f.selector.start_ms / 1000) % 60).padStart(2, '0')}`}</span>
                  )}
                  {f.text.length > 140 ? `${f.text.slice(0, 140)}…` : f.text}
                </button>
              </li>
            ))}
          </ol>
          <div style={{ marginTop: 12 }}>
            <strong>Tags</strong>
            <div
              style={{
                display: 'flex',
                gap: 6,
                flexWrap: 'wrap',
                alignItems: 'center',
                margin: '6px 0',
              }}
            >
              {tags.map((t) => (
                <span
                  key={t.relation_id}
                  style={{
                    border: `1px solid ${colors.border}`,
                    borderRadius: 10,
                    padding: '1px 8px',
                  }}
                >
                  {t.entity.name}{' '}
                  <button
                    type="button"
                    onClick={() => void window.pim.untag(t.relation_id)}
                    title="remove tag"
                    style={{
                      border: 0,
                      background: 'none',
                      cursor: 'pointer',
                      color: colors.muted,
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addTag()
                }}
                placeholder="add tag, Return"
                style={{
                  padding: '2px 6px',
                  border: `1px solid ${colors.border}`,
                  borderRadius: 6,
                  fontFamily: 'inherit',
                  fontSize: 12,
                  width: 120,
                }}
              />
            </div>
            <strong>Connections</strong>{' '}
            <span style={{ color: colors.muted }}>
              {relations.filter((r) => r.predicate !== 'tagged').length}
            </span>
            <ul style={{ paddingLeft: 0, listStyle: 'none', margin: '6px 0' }}>
              {relations
                .filter((r) => r.predicate !== 'tagged')
                .map((r) => {
                  const otherId = r.subject_id === item.id ? r.object_id : r.subject_id
                  const otherLabel = r.subject_id === item.id ? r.object_label : r.subject_label
                  const otherKind = r.subject_id === item.id ? r.object_kind : r.subject_kind
                  return (
                    <li
                      key={r.id}
                      style={{ padding: '3px 0', borderBottom: `1px solid ${colors.border}` }}
                    >
                      <span style={{ color: colors.accent }}>{r.predicate}</span>{' '}
                      {otherKind === 'item' ? (
                        <button
                          type="button"
                          onClick={() => onOpenItem(otherId)}
                          style={{
                            border: 0,
                            background: 'none',
                            cursor: 'pointer',
                            font: 'inherit',
                            padding: 0,
                            color: 'inherit',
                            textDecoration: 'underline',
                          }}
                        >
                          {otherLabel}
                        </button>
                      ) : (
                        otherLabel
                      )}
                      <span style={{ color: colors.muted }}>
                        {' '}
                        · {r.status} · {r.author}
                        {r.score_json &&
                          'terms' in r.score_json &&
                          ` (${(r.score_json.terms as string[]).slice(0, 4).join(', ')})`}
                      </span>
                      {r.status === 'suggested' && (
                        <>
                          <button
                            type="button"
                            onClick={() => void window.pim.review(r.id, 'accepted')}
                            style={{
                              marginLeft: 6,
                              border: 0,
                              background: 'none',
                              color: colors.ok,
                              cursor: 'pointer',
                            }}
                          >
                            accept
                          </button>
                          <button
                            type="button"
                            onClick={() => void window.pim.review(r.id, 'rejected')}
                            style={{
                              border: 0,
                              background: 'none',
                              color: colors.bad,
                              cursor: 'pointer',
                            }}
                          >
                            reject
                          </button>
                        </>
                      )}
                    </li>
                  )
                })}
            </ul>
          </div>
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
