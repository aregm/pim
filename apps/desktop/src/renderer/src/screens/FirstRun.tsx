import { useEffect, useState } from 'react'
import type { ItemView, SearchHit, SettingsView } from '../pim.d.ts'
import { Button, Chip, colors } from '../ui.tsx'
import { useRuntimeStatus, WhatWorks } from './Runtime.tsx'

const SAMPLE =
  'Welcome to PIM. This note is your first item. Everything you capture stays on this Mac: the original bytes, what was read out of them, and the links between them. Search for the word harbour to find this note again.'

/**
 * UI-7: choose the vault folder, confirm the shortcut, see what works, capture one item and find it, all on
 * one screen, no configuration beyond the folder. The app logs the time to the first searchable item.
 */
export function FirstRun({
  settings,
  items,
  onSettings,
  onDone,
}: {
  settings: SettingsView
  items: ItemView[]
  onSettings: (s: SettingsView) => void
  onDone: () => void
}) {
  const status = useRuntimeStatus(3000)
  const [shortcut, setShortcut] = useState(settings.shortcut)
  const [text, setText] = useState(SAMPLE)
  const [note, setNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setHits(null)
      return
    }
    const id = setTimeout(() => void window.pim.search(q).then(setHits), 120)
    return () => clearTimeout(id)
  }, [query])
  const captured = items.filter((i) => i.state !== 'duplicate')
  const input = {
    padding: 6,
    border: `1px solid ${colors.border}`,
    borderRadius: 6,
    fontFamily: 'inherit',
    fontSize: 14,
  } as const
  const step = (n: number, title: string) => (
    <h3 style={{ margin: '20px 0 6px' }}>
      <span style={{ color: colors.accent, marginRight: 8 }}>{n}</span>
      {title}
    </h3>
  )
  const capture = async () => {
    const value = text.trim()
    if (!value) return
    try {
      const r = await window.pim.capture({ kind: 'text', text: value }, 'first-run')
      setNote(r.existing ? 'already in the vault' : `captured, ${r.state}`)
    } catch (e) {
      setNote(`not captured: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 24, fontSize: 14 }}>
      <h1 style={{ marginTop: 0 }}>Welcome</h1>
      <p style={{ color: colors.muted }}>
        Five short steps. Nothing leaves this Mac; nothing here needs a model.
      </p>
      {step(1, 'Your vault')}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <code style={{ flex: 1, fontSize: 13 }}>{settings.vaultDir}</code>
        <Button
          onClick={() =>
            void window.pim.switchVault().then((s) => {
              if (s) onSettings(s)
            })
          }
        >
          Change folder…
        </Button>
      </div>
      <p style={{ color: colors.muted, fontSize: 12, margin: '4px 0 0' }}>
        One folder holds everything: the database and the original files. Not encrypted in v0.1;
        FileVault protects the disk.
      </p>
      {step(2, 'Capture shortcut')}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input value={shortcut} onChange={(e) => setShortcut(e.target.value)} style={input} />
        <Button
          onClick={() => void window.pim.saveSettings({ shortcut }).then((s) => onSettings(s))}
        >
          Save
        </Button>
        <span style={{ color: colors.muted, fontSize: 12 }}>
          opens the capture panel from any app: paste or drop, press Return
        </span>
      </div>
      {step(3, 'What works right now')}
      <WhatWorks status={status} />
      {step(4, 'Capture one item')}
      <p style={{ color: colors.muted, fontSize: 12, margin: '0 0 6px' }}>
        Edit the text or keep it, then capture. You can also drop a file or a link anywhere on this
        window.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        style={{ ...input, width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
        <Button primary onClick={() => void capture()}>
          Capture
        </Button>
        {note && <span style={{ color: colors.accent }}>{note}</span>}
      </div>
      {captured.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0' }}>
          {captured.slice(0, 5).map((i) => (
            <li key={i.id} style={{ padding: '2px 0' }}>
              {i.title ?? i.source_id}
              <Chip state={i.state} />
            </li>
          ))}
        </ul>
      )}
      {step(5, 'Find it again')}
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={
          captured.length ? 'a word you remember, e.g. harbour' : 'capture something first'
        }
        disabled={captured.length === 0}
        style={{ ...input, width: '100%', boxSizing: 'border-box' }}
      />
      {hits && (
        <p style={{ color: hits.length ? colors.ok : colors.muted, margin: '6px 0 0' }}>
          {hits.length
            ? `found: ${hits.map((h) => h.title ?? h.item_id).join(', ')}`
            : 'nothing yet; a new item is searchable once its text is read, a few seconds for a note'}
        </p>
      )}
      <div style={{ marginTop: 28, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button primary onClick={onDone}>
          Done, open the library
        </Button>
        <span style={{ color: colors.muted, fontSize: 12 }}>
          Settings has everything on this page, plus backup and export.
        </span>
      </div>
    </div>
  )
}
