// preserve::web — loads a URL in an offscreen, sandboxed window with no Node integration and a throwaway
// session, and returns the raw HTML, a readable extraction, metadata and a full-page screenshot.
// Runs as its own Electron process, started by compose; it never touches the vault.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { app, BrowserWindow } from 'electron'
import { registerWorker } from 'iii-sdk'

const require = createRequire(import.meta.url)
const READABILITY = readFileSync(require.resolve('@mozilla/readability/Readability.js'), 'utf8')
const NAME = 'web-preserve'
const VERSION = '0.1.0'
const ENGINE_URL = process.env.III_URL ?? 'ws://127.0.0.1:49140'
const LOAD_TIMEOUT_MS = 30_000
const MAX_HEIGHT = 8_000

const log = (event, fields = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }))

async function preserve({ url }) {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `preserve-${Date.now()}`,
      images: true,
    },
  })
  try {
    await Promise.race([
      win.loadURL(url),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`load timed out after ${LOAD_TIMEOUT_MS} ms`)),
          LOAD_TIMEOUT_MS,
        ),
      ),
    ])
    await new Promise((r) => setTimeout(r, 1500)) // let late scripts settle
    const page = await win.webContents.executeJavaScript(`(() => {
      ${READABILITY}
      const meta = {};
      for (const m of document.querySelectorAll('meta[name], meta[property]')) {
        const k = m.getAttribute('name') || m.getAttribute('property'); const v = m.getAttribute('content');
        if (k && v && /^(description|author|og:|twitter:|article:|dc\\.)/i.test(k)) meta[k] = v.slice(0, 2000);
      }
      const canonical = document.querySelector('link[rel="canonical"]'); if (canonical) meta.canonical = canonical.href;
      if (document.documentElement.lang) meta.lang = document.documentElement.lang;
      let readable = null;
      try { readable = new Readability(document.cloneNode(true)).parse(); } catch (e) { meta.readability_error = String(e); }
      return {
        title: document.title || '',
        raw_html: document.documentElement.outerHTML,
        readable_html: readable ? readable.content : null,
        text: readable ? readable.textContent : null,
        meta,
        height: Math.min(document.documentElement.scrollHeight, ${MAX_HEIGHT}),
      };
    })()`)
    win.setContentSize(1280, Math.max(900, page.height))
    await new Promise((r) => setTimeout(r, 300))
    let screenshot = null
    try {
      screenshot = (await win.webContents.capturePage()).toPNG().toString('base64')
    } catch (e) {
      page.meta.screenshot_error = String(e)
    }
    return {
      url,
      final_url: win.webContents.getURL() || url,
      title: page.title,
      metadata: page.meta,
      raw_html: page.raw_html,
      readable_html: page.readable_html,
      text: page.text,
      screenshot_png_b64: screenshot,
    }
  } finally {
    win.destroy()
  }
}

// Software rendering: the hidden window has no display, and the GPU process crashed on tall captures.
app.disableHardwareAcceleration()

app.whenReady().then(() => {
  if (app.dock) app.dock.hide()
  const started = Date.now()
  const iii = registerWorker(ENGINE_URL, { workerName: NAME })
  iii.registerFunction(`${NAME}::health`, () => ({
    worker: NAME,
    version: VERSION,
    ok: true,
    uptime_ms: Date.now() - started,
  }))
  iii.registerFunction('preserve::web', async (input) => {
    const t = Date.now()
    const out = await preserve(input)
    log('preserve.web', {
      url: input.url,
      ms: Date.now() - t,
      bytes: out.raw_html.length,
      screenshot: Boolean(out.screenshot_png_b64),
    })
    return out
  })
  const stop = async () => {
    await iii.shutdown()
    app.quit()
  }
  process.once('SIGTERM', () => void stop())
  process.once('SIGINT', () => void stop())
  log('worker.start', { worker: NAME, version: VERSION, engine: ENGINE_URL })
})
app.on('window-all-closed', () => {}) // stay alive between pages
