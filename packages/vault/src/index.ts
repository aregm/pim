import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BlobStore } from './blobs.ts'
import { Graph, type RelationStatus } from './graph.ts'
import { uuidv7 } from './id.ts'
import { MIGRATIONS } from './migrations.ts'
import { centroid, Vectors } from './vectors.ts'

export * from './backup.ts'
export { BlobStore } from './blobs.ts'
export * from './graph.ts'
export { uuidv7 } from './id.ts'
export * from './transfer.ts'

export type SourceKind = 'url' | 'text' | 'file' | 'image'
export type ArtifactState = 'received' | 'preserved' | 'failed' | 'duplicate'
export type JobState = 'open' | 'running' | 'done' | 'failed'

export interface ReceiptInput {
  source_kind: SourceKind
  /** Stable identity of the source: normalized URL, `sha256:` of small content, or `file:<path>:<size>:<mtime>`. */
  source_id: string
  source_uri?: string
  title?: string
  content_hash?: string
  surface: string
  original_path?: string
  /** Stages to enqueue for a new artifact. */
  stages?: string[]
}

export interface Receipt {
  item_id: string
  state: ArtifactState
  existing: boolean
}

export interface ItemRow {
  id: string
  kind: string
  intent: string
  title: string | null
  created_at: string
  source_kind: SourceKind
  source_id: string
  source_uri: string | null
  content_hash: string | null
  state: ArtifactState
  duplicate_of: string | null
  error: string | null
  capture_count: number
  last_captured_at: string
}

export interface PayloadRow {
  id: string
  artifact_id: string
  role: string
  blob_id: string
  mime: string
  byte_length: number
  created_at: string
}

export type Selector =
  | { kind: 'block'; index: number }
  | {
      kind: 'page'
      page: number
      start: number
      end: number
      bbox?: [number, number, number, number] | undefined
    }
  | { kind: 'char'; start: number; end: number }
  | { kind: 'time'; start_ms: number; end_ms: number }
  | { kind: 'box'; x: number; y: number; w: number; h: number }

export interface FragmentInput {
  ordinal: number
  selector: Selector
  text: string
}

export interface FragmentRow {
  id: string
  artifact_id: string
  payload_id: string
  run_id: string
  /** The processor of the run that produced it; `enrich::*` marks model output (MET-2). */
  processor: string
  ordinal: number
  selector: Selector
  text: string
}

export interface RunRow {
  id: string
  artifact_id: string
  processor: string
  version: string
  status: string
  started_at: string
  finished_at: string | null
  error: string | null
  model_digest: string | null
  prompt_digest: string | null
  params_json: string | null
}

export interface NoteRow {
  item_id: string
  artifact_id: string
  author: string
  text: string
  title: string | null
  run_id: string
  created_at: string
  updated_at: string
  relation_id: string | null
  status: RelationStatus | null
}

export interface SemanticHit {
  item_id: string
  fragment_id: string
  distance: number
  text: string
}

export interface SearchHit {
  item_id: string
  title: string | null
  source_kind: SourceKind
  state: ArtifactState
  score: number
  snippet: string
  fragment_id: string | null
  last_captured_at: string
  /** Hybrid search: which half found it (specification PRS-8, UI-5). */
  why?: 'lexical' | 'semantic' | 'both'
}

export interface JobRow {
  id: string
  artifact_id: string
  stage: string
  state: JobState
  attempts: number
  next_run_at: string
  lease_until: string | null
  last_error: string | null
}

const now = () => new Date().toISOString()
const plus = (ms: number) => new Date(Date.now() + ms).toISOString()

