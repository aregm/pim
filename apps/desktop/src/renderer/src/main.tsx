// biome-ignore-all lint/a11y/noStaticElementInteractions: the whole surface is a drop target by design (UI-1)
import { StrictMode, useCallback, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { ItemView } from './pim.d.ts'
import { CapturePanel } from './screens/CapturePanel.tsx'
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
  const [workers, setWorkers] = useState<string[] | null>(null)
  const [dropNote, setDropNote] = useState<string | null>(null)
  const refresh = useCallback(() => void window.pim.items().then(setItems), [])
  useEffect(() => {
    refresh()
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
      <main style={{ flex: 1, padding: 24, overflow: 'auto' }}>
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
            <Item item={current} />
          </>
        ) : (
          <>
            <h1 style={{ marginTop: 0 }}>{screen}</h1>
            {screen === 'Inbox' && <Inbox items={items} onOpen={setOpen} />}
            {screen === 'Library' && <Library items={items} onOpen={setOpen} />}
            {screen === 'Graph' && <p style={{ color: colors.muted }}>The graph arrives in M4.</p>}
            {screen === 'Settings' && <Settings />}
          </>
        )}
      </main>
    </div>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<StrictMode>{location.hash === '#/capture' ? <CapturePanel /> : <App />}</StrictMode>)
