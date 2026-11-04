// biome-ignore-all lint/suspicious/noThenProperty: Sigma 4 style conditionals are then/else by design
import Graphology from 'graphology'
import forceAtlas2 from 'graphology-layout-forceatlas2'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import Sigma, { DEFAULT_STYLES } from 'sigma'
import { DEFAULT_EDGE_PRIMITIVES, DEFAULT_NODE_PRIMITIVES } from 'sigma/primitives'
import { extremityArrow, pathCurved, sdfCircle, sdfDiamond } from 'sigma/rendering'
import type { GraphEdge, GraphNode, Neighbourhood, RelationView } from '../pim.d.ts'
import { Button, colors, when, where } from '../ui.tsx'

const DIMENSIONS: Record<string, string[]> = {
  meaning: ['about', 'tagged', 'related_to', 'same_as', 'possible_duplicate'],
  evidence: ['derived_from', 'quotes', 'captured_from'],
  people: ['mentions'],
  time: ['occurred_at', 'before'],
}
const DIMENSION_COLOR: Record<string, string> = {
  meaning: '#5b6b8c',
  evidence: '#2a8a5a',
  people: '#8a4fbb',
  time: '#c0762a',
}
const NODE_COLOR: Record<string, string> = {
  url: '#2f5fd1',
  text: '#1b7f3b',
  file: '#9a6700',
  image: '#b03a8a',
  entity: '#6b4fbb',
}
const dimensionOf = (predicate: string) =>
  Object.keys(DIMENSIONS).find((k) => DIMENSIONS[k]?.includes(predicate)) ?? 'meaning'

type Selection = { kind: 'node'; key: string } | { kind: 'edge'; id: string } | null

