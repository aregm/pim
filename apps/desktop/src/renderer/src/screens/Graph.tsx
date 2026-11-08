import Graphology from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { useCallback, useEffect, useRef, useState } from 'react'
import Sigma from 'sigma'
import type { GraphEdge, GraphNode, Neighbourhood, RelationView } from '../pim.d.ts'
import { Button, colors, when } from '../ui.tsx'

const DIMENSIONS: Record<string, string[]> = {
  meaning: ['about', 'tagged', 'related_to', 'same_as', 'possible_duplicate'],
  evidence: ['derived_from', 'quotes', 'captured_from'],
  people: ['mentions'],
  time: ['occurred_at', 'before'],
}
const NODE_COLOR: Record<string, string> = {
  url: '#2f5fd1',
  text: '#1b7f3b',
  file: '#9a6700',
  image: '#b03a8a',
  entity: '#555',
}

/**
 * GRA-1 and GRA-3: a bounded neighbourhood from the focus. Click a node for its card, double-click to refocus,
 * drag to pin, click an edge to see type, author, evidence, status and why it is visible.
 */
export function GraphScreen({
  focus,
  onOpenItem,
  onFocus,
}: {
  focus: { kind: 'item' | 'entity'; id: string } | null
  onOpenItem: (id: string, fragment?: string | null) => void
  onFocus: (n: { kind: 'item' | 'entity'; id: string }) => void
}) {
  const host = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState<Record<string, boolean>>({
    meaning: true,
    evidence: true,
    people: true,
    time: false,
  })
  const [suggested, setSuggested] = useState(false)
  const [budget, setBudget] = useState(150)
  const [projection, setProjection] = useState<'graph' | 'table' | 'timeline'>('graph')
  const [data, setData] = useState<Neighbourhood | null>(null)
  const [node, setNode] = useState<GraphNode | null>(null)
  const [edge, setEdge] = useState<(GraphEdge & { detail?: RelationView | undefined }) | null>(null)
  const load = useCallback(async () => {
    if (!focus) return
    const predicates = Object.entries(dims).flatMap(([k, on]) => (on ? (DIMENSIONS[k] ?? []) : []))
    setData(
      await window.pim.neighbourhood({
        node: focus,
        budget,
        include_suggested: suggested,
        predicates,
      }),
    )
    setNode(null)
    setEdge(null)
  }, [focus, dims, budget, suggested])
  useEffect(() => {
    void load()
    return window.pim.onItemsChanged(() => void load())
  }, [load])

  // sigma lifecycle
  useEffect(() => {
    if (!host.current || !data || projection !== 'graph') return
    const g = new Graphology({ multi: true })
    const degree = new Map<string, number>()
    for (const e of data.edges)
      for (const k of [e.source, e.target]) degree.set(k, (degree.get(k) ?? 0) + 1)
    data.nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / Math.max(1, data.nodes.length)
      g.addNode(n.key, {
        label: n.label.length > 40 ? `${n.label.slice(0, 40)}…` : n.label,
        x: n.key === data.focus ? 0 : Math.cos(angle),
        y: n.key === data.focus ? 0 : Math.sin(angle),
        size: n.key === data.focus ? 14 : 6 + Math.min(8, degree.get(n.key) ?? 0),
        color: n.kind === 'entity' ? NODE_COLOR.entity : (NODE_COLOR[n.item_kind ?? ''] ?? '#888'),
        type: n.kind === 'entity' ? 'circle' : 'circle',
        borderColor: n.pinned ? '#e3b800' : undefined,
      })
    })
    for (const e of data.edges)
      if (g.hasNode(e.source) && g.hasNode(e.target))
        g.addEdgeWithKey(e.id, e.source, e.target, {
          size: e.status === 'suggested' ? 1 : 1.5 + Math.min(3, e.evidence_count),
          color: e.status === 'suggested' ? '#cfcfcf' : '#9aa7c7',
          label: e.predicate,
        })
    if (g.order > 1)
      forceAtlas2.assign(g, {
        iterations: 200,
        settings: { ...forceAtlas2.inferSettings(g), gravity: 1, scalingRatio: 4 },
      })
    const sigma = new Sigma(g, host.current, {
      settings: { renderEdgeLabels: true, labelRenderedSizeThreshold: 8 },
    })
    let dragging: string | null = null
    sigma.on('clickNode', ({ node: key }) => {
      setEdge(null)
      setNode(data.nodes.find((n) => n.key === key) ?? null)
    })
    sigma.on('doubleClickNode', ({ node: key, event }) => {
      event.preventSigmaDefault()
      const n = data.nodes.find((x) => x.key === key)
      if (n) onFocus({ kind: n.kind, id: n.id })
    })
    sigma.on('clickEdge', ({ edge: id }) => {
      setNode(null)
      const e = data.edges.find((x) => x.id === id) ?? null
      setEdge(e)
      if (e) {
        const itemKey = e.source.startsWith('item:') ? e.source : e.target
        void window.pim.relations(itemKey.slice(5)).then((rels) => {
          const detail = rels.find((r) => r.id === id)
          setEdge((cur) => (cur && cur.id === id ? { ...cur, detail } : cur))
        })
      }
    })
    sigma.on('downNode', ({ node: key }) => {
      dragging = key
      sigma.getCamera().enabled = false
    })
    sigma.getMouseCaptor().on('mousemovebody', (e) => {
      if (!dragging) return
      const pos = sigma.viewportToGraph(e)
      g.setNodeAttribute(dragging, 'x', pos.x)
      g.setNodeAttribute(dragging, 'y', pos.y)
      e.preventSigmaDefault()
    })
    sigma.getMouseCaptor().on('mouseup', () => {
      if (dragging?.startsWith('item:')) {
        const n = data.nodes.find((x) => x.key === dragging)
        if (n && !n.pinned) void window.pim.pin(n.id, true)
      }
      dragging = null
      sigma.getCamera().enabled = true
    })
    return () => sigma.kill()
  }, [data, projection, onFocus])

  if (!focus)
    return (
      <p style={{ color: colors.muted }}>
        Open an item and choose "Show in graph", or click a result in the Library.
      </p>
    )
  const toggle = (k: string) => setDims((d) => ({ ...d, [k]: !d[k] }))
  const row = {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    flexWrap: 'wrap' as const,
    fontSize: 13,
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <div style={row}>
        {Object.keys(DIMENSIONS).map((k) => (
          <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={dims[k] ?? false} onChange={() => toggle(k)} /> {k}
          </label>
        ))}
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={suggested} onChange={() => setSuggested(!suggested)} />{' '}
          suggested
        </label>
        <label>
          budget{' '}
          <input
            type="number"
            min={5}
            max={1000}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value) || 150)}
            style={{ width: 64 }}
          />
          {budget > 500 && <span style={{ color: colors.warn }}> large views get slow</span>}
        </label>
        <span style={{ marginLeft: 'auto', color: colors.muted }}>
          {data
            ? `${data.nodes.length} nodes, ${data.edges.length} edges${data.hidden ? `, ${data.hidden} hidden by the budget` : ''}`
            : 'loading…'}
        </span>
        {(['graph', 'table', 'timeline'] as const).map((p) => (
          <Button key={p} onClick={() => setProjection(p)} primary={projection === p}>
            {p}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 12, flex: 1, minHeight: 0 }}>
        <div
          style={{
            flex: 3,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            overflow: 'auto',
            position: 'relative',
          }}
        >
          {projection === 'graph' && (
            <div ref={host} style={{ width: '100%', height: '100%', minHeight: 400 }} />
          )}
          {projection === 'table' && data && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: colors.muted }}>
                  <th style={{ padding: 6 }}>Node</th>
                  <th>Kind</th>
                  <th>Hops</th>
                  <th>Why visible</th>
                </tr>
              </thead>
              <tbody>
                {data.nodes.map((n) => (
                  <tr
                    key={n.key}
                    onClick={() => setNode(n)}
                    style={{ cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
                  >
                    <td style={{ padding: 6 }}>{n.label}</td>
                    <td>{n.kind === 'entity' ? n.entity_kind : n.item_kind}</td>
                    <td>{n.hops}</td>
                    <td style={{ color: colors.muted }}>{n.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {projection === 'timeline' && data && (
            <Timeline nodes={data.nodes} edges={data.edges} onPick={setNode} />
          )}
        </div>
        <aside style={{ flex: 1, minWidth: 240, fontSize: 13, overflow: 'auto' }}>
          {node && (
            <div>
              <strong>{node.label}</strong>
              <div style={{ color: colors.muted }}>
                {node.kind === 'entity'
                  ? `${node.entity_kind} entity`
                  : `${node.item_kind} item, ${node.state}`}{' '}
                · {node.hops === 0 ? 'focus' : `${node.hops} hop${node.hops === 1 ? '' : 's'}`}
              </div>
              <p style={{ color: colors.muted }}>Why here: {node.reason}</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {node.kind === 'item' && <Button onClick={() => onOpenItem(node.id)}>Open</Button>}
                <Button onClick={() => onFocus({ kind: node.kind, id: node.id })}>Refocus</Button>
                {node.kind === 'item' && (
                  <Button onClick={() => void window.pim.pin(node.id, !node.pinned)}>
                    {node.pinned ? 'Unpin' : 'Pin'}
                  </Button>
                )}
              </div>
            </div>
          )}
          {edge && <EdgeCard edge={edge} nodes={data?.nodes ?? []} onOpenItem={onOpenItem} />}
          {!node && !edge && <p style={{ color: colors.muted }}>Click a node or an edge.</p>}
        </aside>
      </div>
    </div>
  )
}

/** GRA-1: the five questions for one edge. */
function EdgeCard({
  edge,
  nodes,
  onOpenItem,
}: {
  edge: GraphEdge & { detail?: RelationView | undefined }
  nodes: GraphNode[]
  onOpenItem: (id: string, fragment?: string | null) => void
}) {
  const label = (key: string) => nodes.find((n) => n.key === key)?.label ?? key
  const target = nodes.find((n) => n.key === edge.target || n.key === edge.source)
  const d = edge.detail
  return (
    <div>
      <strong>
        {label(edge.source)} <span style={{ color: colors.accent }}>{edge.predicate}</span>{' '}
        {label(edge.target)}
      </strong>
      <ol style={{ paddingLeft: 18, color: colors.muted, lineHeight: 1.6 }}>
        <li>
          Type: <b style={{ color: 'inherit' }}>{edge.predicate}</b>
        </li>
        <li>
          Asserted by: {edge.author}
          {edge.generator &&
            ` (${edge.generator}${edge.score != null ? `, score ${edge.score}` : ''})`}
          {d?.score_json && (
            <code style={{ display: 'block', fontSize: 11 }}>{JSON.stringify(d.score_json)}</code>
          )}
        </li>
        <li>
          Evidence: {edge.evidence_count} fragment{edge.evidence_count === 1 ? '' : 's'}
          {d?.evidence.map((ev) => (
            <div key={ev.fragment_id}>
              <button
                type="button"
                onClick={() => onOpenItem(ev.artifact_id, ev.fragment_id)}
                style={{
                  background: 'none',
                  border: 0,
                  color: colors.accent,
                  cursor: 'pointer',
                  padding: 0,
                  textAlign: 'left',
                  font: 'inherit',
                }}
              >
                "{ev.text.length > 90 ? `${ev.text.slice(0, 90)}…` : ev.text}"
              </button>
            </div>
          ))}
        </li>
        <li>Status: {edge.status}</li>
        <li>
          Why visible: {target?.reason ?? 'in the selected dimensions'}; added{' '}
          {when(edge.created_at)}
        </li>
      </ol>
      {edge.status === 'suggested' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <Button primary onClick={() => void window.pim.review(edge.id, 'accepted')}>
            Accept
          </Button>
          <Button onClick={() => void window.pim.review(edge.id, 'rejected')}>Reject</Button>
        </div>
      )}
    </div>
  )
}

/** The same nodes placed by time: items by capture, in the order they were captured. */
function Timeline({
  nodes,
  edges,
  onPick,
}: {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onPick: (n: GraphNode) => void
}) {
  const items = nodes.filter((n) => n.kind === 'item')
  return (
    <ol style={{ padding: 16, margin: 0, listStyle: 'none', fontSize: 13 }}>
      {items.map((n) => (
        <li
          key={n.key}
          style={{
            display: 'flex',
            gap: 12,
            padding: '6px 0',
            borderLeft: `2px solid ${colors.border}`,
            paddingLeft: 12,
          }}
        >
          <button
            type="button"
            onClick={() => onPick(n)}
            style={{
              background: 'none',
              border: 0,
              cursor: 'pointer',
              font: 'inherit',
              textAlign: 'left',
              padding: 0,
            }}
          >
            {n.label}
          </button>
          <span style={{ color: colors.muted }}>
            {edges.filter((e) => e.source === n.key || e.target === n.key).length} edges
          </span>
        </li>
      ))}
    </ol>
  )
}
