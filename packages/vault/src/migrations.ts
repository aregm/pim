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
  {
    version: 2,
    sql: `
CREATE TABLE processing_run (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifact(item_id),
  processor TEXT NOT NULL,
  version TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX processing_run_artifact ON processing_run(artifact_id);
CREATE TABLE fragment (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifact(item_id),
  payload_id TEXT NOT NULL REFERENCES artifact_payload(id),
  run_id TEXT NOT NULL REFERENCES processing_run(id),
  ordinal INTEGER NOT NULL,
  selector_json TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX fragment_artifact ON fragment(artifact_id, ordinal);
CREATE VIRTUAL TABLE fragment_fts USING fts5(text, content='fragment', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER fragment_ai AFTER INSERT ON fragment BEGIN
  INSERT INTO fragment_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER fragment_ad AFTER DELETE ON fragment BEGIN
  INSERT INTO fragment_fts(fragment_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
END;
CREATE VIRTUAL TABLE item_fts USING fts5(title, content='item', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER item_ai AFTER INSERT ON item BEGIN
  INSERT INTO item_fts(rowid, title) VALUES (new.rowid, COALESCE(new.title, ''));
END;
CREATE TRIGGER item_au AFTER UPDATE OF title ON item BEGIN
  INSERT INTO item_fts(item_fts, rowid, title) VALUES ('delete', old.rowid, COALESCE(old.title, ''));
  INSERT INTO item_fts(rowid, title) VALUES (new.rowid, COALESCE(new.title, ''));
END;
INSERT INTO item_fts(rowid, title) SELECT rowid, COALESCE(title, '') FROM item;
`,
  },
  {
    version: 3,
    sql: `
ALTER TABLE item ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE TABLE entity (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  normalized TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(kind, normalized)
);
CREATE TABLE relation (
  id TEXT PRIMARY KEY,
  subject_kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  status TEXT NOT NULL,
  author TEXT NOT NULL,
  generator TEXT,
  score REAL,
  score_json TEXT,
  run_id TEXT REFERENCES processing_run(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subject_kind, subject_id, predicate, object_kind, object_id, author)
);
CREATE INDEX relation_subject ON relation(subject_kind, subject_id, status);
CREATE INDEX relation_object ON relation(object_kind, object_id, status);
CREATE TABLE relation_evidence (
  relation_id TEXT NOT NULL REFERENCES relation(id),
  fragment_id TEXT NOT NULL REFERENCES fragment(id),
  role TEXT NOT NULL DEFAULT 'support',
  PRIMARY KEY(relation_id, fragment_id, role)
);
CREATE VIRTUAL TABLE fragment_vocab USING fts5vocab('fragment_fts', 'row');
`,
  },
]