/** One vault directory: `vault.sqlite` plus `blobs/`. One instance per process; the core is the only writer (ADR-003). */
export class Vault {
  readonly dir: string
  readonly db: DatabaseSync
  readonly blobs: BlobStore
  readonly graph: Graph
  readonly vectors: Vectors

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'vault.sqlite'), { allowExtension: true })
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
    this.migrate()
    this.vectors = new Vectors(this.db)
    this.blobs = new BlobStore(join(dir, 'blobs'))
    this.graph = new Graph(this.db)
  }

  close() {
    this.db.close()
  }

  private migrate() {
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    )
    const applied = new Set(
      (this.db.prepare('SELECT version FROM schema_version').all() as { version: number }[]).map(
        (r) => r.version,
      ),
    )
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue
      this.db.exec('BEGIN')
      try {
        this.db.exec(m.sql)
        this.db
          .prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)')
          .run(m.version, now())
        this.db.exec('COMMIT')
      } catch (e) {
        this.db.exec('ROLLBACK')
        throw e
      }
    }
  }

  get schemaVersion(): number {
    return (this.db.prepare('SELECT MAX(version) v FROM schema_version').get() as { v: number }).v
  }

  /** CAP-1, CAP-3: one artifact per source identity; a repeat adds a capture event and returns the existing item. */
  receipt(input: ReceiptInput): Receipt {
    const t = now()
    const existing = this.db
      .prepare('SELECT item_id, state FROM artifact WHERE source_kind = ? AND source_id = ?')
      .get(input.source_kind, input.source_id) as
      | { item_id: string; state: ArtifactState }
      | undefined
    if (existing) {
      this.addCaptureEvent(existing.item_id, input.surface, t, input.original_path)
      return { item_id: existing.item_id, state: existing.state, existing: true }
    }
    const id = uuidv7()
    this.db.exec('BEGIN')
    try {
      this.db
        .prepare(
          'INSERT INTO item (id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(id, 'artifact', input.title ?? null, t, t)
      this.db
        .prepare(
          'INSERT INTO artifact (item_id, source_kind, source_id, source_uri, content_hash, state) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          id,
          input.source_kind,
          input.source_id,
          input.source_uri ?? null,
          input.content_hash ?? null,
          'received',
        )
      this.addCaptureEvent(id, input.surface, t, input.original_path)
      for (const stage of input.stages ?? []) {
        this.db
          .prepare(
            'INSERT INTO job (id, artifact_id, stage, state, attempts, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
          )
          .run(uuidv7(), id, stage, 'open', t, t, t)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
    return { item_id: id, state: 'received', existing: false }
  }

  private addCaptureEvent(artifactId: string, surface: string, at: string, originalPath?: string) {
    this.db
      .prepare(
        'INSERT INTO capture_event (id, artifact_id, surface, at, original_path) VALUES (?, ?, ?, ?, ?)',
      )
      .run(uuidv7(), artifactId, surface, at, originalPath ?? null)
  }

  addPayload(
    artifactId: string,
    role: string,
    blobId: string,
    mime: string,
    byteLength: number,
  ): PayloadRow {
    const row: PayloadRow = {
      id: uuidv7(),
      artifact_id: artifactId,
      role,
      blob_id: blobId,
      mime,
      byte_length: byteLength,
      created_at: now(),
    }
    this.db
      .prepare(
        'INSERT INTO artifact_payload (id, artifact_id, role, blob_id, mime, byte_length, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        row.id,
        row.artifact_id,
        row.role,
        row.blob_id,
        row.mime,
        row.byte_length,
        row.created_at,
      )
    return row
  }

  payloads(artifactId: string): PayloadRow[] {
    return this.db
      .prepare('SELECT * FROM artifact_payload WHERE artifact_id = ? ORDER BY created_at')
      .all(artifactId) as unknown as PayloadRow[]
  }

  /** Marks the artifact preserved, or a duplicate when another artifact already holds the same content hash. */
  markPreserved(artifactId: string, contentHash: string, title?: string): ArtifactState {
    const twin = this.db
      .prepare(
        'SELECT item_id FROM artifact WHERE content_hash = ? AND item_id != ? AND state = ? LIMIT 1',
      )
      .get(contentHash, artifactId, 'preserved') as { item_id: string } | undefined
    const state: ArtifactState = twin ? 'duplicate' : 'preserved'
    this.db
      .prepare(
        'UPDATE artifact SET state = ?, content_hash = ?, duplicate_of = ?, error = NULL WHERE item_id = ?',
      )
      .run(state, contentHash, twin?.item_id ?? null, artifactId)
    if (title)
      this.db
        .prepare('UPDATE item SET title = COALESCE(title, ?), updated_at = ? WHERE id = ?')
        .run(title, now(), artifactId)
    return state
  }

  markFailed(artifactId: string, error: string) {
    this.db
      .prepare('UPDATE artifact SET state = ?, error = ? WHERE item_id = ?')
      .run('failed', error, artifactId)
  }

  items(limit = 200): ItemRow[] {
    return this.db
      .prepare(
        `SELECT i.id, i.kind, i.intent, i.title, i.created_at, a.source_kind, a.source_id, a.source_uri, a.content_hash, a.state, a.duplicate_of, a.error,
                (SELECT COUNT(*) FROM capture_event c WHERE c.artifact_id = a.item_id) AS capture_count,
                (SELECT MAX(at) FROM capture_event c WHERE c.artifact_id = a.item_id) AS last_captured_at
         FROM item i JOIN artifact a ON a.item_id = i.id
         WHERE i.deleted_at IS NULL ORDER BY last_captured_at DESC LIMIT ?`,
      )
      .all(limit) as unknown as ItemRow[]
  }

  item(id: string): ItemRow | undefined {
    return this.items(10_000).find((r) => r.id === id)
  }

  // ---- jobs: the queue of record (ADR-003) ----

  /** Leases the next runnable job for `stage`; `running` jobs whose lease expired are offered again. */
  claimJob(stage: string, leaseMs = 60_000): JobRow | undefined {
    const t = now()
    const row = this.db
      .prepare(
        `SELECT * FROM job WHERE stage = ? AND ((state = 'open' AND next_run_at <= ?) OR (state = 'running' AND lease_until < ?))
         ORDER BY next_run_at LIMIT 1`,
      )
      .get(stage, t, t) as JobRow | undefined
    if (!row) return undefined
    this.db
      .prepare('UPDATE job SET state = ?, lease_until = ?, updated_at = ? WHERE id = ?')
      .run('running', plus(leaseMs), t, row.id)
    return { ...row, state: 'running' }
  }

  /** Keeps a long-running job's lease alive so no other tick claims it (media jobs can take minutes). */
  extendLease(id: string, leaseMs = 60_000) {
    this.db
      .prepare("UPDATE job SET lease_until = ?, updated_at = ? WHERE id = ? AND state = 'running'")
      .run(plus(leaseMs), now(), id)
  }

  /** Marks a job done; `note` is kept in `last_error` for jobs that finished by skipping (e.g. no model). */
  completeJob(id: string, note?: string) {
    this.db
      .prepare(
        'UPDATE job SET state = ?, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?',
      )
      .run('done', note ?? null, now(), id)
  }

  /** Three attempts with exponential backoff (5 s, 10 s, 20 s), then `failed`. */
  failJob(id: string, error: string, maxAttempts = 3): JobState {
    const row = this.db.prepare('SELECT attempts FROM job WHERE id = ?').get(id) as {
      attempts: number
    }
    const attempts = row.attempts + 1
    const state: JobState = attempts >= maxAttempts ? 'failed' : 'open'
    this.db
      .prepare(
        'UPDATE job SET state = ?, attempts = ?, next_run_at = ?, lease_until = NULL, last_error = ?, updated_at = ? WHERE id = ?',
      )
      .run(state, attempts, plus(5_000 * 2 ** (attempts - 1)), error, now(), id)
    return state
  }

  /** Puts a failed artifact's jobs back to `open` for an immediate retry. */
  retry(artifactId: string) {
    const t = now()
    this.db
      .prepare(
        "UPDATE job SET state = 'open', attempts = 0, next_run_at = ?, lease_until = NULL, updated_at = ? WHERE artifact_id = ? AND state = 'failed'",
      )
      .run(t, t, artifactId)
    this.db
      .prepare(
        "UPDATE artifact SET state = 'received', error = NULL WHERE item_id = ? AND state = 'failed'",
      )
      .run(artifactId)
  }

  // ---- processing runs and fragments (MET-1, PRS-1) ----

  startRun(
    artifactId: string,
    processor: string,
    version: string,
    meta: { model_digest?: string; prompt_digest?: string; params?: Record<string, unknown> } = {},
  ): string {
    const id = uuidv7()
    this.db
      .prepare(
        'INSERT INTO processing_run (id, artifact_id, processor, version, status, started_at, model_digest, prompt_digest, params_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        artifactId,
        processor,
        version,
        'running',
        now(),
        meta.model_digest ?? null,
        meta.prompt_digest ?? null,
        meta.params ? JSON.stringify(meta.params) : null,
      )
    return id
  }

  /** Records the model and prompt a run used once they are known (MET-1). */
  describeRun(id: string, meta: { model_digest?: string; prompt_digest?: string }) {
    this.db
      .prepare(
        'UPDATE processing_run SET model_digest = COALESCE(?, model_digest), prompt_digest = COALESCE(?, prompt_digest) WHERE id = ?',
      )
      .run(meta.model_digest ?? null, meta.prompt_digest ?? null, id)
  }

  /** The latest finished run of a processor on an artifact, to skip work already done with the same model. */
  lastRun(artifactId: string, processor: string): RunRow | undefined {
    return this.db
      .prepare(
        "SELECT * FROM processing_run WHERE artifact_id = ? AND processor = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1",
      )
      .get(artifactId, processor) as RunRow | undefined
  }

  /** Runs left `running` by an instance that died mid-stage are failed, so the job's retry starts a new one (PRS-7). */
  closeStaleRuns(): number {
    const r = this.db
      .prepare(
        "UPDATE processing_run SET status = 'failed', finished_at = ?, error = 'interrupted' WHERE status = 'running'",
      )
      .run(now())
    return Number(r.changes)
  }

  run(id: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM processing_run WHERE id = ?').get(id) as
      | RunRow
      | undefined
  }

  finishRun(id: string, error?: string) {
    this.db
      .prepare('UPDATE processing_run SET status = ?, finished_at = ?, error = ? WHERE id = ?')
      .run(error ? 'failed' : 'done', now(), error ?? null, id)
  }

  /** Replaces the fragments one processor derived from one payload; a re-run never duplicates. */
  replaceFragments(
    artifactId: string,
    payloadId: string,
    runId: string,
    processor: string,
    fragments: FragmentInput[],
  ) {
    const t = now()
    this.db.exec('BEGIN')
    try {
      const gone = (
        this.db
          .prepare(
            'SELECT id FROM fragment WHERE payload_id = ? AND run_id IN (SELECT id FROM processing_run WHERE processor = ?)',
          )
          .all(payloadId, processor) as { id: string }[]
      ).map((r) => r.id)
      this.forgetEmbeddings(gone)
      this.db
        .prepare(
          'DELETE FROM fragment WHERE payload_id = ? AND run_id IN (SELECT id FROM processing_run WHERE processor = ?)',
        )
        .run(payloadId, processor)
      const insert = this.db.prepare(
        'INSERT INTO fragment (id, artifact_id, payload_id, run_id, ordinal, selector_json, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      for (const f of fragments)
        insert.run(
          uuidv7(),
          artifactId,
          payloadId,
          runId,
          f.ordinal,
          JSON.stringify(f.selector),
          f.text,
          t,
        )
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  fragments(artifactId: string): FragmentRow[] {
    const rows = this.db
      .prepare(
        'SELECT f.id, f.artifact_id, f.payload_id, f.run_id, r.processor, f.ordinal, f.selector_json, f.text FROM fragment f JOIN processing_run r ON r.id = f.run_id WHERE f.artifact_id = ? ORDER BY f.ordinal',
      )
      .all(artifactId) as unknown as (Omit<FragmentRow, 'selector'> & { selector_json: string })[]
    return rows.map(({ selector_json, ...r }) => ({
      ...r,
      selector: JSON.parse(selector_json) as Selector,
    }))
  }

  /** Lexical search over fragment text and titles, best fragment per item, BM25 order (RET-1). */
  search(query: string, limit = 50): SearchHit[] {
    const q = toFtsQuery(query)
    if (!q) return []
    return this.db
      .prepare(
        `WITH hits AS (
           SELECT f.artifact_id AS item_id, f.id AS fragment_id, bm25(fragment_fts) AS score,
                  snippet(fragment_fts, 0, '[', ']', '…', 12) AS snippet
           FROM fragment_fts JOIN fragment f ON f.rowid = fragment_fts.rowid
           WHERE fragment_fts MATCH ?
           UNION ALL
           SELECT i.id, NULL, bm25(item_fts) - 1.0, snippet(item_fts, 0, '[', ']', '…', 12)
           FROM item_fts JOIN item i ON i.rowid = item_fts.rowid
           WHERE item_fts MATCH ?
         ),
         best AS (SELECT item_id, fragment_id, score, snippet, ROW_NUMBER() OVER (PARTITION BY item_id ORDER BY score) AS rn FROM hits)
         SELECT b.item_id, i.title, a.source_kind, a.state, b.score, b.snippet, b.fragment_id,
                (SELECT MAX(at) FROM capture_event c WHERE c.artifact_id = a.item_id) AS last_captured_at
         FROM best b JOIN item i ON i.id = b.item_id JOIN artifact a ON a.item_id = i.id
         WHERE b.rn = 1 AND i.deleted_at IS NULL AND a.state != 'duplicate'
         ORDER BY b.score LIMIT ?`,
      )
      .all(q, q, limit) as unknown as SearchHit[]
  }

  // ---- inputs for the deterministic link generators (GRA-2) ----

  /** Terms of this artifact that few fragments in the whole vault contain, with the fragment that holds each. */
  rareTerms(
    artifactId: string,
    maxDocShare = 0.05,
    limit = 30,
  ): { term: string; doc: number; fragment_id: string }[] {
    const frags = this.db
      .prepare('SELECT id, text FROM fragment WHERE artifact_id = ?')
      .all(artifactId) as unknown as { id: string; text: string }[]
    const total = (this.db.prepare('SELECT COUNT(*) c FROM fragment').get() as { c: number }).c
    const firstFragment = new Map<string, string>()
    for (const f of frags)
      for (const w of f.text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}_-]{4,}/gu) ?? [])
        if (!firstFragment.has(w)) firstFragment.set(w, f.id)
    if (firstFragment.size === 0) return []
    const terms = [...firstFragment.keys()]
    const out: { term: string; doc: number; fragment_id: string }[] = []
    const maxDoc = Math.max(2, Math.floor(total * maxDocShare))
    const stmt = this.db.prepare('SELECT term, doc FROM fragment_vocab WHERE term = ?')
    for (const term of terms) {
      const row = stmt.get(term) as { term: string; doc: number } | undefined
      if (row && row.doc >= 2 && row.doc <= maxDoc)
        out.push({ term, doc: row.doc, fragment_id: firstFragment.get(term) ?? '' })
    }
    return out.sort((a, b) => a.doc - b.doc).slice(0, limit)
  }

  /** Other artifacts whose fragments contain the term, with one fragment each as evidence. */
  artifactsWithTerm(
    term: string,
    excludeArtifact: string,
    limit = 50,
  ): { artifact_id: string; fragment_id: string }[] {
    return this.db
      .prepare(
        `SELECT f.artifact_id, MIN(f.id) AS fragment_id FROM fragment_fts JOIN fragment f ON f.rowid = fragment_fts.rowid
         WHERE fragment_fts MATCH ? AND f.artifact_id != ? GROUP BY f.artifact_id LIMIT ?`,
      )
      .all(`"${term.replace(/"/g, '')}"`, excludeArtifact, limit) as unknown as {
      artifact_id: string
      fragment_id: string
    }[]
  }

  /** The URL item an href points at, if captured. */
  itemForUrl(href: string): string | undefined {
    let url: string
    try {
      const u = new URL(href)
      u.hash = ''
      url = u.href
    } catch {
      return undefined
    }
    return (
      this.db
        .prepare("SELECT item_id FROM artifact WHERE source_kind = 'url' AND source_id = ?")
        .get(url) as { item_id: string } | undefined
    )?.item_id
  }

  /** Items first captured within the window around this artifact's first capture. */
  capturedNear(
    artifactId: string,
    windowMs = 30 * 60_000,
  ): { artifact_id: string; minutes: number }[] {
    const t = (
      this.db
        .prepare('SELECT MIN(at) at FROM capture_event WHERE artifact_id = ?')
        .get(artifactId) as { at: string | null }
    ).at
    if (!t) return []
    const centre = Date.parse(t)
    return (
      this.db
        .prepare(
          'SELECT artifact_id, MIN(at) at FROM capture_event WHERE artifact_id != ? GROUP BY artifact_id',
        )
        .all(artifactId) as unknown as { artifact_id: string; at: string }[]
    )
      .map((r) => ({
        artifact_id: r.artifact_id,
        minutes: Math.abs(Date.parse(r.at) - centre) / 60_000,
      }))
      .filter((r) => r.minutes * 60_000 <= windowMs)
  }

  neighbourhood(
    focus: { kind: 'item' | 'entity'; id: string },
    opts?: Parameters<Graph['neighbourhood']>[1],
  ) {
    return this.graph.neighbourhood(focus, opts)
  }

  /** Adds a stage job for an artifact unless one exists (any state). */
  // ---- embeddings (PRS-5, specification 6.4 step 6): derived, rebuilt when the model changes ----

  /** Fragments of an artifact that have no vector from this model yet. */
  fragmentsToEmbed(artifactId: string, modelDigest: string): FragmentRow[] {
    return this.fragments(artifactId).filter(
      (f) =>
        !this.db
          .prepare('SELECT 1 FROM embedding WHERE fragment_id = ? AND model_digest = ?')
          .get(f.id, modelDigest),
    )
  }

  private forgetEmbeddings(fragmentIds: string[]) {
    if (fragmentIds.length === 0) return
    this.vectors.forget('fragment', fragmentIds)
    const del = this.db.prepare('DELETE FROM embedding WHERE fragment_id = ?')
    for (const id of fragmentIds) del.run(id)
  }

  /** Drops an artifact's vectors from any other model, so changing the model invalidates only embeddings. */
  invalidateEmbeddings(artifactId: string, keepDigest: string): number {
    const stale = (
      this.db
        .prepare('SELECT fragment_id FROM embedding WHERE artifact_id = ? AND model_digest != ?')
        .all(artifactId, keepDigest) as { fragment_id: string }[]
    ).map((r) => r.fragment_id)
    this.forgetEmbeddings(stale)
    return stale.length
  }

  /** Stores vectors for fragments under a run, then refreshes the artifact centroid. */
  putEmbeddings(
    artifactId: string,
    runId: string,
    model: string,
    modelDigest: string,
    dim: number,
    rows: { fragment_id: string; vector: Float32Array }[],
  ) {
    const t = now()
    this.db.exec('BEGIN')
    try {
      this.forgetEmbeddings(rows.map((r) => r.fragment_id))
      const ins = this.db.prepare(
        'INSERT INTO embedding (fragment_id, artifact_id, model, model_digest, dim, run_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      for (const r of rows) ins.run(r.fragment_id, artifactId, model, modelDigest, dim, runId, t)
      this.vectors.put(
        'fragment',
        dim,
        rows.map((r) => ({ id: r.fragment_id, vector: r.vector })),
      )
      const ids = (
        this.db
          .prepare('SELECT fragment_id FROM embedding WHERE artifact_id = ? AND model_digest = ?')
          .all(artifactId, modelDigest) as { fragment_id: string }[]
      ).map((r) => r.fragment_id)
      const all = [...this.vectors.get('fragment', dim, ids).values()]
      if (all.length) {
        const c = centroid(all, dim)
        this.vectors.put('artifact', dim, [{ id: artifactId, vector: c }])
        this.db
          .prepare(
            'INSERT INTO artifact_embedding (artifact_id, model_digest, dim, fragments, run_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(artifact_id) DO UPDATE SET model_digest = excluded.model_digest, dim = excluded.dim, fragments = excluded.fragments, run_id = excluded.run_id, updated_at = excluded.updated_at',
          )
          .run(artifactId, modelDigest, dim, all.length, runId, t)
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  embeddingCount(artifactId: string): { count: number; model_digest: string | null } {
    const r = this.db
      .prepare(
        'SELECT COUNT(*) AS count, MAX(model_digest) AS model_digest FROM embedding WHERE artifact_id = ?',
      )
      .get(artifactId) as { count: number; model_digest: string | null }
    return r
  }

  artifactVector(artifactId: string): { vector: Float32Array; dim: number } | undefined {
    const r = this.db
      .prepare('SELECT dim FROM artifact_embedding WHERE artifact_id = ?')
      .get(artifactId) as { dim: number } | undefined
    if (!r) return undefined
    const v = this.vectors.get('artifact', r.dim, [artifactId]).get(artifactId)
    return v ? { vector: v, dim: r.dim } : undefined
  }

  /** Nearest artifacts by centroid, with their ids resolved to live, non-duplicate artifacts. */
  nearestArtifacts(vector: Float32Array, k: number, exclude: string[] = []) {
    return this.vectors.nearest('artifact', vector, k, new Set(exclude)).filter((n) => {
      const a = this.item(n.id)
      return a && a.state !== 'duplicate'
    })
  }

  /** Nearest fragments to a vector, each with its artifact and text; the semantic half of hybrid search. */
  nearestFragments(vector: Float32Array, k: number, exclude: string[] = []): SemanticHit[] {
    const hits = this.vectors.nearest('fragment', vector, k, new Set(exclude))
    const sel = this.db.prepare('SELECT artifact_id, text FROM fragment WHERE id = ?')
    return hits.flatMap((h) => {
      const f = sel.get(h.id) as { artifact_id: string; text: string } | undefined
      return f
        ? [{ item_id: f.artifact_id, fragment_id: h.id, distance: h.distance, text: f.text }]
        : []
    })
  }

  /** Name vectors of entities, for resolution by closeness (specification 6.4 step 5). */
  putEntityVectors(
    modelDigest: string,
    dim: number,
    rows: { entity_id: string; vector: Float32Array }[],
  ) {
    if (rows.length === 0) return
    this.vectors.put(
      'entity',
      dim,
      rows.map((r) => ({ id: r.entity_id, vector: r.vector })),
    )
    const up = this.db.prepare(
      'INSERT INTO entity_embedding (entity_id, model_digest, dim) VALUES (?, ?, ?) ON CONFLICT(entity_id) DO UPDATE SET model_digest = excluded.model_digest, dim = excluded.dim',
    )
    for (const r of rows) up.run(r.entity_id, modelDigest, dim)
  }

  entitiesWithoutVector(entityIds: string[], modelDigest: string): string[] {
    const has = this.db.prepare(
      'SELECT 1 FROM entity_embedding WHERE entity_id = ? AND model_digest = ?',
    )
    return entityIds.filter((id) => !has.get(id, modelDigest))
  }

  nearestEntities(vector: Float32Array, k: number, exclude: string[] = []) {
    return this.vectors.nearest('entity', vector, k, new Set(exclude))
  }

  fragmentVectors(fragmentIds: string[], dim: number) {
    return this.vectors.get('fragment', dim, fragmentIds)
  }

  // ---- notes: a summary is an item of kind `note`, linked by derived_from (specification 6.4 step 5) ----

  /** One note per artifact and author: a re-run replaces the text while the review status stays. */
  upsertNote(
    artifactId: string,
    author: string,
    text: string,
    title: string | null,
    runId: string,
  ): string {
    const t = now()
    const existing = this.db
      .prepare('SELECT item_id FROM note WHERE artifact_id = ? AND author = ?')
      .get(artifactId, author) as { item_id: string } | undefined
    if (existing) {
      this.db
        .prepare(
          'UPDATE note SET text = ?, title = ?, run_id = ?, updated_at = ? WHERE item_id = ?',
        )
        .run(text, title, runId, t, existing.item_id)
      this.db
        .prepare('UPDATE item SET title = ?, updated_at = ? WHERE id = ?')
        .run(title ?? 'Summary', t, existing.item_id)
      return existing.item_id
    }
    const id = uuidv7()
    this.db
      .prepare('INSERT INTO item (id, kind, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, 'note', title ?? 'Summary', t, t)
    this.db
      .prepare(
        'INSERT INTO note (item_id, artifact_id, author, text, title, run_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, artifactId, author, text, title, runId, t, t)
    return id
  }

  notes(artifactId: string): NoteRow[] {
    return this.db
      .prepare(
        "SELECT n.*, r.id AS relation_id, r.status FROM note n LEFT JOIN relation r ON r.subject_kind = 'item' AND r.subject_id = n.item_id AND r.predicate = 'derived_from' AND r.object_kind = 'item' AND r.object_id = n.artifact_id WHERE n.artifact_id = ? ORDER BY n.updated_at DESC",
      )
      .all(artifactId) as unknown as NoteRow[]
  }

  /** Reopens done jobs of a stage whose last error starts with a prefix, e.g. once a model becomes available. */
  requeueWhere(stage: string, errorPrefix: string): number {
    const t = now()
    const r = this.db
      .prepare(
        "UPDATE job SET state = 'open', attempts = 0, next_run_at = ?, lease_until = NULL, updated_at = ? WHERE stage = ? AND state IN ('done', 'failed') AND last_error LIKE ?",
      )
      .run(t, t, stage, `${errorPrefix}%`)
    return Number(r.changes)
  }

  enqueue(artifactId: string, stage: string): boolean {
    const t = now()
    const r = this.db
      .prepare(
        'INSERT OR IGNORE INTO job (id, artifact_id, stage, state, attempts, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      )
      .run(uuidv7(), artifactId, stage, 'open', t, t, t)
    return r.changes > 0
  }

  /** Reopens a finished stage so it runs again (the link stage after new fragments arrive). */
  requeue(artifactId: string, stage: string) {
    if (this.enqueue(artifactId, stage)) return
    const t = now()
    this.db
      .prepare(
        "UPDATE job SET state = 'open', attempts = 0, next_run_at = ?, lease_until = NULL, updated_at = ? WHERE artifact_id = ? AND stage = ? AND state IN ('done', 'failed')",
      )
      .run(t, t, artifactId, stage)
  }

  /** Gives every preserved artifact that never had `stage` a job for it; how an upgrade catches up. */
  backfill(stage: string): number {
    const rows = this.db
      .prepare(
        "SELECT a.item_id FROM artifact a WHERE a.state = 'preserved' AND NOT EXISTS (SELECT 1 FROM job j WHERE j.artifact_id = a.item_id AND j.stage = ?)",
      )
      .all(stage) as unknown as { item_id: string }[]
    for (const r of rows) this.enqueue(r.item_id, stage)
    return rows.length
  }

  jobs(artifactId: string): JobRow[] {
    return this.db
      .prepare('SELECT * FROM job WHERE artifact_id = ? ORDER BY created_at')
      .all(artifactId) as unknown as JobRow[]
  }
}

/** Turns what the person typed into a safe FTS5 query: each word a prefix term, quotes kept as phrases. */
export function toFtsQuery(input: string): string {
  const phrases = [...input.matchAll(/"([^"]+)"/g)].map(
    (m) => `"${(m[1] ?? '').replace(/"/g, '')}"`,
  )
  const rest = input.replace(/"[^"]*"?/g, ' ')
  const words = rest
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}_]/gu, ''))
    .filter((w) => w.length > 0)
    .map((w) => `"${w}"*`)
  return [...phrases, ...words].join(' ')
}

export const openVault = (dir: string) => new Vault(dir)
