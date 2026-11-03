import { useEffect, useState } from 'react'
import type { SettingsView, WatchedFolder } from '../pim.d.ts'
import { Button, colors } from '../ui.tsx'

export function Settings() {
  const [s, setS] = useState<SettingsView | null>(null)
  const [folder, setFolder] = useState('')
  const [policy, setPolicy] = useState<WatchedFolder['policy']>('copy')
  const [shortcut, setShortcut] = useState('')
  useEffect(() => {
    void window.pim.settings().then((v) => {
      setS(v)
      setShortcut(v.shortcut)
    })
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