/**
 * GRA-1 and GRA-3: a bounded neighbourhood from the focus, drawn as nodes and edges. Click a node or an edge for
 * its details on the right, with every cited passage as a row that opens the item at that page or time.
 * Double-click a node to refocus; drag an item to pin it.
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
  const sigmaRef = useRef<Sigma | null>(null)
  const graphRef = useRef<Graphology | null>(null)
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
  const [sel, setSel] = useState<Selection>(null)
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
  }, [focus, dims, budget, suggested])
  useEffect(() => {
    setSel(null)
    void load()
    return window.pim.onItemsChanged(() => void load())
  }, [load])

  // Build the graph, lay it out, and mount sigma. Rebuilt only when the data or the projection changes.
  useEffect(() => {
    if (!host.current || !data || projection !== 'graph') return
    const g = new Graphology({ multi: true })
    const degree = new Map<string, number>()
    for (const e of data.edges)
      for (const k of [e.source, e.target]) degree.set(k, (degree.get(k) ?? 0) + 1)
    const others = data.nodes.filter((n) => n.key !== data.focus)
    data.nodes.forEach((n) => {
      const i = others.indexOf(n)
      const angle = (2 * Math.PI * i) / Math.max(1, others.length)
      g.addNode(n.key, {
        label: n.label.length > 36 ? `${n.label.slice(0, 36)}…` : n.label,
        x: i < 0 ? 0 : 10 * Math.cos(angle),
        y: i < 0 ? 0 : 10 * Math.sin(angle),
        size: i < 0 ? 12 : 5 + Math.min(5, Math.sqrt(degree.get(n.key) ?? 0)),
        color: n.kind === 'entity' ? NODE_COLOR.entity : (NODE_COLOR[n.item_kind ?? ''] ?? '#888'),
        kind: n.kind,
        focus: i < 0,
        pinned: n.pinned,
      })
    })
    for (const e of data.edges)
      if (g.hasNode(e.source) && g.hasNode(e.target))
        g.addEdgeWithKey(e.id, e.source, e.target, {
          size: e.status === 'suggested' ? 1 : 1.5 + Math.min(2, e.evidence_count / 2),
          color: DIMENSION_COLOR[dimensionOf(e.predicate)] ?? colors.muted,
          opacity: e.status === 'suggested' ? 0.35 : 0.9,
          label: e.predicate.replace(/_/g, ' '),
        })
    if (g.order > 1)
      forceAtlas2.assign(g, {
        iterations: 600,
        settings: {
          ...forceAtlas2.inferSettings(g),
          gravity: 0.6,
          strongGravityMode: true,
          scalingRatio: 12,
          adjustSizes: true,
        },
      })
    const few = g.order <= 80
    const faded = (_a: unknown, s: { isHighlighted: boolean }, gs: { hasHighlighted: boolean }) =>
      gs.hasHighlighted && !s.isHighlighted
    const sigma = new Sigma(g, host.current, {
      primitives: {
        nodes: { ...DEFAULT_NODE_PRIMITIVES, shapes: [sdfCircle(), sdfDiamond()] },
        edges: {
          ...DEFAULT_EDGE_PRIMITIVES,
          paths: [...DEFAULT_EDGE_PRIMITIVES.paths, pathCurved()],
          extremities: [extremityArrow()],
        },
      },
      styles: {
        nodes: {
          ...DEFAULT_STYLES.nodes,
          shape: { whenData: { kind: 'entity' }, then: 'diamond', else: 'circle' },
          size: {
            whenState: ['isHovered', 'isHighlighted'],
            then: (a) => (a.size as number) + 2,
            else: { attribute: 'size', defaultValue: 6 },
          },
          opacity: { when: faded, then: 0.2, else: 1 },
          labelSize: 12,
          labelColor: { when: faded, then: '#aaa', else: '#1d1d1d' },
          labelVisibility: {
            whenState: ['isHovered', 'isHighlighted'],
            then: 'visible',
            else: few ? 'visible' : 'auto',
          },
          labelBackgroundColor: 'rgba(255,255,255,0.85)',
          labelBackgroundPadding: 2,
        },
        edges: {
          ...DEFAULT_STYLES.edges,
          parallelPath: 'curved',
          head: 'arrow',
          size: {
            whenState: 'isHighlighted',
            then: (a) => (a.size as number) + 1.5,
            else: { attribute: 'size', defaultValue: 1 },
          },
          color: { whenState: 'isHighlighted', then: colors.accent, else: { attribute: 'color' } },
          opacity: { when: faded, then: 0.08, else: { attribute: 'opacity', defaultValue: 1 } },
          labelSize: 11,
          labelColor: colors.accent,
          labelVisibility: {
            whenState: ['isHovered', 'isHighlighted'],
            then: 'visible',
            else: 'hidden',
          },
          labelBackgroundColor: 'rgba(255,255,255,0.9)',
          labelBackgroundPadding: 2,
        },
      },
      settings: {
        itemSizesReference: 'screen',
        autoRescaleContent: 'labels',
        enableEdgeEvents: true,
        enableNodeDrag: true,
        renderEdgeLabels: true,
        labelDensity: 3,
        labelGridCellSize: 60,
        labelRenderedSizeThreshold: 0,
        stagePadding: 40,
        enableCameraRotation: false,
        enableCameraMouseRotation: false,
      },
    })
    sigmaRef.current = sigma
    graphRef.current = g
    sigma.on('clickNode', ({ node: key }) => setSel({ kind: 'node', key }))
    sigma.on('clickEdge', ({ edge: id }) => setSel({ kind: 'edge', id }))
    sigma.on('clickStage', () => setSel(null))
    sigma.on('doubleClickNode', ({ node: key, event }) => {
      event.preventSigmaDefault()
      const n = data.nodes.find((x) => x.key === key)
      if (n) onFocus({ kind: n.kind, id: n.id })
    })
    sigma.on('nodeDragEnd', ({ node: key }) => {
      const n = data.nodes.find((x) => x.key === key)
      if (n?.kind === 'item' && !n.pinned) void window.pim.pin(n.id, true)
    })
    return () => {
      sigma.kill()
      sigmaRef.current = null
      graphRef.current = null
    }
  }, [data, projection, onFocus])

  // Highlight the selection and its neighbours; everything else fades.
  useEffect(() => {
    const sigma = sigmaRef.current
    const g = graphRef.current
    if (!sigma || !g) return
    sigma.setNodesState(g.nodes(), { isHighlighted: false })
    sigma.setEdgesState(g.edges(), { isHighlighted: false })
    if (sel?.kind === 'node' && g.hasNode(sel.key)) {
      sigma.setNodeState(sel.key, { isHighlighted: true })
      for (const e of g.edges(sel.key)) {
        sigma.setEdgeState(e, { isHighlighted: true })
        sigma.setNodeState(g.opposite(sel.key, e), { isHighlighted: true })
      }
    } else if (sel?.kind === 'edge' && g.hasEdge(sel.id)) {
      sigma.setEdgeState(sel.id, { isHighlighted: true })
      sigma.setNodesState(g.extremities(sel.id), { isHighlighted: true })
    }
    sigma.setGraphState({ hasHighlighted: sel !== null })
  }, [sel])

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
  const node = sel?.kind === 'node' ? (data?.nodes.find((n) => n.key === sel.key) ?? null) : null
  const edge = sel?.kind === 'edge' ? (data?.edges.find((e) => e.id === sel.id) ?? null) : null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 8 }}>
      <div style={row}>
        {Object.keys(DIMENSIONS).map((k) => (
          <label key={k} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={dims[k] ?? false} onChange={() => toggle(k)} />
            <span style={{ color: DIMENSION_COLOR[k] }}>{k}</span>
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
            overflow: projection === 'graph' ? 'hidden' : 'auto',
            position: 'relative',
            minWidth: 0,
          }}
        >
          {projection === 'graph' && (
            <>
              <div ref={host} style={{ width: '100%', height: '100%', minHeight: 400 }} />
              <Legend />
            </>
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
                    onClick={() => setSel({ kind: 'node', key: n.key })}
                    style={{
                      cursor: 'pointer',
                      borderTop: `1px solid ${colors.border}`,
                      background: sel?.kind === 'node' && sel.key === n.key ? '#eef2fb' : undefined,
                    }}
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
            <Timeline
              nodes={data.nodes}
              edges={data.edges}
              onPick={(n) => setSel({ kind: 'node', key: n.key })}
            />
          )}
        </div>
        <aside style={{ flex: 1, minWidth: 260, maxWidth: 380, fontSize: 13, overflow: 'auto' }}>
          {node && data && (
            <NodePanel
              node={node}
              data={data}
              onOpenItem={onOpenItem}
              onFocus={onFocus}
              onSelectEdge={(id) => setSel({ kind: 'edge', id })}
            />
          )}
          {edge && data && (
            <EdgePanel
              edge={edge}
              data={data}
              onOpenItem={onOpenItem}
              onSelectNode={(key) => setSel({ kind: 'node', key })}
            />
          )}
          {!node && !edge && (
            <p style={{ color: colors.muted }}>
              Click a node or an edge. Double-click a node to make it the focus; drag an item to pin
              it.
            </p>
          )}
        </aside>
      </div>
    </div>
  )
}

function Legend() {
  const entries = [
    ['web', NODE_COLOR.url],
    ['text', NODE_COLOR.text],
    ['file', NODE_COLOR.file],
    ['image', NODE_COLOR.image],
    ['entity', NODE_COLOR.entity],
  ] as const
  return (
    <div
      style={{
        position: 'absolute',
        left: 8,
        bottom: 6,
        display: 'flex',
        gap: 10,
        fontSize: 11,
        color: colors.muted,
        pointerEvents: 'none',
      }}
    >
      {entries.map(([name, color]) => (
        <span key={name} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span
            style={{
              width: 8,
              height: 8,
              background: color,
              borderRadius: name === 'entity' ? 0 : 4,
              transform: name === 'entity' ? 'rotate(45deg)' : undefined,
              display: 'inline-block',
            }}
          />
          {name}
        </span>
      ))}
    </div>
  )
}

const rowStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  background: 'none',
  border: 0,
  borderTop: `1px solid ${colors.border}`,
  padding: '6px 4px',
  textAlign: 'left',
  cursor: 'pointer',
  font: 'inherit',
  color: 'inherit',
}

/** One clickable row of a list: a muted lead, then the text. */
function Row({
  lead,
  children,
  onClick,
}: {
  lead?: ReactNode
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} style={rowStyle}>
      {lead && <span style={{ color: colors.muted, marginRight: 6 }}>{lead}</span>}
      {children}
    </button>
  )
}

