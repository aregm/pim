import { join } from 'node:path'
import { EngineWorkersList, HealthResponse, PingResponse } from '@pim/contracts'
import { app, BrowserWindow, ipcMain } from 'electron'
import { registerWorker } from 'iii-sdk'

const VERSION = '0.1.0'
const ENGINE_URL = process.env.III_URL ?? 'ws://127.0.0.1:49140'
const started = Date.now()

// The main process is the trusted core and one worker on the engine (spec D3, ADR-001).
const iii = registerWorker(ENGINE_URL, { workerName: 'desktop' })
iii.registerFunction('kernel::ping', () =>
  PingResponse.parse({ pong: true, at: new Date().toISOString() }),
)
iii.registerFunction('kernel::health', () =>
  HealthResponse.parse({
    worker: 'desktop',
    version: VERSION,
    ok: true,
    uptime_ms: Date.now() - started,
  }),
)

ipcMain.handle('engine:workers', async () => {
  const result = await iii.trigger({
    function_id: 'engine::workers::list',
    payload: {},
    timeout: 5_000,
  })
  return EngineWorkersList.parse(result).workers.map((w) => w.name)
})

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'PIM',
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
    },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())
app.on('before-quit', () => void iii.shutdown())
