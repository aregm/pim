import { contextBridge, ipcRenderer, webUtils } from 'electron'

// The only bridge between the renderer and the core. Shapes are typed in @pim/contracts.
contextBridge.exposeInMainWorld('pim', {
  capture: (req: unknown, surface: string) => ipcRenderer.invoke('capture', req, surface),
  captureClipboard: () => ipcRenderer.invoke('capture:clipboard'),
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  items: () => ipcRenderer.invoke('items:list'),
  payloads: (id: string) => ipcRenderer.invoke('items:payloads', id),
  fragments: (id: string) => ipcRenderer.invoke('items:fragments', id),
  search: (query: string, hybrid = false) => ipcRenderer.invoke('items:search', query, hybrid),
  notes: (id: string) => ipcRenderer.invoke('items:notes', id),
  enrich: (id: string) => ipcRenderer.invoke('items:enrich', id),
  modelsStatus: (force = false) => ipcRenderer.invoke('models:status', force),
  relations: (id: string) => ipcRenderer.invoke('items:relations', id),
  suggestions: () => ipcRenderer.invoke('items:suggestions'),
  tags: (id: string) => ipcRenderer.invoke('items:tags', id),
  pin: (id: string, pinned: boolean) => ipcRenderer.invoke('items:pin', id, pinned),
  neighbourhood: (q: unknown) => ipcRenderer.invoke('graph:neighbourhood', q),
  review: (relationId: string, status: 'accepted' | 'rejected') =>
    ipcRenderer.invoke('review:relation', { relation_id: relationId, status }),
  tag: (itemId: string, label: string) =>
    ipcRenderer.invoke('review:tag', { item_id: itemId, label }),
  untag: (relationId: string) => ipcRenderer.invoke('review:untag', relationId),
  blobUrl: (blobId: string) => `pim-blob://${blobId.replace(/^sha256:/, '')}/`,
  retry: (id: string) => ipcRenderer.invoke('items:retry', id),
  openSource: (id: string) => ipcRenderer.invoke('source:open', id),
  settings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch: unknown) => ipcRenderer.invoke('settings:set', patch),
  engineWorkers: (): Promise<string[]> => ipcRenderer.invoke('engine:workers'),
  onItemsChanged: (cb: () => void) => {
    const listener = () => cb()
    ipcRenderer.on('items:changed', listener)
    return () => ipcRenderer.off('items:changed', listener)
  },
  closePanel: () => ipcRenderer.send('panel:close'),
  showMain: () => ipcRenderer.send('main:show'),
})