const Heading = ({ children }: { children: ReactNode }) => (
  <div style={{ marginTop: 14, marginBottom: 4, fontWeight: 600 }}>{children}</div>
)

const snippet = (text: string, n = 100) => (text.length > n ? `${text.slice(0, n)}…` : text)

/** Passages cited as evidence, one row each, opening the item at that page or time. */
function Passages({
  evidence,
  onOpenItem,
}: {
  evidence: RelationView['evidence']
  onOpenItem: (id: string, fragment?: string | null) => void
}) {
  const seen = new Set<string>()
  const rows = evidence.filter((ev) => !seen.has(ev.fragment_id) && seen.add(ev.fragment_id))
  if (rows.length === 0)
    return <p style={{ color: colors.muted, margin: '4px 0' }}>no cited passages</p>
  return (
    <div>
      {rows.map((ev) => (
        <Row
          key={ev.fragment_id}
          lead={`${ev.title ?? 'untitled'} · ${where(ev.selector)}`}
          onClick={() => onOpenItem(ev.artifact_id, ev.fragment_id)}
        >
          <span style={{ display: 'block', color: '#333' }}>"{snippet(ev.text)}"</span>
        </Row>
      ))}
    </div>
  )
}

const StatusDot = ({ status }: { status: GraphEdge['status'] }) => (
  <span
    title={status}
    style={{
      display: 'inline-block',
      width: 7,
      height: 7,
      borderRadius: 4,
      marginRight: 6,
      background:
        status === 'accepted' ? colors.ok : status === 'suggested' ? '#cfcfcf' : colors.bad,
    }}
  />
)

