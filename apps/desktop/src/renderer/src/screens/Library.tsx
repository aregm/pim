import { useEffect, useState } from 'react'
import type { ItemView, SearchHit } from '../pim.d.ts'
import { Chip, colors, kindLabel, when } from '../ui.tsx'

const KINDS = ['all', 'url', 'text', 'file', 'image'] as const

/** `[term]` marks from FTS5 become highlights; keys are character offsets, unique within one snippet. */
function renderSnippet(snippet: string) {
  const out = []
  let offset = 0
  for (const part of snippet.split(/(\[[^\]]+\])/)) {
    if (part.startsWith('[') && part.endsWith(']'))
      out.push(<mark key={offset}>{part.slice(1, -1)}</mark>)
    else out.push(part)
    offset += part.length
  }
  return out
}

/** UI-5: lexical results as you type, lexical first; a kind filter; the full list when the box is empty. */
export function Library({
  items,
  onOpen,
}: {
  items: ItemView[]
  onOpen: (id: string, fragment?: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('all')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [hybrid, setHybrid] = useState(false)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    const id = setTimeout(() => void window.pim.search(q, hybrid).then(setHits), 120)
    return () => clearTimeout(id)
  }, [query, hybrid])
  const byKind = <T extends { source_kind: string }>(rows: T[]) =>
    kind === 'all' ? rows : rows.filter((r) => r.source_kind === kind)
  const listed = byKind(items.filter((i) => i.state !== 'duplicate'))
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="search a phrase you remember…"
          style={{
            flex: 1,
            padding: '8px 10px',
            fontSize: 14,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            fontFamily: 'inherit',
          }}
        />
        <label
          title="also rank by meaning, through the embedding model; lexical results stay when no model runs"
          style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }}
        >
          <input type="checkbox" checked={hybrid} onChange={() => setHybrid(!hybrid)} /> hybrid
        </label>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            style={{
              border: `1px solid ${k === kind ? colors.accent : colors.border}`,
              background: k === kind ? '#e8eef8' : 'white',
              borderRadius: 10,
              padding: '3px 10px',
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {k}
          </button>
        ))}
      </div>
      {hits ? (
        hits.length === 0 ? (
          <p style={{ color: colors.muted }}>no matches</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {byKind(hits).map((h) => (
              <li
                key={h.item_id}
                style={{ padding: '8px 0', borderBottom: `1px solid ${colors.border}` }}
              >
                <button
                  type="button"
                  onClick={() => onOpen(h.item_id, h.fragment_id)}
                  style={{
                    background: 'none',
                    border: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: 'inherit',
                    padding: 0,
                    width: '100%',
                  }}
                >
                  <span style={{ fontSize: 12, color: colors.muted, marginRight: 8 }}>
                    {h.source_kind}
                  </span>
                  {h.title ?? h.item_id}
                  <Chip state={h.state} />
                  {h.why && h.why !== 'lexical' && (
                    <span style={{ fontSize: 11, color: colors.accent, marginLeft: 8 }}>
                      {h.why === 'both' ? 'words and meaning' : 'by meaning'}
                    </span>
                  )}
                  <div style={{ fontSize: 13, color: colors.muted, marginTop: 2 }}>
                    {renderSnippet(h.snippet)}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : listed.length === 0 ? (
        <p style={{ color: colors.muted }}>The vault is empty.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', color: colors.muted, fontSize: 12 }}>
              <th style={{ padding: '6px 0' }}>Kind</th>
              <th>Title</th>
              <th>State</th>
              <th>Captured</th>
            </tr>
          </thead>
          <tbody>
            {listed.map((i) => (
              <tr
                key={i.id}
                onClick={() => onOpen(i.id)}
                style={{ cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
              >
                <td style={{ padding: '8px 0', color: colors.muted }}>{kindLabel(i)}</td>
                <td>{i.title ?? i.source_id}</td>
                <td>
                  <Chip state={i.state} />
                </td>
                <td style={{ color: colors.muted }}>{when(i.last_captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
