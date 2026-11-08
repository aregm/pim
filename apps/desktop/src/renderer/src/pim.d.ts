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
