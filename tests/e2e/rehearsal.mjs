#!/usr/bin/env node
// The first-afternoon rehearsal (specification section 7, Gate 6), driven through the real app with Playwright:
// a fresh install, the first-run screen, five pieces captured, each found by a remembered phrase and opened back
// to its source, two suggested links accepted, the graph opened from an item, then the export round trip and a
// backup with a restore test. Nothing waits on a model: the enrich stage runs in the background throughout.
//
//   node tests/e2e/rehearsal.mjs [--packaged] [--corpus tests/corpus] [--url <web page>] [--phrase <word>]
//                                [--engine ws://127.0.0.1:49150] [--keep]
//
// Development mode (default) drives apps/desktop/out (run `npm run build -w apps/desktop` first) against the
// repository engine (`npm run engine`) as a second, non-primary instance. `--packaged` drives
// apps/desktop/dist/mac-arm64/PIM.app, which starts its own bundled engine at --engine.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const packaged = args.includes('--packaged')
const keep = args.includes('--keep')
const corpus = resolve(flag('--corpus', join(root, 'tests/corpus')))
const url = flag('--url', 'https://en.wikipedia.org/wiki/Lighthouse')
const webPhrase = flag('--phrase', 'system of lamps')
const engineUrl = flag('--engine', packaged ? 'ws://127.0.0.1:49150' : 'ws://127.0.0.1:49140')
const python = process.env.PIM_PY ?? join(root, '.tooling/py')

const appDir = packaged
  ? join(root, 'apps/desktop/dist/mac-arm64/PIM.app/Contents/Resources/app')
  : join(root, 'apps/desktop')
const executablePath = packaged
  ? join(root, 'apps/desktop/dist/mac-arm64/PIM.app/Contents/MacOS/PIM')
  : join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
for (const p of [executablePath, join(appDir, 'out/main/index.js')])
  if (!existsSync(p))
    throw new Error(`${p} is missing: build${packaged ? ' and package' : ''} first`)

const PIECES = [
  { name: 'PDF', file: 'report.pdf', phrase: 'quorum', kind: 'file' },
  { name: 'whiteboard photo', file: 'whiteboard.jpg', phrase: 'harbour survey', kind: 'file' },
  { name: 'voice memo', file: 'memo.aiff', phrase: 'kiosk rollout', kind: 'file' },
  { name: 'video', file: 'video.mp4', phrase: 'lighthouse', kind: 'file' },
]
for (const p of PIECES)
  if (!existsSync(join(corpus, p.file))) throw new Error(`${join(corpus, p.file)} is missing`)