/** A node's metadata, its connections, and the passages those connections cite. */
function NodePanel({
  node,
  data,
  onOpenItem,
  onFocus,
  onSelectEdge,
}: {
  node: GraphNode
  data: Neighbourhood
  onOpenItem: (id: string, fragment?: string | null) => void
  onFocus: (n: { kind: 'item' | 'entity'; id: string }) => void
  onSelectEdge: (id: string) => void
}) {
  const [rels, setRels] = useState<RelationView[]>([])
  useEffect(() => {
    setRels([])
    if (node.kind === 'item') void window.pim.relations(node.id).then(setRels)
  }, [node.kind, node.id])
  const label = (key: string) => data.nodes.find((n) => n.key === key)?.label ?? key
  const edges = data.edges.filter((e) => e.source === node.key || e.target === node.key)
  const visible = new Set(edges.map((e) => e.id))
  const evidence = rels.filter((r) => visible.has(r.id)).flatMap((r) => r.evidence)
  return (
    <div>
      <strong style={{ fontSize: 14 }}>{node.label}</strong>
      <div style={{ color: colors.muted, marginTop: 2 }}>
        {node.kind === 'entity'
          ? `${node.entity_kind} entity`
          : `${node.item_kind} item · ${node.state}${node.pinned ? ' · pinned' : ''}`}
        {' · '}
        {node.hops === 0 ? 'focus' : `${node.hops} hop${node.hops === 1 ? '' : 's'} away`}
      </div>
      <div style={{ color: colors.muted, marginTop: 2 }}>Why here: {node.reason}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {node.kind === 'item' && <Button onClick={() => onOpenItem(node.id)}>Open</Button>}
        {node.hops > 0 && (
          <Button onClick={() => onFocus({ kind: node.kind, id: node.id })}>Make focus</Button>
        )}
        {node.kind === 'item' && (
          <Button onClick={() => void window.pim.pin(node.id, !node.pinned)}>
            {node.pinned ? 'Unpin' : 'Pin'}
          </Button>
        )}
      </div>
      <Heading>
        Connections <span style={{ color: colors.muted, fontWeight: 400 }}>{edges.length}</span>
      </Heading>
      {edges.map((e) => {
        const out = e.source === node.key
        return (
          <Row key={e.id} onClick={() => onSelectEdge(e.id)}>
            <StatusDot status={e.status} />
            <span style={{ color: DIMENSION_COLOR[dimensionOf(e.predicate)] }}>
              {out ? '' : '← '}
              {e.predicate.replace(/_/g, ' ')}
              {out ? ' →' : ''}
            </span>{' '}
            {label(out ? e.target : e.source)}
            <span style={{ color: colors.muted }}>
              {' '}
              · {e.evidence_count} passage{e.evidence_count === 1 ? '' : 's'}
            </span>
          </Row>
        )
      })}
      {node.kind === 'item' && (
        <>
          <Heading>
            Cited passages{' '}
            <span style={{ color: colors.muted, fontWeight: 400 }}>
              {new Set(evidence.map((ev) => ev.fragment_id)).size}
            </span>
          </Heading>
          <Passages evidence={evidence} onOpenItem={onOpenItem} />
        </>
      )}
    </div>
  )
}

