import { createReadStream } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import {
  CaptureRequest,
  EngineWorkersList,
  HealthResponse,
  NeighbourhoodRequest,
  PingResponse,
  ReviewRequest,
  SearchRequest,
  TagRequest,
} from '@pim/contracts'
import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  shell,
  Tray,
} from 'electron'
import { registerWorker } from 'iii-sdk'
import { Core } from './core.ts'
import { loadSettings, type Settings, saveSettings } from './settings.ts'
import { FolderWatcher } from './watch.ts'

const VERSION = '0.1.0'
const ENGINE_URL = process.env.III_URL ?? 'ws://127.0.0.1:49140'
const started = Date.now()

// The main process is the trusted core and one worker on the engine (spec D3, ADR-001), in the `pim` namespace.
const iii = registerWorker(ENGINE_URL, { workerName: 'desktop', namespace: 'pim' })
let settings: Settings = loadSettings()
let core: Core
let mainWindow: BrowserWindow | undefined
let panel: BrowserWindow | undefined
let tray: Tray | undefined
const watcher = new FolderWatcher((path, folder) => {
  void core.receive({ kind: 'file', path }, 'folder', { moveOriginal: folder.policy === 'move' })
})

const rendererUrl = (hash: string) =>
  process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}#${hash}` : undefined

const load = (win: BrowserWindow, hash: string) => {
  const url = rendererUrl(hash)
  if (url) void win.loadURL(url)
  else void win.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
}

const webPreferences = () => ({
  preload: join(import.meta.dirname, '../preload/index.cjs'),
  sandbox: true,
  contextIsolation: true,
})

function showMain() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
    return
  }
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'PIM',
    webPreferences: webPreferences(),
  })
  load(mainWindow, '/inbox')
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
}

/** UI-1: one keystroke opens the panel; it closes itself after the receipt. */
function togglePanel() {
  if (panel && !panel.isDestroyed()) {
    if (panel.isVisible()) panel.hide()
    else {
      panel.show()
      panel.focus()
    }
    return
  }
  panel = new BrowserWindow({
    width: 520,
    height: 300,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: 'Capture',
    webPreferences: webPreferences(),
  })
  load(panel, '/capture')
  panel.on('blur', () => panel?.hide())
  panel.on('closed', () => {
    panel = undefined
  })
}

function registerShortcut() {
  globalShortcut.unregisterAll()
  if (!globalShortcut.register(settings.shortcut, togglePanel))
    console.error(JSON.stringify({ event: 'shortcut.unavailable', shortcut: settings.shortcut }))
}

function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('items:changed')
}

async function captureClipboard() {
  // Electron 45 clipboard: items with MIME types, blobs for binary data.
  for (const item of await clipboard.read()) {
    const type = item.types.find((t) => t === 'image/png')
    if (type) {
      const blob = (await item.getType(type)) as Blob
      return core.receiveImage(new Uint8Array(await blob.arrayBuffer()), 'clipboard')
    }
  }
  const text = (await clipboard.readText()).trim()
  if (!text) throw new Error('clipboard is empty')
  if (/^https?:\/\/\S+$/.test(text)) return core.receive({ kind: 'url', url: text }, 'clipboard')
  return core.receive({ kind: 'text', text }, 'clipboard')
}

const secretOk = (headers: Record<string, string>) =>
  headers['x-pim-secret'] === settings.captureSecret

// The renderer's origin (file or the dev server) differs from the blob scheme's, so every fetch is cross-origin.
const CORS = { 'access-control-allow-origin': '*' }
// pim-blob://<hex>/ must be a standard, secure scheme that fetch() and media elements may load; this has to be
// declared before the app is ready, or every fetch of a blob fails.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'pim-blob',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
])

