import { useEffect, useState } from 'react'
import type { RuntimeStatus } from '../pim.d.ts'
import { colors } from '../ui.tsx'

/** Polls what the engine, the workers and the models can do right now; shared by first run and Settings. */
export function useRuntimeStatus(intervalMs = 5000) {
  const [status, setStatus] = useState<RuntimeStatus | null>(null)
  useEffect(() => {
    let live = true
    const poll = () =>
      void window.pim.runtimeStatus().then((s) => {
        if (live) setStatus(s)
      })
    poll()
    const id = setInterval(poll, intervalMs)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [intervalMs])
  return status
}

const Line = ({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) => (
  <li style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
    <span style={{ color: ok === null ? colors.muted : ok ? colors.ok : colors.warn, width: 14 }}>
      {ok === null ? '·' : ok ? '✓' : '–'}
    </span>
    <span style={{ width: 170 }}>{label}</span>
    <span style={{ color: colors.muted, fontSize: 13 }}>{detail}</span>
  </li>
)

/** First-run promise: say what works without anything else installed (spec 4, First run). */
export function WhatWorks({ status }: { status: RuntimeStatus | null }) {
  if (!status) return <p style={{ color: colors.muted }}>checking…</p>
  const has = (w: string) => status.engine.workers.includes(w)
  const engine = status.engine.reachable
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, fontSize: 14 }}>
      <Line
        ok={engine}
        label="Engine"
        detail={
          engine
            ? `${status.engine.bundled ? 'started by the app' : 'running'} at ${status.engine.url}, ${status.engine.workers.length} workers`
            : `nothing answers at ${status.engine.url}; start it with npm run engine, or use the packaged app`
        }
      />
      <Line
        ok={engine ? has('parse') : null}
        label="Text, PDF, HTML, email"
        detail={has('parse') ? 'parsed into searchable passages' : 'parse worker not running'}
      />
      <Line
        ok={engine ? has('web-preserve') : null}
        label="Web pages"
        detail={
          has('web-preserve')
            ? 'saved with a readable copy and a screenshot'
            : 'web-preserve worker not running'
        }
      />
      <Line
        ok={engine ? has('media') : null}
        label="Audio, video, photos"
        detail={
          has('media')
            ? 'transcribed and OCR-read on this Mac'
            : status.python.present
              ? 'media worker not running yet'
              : 'needs the Python runtime: run infra/setup.sh, then set its path in Settings'
        }
      />
      <Line
        ok={status.models.ok}
        label="Summaries, tags, captions"
        detail={
          status.models.ok
            ? `Ollama with ${status.models.models.length} models; everything a model writes is a suggestion`
            : 'Ollama not running: search stays lexical, nothing is summarised until it runs'
        }
      />
    </ul>
  )
}
