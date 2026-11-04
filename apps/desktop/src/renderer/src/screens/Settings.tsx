import { useEffect, useState } from 'react'
import type { ModelsStatus, SettingsView, VerifyReport, WatchedFolder } from '../pim.d.ts'
import { Button, colors, when } from '../ui.tsx'
import { useRuntimeStatus, WhatWorks } from './Runtime.tsx'

const kb = (n: number) =>
  n < 1048576 ? `${Math.round(n / 1024)} kB` : `${(n / 1048576).toFixed(1)} MB`
const verdict = (r: VerifyReport) =>
  `${r.ok ? 'passed' : 'FAILED'}: ${r.items} items, ${r.payloads} attachments${
    r.missing_blobs.length ? `, ${r.missing_blobs.length} missing` : ''
  }${r.search ? `, search for "${r.search.query}" ${r.search.found ? 'found it' : 'found nothing'}` : ''}`

export function Settings() {
  const [s, setS] = useState<SettingsView | null>(null)
  const [folder, setFolder] = useState('')
  const [policy, setPolicy] = useState<WatchedFolder['policy']>('copy')
  const [shortcut, setShortcut] = useState('')
  const [models, setModels] = useState<ModelsStatus | null>(null)
  const [names, setNames] = useState({ embed: '', text: '', vision: '' })
  const [python, setPython] = useState('')
  const [note, setNote] = useState<Record<string, string>>({})
  const runtime = useRuntimeStatus(5000)
  const say = (key: string, text: string) => setNote((n) => ({ ...n, [key]: text }))
  const fail = (key: string) => (e: unknown) =>
    say(key, `failed: ${e instanceof Error ? e.message : String(e)}`)
  useEffect(() => {
    void window.pim.settings().then((v) => {
      setS(v)
      setShortcut(v.shortcut)
      setNames(v.models)
      setPython(v.pythonRuntime ?? '')
    })
    const poll = () => void window.pim.modelsStatus(true).then(setModels)
    poll()
    const id = setInterval(poll, 10_000)
    return () => clearInterval(id)
  }, [])
  if (!s) return null
  const save = async (patch: Partial<SettingsView>) =>
    setS({ ...s, ...(await window.pim.saveSettings(patch)) })
  const row = { display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' } as const
  const input = {
    padding: 6,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontFamily: 'inherit',
  } as const
  return (
    <div style={{ maxWidth: 720, fontSize: 14 }}>
      <h3>Vault</h3>
      <div style={row}>
        <code style={{ flex: 1 }}>{s.vaultDir}</code>
        <Button
          onClick={() =>
            void window.pim
              .switchVault()
              .then((v) => {
                if (v) {
                  setS(v)
                  say('vault', `now using ${v.vaultDir}`)
                }
              })
              .catch(fail('vault'))
          }
        >
          Change folder…
        </Button>
      </div>
      <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 8px' }}>
        An empty folder starts a new vault; a folder with a vault opens it. Not encrypted in v0.1
        (ADR-004); FileVault protects the disk.
        {note.vault && <span style={{ color: colors.accent }}> {note.vault}</span>}
      </p>
      <h3>Backup</h3>
      <div style={row}>
        <Button
          onClick={() =>
            void window.pim
              .backup()
              .then((r) => {
                if (!r) return
                say(
                  'backup',
                  `backed up ${r.manifest.items} items, ${kb(r.manifest.bytes)} of attachments, into ${r.dir}`,
                )
                void window.pim.settings().then(setS)
              })
              .catch(fail('backup'))
          }
        >
          Back up now…
        </Button>
        <Button
          onClick={() =>
            void window.pim
              .testRestore()
              .then((r) => {
                if (r)
                  say(
                    'restore',
                    `restore test ${verdict(r.report)} (backup of ${when(r.manifest.created_at)})`,
                  )
              })
              .catch(fail('restore'))
          }
        >
          Test a restore…
        </Button>
        <Button
          onClick={() =>
            void window.pim
              .restore()
              .then((r) => {
                if (!r) return
                say(
                  'restore',
                  `restored into ${r.target}: ${verdict(r.report)}${r.switched ? '; the app now uses it' : '; the app keeps the current vault'}`,
                )
                void window.pim.settings().then(setS)
              })
              .catch(fail('restore'))
          }
        >
          Restore into a new folder…
        </Button>
      </div>
      <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 8px' }}>
        {s.lastBackup
          ? `Last backup ${when(s.lastBackup.at)} in ${s.lastBackup.dir}.`
          : 'No backup yet.'}{' '}
        A backup is a folder with a copy of the database and every attachment; a restore test opens
        one in a temporary folder, checks every attachment and runs a search.
        {note.backup && <span style={{ color: colors.accent }}> {note.backup}</span>}
        {note.restore && <span style={{ color: colors.accent }}> {note.restore}</span>}
      </p>
      <h3>Export and import</h3>
      <div style={row}>
        <Button
          onClick={() =>
            void window.pim
              .exportItems(null)
              .then((r) => {
                if (r)
                  say('export', `exported ${r.items} items with ${r.blobs} attachments to ${r.dir}`)
              })
              .catch(fail('export'))
          }
        >
          Export everything…
        </Button>
        <Button
          onClick={() =>
            void window.pim
              .importPackage()
              .then((r) => {
                if (r)
                  say(
                    'export',
                    `imported ${r.items} items, ${r.relations} links, ${r.entities} entities; ${r.existing} already here${
                      r.conflicts.length ? `; skipped: ${r.conflicts.join('; ')}` : ''
                    }`,
                  )
              })
              .catch(fail('export'))
          }
        >
          Import a package…
        </Button>
      </div>
      <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 8px' }}>
        An export is a folder of Markdown and JSON with the attachments; it opens without PIM, and
        importing it brings every item back with the same ids and links. The Library exports a
        selection.
        {note.export && <span style={{ color: colors.accent }}> {note.export}</span>}
      </p>
      <h3>Capture shortcut</h3>
      <div style={row}>
        <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} style={input} />
        <Button onClick={() => void save({ shortcut })}>Save</Button>
      </div>
      <h3>Watched folders</h3>
      <ul>
        {s.watchedFolders.map((f) => (
          <li key={f.path} style={row}>
            <code style={{ flex: 1 }}>{f.path}</code>
            <span style={{ color: colors.muted }}>{f.policy}</span>
            <Button
              onClick={() =>
                void save({ watchedFolders: s.watchedFolders.filter((x) => x.path !== f.path) })
              }
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      <div style={row}>
        <input
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          placeholder="/Users/you/Captures"
          style={{ ...input, flex: 1 }}
        />
        <select
          value={policy}
          onChange={(e) => setPolicy(e.target.value as WatchedFolder['policy'])}
          style={input}
        >
          <option value="copy">copy, keep the original</option>
          <option value="move">move, delete the original once preserved</option>
        </select>
        <Button
          onClick={() => {
            if (!folder.trim()) return
            void save({ watchedFolders: [...s.watchedFolders, { path: folder.trim(), policy }] })
            setFolder('')
          }}
        >
          Add
        </Button>
      </div>
      <h3>Models</h3>
      <p style={{ color: models?.ok ? colors.ok : colors.warn }}>
        {models === null
          ? 'checking…'
          : models.ok
            ? `Ollama answers at ${models.url} with ${models.models.length} model${models.models.length === 1 ? '' : 's'}`
            : `Ollama not reachable (${models.error ?? 'no answer'}): search stays lexical, nothing is enriched until it runs`}
      </p>
      {models?.ok && (
        <ul style={{ color: colors.muted, fontSize: 12 }}>
          {models.models.map((m) => (
            <li key={m.name}>
              <code>{m.name}</code> · {m.digest.slice(7, 19)}
            </li>
          ))}
        </ul>
      )}
      {(['embed', 'text', 'vision'] as const).map((k) => (
        <div key={k} style={row}>
          <span style={{ width: 110, color: colors.muted }}>
            {k === 'embed' ? 'embeddings' : k === 'text' ? 'extraction' : 'captions'}
          </span>
          <input
            value={names[k]}
            onChange={(e) => setNames({ ...names, [k]: e.target.value })}
            style={{ ...input, flex: 1 }}
          />
          {models?.ok &&
            !models.models.some((m) => m.name === names[k] || m.name === `${names[k]}:latest`) && (
              <span style={{ color: colors.warn, fontSize: 12 }}>
                not installed: ollama pull {names[k]}
              </span>
            )}
        </div>
      ))}
      <div style={row}>
        <Button onClick={() => void save({ models: names })}>Save models</Button>
        <span style={{ color: colors.muted, fontSize: 12 }}>
          A changed embedding model re-embeds items on their next enrichment; fragments and accepted
          knowledge stay.
        </span>
      </div>
      <h3>Runtime</h3>
      <WhatWorks status={runtime} />
      <div style={row}>
        <span style={{ width: 110, color: colors.muted }}>Python runtime</span>
        <input
          value={python}
          onChange={(e) => setPython(e.target.value)}
          placeholder="/path/to/pim/.tooling/py"
          style={{ ...input, flex: 1 }}
        />
        <Button onClick={() => void save({ pythonRuntime: python.trim() || null })}>Save</Button>
      </div>
      <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 8px' }}>
        The environment that <code>infra/setup.sh</code> builds for audio transcription and OCR. The
        packaged app starts the media worker from it at its next start; with the engine run from the
        repository, compose already uses <code>.tooling/py</code>.
      </p>
      <h3>Capture endpoint</h3>
      <p>
        <code>POST {s.endpoint}</code> with header <code>x-pim-secret</code> and a JSON body such as{' '}
        <code>{'{"kind":"url","url":"https://…"}'}</code>
      </p>
      <p style={{ color: colors.muted, fontSize: 12 }}>
        Secret: <code>{s.captureSecret}</code> (plain settings file in v0.1, Keychain in v0.2)
      </p>
    </div>
  )
}
