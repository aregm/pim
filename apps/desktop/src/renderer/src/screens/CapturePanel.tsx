// biome-ignore-all lint/a11y/noStaticElementInteractions: the whole surface is a drop target by design (UI-1)
import { useEffect, useRef, useState } from 'react'
import { Button, captureDrop, colors } from '../ui.tsx'

/** UI-1: paste or drop, press Return, see the receipt, the panel closes itself. */
export function CapturePanel() {
  const [text, setText] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') window.pim.closePanel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const done = (message: string) => {
    setToast(message)
    setText('')
    setTimeout(() => {
      setToast(null)
      window.pim.closePanel()
    }, 900)
  }
  const fail = (e: unknown) =>
    setToast(`not captured: ${e instanceof Error ? e.message : String(e)}`)

  const submit = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      const r = await window.pim.capture(
        /^https?:\/\/\S+$/.test(value)
          ? { kind: 'url', url: value }
          : { kind: 'text', text: value },
        'panel',
      )
      done(r.existing ? 'already in the vault, capture noted' : `captured, ${r.state}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const clip = async () => {
    setBusy(true)
    try {
      const r = await window.pim.captureClipboard()
      done(r.existing ? 'already in the vault, capture noted' : `clipboard captured, ${r.state}`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }
  const drop = async (e: React.DragEvent) => {
    e.preventDefault()
    try {
      const n = await captureDrop(e.dataTransfer, 'panel')
      done(n ? `captured ${n} item${n === 1 ? '' : 's'}` : 'nothing to capture')
    } catch (err) {
      fail(err)
    }
  }

  return (
    <div
      onDrop={drop}
      onDragOver={(e) => e.preventDefault()}
      style={{
        padding: 16,
        height: '100vh',
        boxSizing: 'border-box',
        fontFamily: 'system-ui',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <strong>Capture</strong>
        <span style={{ fontSize: 12, color: colors.muted }}>
          paste a link, text, or drop files here · Return to save · Esc to close
        </span>
      </div>
      <textarea
        ref={input}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            void submit()
          }
        }}
        placeholder="https://… or any text"
        style={{
          flex: 1,
          resize: 'none',
          fontSize: 14,
          padding: 10,
          borderRadius: 8,
          border: `1px solid ${colors.border}`,
          fontFamily: 'inherit',
        }}
      />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Button primary onClick={() => void submit()}>
          Capture
        </Button>
        <Button onClick={() => void clip()}>Capture clipboard</Button>
        <span
          style={{
            marginLeft: 'auto',
            fontSize: 13,
            color: toast?.startsWith('not') ? colors.bad : colors.ok,
          }}
        >
          {toast}
        </span>
      </div>
    </div>
  )
}
