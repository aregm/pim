import type { CaptureRequest, Receipt } from '@pim/contracts'

export interface ItemView {
  id: string
  kind: string
  intent: string
  title: string | null
  created_at: string
  source_kind: 'url' | 'text' | 'file' | 'image'
  source_id: string
  source_uri: string | null
  content_hash: string | null
  state: 'received' | 'preserved' | 'failed' | 'duplicate'
  duplicate_of: string | null
  error: string | null
  capture_count: number
  last_captured_at: string
}
export interface PayloadView {
  id: string
  role: string
  blob_id: string
  mime: string
  byte_length: number
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
export interface FragmentView {
  id: string
  payload_id: string
  /** `enrich::*` means model output (MET-2). */
  processor: string
  ordinal: number
  selector: Selector
  text: string
}
export interface SearchHit {
  why?: 'lexical' | 'semantic' | 'both'
  item_id: string
  title: string | null
  source_kind: 'url' | 'text' | 'file' | 'image'
  state: 'received' | 'preserved' | 'failed' | 'duplicate'
  score: number
  snippet: string
  fragment_id: string | null
  last_captured_at: string
}
export interface RelationView {
  id: string
  subject_kind: 'item' | 'entity'
  subject_id: string
  subject_label: string
  predicate: string
  object_kind: 'item' | 'entity'
  object_id: string
  object_label: string
  status: 'suggested' | 'accepted' | 'rejected' | 'superseded'
  author: string
  generator: string | null
  score: number | null
  score_json: Record<string, unknown> | null
  created_at: string
  run: RunView | null
  evidence: {
    fragment_id: string
    artifact_id: string
    title: string | null
    selector: Selector
    text: string
    role: string
  }[]
}
export interface RunView {
  id: string
  processor: string
  version: string
  model_digest: string | null
  prompt_digest: string | null
  started_at: string
}
export interface NoteView {
  item_id: string
  artifact_id: string
  author: string
  text: string
  title: string | null
  run_id: string
  created_at: string
  updated_at: string
  relation_id: string | null
  status: 'suggested' | 'accepted' | 'rejected' | 'superseded' | null
  run: RunView | null
}
export interface ModelSettings {
  embed: string
  text: string
  vision: string
}
export interface ModelsStatus {
  ok: boolean
  url: string
  models: { name: string; digest: string }[]
  error?: string
}
export interface TagView {
  relation_id: string
  entity: { id: string; kind: string; name: string }
}
export interface GraphNode {
  key: string
  kind: 'item' | 'entity'
  id: string
  label: string
  item_kind?: string
  state?: string
  entity_kind?: string
  pinned: boolean
  hops: number
  reason: string
}
export interface GraphEdge {
  id: string
  source: string
  target: string
  predicate: string
  status: 'suggested' | 'accepted' | 'rejected' | 'superseded'
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
export interface NeighbourhoodQuery {
  node: { kind: 'item' | 'entity'; id: string }
  budget?: number
  include_suggested?: boolean
  predicates?: string[]
  max_hops?: number
}
export interface WatchedFolder {
  path: string
  policy: 'copy' | 'move'
}
export interface SettingsView {
  vaultDir: string
  shortcut: string
  watchedFolders: WatchedFolder[]
  captureSecret: string
  endpoint: string
  models: ModelSettings
  pythonRuntime: string | null
  firstRunDone: boolean
  lastBackup: { at: string; dir: string } | null
}
export interface ExportReport {
  dir: string
  items: number
  blobs: number
  bytes: number
}
export interface ImportReport {
  items: number
  existing: number
  conflicts: string[]
  blobs: number
  entities: number
  relations: number
}
export interface BackupManifest {
  created_at: string
  app_version: string
  schema_version: number
  items: number
  blobs: number
  bytes: number
}
export interface VerifyReport {
  ok: boolean
  items: number
  payloads: number
  missing_blobs: string[]
  search: { query: string; found: boolean } | null
  schema_version: number
}
export interface RuntimeStatus {
  engine: { url: string; reachable: boolean; bundled: boolean; workers: string[] }
  python: { path: string | null; present: boolean }
  models: ModelsStatus
  firstRunStartedAt: string | null
}

declare global {
  interface Window {
    pim: {
      capture: (req: CaptureRequest, surface: string) => Promise<Receipt>
      captureClipboard: () => Promise<Receipt>
      pathForFile: (file: File) => string
      items: () => Promise<ItemView[]>
      payloads: (id: string) => Promise<PayloadView[]>
      fragments: (id: string) => Promise<FragmentView[]>
      search: (query: string, hybrid?: boolean) => Promise<SearchHit[]>
      notes: (id: string) => Promise<NoteView[]>
      enrich: (id: string) => Promise<void>
      modelsStatus: (force?: boolean) => Promise<ModelsStatus>
      relations: (id: string) => Promise<RelationView[]>
      suggestions: () => Promise<RelationView[]>
      tags: (id: string) => Promise<TagView[]>
      pin: (id: string, pinned: boolean) => Promise<void>
      neighbourhood: (q: NeighbourhoodQuery) => Promise<Neighbourhood>
      review: (relationId: string, status: 'accepted' | 'rejected') => Promise<void>
      tag: (itemId: string, label: string) => Promise<{ id: string; name: string }>
      untag: (relationId: string) => Promise<void>
      blobUrl: (blobId: string) => string
      retry: (id: string) => Promise<void>
      openSource: (id: string) => Promise<void>
      settings: () => Promise<SettingsView>
      saveSettings: (patch: Partial<SettingsView>) => Promise<SettingsView>
      engineWorkers: () => Promise<string[]>
      exportItems: (ids: string[] | null, dir?: string) => Promise<ExportReport | null>
      importPackage: (dir?: string) => Promise<ImportReport | null>
      backup: (dest?: string) => Promise<{ dir: string; manifest: BackupManifest } | null>
      testRestore: (
        backupDir?: string,
      ) => Promise<{ manifest: BackupManifest; report: VerifyReport } | null>
      restore: (
        backupDir?: string,
        target?: string,
      ) => Promise<{
        target: string
        manifest: BackupManifest
        report: VerifyReport
        switched: boolean
      } | null>
      switchVault: (dir?: string) => Promise<SettingsView | null>
      runtimeStatus: () => Promise<RuntimeStatus>
      firstRunDone: () => Promise<SettingsView>
      reveal: (path: string) => Promise<void>
      onItemsChanged: (cb: () => void) => () => void
      closePanel: () => void
      showMain: () => void
    }
  }
}
