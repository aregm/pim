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
  ordinal: number
  selector: Selector
  text: string
}
export interface SearchHit {
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
  evidence: { fragment_id: string; artifact_id: string; text: string; role: string }[]
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
      search: (query: string) => Promise<SearchHit[]>
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
      onItemsChanged: (cb: () => void) => () => void
      closePanel: () => void
      showMain: () => void
    }
  }
}