const results = []
const t0 = Date.now()
const since = () => Date.now() - t0
let failed = 0
const record = (step, ok, detail, ms) => {
  results.push({ step, ok, detail, ms })
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${ms !== undefined ? ` (${ms} ms)` : ''}  ${detail}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeoutMs, label) {
  const until = Date.now() + timeoutMs
  let last
  while (Date.now() < until) {
    last = await fn()
    if (last) return last
    await sleep(500)
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`)
}

// ---- a fresh install ----
const userData = mkdtempSync(join(tmpdir(), 'pim-rehearsal-'))
mkdirSync(userData, { recursive: true })
writeFileSync(
  join(userData, 'settings.json'),
  JSON.stringify({
    shortcut: 'CommandOrControl+Alt+Shift+F10',
    captureSecret: 'rehearsal',
    pythonRuntime: existsSync(join(python, 'bin/python')) ? python : null,
    firstRunDone: false,
  }),
)
const env = { ...process.env, III_URL: engineUrl }
if (!packaged) env.PIM_WORKER_NAME = 'rehearsal'
const app = await electron.launch({
  executablePath,
  args: [...(packaged ? [] : [join(appDir, 'out/main/index.js')]), `--user-data-dir=${userData}`],
  env,
  timeout: 60_000,
})
const stdout = []
app.process().stdout?.on('data', (d) => stdout.push(d.toString()))
app.process().stderr?.on('data', (d) => stdout.push(d.toString()))
const win = await app.firstWindow()
const pim = (fn, arg) => win.evaluate(fn, arg)

try {
  // ---- first run (UI-7) ----
  await win.getByText('Welcome').first().waitFor({ timeout: 60_000 })
  const status = await waitFor(
    async () => {
      const s = await pim(() => window.pim.runtimeStatus())
      return s.engine.reachable && s.engine.workers.includes('parse') ? s : null
    },
    90_000,
    'the engine and the parse worker',
  )
  record(
    'first run: engine ready',
    true,
    `${status.engine.bundled ? 'bundled' : 'external'} engine, workers: ${status.engine.workers.filter((w) => !w.startsWith('iii-')).join(', ')}; models ${status.models.ok ? 'up' : 'down'}`,
    since(),
  )
  await win.getByRole('button', { name: 'Capture', exact: true }).click()
  await waitFor(
    () => pim(() => window.pim.search('harbour').then((h) => h.length > 0)),
    60_000,
    'the sample to be searchable',
  )
  const firstItemMs = since()
  await win.getByPlaceholder(/remember/).fill('harbour')
  await win.getByText(/^found:/).waitFor({ timeout: 10_000 })
  record(
    'first run: first captured, searchable item (UI-7, under five minutes)',
    firstItemMs < 5 * 60_000,
    'sample note captured and found by "harbour" on the first-run screen',
    firstItemMs,
  )
  await win.getByRole('button', { name: /^Done/ }).click()
  await win.getByRole('heading', { name: 'Library' }).waitFor({ timeout: 10_000 })

  // ---- piece 1: clip a web page through the capture panel (UI-1: paste, Return, receipt) ----
  const panelPromise = app.waitForEvent('window')
  await app.evaluate(
    ({ BrowserWindow }, { preload, file }) => {
      const w = new BrowserWindow({
        width: 520,
        height: 300,
        webPreferences: { preload, sandbox: true, contextIsolation: true },
      })
      void w.loadFile(file, { hash: '/capture' })
    },
    {
      preload: join(appDir, 'out/preload/index.cjs'),
      file: join(appDir, 'out/renderer/index.html'),
    },
  )
  const panel = await panelPromise
  const box = panel.locator('textarea')
  await box.waitFor({ timeout: 10_000 })
  await box.fill(url)
  const tPanel = Date.now()
  await box.press('Enter')
  await panel.getByText(/captured|already in the vault/).waitFor({ timeout: 10_000 })
  const receiptMs = Date.now() - tPanel
  record(
    'clip a web page: paste, Return, receipt shown in the panel (UI-1, CAP-1)',
    true,
    url,
    receiptMs,
  )
  await panel.close().catch(() => {})

  // ---- pieces 2 to 5: dropped files (the drop handler's call, with the file's path) ----
  const captured = {}
  for (const p of PIECES) {
    const r = await pim(({ path }) => window.pim.capture({ kind: 'file', path }, 'drop'), {
      path: join(corpus, p.file),
    })
    captured[p.name] = r.item_id
    record(`drop ${p.name}: durable receipt`, !r.existing, `${p.file} → ${r.item_id} (${r.state})`)
  }
  const items = await pim(() => window.pim.items())
  const web = items.find((i) => i.source_kind === 'url')
  if (!web) throw new Error('the web page has no item')
  captured.web = web.id
  const pieces = [{ name: 'web page', phrase: webPhrase, id: web.id }].concat(
    PIECES.map((p) => ({ name: p.name, phrase: p.phrase, id: captured[p.name] })),
  )

  // ---- processing without blocking the window (UI-2); every piece preserved and read ----
  let worstRoundTrip = 0
  const tWait = Date.now()
  await waitFor(
    async () => {
      const t = Date.now()
      const all = await pim(() => window.pim.items())
      worstRoundTrip = Math.max(worstRoundTrip, Date.now() - t)
      const states = Object.fromEntries(all.map((i) => [i.id, i]))
      for (const p of pieces) {
        const i = states[p.id]
        if (!i) return null
        if (i.state === 'failed') throw new Error(`${p.name} failed: ${i.error}`)
        if (i.state !== 'preserved') return null
        const n = await pim((id) => window.pim.fragments(id).then((f) => f.length), p.id)
        if (n === 0) return null
      }
      return true
    },
    15 * 60_000,
    'every piece to be preserved and read',
  )
  record(
    'every piece preserved and read into passages; window answered throughout (UI-2)',
    worstRoundTrip < 1000,
    `worst renderer round trip while processing: ${worstRoundTrip} ms`,
    Date.now() - tWait,
  )

  // ---- find each by a remembered phrase, results before Return (UI-5), then open to the source (UI-3) ----
  for (const p of pieces) {
    await win.getByRole('button', { name: 'Library', exact: true }).click()
    const search = win.getByPlaceholder('search a phrase you remember…')
    await search.fill('')
    await search.fill(p.phrase)
    const title =
      (await pim(
        (id) => window.pim.items().then((all) => all.find((i) => i.id === id)?.title),
        p.id,
      )) ?? p.id
    const hit = win
      .locator('li')
      .filter({ hasText: title.slice(0, 40) })
      .first()
    let found = true
    try {
      await hit.waitFor({ timeout: 15_000 })
    } catch {
      found = false
    }
    record(
      `find ${p.name} by "${p.phrase}" as typed (UI-5)`,
      found,
      found ? title : `no hit for ${title}`,
    )
    if (!found) continue
    await hit.locator('button').first().click()
    await win.getByRole('heading', { name: title.slice(0, 40) }).waitFor({ timeout: 10_000 })
    // the focused passage is marked in the passage list, and the viewer shows it in its own way
    let marked = 0
    try {
      await win.locator('[style*="rgb(255, 242, 168)"]').first().waitFor({ timeout: 10_000 })
      marked = await win.locator('[style*="rgb(255, 242, 168)"]').count()
    } catch {
      marked = 0
    }
    const kind = await pim(
      (id) => window.pim.payloads(id).then((ps) => ps.find((x) => x.role === 'raw')?.mime ?? ''),
      p.id,
    )
    let place = ''
    if (kind.startsWith('audio/') || kind.startsWith('video/')) {
      const player = await waitFor(
        () =>
          win.evaluate(() => {
            const m = document.querySelector('audio, video')
            return m ? { at: m.currentTime } : null
          }),
        10_000,
        'the player',
      )
      place = `player at ${player.at.toFixed(2)} s`
    } else if (kind === 'application/pdf') {
      await win.locator('canvas').first().waitFor({ timeout: 20_000 })
      place = `${await win.locator('canvas').count()} page canvas rendered`
    } else if (kind.startsWith('image/')) {
      const boxes = await win.locator('[style*="rgb(227, 184, 0)"]').count()
      place = `${boxes} highlighted OCR box`
    } else {
      place = (await win.locator('iframe').count()) ? 'readable copy in its frame' : 'text shown'
    }
    record(`open ${p.name} back to its source at the passage (UI-3)`, marked > 0, place)
    await win.getByRole('button', { name: '← back' }).click()
  }

  // ---- accept two suggested links in the inbox (deterministic generators, no model involved) ----
  await win.getByRole('button', { name: 'Inbox', exact: true }).click()
  const links = await waitFor(
    async () => {
      const s = await pim(() => window.pim.suggestions())
      const between = s.filter(
        (r) =>
          r.subject_kind === 'item' && r.object_kind === 'item' && !r.author.startsWith('enrich::'),
      )
      return between.length >= 2 ? between : null
    },
    3 * 60_000,
    'two suggested links between items',
  )
  const accepted = []
  for (const l of links.slice(0, 2)) {
    // the item's row holds its suggestions as nested rows: the outer row by subject, the inner by object
    const outer = win
      .locator('li')
      .filter({ has: win.locator('li') })
      .filter({ hasText: l.subject_label.slice(0, 30) })
      .first()
    // two generators can propose the same predicate to the same object; the generator's name tells them apart
    const row = outer
      .locator('li')
      .filter({ hasText: l.object_label.slice(0, 30) })
      .filter({ hasText: l.predicate })
      .filter({ hasText: l.generator ?? '' })
      .first()
    await row.getByRole('button', { name: 'accept', exact: true }).click()
    accepted.push(l)
  }
  // the person's decision is what counts: two links between items are accepted now, by a click each
  const nowAccepted = await waitFor(
    async () => {
      const rel = await pim(
        (ids) => Promise.all(ids.map((id) => window.pim.relations(id))),
        pieces.map((p) => p.id),
      )
      const seen = new Map()
      for (const r of rel.flat())
        if (r.status === 'accepted' && r.subject_kind === 'item' && r.object_kind === 'item')
          seen.set(r.id, r)
      return seen.size >= 2 ? [...seen.values()] : null
    },
    10_000,
    'two links between items to be accepted',
  )
  record(
    'accept two suggested links in the inbox',
    true,
    nowAccepted
      .map(
        (l) =>
          `${l.subject_label.slice(0, 24)} —${l.predicate}→ ${l.object_label.slice(0, 24)} (${l.generator})`,
      )
      .join('; '),
  )

  // ---- open the graph from one item (UI-6: direct interactions; the panel names the focus) ----
  await win.getByRole('button', { name: 'Library', exact: true }).click()
  const webTitle =
    (await pim(
      (id) => window.pim.items().then((all) => all.find((i) => i.id === id)?.title),
      web.id,
    )) ?? web.id
  await win
    .locator('tr')
    .filter({ hasText: webTitle.slice(0, 40) })
    .first()
    .click()
  await win.getByRole('button', { name: 'Show in graph' }).click()
  await win.getByRole('heading', { name: 'Graph' }).waitFor({ timeout: 10_000 })
  await win.locator('canvas').first().waitFor({ timeout: 20_000 })
  const nodes = await waitFor(
    async () => {
      const n = await pim(
        (id) => window.pim.neighbourhood({ node: { kind: 'item', id }, include_suggested: true }),
        web.id,
      )
      return n.nodes.length > 1 ? n : null
    },
    30_000,
    'graph neighbours',
  )
  record(
    'open the graph from an item',
    true,
    `${nodes.nodes.length} nodes, ${nodes.edges.length} edges around the web page`,
  )

  // ---- export the five and bring them back into a fresh vault (MET-3, MET-5) ----
  const work = mkdtempSync(join(tmpdir(), 'pim-rehearsal-work-'))
  const exportDir = join(work, 'export')
  const exp = await pim(({ ids, dir }) => window.pim.exportItems(ids, dir), {
    ids: pieces.map((p) => p.id),
    dir: exportDir,
  })
  const index = readFileSync(join(exportDir, 'index.md'), 'utf8')
  let broken = 0
  for (const m of index.matchAll(/\]\(([^)]+)\)/g))
    if (!existsSync(join(exportDir, decodeURI(m[1])))) broken++
  for (const p of pieces) {
    const md = readFileSync(join(exportDir, 'items', `${p.id}.md`), 'utf8')
    for (const m of md.matchAll(/\]\(([^)]+)\)/g))
      if (!existsSync(join(exportDir, 'items', decodeURI(m[1])))) broken++
  }
  const { Vault, importPackage } = await import('@pim/vault')
  const fresh = new Vault(join(work, 'fresh'))
  const imp = await importPackage(fresh, exportDir)
  const live = new Vault(join(userData, 'vault'))
  const rows = (v, sql) => v.db.prepare(sql).all()
  const ids = pieces.map((p) => `'${p.id}'`).join(',')
  const compare = (sql) => JSON.stringify(rows(live, sql)) === JSON.stringify(rows(fresh, sql))
  const same = {
    items: compare(`SELECT id, title FROM item WHERE id IN (${ids}) ORDER BY id`),
    fragments: compare(
      `SELECT id, artifact_id, ordinal, text FROM fragment WHERE artifact_id IN (${ids}) ORDER BY id`,
    ),
    relations: compare(
      `SELECT id, subject_id, predicate, object_id, status, author FROM relation WHERE subject_id IN (${ids}) AND object_id IN (${ids}) ORDER BY id`,
    ),
    blobs: fresh.db
      .prepare('SELECT blob_id, byte_length FROM artifact_payload')
      .all()
      .every((p) => fresh.blobs.has(p.blob_id)),
    search: fresh.search('quorum').length > 0,
  }
  live.close()
  fresh.close()
  record(
    'export the five, every link resolves; import into a fresh vault keeps ids and links (MET-3, MET-5)',
    broken === 0 && Object.values(same).every(Boolean) && imp.items === pieces.length,
    `${exp.items} items, ${exp.blobs} attachments, ${broken} broken links; import: ${imp.items} items, ${imp.relations} relations, ${imp.entities} entities; identical: ${Object.entries(
      same,
    )
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ')}`,
  )

  // ---- backup and the restore test (SEC-4) ----
  const bk = await pim((dir) => window.pim.backup(dir), join(work, 'backups'))
  const test = await pim((dir) => window.pim.testRestore(dir), bk.dir)
  record(
    'backup, then a restore test into a fresh folder: every item opens, search passes (SEC-4)',
    test.report.ok,
    `${bk.manifest.items} items, ${bk.manifest.blobs} blobs; restore test: ${test.report.items} items, ${test.report.missing_blobs.length} missing, search "${test.report.search?.query}" ${test.report.search?.found ? 'found' : 'missing'}`,
  )
  if (!keep) rmSync(work, { recursive: true, force: true })
} catch (e) {
  record('rehearsal', false, e instanceof Error ? e.message : String(e))
  console.error(stdout.slice(-30).join(''))
} finally {
  const timing = stdout
    .join('')
    .split('\n')
    .filter((l) => l.includes('first_run.'))
    .join(' ')
  console.log(`\napp log: ${timing || '(no first-run timing lines)'}`)
  await app.close().catch(() => {})
  if (keep) console.log(`kept ${userData}`)
  else rmSync(userData, { recursive: true, force: true })
  console.log(
    `\n${results.filter((r) => r.ok).length} of ${results.length} steps passed in ${Math.round(since() / 1000)} s`,
  )
  process.exit(failed ? 1 : 0)
}
