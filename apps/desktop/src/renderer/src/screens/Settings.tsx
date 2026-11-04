import { useEffect, useState } from 'react'
import type { ModelsStatus, SettingsView, WatchedFolder } from '../pim.d.ts'
import { Button, colors } from '../ui.tsx'

export function Settings() {
  const [s, setS] = useState<SettingsView | null>(null)
  const [folder, setFolder] = useState('')
  const [policy, setPolicy] = useState<WatchedFolder['policy']>('copy')
  const [shortcut, setShortcut] = useState('')
  const [models, setModels] = useState<ModelsStatus | null>(null)
  const [names, setNames] = useState({ embed: '', text: '', vision: '' })
  useEffect(() => {
    void window.pim.settings().then((v) => {
      setS(v)
      setShortcut(v.shortcut)
      setNames(v.models)
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
      <p>
        <code>{s.vaultDir}</code>
        <br />
        <span style={{ color: colors.muted, fontSize: 12 }}>
          Not encrypted in v0.1 (ADR-004); FileVault protects the disk.
        </span>
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