/** GRA-1: the five questions for one edge, and its evidence as clickable passages. */
function EdgePanel({
  edge,
  data,
  onOpenItem,
  onSelectNode,
}: {
  edge: GraphEdge
  data: Neighbourhood
  onOpenItem: (id: string, fragment?: string | null) => void
  onSelectNode: (key: string) => void
}) {
  const [detail, setDetail] = useState<RelationView | null>(null)
  useEffect(() => {
    setDetail(null)
    const itemKey = edge.source.startsWith('item:') ? edge.source : edge.target
    void window.pim
      .relations(itemKey.slice(5))
      .then((rels) => setDetail(rels.find((r) => r.id === edge.id) ?? null))
  }, [edge.id, edge.source, edge.target])
  const label = (key: string) => data.nodes.find((n) => n.key === key)?.label ?? key
  const far = data.nodes.find((n) => n.key === edge.target) ?? null
  const end = (key: string) => (
    <button
      type="button"
      onClick={() => onSelectNode(key)}
      style={{
        ...rowStyle,
        display: 'inline',
        width: 'auto',
        borderTop: 0,
        padding: 0,
        fontWeight: 600,
      }}
    >
      {label(key)}
    </button>
  )
  const fact = (k: string, v: ReactNode) => (
    <div style={{ display: 'flex', gap: 8, padding: '2px 0' }}>
      <span style={{ color: colors.muted, width: 86, flexShrink: 0 }}>{k}</span>
      <span>{v}</span>
    </div>
  )
  return (
    <div>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        {end(edge.source)}{' '}
        <span style={{ color: DIMENSION_COLOR[dimensionOf(edge.predicate)] }}>
          {edge.predicate.replace(/_/g, ' ')} →
        </span>{' '}
        {end(edge.target)}
      </div>
      <div style={{ marginTop: 8 }}>
        {fact('Type', `${edge.predicate} (${dimensionOf(edge.predicate)})`)}
        {fact(
          'Asserted by',
          <>
            {edge.author}
            {edge.generator &&
              ` · ${edge.generator}${edge.score != null ? `, score ${edge.score}` : ''}`}
            {detail?.score_json && (
              <code
                style={{
                  display: 'block',
                  fontSize: 11,
                  color: colors.muted,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {JSON.stringify(detail.score_json)}
              </code>
            )}
          </>,
        )}
        {fact(
          'Status',
          <>
            <StatusDot status={edge.status} />
            {edge.status}
          </>,
        )}
        {fact('Why visible', far?.reason ?? 'in the selected dimensions')}
        {fact('Added', when(edge.created_at))}
      </div>
      {edge.status === 'suggested' && (
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <Button primary onClick={() => void window.pim.review(edge.id, 'accepted')}>
            Accept
          </Button>
          <Button onClick={() => void window.pim.review(edge.id, 'rejected')}>Reject</Button>
        </div>
      )}
      <Heading>
        Evidence{' '}
        <span style={{ color: colors.muted, fontWeight: 400 }}>
          {edge.evidence_count} passage{edge.evidence_count === 1 ? '' : 's'}
        </span>
      </Heading>
      {detail ? (
        <Passages evidence={detail.evidence} onOpenItem={onOpenItem} />
      ) : (
        <p style={{ color: colors.muted, margin: '4px 0' }}>loading…</p>
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
