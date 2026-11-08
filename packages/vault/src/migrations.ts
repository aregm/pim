/** Numbered, append-only. A migration never changes after it ships (ADR-003, ADR-004). */
export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE item (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  intent TEXT NOT NULL DEFAULT 'reference',
  title TEXT,
  sensitivity TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE TABLE artifact (
  item_id TEXT PRIMARY KEY REFERENCES item(id),
  source_kind TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_uri TEXT,
  content_hash TEXT,
  state TEXT NOT NULL,
  duplicate_of TEXT REFERENCES artifact(item_id),
  error TEXT,
  UNIQUE(source_kind, source_id)
);
CREATE INDEX artifact_content_hash ON artifact(content_hash) WHERE content_hash IS NOT NULL;
CREATE TABLE capture_event (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifact(item_id),
  surface TEXT NOT NULL,
  at TEXT NOT NULL,
  original_path TEXT
);
CREATE INDEX capture_event_artifact ON capture_event(artifact_id);
CREATE TABLE artifact_payload (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifact(item_id),
  role TEXT NOT NULL,
  blob_id TEXT NOT NULL,
  mime TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX artifact_payload_artifact ON artifact_payload(artifact_id);
CREATE TABLE job (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifact(item_id),
  stage TEXT NOT NULL,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT NOT NULL,
  lease_until TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(artifact_id, stage)
);
CREATE INDEX job_open ON job(state, next_run_at);
`,
  },
]
