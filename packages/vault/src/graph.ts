import type { DatabaseSync } from 'node:sqlite'
import { uuidv7 } from './id.ts'
import type { Selector } from './index.ts'

export type NodeKind = 'item' | 'entity'
export type RelationStatus = 'suggested' | 'accepted' | 'rejected' | 'superseded'

export interface NodeRef {
  kind: NodeKind
  id: string
}

export interface RelationInput {
  subject: NodeRef
  predicate: string
  object: NodeRef
  author: string
  status?: RelationStatus
  generator?: string
  score?: number
  score_json?: Record<string, unknown>
  run_id?: string
  evidence?: string[]
}

export interface RelationRow {
  id: string
  subject_kind: NodeKind
  subject_id: string
  predicate: string
  object_kind: NodeKind
  object_id: string
  status: RelationStatus
  author: string
  generator: string | null
  score: number | null
  score_json: string | null
  run_id: string | null
  created_at: string
  updated_at: string
}

export interface Evidence {
  fragment_id: string
  artifact_id: string
  title: string | null
  selector: Selector
  text: string
  role: string
}

export interface EntityRow {
  id: string
  kind: string
  name: string
  normalized: string
}

export interface GraphNode {
  key: string
  kind: NodeKind
  id: string
  label: string
  item_kind?: string
  state?: string
  entity_kind?: string
  pinned: boolean
  hops: number
  /** GRA-1 question five: why this node is in the view. */
  reason: string
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  predicate: string
  status: RelationStatus
  author: string
  generator: string | null
  score: number | null
  evidence_count: number
  created_at: string
}

export interface Neighbourhood {
  focus: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  hidden: number
  budget: number
}

export const nodeKey = (n: NodeRef) => `${n.kind}:${n.id}`
export const normalizeName = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')
const now = () => new Date().toISOString()

/** Entities, relations with evidence, and the budgeted neighbourhood (GRA-1 to GRA-3). */
export class Graph {
  constructor(private readonly db: DatabaseSync) {}

