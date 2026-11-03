import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { BlobStore } from './blobs.ts'
import { uuidv7 } from './id.ts'
import { MIGRATIONS } from './migrations.ts'

export { BlobStore } from './blobs.ts'
export { uuidv7 } from './id.ts'

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
  ordinal: number
  selector: Selector
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

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(dir, { recursive: true })
    this.db = new DatabaseSync(join(dir, 'vault.sqlite'))
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA foreign_keys = ON;')
    this.migrate()
    this.blobs = new BlobStore(join(dir, 'blobs'))
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

  completeJob(id: string) {
    this.db
      .prepare('UPDATE job SET state = ?, lease_until = NULL, updated_at = ? WHERE id = ?')
      .run('done', now(), id)
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

  startRun(artifactId: string, processor: string, version: string): string {
    const id = uuidv7()
    this.db
      .prepare(
        'INSERT INTO processing_run (id, artifact_id, processor, version, status, started_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, artifactId, processor, version, 'running', now())
    return id
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
        'SELECT id, artifact_id, payload_id, run_id, ordinal, selector_json, text FROM fragment WHERE artifact_id = ? ORDER BY ordinal',
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

  /** Adds a stage job for an artifact unless one exists (any state). */
  enqueue(artifactId: string, stage: string): boolean {
    const t = now()
    const r = this.db
      .prepare(
        'INSERT OR IGNORE INTO job (id, artifact_id, stage, state, attempts, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)',
      )
      .run(uuidv7(), artifactId, stage, 'open', t, t, t)
    return r.changes > 0
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
