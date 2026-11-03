import { useCallback, useEffect, useRef, useState } from 'react'
import type { FragmentView } from '../pim.d.ts'

const stamp = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

interface KeyframeIndex {
  duration_ms: number
  keyframes: { at_ms: number; blob_id: string }[]
}

/**
 * PRS-3: the player plus the transcript; a click on a line seeks the player, and playback follows the lines.
 * Video adds the keyframe strip (PRS-4); each thumbnail seeks to its time.
 */
export function MediaViewer({
  blobId,
  mime,
  fragments,
  selected,
  onSelect,
  keyframesBlobId,
}: {
  blobId: string
  mime: string
  fragments: FragmentView[]
  selected: string | null
  onSelect: (id: string) => void
  keyframesBlobId?: string | undefined
}) {
  const media = useRef<HTMLMediaElement>(null)
  const [current, setCurrent] = useState<string | null>(null)
  const [index, setIndex] = useState<KeyframeIndex | null>(null)
  const lines = fragments.filter((f) => f.selector.kind === 'time')
  const seek = useCallback((ms: number) => {
    const el = media.current
    if (!el) return
    el.currentTime = ms / 1000
    void el.play().catch(() => {})
  }, [])
  useEffect(() => {
    const f = fragments.find((x) => x.id === selected)
    if (f?.selector.kind === 'time') seek(f.selector.start_ms)
  }, [selected, fragments, seek])
  useEffect(() => {
    if (!keyframesBlobId) return
    let live = true
    fetch(window.pim.blobUrl(keyframesBlobId))
      .then((r) => r.json())
      .then((j: KeyframeIndex) => live && setIndex(j))
    return () => {
      live = false
    }
  }, [keyframesBlobId])
  const onTime = () => {
    const ms = (media.current?.currentTime ?? 0) * 1000
    const line = lines.find(
      (f) => f.selector.kind === 'time' && ms >= f.selector.start_ms && ms < f.selector.end_ms,
    )
    setCurrent(line?.id ?? null)
  }
  const src = window.pim.blobUrl(blobId)
  const isVideo = mime.startsWith('video/')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ background: '#111', display: 'flex', justifyContent: 'center' }}>
        {isVideo ? (
          <video
            ref={media as React.RefObject<HTMLVideoElement>}
            src={src}
            controls
            onTimeUpdate={onTime}
            style={{ maxHeight: 360, width: '100%' }}
          >
            <track kind="captions" />
          </video>
        ) : (
          <audio
            ref={media as React.RefObject<HTMLAudioElement>}
            src={src}
            controls
            onTimeUpdate={onTime}
            style={{ width: '100%', margin: 12 }}
          >
            <track kind="captions" />
          </audio>
        )}
      </div>
      {index && index.keyframes.length > 0 && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            padding: 8,
            borderBottom: '1px solid #ddd',
          }}
        >
          {index.keyframes.map((k) => (
            <button
              key={k.blob_id}
              type="button"
              onClick={() => seek(k.at_ms)}
              title={stamp(k.at_ms)}
              style={{
                border: 0,
                background: 'none',
                padding: 0,
                cursor: 'pointer',
                flex: '0 0 auto',
                textAlign: 'center',
                fontSize: 11,
              }}
            >
              <img
                src={window.pim.blobUrl(k.blob_id)}
                alt={`keyframe at ${stamp(k.at_ms)}`}
                style={{ height: 54, display: 'block', borderRadius: 4 }}
              />
              {stamp(k.at_ms)}
            </button>
          ))}
        </div>
      )}
      <div style={{ overflow: 'auto', padding: 12, fontSize: 14, lineHeight: 1.6 }}>
        {lines.length === 0 && <p style={{ color: '#6b6b6b' }}>no transcript yet</p>}
        {lines.map((f) => {
          const sel = f.selector
          return sel.kind === 'time' ? (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                onSelect(f.id)
                seek(sel.start_ms)
              }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                border: 0,
                padding: '4px 8px',
                borderRadius: 4,
                cursor: 'pointer',
                font: 'inherit',
                background: f.id === selected ? '#fff2a8' : f.id === current ? '#eef3ff' : 'none',
              }}
            >
              <span style={{ color: '#6b6b6b', fontSize: 12, marginRight: 8 }}>
                {stamp(sel.start_ms)}
              </span>
              {f.text}
            </button>
          ) : null
        })}
      </div>
    </div>
  )
}
