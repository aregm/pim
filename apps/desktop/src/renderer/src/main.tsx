// biome-ignore-all lint/a11y/noStaticElementInteractions: the whole surface is a drop target by design (UI-1)
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ItemView, SettingsView } from './pim.d.ts'
import { CapturePanel } from './screens/CapturePanel.tsx'
import { FirstRun } from './screens/FirstRun.tsx'
import { GraphScreen } from './screens/Graph.tsx'
import { Inbox } from './screens/Inbox.tsx'
import { Item } from './screens/Item.tsx'
import { Library } from './screens/Library.tsx'
import { Settings } from './screens/Settings.tsx'
import { captureDrop, colors } from './ui.tsx'

const SCREENS = ['Inbox', 'Library', 'Graph', 'Settings'] as const
type Screen = (typeof SCREENS)[number]

function App() {
  const [screen, setScreen] = useState<Screen>('Inbox')
  const [items, setItems] = useState<ItemView[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [graphFocus, setGraphFocus] = useState<{ kind: 'item' | 'entity'; id: string } | null>(null)
  const openItem = (id: string, fragment?: string | null) => {
    setFocus(fragment ?? null)
    setOpen(id)
  }
  const showInGraph = (id: string) => {
    setGraphFocus({ kind: 'item', id })
    setOpen(null)
    setScreen('Graph')
  }
  const [workers, setWorkers] = useState<string[] | null>(null)
  const [dropNote, setDropNote] = useState<string | null>(null)
  const [settings, setSettings] = useState<SettingsView | null>(null)
  const refresh = useCallback(() => void window.pim.items().then(setItems), [])
  useEffect(() => {
    refresh()
    void window.pim.settings().then(setSettings)
    const off = window.pim.onItemsChanged(refresh)
    const poll = () => window.pim.engineWorkers().then(setWorkers, () => setWorkers(null))
    void poll()
    const id = setInterval(poll, 5000)
    return () => {
      off()
      clearInterval(id)
    }
  }, [refresh])
  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    try {
      const n = await captureDrop(e.dataTransfer, 'drop')
      setDropNote(n ? `captured ${n} item${n === 1 ? '' : 's'}` : 'nothing to capture')
    } catch (err) {
      setDropNote(`not captured: ${err instanceof Error ? err.message : String(err)}`)
    }
    setTimeout(() => setDropNote(null), 2500)
  }
  const current = open ? items.find((i) => i.id === open) : undefined
  if (settings && !settings.firstRunDone)
    return (
      <div
        onDrop={drop}
        onDragOver={(e) => e.preventDefault()}
        style={{ height: '100vh', overflow: 'auto', fontFamily: 'system-ui' }}
      >
        <FirstRun
          settings={settings}
          items={items}
          onSettings={setSettings}
          onDone={() =>
            void window.pim.firstRunDone().then((s) => {
              setSettings(s)
              setScreen('Library')
            })
          }
        />
        {dropNote && (
          <div style={{ position: 'fixed', bottom: 16, left: 24, color: colors.accent }}>
            {dropNote}
          </div>
        )}
      </div>
    )
  return (
    <div
      onDrop={drop}
      onDragOver={(e) => e.preventDefault()}
      style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui', margin: 0 }}
    >
      <nav
        style={{
          width: 180,
          borderRight: `1px solid ${colors.border}`,
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {SCREENS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setScreen(s)
              setOpen(null)
            }}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              border: 0,
              background: s === screen && !open ? '#e8eef8' : 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            {s}
          </button>
        ))}
        <div
          style={{ marginTop: 'auto', fontSize: 11, color: workers ? colors.muted : colors.bad }}
        >
          {workers ? `engine: ${workers.length} workers` : 'engine not reachable'}
          {dropNote && <div style={{ color: colors.accent }}>{dropNote}</div>}
        </div>
      </nav>
      <main
        style={{
          flex: 1,
          padding: 24,
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }}
      >
        {current ? (
          <>
            <button
              type="button"
              onClick={() => setOpen(null)}
              style={{
                background: 'none',
                border: 0,
                color: colors.accent,
                cursor: 'pointer',
                padding: 0,
                marginBottom: 12,
              }}
            >
              ← back
            </button>
            <Item
              item={current}
              focusFragment={focus}
              onShowInGraph={showInGraph}
              onOpenItem={openItem}
            />
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 0 }}>{screen}</h1>
            {screen === 'Inbox' && <Inbox items={items} onOpen={openItem} />}
            {screen === 'Library' && <Library items={items} onOpen={openItem} />}
            {screen === 'Graph' && (
              <GraphScreen
                focus={graphFocus ?? (items[0] ? { kind: 'item', id: items[0].id } : null)}
                onOpenItem={openItem}
                onFocus={setGraphFocus}
              />
            )}
            {screen === 'Settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<StrictMode>{location.hash === '#/capture' ? <CapturePanel /> : <App />}</StrictMode>)
