import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

const SCREENS = ['Inbox', 'Library', 'Item', 'Graph', 'Settings'] as const

function App() {
  const [screen, setScreen] = useState<(typeof SCREENS)[number]>('Inbox')
  const [workers, setWorkers] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const refresh = () =>
      window.pim
        .engineWorkers()
        .then((w) => {
          setWorkers(w)
          setError(null)
        })
        .catch((e: Error) => setError(e.message))
    refresh()
    const id = setInterval(refresh, 3000)
    return () => clearInterval(id)
  }, [])
  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui', margin: 0 }}>
      <nav style={{ width: 180, borderRight: '1px solid #ddd', padding: 12 }}>
        {SCREENS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScreen(s)}
            style={{
              display: 'block',
              width: '100%',
              textAlign: 'left',
              padding: '8px 10px',
              border: 0,
              background: s === screen ? '#e8eef8' : 'transparent',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            {s}
          </button>
        ))}
      </nav>
      <main style={{ flex: 1, padding: 24 }}>
        <h1 style={{ marginTop: 0 }}>{screen}</h1>
        <p style={{ color: '#666' }}>M0: the shell. Capture and the inbox arrive in M1.</p>
        <section style={{ marginTop: 24, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
          <strong>Engine</strong>
          {error && <p style={{ color: '#b00' }}>not reachable: {error}</p>}
          {workers && (
            <p>
              {workers.length} workers connected: {workers.join(', ')}
            </p>
          )}
          {!workers && !error && <p>connecting…</p>}
        </section>
      </main>
    </div>
  )
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
