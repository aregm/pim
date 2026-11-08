import { useEffect, useState } from 'react'
import type { ItemView, RelationView } from '../pim.d.ts'
import { Button, Chip, colors, kindLabel, when } from '../ui.tsx'

const DAY = 24 * 3600 * 1000

/**
 * The inbox is for exceptions and what just arrived, plus every suggestion waiting for a decision (ADR-005).
 * UI-4: j and k move, a accepts the row's suggestions, r rejects them, Enter opens the item.
 */
export function Inbox({ items, onOpen }: { items: ItemView[]; onOpen: (id: string) => void }) {
  const [suggestions, setSuggestions] = useState<RelationView[]>([])
  const [cursor, setCursor] = useState(0)
  useEffect(() => {
    const load = () => void window.pim.suggestions().then(setSuggestions)
    load()
    return window.pim.onItemsChanged(load)
  }, [])
  const recent = Date.now() - DAY
  const bySubject = new Map<string, RelationView[]>()
  for (const s of suggestions)
    bySubject.set(s.subject_id, [...(bySubject.get(s.subject_id) ?? []), s])
  const shown = items.filter(
    (i) =>
      i.state === 'failed' ||
      i.state === 'received' ||
      bySubject.has(i.id) ||
      new Date(i.last_captured_at).getTime() > recent,
  )
  const decide = (rows: RelationView[], status: 'accepted' | 'rejected') => {
    for (const r of rows) void window.pim.review(r.id, status)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement | null)?.tagName === 'INPUT' ||
        (e.target as HTMLElement | null)?.tagName === 'TEXTAREA'
      )
        return
      const item = shown[cursor]
      if (e.key === 'j') setCursor((c) => Math.min(shown.length - 1, c + 1))
      else if (e.key === 'k') setCursor((c) => Math.max(0, c - 1))
      else if (e.key === 'a' && item) decide(bySubject.get(item.id) ?? [], 'accepted')
      else if (e.key === 'r' && item) decide(bySubject.get(item.id) ?? [], 'rejected')
      else if (e.key === 'Enter' && item) onOpen(item.id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  if (!shown.length)
    return (
      <p style={{ color: colors.muted }}>
        Nothing new. Press the capture shortcut or drop a file anywhere in this window.
      </p>
    )
  return (
    <div>
      <p style={{ color: colors.muted, fontSize: 12, marginTop: 0 }}>
        j / k move · a accept the row's suggestions · r reject them · Enter open ·{' '}
        {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} waiting
      </p>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {shown.map((i, idx) => {
          const sug = bySubject.get(i.id) ?? []
          return (
            <li
              key={i.id}
              style={{
                padding: '10px 8px',
                borderBottom: `1px solid ${colors.border}`,
                background: idx === cursor ? '#f4f7fd' : 'transparent',
                borderRadius: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => onOpen(i.id)}
                  style={{
                    flex: 1,
                    textAlign: 'left',
                    background: 'none',
                    border: 0,
                    cursor: 'pointer',
                    fontSize: 14,
                    padding: 0,
                  }}
                >
                  <span style={{ fontSize: 12, color: colors.muted, marginRight: 8 }}>
                    {kindLabel(i)}
                  </span>
                  {i.title ?? i.source_id}
                  <Chip state={i.state} />
                  {i.capture_count > 1 && (
                    <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8 }}>
                      captured {i.capture_count} times
                    </span>
                  )}
                  <div style={{ fontSize: 12, color: colors.muted }}>
                    {when(i.last_captured_at)}
                    {i.error && <span style={{ color: colors.bad }}> · {i.error}</span>}
                  </div>
                </button>
                {i.state === 'failed' && (
                  <Button onClick={() => void window.pim.retry(i.id)}>Retry</Button>
                )}
                {sug.length > 0 && (
                  <>
                    <Button primary onClick={() => decide(sug, 'accepted')}>
                      Accept {sug.length}
                    </Button>
                    <Button onClick={() => decide(sug, 'rejected')}>Reject {sug.length}</Button>
                  </>
                )}
                <Button onClick={() => void window.pim.openSource(i.id)}>Open original</Button>
              </div>
              {sug.length > 0 && (
                <ul style={{ margin: '6px 0 0 24px', padding: 0, listStyle: 'none', fontSize: 13 }}>
                  {sug.map((s) => (
                    <li
                      key={s.id}
                      style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '2px 0' }}
                    >
                      <span style={{ color: colors.accent }}>{s.predicate}</span>
                      <span>{s.object_label}</span>
                      <span style={{ color: colors.muted }}>
                        {s.generator}
                        {s.score_json &&
                          'terms' in s.score_json &&
                          ` (${(s.score_json.terms as string[]).slice(0, 4).join(', ')})`}
                        {s.score_json &&
                          'minutes_apart' in s.score_json &&
                          ` (${String(s.score_json.minutes_apart)} min apart)`}
                        {s.evidence.length > 0 && ` · ${s.evidence.length} evidence`}
                      </span>
                      <button
                        type="button"
                        onClick={() => void window.pim.review(s.id, 'accepted')}
                        style={{
                          marginLeft: 'auto',
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
                        onClick={() => void window.pim.review(s.id, 'rejected')}
                        style={{
                          border: 0,
                          background: 'none',
                          color: colors.bad,
                          cursor: 'pointer',
                        }}
                      >
                        reject
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