app.whenReady().then(() => {
  core = new Core(settings.vaultDir, iii)
  core.on('changed', broadcast)
  core.start()
  protocol.handle('pim-blob', (request: Request) => {
    // pim-blob://<hex>/ : the hex is the host of a standard-scheme URL, so it arrives lower-cased
    const hex = new URL(request.url).host.toLowerCase()
    const blobId = `sha256:${hex}`
    const payload = core.vault.db
      .prepare('SELECT mime FROM artifact_payload WHERE blob_id = ? LIMIT 1')
      .get(blobId) as { mime: string } | undefined
    if (!/^[0-9a-f]{64}$/.test(hex) || !payload || !core.vault.blobs.has(blobId))
      return new Response('not found', { status: 404, headers: CORS })
    const stream = Readable.toWeb(
      createReadStream(core.vault.blobs.pathFor(blobId)),
    ) as ReadableStream
    return new Response(stream, { headers: { ...CORS, 'content-type': payload.mime } })
  })
  watcher.apply(settings.watchedFolders)

  // ---- functions on the engine ----
  iii.registerFunction('kernel::ping', async () =>
    PingResponse.parse({ pong: true, at: new Date().toISOString() }),
  )
  iii.registerFunction('kernel::health', async () =>
    HealthResponse.parse({
      worker: 'desktop',
      version: VERSION,
      ok: true,
      uptime_ms: Date.now() - started,
    }),
  )
  iii.registerFunction('kernel::receipt', (input: unknown) =>
    core.receive(CaptureRequest.parse(input), 'api'),
  )
  iii.registerFunction('kernel::retry', async (input: unknown) => {
    const { item_id, stage } = input as { item_id: string; stage?: string }
    if (stage) core.requeue(String(item_id), String(stage))
    else core.retry(String(item_id))
    return { ok: true }
  })
  iii.registerFunction('kernel::neighborhood', async (input: unknown) => {
    const q = NeighbourhoodRequest.parse(input)
    return core.vault.neighbourhood(q.node, {
      budget: q.budget,
      includeSuggested: q.include_suggested,
      predicates: q.predicates,
      maxHops: q.max_hops,
    })
  })
  iii.registerFunction('kernel::review', async (input: unknown) => {
    const { relation_id, status } = ReviewRequest.parse(input)
    core.review(relation_id, status)
    return { ok: true }
  })
  iii.registerFunction('kernel::tag', async (input: unknown) => {
    const { item_id, label } = TagRequest.parse(input)
    return core.tag(item_id, label)
  })
  iii.registerFunction('kernel::relations', async (input: unknown) => ({
    relations: core.relations(String((input as { item_id: string }).item_id)),
  }))
  iii.registerFunction('kernel::search', async (input: unknown) => {
    const { query, limit } = SearchRequest.parse(input)
    return { hits: core.search(query, limit) }
  })
  // CAP-4: loopback endpoint through iii's http worker; the secret is checked here, not in the worker.
  iii.registerFunction(
    'capture::http',
    async (req: { headers: Record<string, string>; body: unknown }) => {
      if (!secretOk(req.headers ?? {}))
        return { status_code: 401, body: { error: 'missing or wrong x-pim-secret' } }
      const parsed = CaptureRequest.safeParse(req.body)
      if (!parsed.success)
        return {
          status_code: 400,
          body: { error: 'invalid capture request', issues: parsed.error.issues },
        }
      return { status_code: 200, body: await core.receive(parsed.data, 'http') }
    },
  )
  iii.observe(
    { function_id: 'http::on-request', args: { method: 'POST', path: '/capture' } },
    'capture::http',
  )

  // ---- IPC: the only way the renderer reaches the core ----
  ipcMain.handle('capture', (_e, req: unknown, surface: string) =>
    core.receive(CaptureRequest.parse(req), surface),
  )
  ipcMain.handle('capture:clipboard', () => captureClipboard())
  ipcMain.handle('items:list', () => core.items())
  ipcMain.handle('items:payloads', (_e, id: string) => core.vault.payloads(id))
  ipcMain.handle('items:fragments', (_e, id: string) => core.vault.fragments(id))
  ipcMain.handle('items:search', (_e, query: string) => core.search(String(query), 50))
  ipcMain.handle('items:relations', (_e, id: string) => core.relations(id))
  ipcMain.handle('items:suggestions', () => core.suggestions())
  ipcMain.handle('items:tags', (_e, id: string) => core.vault.graph.tags(id))
  ipcMain.handle('items:pin', (_e, id: string, pinned: boolean) => {
    core.vault.graph.setPinned(id, Boolean(pinned))
    broadcast()
  })
  ipcMain.handle('graph:neighbourhood', (_e, q: unknown) => {
    const p = NeighbourhoodRequest.parse(q)
    return core.vault.neighbourhood(p.node, {
      budget: p.budget,
      includeSuggested: p.include_suggested,
      predicates: p.predicates,
      maxHops: p.max_hops,
    })
  })
  ipcMain.handle('review:relation', (_e, q: unknown) => {
    const { relation_id, status } = ReviewRequest.parse(q)
    core.review(relation_id, status)
  })
  ipcMain.handle('review:tag', (_e, q: unknown) => {
    const { item_id, label } = TagRequest.parse(q)
    return core.tag(item_id, label)
  })
  ipcMain.handle('review:untag', (_e, relationId: string) => core.untag(String(relationId)))
  ipcMain.handle('items:retry', (_e, id: string) => core.retry(id))
  ipcMain.handle('source:open', async (_e, id: string) => {
    const item = core.vault.item(id)
    if (!item) return
    if (item.source_kind === 'url' && item.source_uri) return shell.openExternal(item.source_uri)
    const raw = core.vault.payloads(id).find((p) => p.role === 'raw')
    if (raw) return shell.openPath(core.vault.blobs.pathFor(raw.blob_id))
  })
  ipcMain.handle('settings:get', () => ({ ...settings, endpoint: 'http://127.0.0.1:3111/capture' }))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    settings = { ...settings, ...patch }
    saveSettings(settings)
    registerShortcut()
    watcher.apply(settings.watchedFolders)
    return settings
  })
  ipcMain.handle('engine:workers', async () => {
    const result = await iii.trigger({
      function_id: 'engine::workers::list',
      payload: {},
      timeoutMs: 5_000,
    })
    return EngineWorkersList.parse(result).workers.map((w) => w.name)
  })
  ipcMain.on('panel:close', () => panel?.hide())
  ipcMain.on('main:show', showMain)

  registerShortcut()
  tray = new Tray(nativeImage.createFromDataURL(TRAY_ICON))
  tray.setToolTip('PIM')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Capture…', accelerator: settings.shortcut, click: togglePanel },
      {
        label: 'Capture clipboard',
        click: () => void captureClipboard().catch((e) => console.error(String(e))),
      },
      { type: 'separator' },
      { label: 'Open PIM', click: showMain },
      { label: 'Quit', click: () => app.quit() },
    ]),
  )
  showMain()
})

app.on('window-all-closed', () => {
  /* the tray keeps the app alive; capture must work without a window */
})
app.on('activate', showMain)
app.on('before-quit', () => {
  globalShortcut.unregisterAll()
  watcher.close()
  core?.stop()
  void iii.shutdown()
})

// 16x16 template icon: a filled circle. Replaced by a real asset when the app gets its identity.
const TRAY_ICON =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAgklEQVR4nGNgoBAwMjAwMDAwMBAFGBgYGBgY/v//jxaWgQZmJiYWBgYGBgYG/v8TMBAFGBgYGBgY6AoGBgYGBgZ8gYGBgYGBgYGQMDAwMDAw0AgwMDAwMDDQCTAwMDAwMNALMDAwMDAw0A0wMDAwMDBgAoAyMDAwMDDQCjAwMDAwMBAFGBgYGBgYAACSVhHt8v9GvgAAAABJRU5ErkJggg=='
