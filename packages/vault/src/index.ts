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

  jobs(artifactId: string): JobRow[] {
    return this.db
      .prepare('SELECT * FROM job WHERE artifact_id = ? ORDER BY created_at')
      .all(artifactId) as unknown as JobRow[]
  }
}

export const openVault = (dir: string) => new Vault(dir)