  /** Finds an entity by kind and normalised name or alias, or creates it; aliases are added, never removed. */
  upsertEntity(kind: string, name: string, aliases: string[] = []): EntityRow {
    const normalized = normalizeName(name)
    const existing =
      (this.db
        .prepare('SELECT id, kind, name, normalized FROM entity WHERE kind = ? AND normalized = ?')
        .get(kind, normalized) as EntityRow | undefined) ??
      (this.db
        .prepare(
          'SELECT e.id, e.kind, e.name, e.normalized FROM entity e JOIN entity_alias a ON a.entity_id = e.id WHERE e.kind = ? AND a.normalized = ?',
        )
        .get(kind, normalized) as EntityRow | undefined)
    const row: EntityRow = existing ?? { id: uuidv7(), kind, name: name.trim(), normalized }
    if (!existing)
      this.db
        .prepare(
          'INSERT INTO entity (id, kind, name, normalized, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(row.id, row.kind, row.name, row.normalized, now())
    const alias = this.db.prepare(
      'INSERT OR IGNORE INTO entity_alias (entity_id, normalized, name) VALUES (?, ?, ?)',
    )
    for (const a of aliases) {
      const n = normalizeName(a)
      if (n && n !== row.normalized) alias.run(row.id, n, a.trim())
    }
    return row
  }

  /** An entity by kind and normalised name or alias, without creating one. */
  findEntity(kind: string, name: string): EntityRow | undefined {
    const normalized = normalizeName(name)
    return (
      (this.db
        .prepare('SELECT id, kind, name, normalized FROM entity WHERE kind = ? AND normalized = ?')
        .get(kind, normalized) as EntityRow | undefined) ??
      (this.db
        .prepare(
          'SELECT e.id, e.kind, e.name, e.normalized FROM entity e JOIN entity_alias a ON a.entity_id = e.id WHERE e.kind = ? AND a.normalized = ?',
        )
        .get(kind, normalized) as EntityRow | undefined)
    )
  }

  aliases(entityId: string): string[] {
    return (
      this.db.prepare('SELECT name FROM entity_alias WHERE entity_id = ?').all(entityId) as {
        name: string
      }[]
    ).map((r) => r.name)
  }

  /** Other artifacts that mention or are tagged with the same entities as this one, with the evidence of both ends. */
  sharedEntities(
    artifactId: string,
  ): { artifact_id: string; entities: string[]; evidence: string[]; score: number }[] {
    const rows = this.db
      .prepare(
        `SELECT r2.subject_id AS artifact_id, e.name, e.kind, r1.status AS s1, r2.status AS s2,
                (SELECT GROUP_CONCAT(fragment_id) FROM relation_evidence WHERE relation_id = r1.id) AS ev1,
                (SELECT GROUP_CONCAT(fragment_id) FROM relation_evidence WHERE relation_id = r2.id) AS ev2
         FROM relation r1
         JOIN relation r2 ON r2.object_kind = 'entity' AND r2.object_id = r1.object_id AND r2.subject_kind = 'item' AND r2.subject_id != r1.subject_id
         JOIN entity e ON e.id = r1.object_id
         WHERE r1.subject_kind = 'item' AND r1.subject_id = ? AND r1.object_kind = 'entity'
           AND r1.predicate IN ('mentions', 'tagged', 'about') AND r2.predicate IN ('mentions', 'tagged', 'about')
           AND r1.status IN ('accepted', 'suggested') AND r2.status IN ('accepted', 'suggested')`,
      )
      .all(artifactId) as {
      artifact_id: string
      name: string
      kind: string
      s1: string
      s2: string
      ev1: string | null
      ev2: string | null
    }[]
    const by = new Map<string, { entities: Set<string>; evidence: Set<string>; score: number }>()
    for (const r of rows) {
      const cur = by.get(r.artifact_id) ?? {
        entities: new Set<string>(),
        evidence: new Set<string>(),
        score: 0,
      }
      // an accepted entity on both ends counts 1, a proposed one 0.5, a proposed tag 0
      cur.score += r.s1 === 'accepted' && r.s2 === 'accepted' ? 1 : r.kind === 'tag' ? 0 : 0.5
      cur.entities.add(r.name)
      for (const id of `${r.ev1 ?? ''},${r.ev2 ?? ''}`.split(',')) if (id) cur.evidence.add(id)
      by.set(r.artifact_id, cur)
    }
    return [...by.entries()].map(([artifact_id, v]) => ({
      artifact_id,
      entities: [...v.entities],
      evidence: [...v.evidence],
      score: v.score,
    }))
  }

  entity(id: string): EntityRow | undefined {
    return this.db.prepare('SELECT id, kind, name, normalized FROM entity WHERE id = ?').get(id) as
      | EntityRow
      | undefined
  }

  /**
   * Adds or refreshes a relation. One row per (subject, predicate, object, author): a re-run updates the score and
   * evidence; a rejected row stays rejected, so a generator never re-proposes what the person refused.
   */
  addRelation(input: RelationInput): RelationRow {
    const t = now()
    const existing = this.db
      .prepare(
        'SELECT * FROM relation WHERE subject_kind = ? AND subject_id = ? AND predicate = ? AND object_kind = ? AND object_id = ? AND author = ?',
      )
      .get(
        input.subject.kind,
        input.subject.id,
        input.predicate,
        input.object.kind,
        input.object.id,
        input.author,
      ) as RelationRow | undefined
    let id: string
    if (existing) {
      id = existing.id
      this.db
        .prepare(
          'UPDATE relation SET generator = ?, score = ?, score_json = ?, run_id = COALESCE(?, run_id), updated_at = ? WHERE id = ?',
        )
        .run(
          input.generator ?? existing.generator,
          input.score ?? existing.score,
          input.score_json ? JSON.stringify(input.score_json) : existing.score_json,
          input.run_id ?? null,
          t,
          id,
        )
      if (input.evidence !== undefined)
        this.db.prepare('DELETE FROM relation_evidence WHERE relation_id = ?').run(id)
    } else {
      id = uuidv7()
      this.db
        .prepare(
          'INSERT INTO relation (id, subject_kind, subject_id, predicate, object_kind, object_id, status, author, generator, score, score_json, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.subject.kind,
          input.subject.id,
          input.predicate,
          input.object.kind,
          input.object.id,
          input.status ?? 'suggested',
          input.author,
          input.generator ?? null,
          input.score ?? null,
          input.score_json ? JSON.stringify(input.score_json) : null,
          input.run_id ?? null,
          t,
          t,
        )
    }
    const ev = this.db.prepare(
      'INSERT OR IGNORE INTO relation_evidence (relation_id, fragment_id, role) VALUES (?, ?, ?)',
    )
    for (const f of input.evidence ?? []) ev.run(id, f, 'support')
    return this.relation(id) as RelationRow
  }

  relation(id: string): RelationRow | undefined {
    return this.db.prepare('SELECT * FROM relation WHERE id = ?').get(id) as RelationRow | undefined
  }

  setStatus(id: string, status: RelationStatus) {
    this.db
      .prepare('UPDATE relation SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id)
  }

  deleteRelation(id: string) {
    this.db.prepare('DELETE FROM relation_evidence WHERE relation_id = ?').run(id)
    this.db.prepare('DELETE FROM relation WHERE id = ?').run(id)
  }

  /** Evidence fragments of a relation with where they sit in their item, for clickable lists. */
  evidence(relationId: string): Evidence[] {
    const rows = this.db
      .prepare(
        'SELECT e.fragment_id, f.artifact_id, i.title, f.selector_json, f.text, e.role FROM relation_evidence e JOIN fragment f ON f.id = e.fragment_id LEFT JOIN item i ON i.id = f.artifact_id WHERE e.relation_id = ?',
      )
      .all(relationId) as unknown as (Omit<Evidence, 'selector'> & { selector_json: string })[]
    return rows.map(({ selector_json, ...r }) => ({ ...r, selector: JSON.parse(selector_json) }))
  }

  /** Relations touching a node, any status except superseded. */
  relationsOf(
    node: NodeRef,
    statuses: RelationStatus[] = ['accepted', 'suggested'],
  ): RelationRow[] {
    const marks = statuses.map(() => '?').join(',')
    return this.db
      .prepare(
        `SELECT * FROM relation WHERE ((subject_kind = ? AND subject_id = ?) OR (object_kind = ? AND object_id = ?)) AND status IN (${marks}) ORDER BY status, score DESC, created_at`,
      )
      .all(node.kind, node.id, node.kind, node.id, ...statuses) as unknown as RelationRow[]
  }

  /** Suggested relations for the inbox, grouped by the item they touch. */
  suggestions(limit = 500): RelationRow[] {
    return this.db
      .prepare("SELECT * FROM relation WHERE status = 'suggested' ORDER BY created_at DESC LIMIT ?")
      .all(limit) as unknown as RelationRow[]
  }

  tags(itemId: string): { relation_id: string; entity: EntityRow }[] {
    return (
      this.db
        .prepare(
          "SELECT r.id AS relation_id, e.id, e.kind, e.name, e.normalized FROM relation r JOIN entity e ON e.id = r.object_id WHERE r.subject_kind = 'item' AND r.subject_id = ? AND r.predicate = 'tagged' AND r.object_kind = 'entity' AND r.status = 'accepted'",
        )
        .all(itemId) as unknown as {
        relation_id: string
        id: string
        kind: string
        name: string
        normalized: string
      }[]
    ).map(({ relation_id, ...entity }) => ({ relation_id, entity }))
  }

  setPinned(itemId: string, pinned: boolean) {
    this.db.prepare('UPDATE item SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, itemId)
  }

  /**
   * GRA-3: breadth-first from the focus over the selected predicates and statuses, pinned items always in,
   * neighbours ordered by evidence count and recency, cut at the budget; `hidden` counts what was cut.
   */
  neighbourhood(
    focus: NodeRef,
    opts: {
      budget?: number | undefined
      predicates?: string[] | undefined
      includeSuggested?: boolean | undefined
      maxHops?: number | undefined
    } = {},
  ): Neighbourhood {
    const budget = Math.max(1, opts.budget ?? 150)
    const statuses: RelationStatus[] = opts.includeSuggested
      ? ['accepted', 'suggested']
      : ['accepted']
    const allowed = opts.predicates ? new Set(opts.predicates) : null
    const maxHops = opts.maxHops ?? 3
    const nodes = new Map<string, GraphNode>()
    const edges = new Map<string, GraphEdge>()
    let hidden = 0
    const describe = (n: NodeRef, hops: number, reason: string): GraphNode | null => {
      if (n.kind === 'item') {
        const row = this.db
          .prepare(
            'SELECT i.id, i.title, i.pinned, a.source_kind, a.state FROM item i JOIN artifact a ON a.item_id = i.id WHERE i.id = ? AND i.deleted_at IS NULL',
          )
          .get(n.id) as
          | { id: string; title: string | null; pinned: number; source_kind: string; state: string }
          | undefined
        if (!row) return null
        return {
          key: nodeKey(n),
          kind: 'item',
          id: row.id,
          label: row.title ?? row.id,
          item_kind: row.source_kind,
          state: row.state,
          pinned: row.pinned === 1,
          hops,
          reason,
        }
      }
      const e = this.entity(n.id)
      if (!e) return null
      return {
        key: nodeKey(n),
        kind: 'entity',
        id: e.id,
        label: e.name,
        entity_kind: e.kind,
        pinned: false,
        hops,
        reason,
      }
    }
    const focusNode = describe(focus, 0, 'the focus')
    if (!focusNode) return { focus: nodeKey(focus), nodes: [], edges: [], hidden: 0, budget }
    nodes.set(focusNode.key, focusNode)
    for (const row of this.db
      .prepare('SELECT id FROM item WHERE pinned = 1 AND deleted_at IS NULL')
      .all() as { id: string }[]) {
      const n = describe({ kind: 'item', id: row.id }, 0, 'pinned')
      if (n && !nodes.has(n.key)) nodes.set(n.key, n)
    }
    let frontier: NodeRef[] = [focus]
    for (let hop = 1; hop <= maxHops && frontier.length; hop++) {
      const next: NodeRef[] = []
      for (const from of frontier) {
        const rels = this.relationsOf(from, statuses).filter(
          (r) => !allowed || allowed.has(r.predicate),
        )
        const ranked = rels
          .map((r) => ({
            r,
            evidence: (
              this.db
                .prepare('SELECT COUNT(*) c FROM relation_evidence WHERE relation_id = ?')
                .get(r.id) as { c: number }
            ).c,
          }))
          .sort(
            (a, b) =>
              b.evidence - a.evidence ||
              (b.r.score ?? 0) - (a.r.score ?? 0) ||
              b.r.updated_at.localeCompare(a.r.updated_at),
          )
        for (const { r, evidence } of ranked) {
          const other: NodeRef =
            r.subject_kind === from.kind && r.subject_id === from.id
              ? { kind: r.object_kind, id: r.object_id }
              : { kind: r.subject_kind, id: r.subject_id }
          const key = nodeKey(other)
          if (!nodes.has(key)) {
            if (nodes.size >= budget) {
              hidden++
              continue
            }
            const n = describe(
              other,
              hop,
              `${r.predicate} ${r.status === 'suggested' ? '(suggested) ' : ''}from ${nodes.get(nodeKey(from))?.label ?? '?'}`,
            )
            if (!n) continue
            nodes.set(key, n)
            next.push(other)
          }
          if (!edges.has(r.id))
            edges.set(r.id, {
              id: r.id,
              source: nodeKey({ kind: r.subject_kind, id: r.subject_id }),
              target: nodeKey({ kind: r.object_kind, id: r.object_id }),
              predicate: r.predicate,
              status: r.status,
              author: r.author,
              generator: r.generator,
              score: r.score,
              evidence_count: evidence,
              created_at: r.created_at,
            })
        }
      }
      frontier = next
    }
    // edges among visible nodes that the walk did not take (closing triangles) are added too
    for (const e of edges.values())
      if (!nodes.has(e.source) || !nodes.has(e.target)) edges.delete(e.id)
    return {
      focus: focusNode.key,
      nodes: [...nodes.values()],
      edges: [...edges.values()],
      hidden,
      budget,
    }
  }
}
