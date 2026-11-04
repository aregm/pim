import type { CSSProperties, ReactNode } from 'react'
import type { ItemView, Selector } from './pim.d.ts'

export const colors = {
  border: '#dcdcdc',
  muted: '#6b6b6b',
  accent: '#2f5fd1',
  bad: '#b00020',
  ok: '#1b7f3b',
  warn: '#9a6700',
}

export const Chip = ({ state }: { state: ItemView['state'] }) => {
  const color = {
    received: colors.warn,
    preserved: colors.ok,
    failed: colors.bad,
    duplicate: colors.muted,
  }[state]
  return (
    <span
      style={{
        fontSize: 12,
        color,
        border: `1px solid ${color}`,
        borderRadius: 10,
        padding: '1px 8px',
        marginLeft: 8,
      }}
    >
      {state}
    </span>
  )
}

export const Button = ({
  children,
  onClick,
  primary,
  style,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  style?: CSSProperties
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      padding: '6px 12px',
      borderRadius: 6,
      border: `1px solid ${primary ? colors.accent : colors.border}`,
      background: primary ? colors.accent : 'white',
      color: primary ? 'white' : 'inherit',
      cursor: 'pointer',
      ...style,
    }}
  >
    {children}
  </button>
)

export const kindLabel = (item: ItemView) =>
  ({ url: 'web', text: 'text', file: 'file', image: 'image' })[item.source_kind]
export const when = (iso: string) => new Date(iso).toLocaleString()
/** Where a fragment sits in its item, short enough for a list row. */
export const where = (s: Selector) =>
  s.kind === 'page'
    ? `p. ${s.page}`
    : s.kind === 'time'
      ? `${Math.floor(s.start_ms / 60000)}:${String(Math.floor(s.start_ms / 1000) % 60).padStart(2, '0')}`
      : s.kind === 'block'
        ? `¶ ${s.index + 1}`
        : s.kind === 'char'
          ? `chars ${s.start}–${s.end}`
          : 'region'

/** Turns dropped files, URLs or text into capture requests and sends them. Shared by the panel and the main window. */
export async function captureDrop(dt: DataTransfer, surface: string) {
  const files = Array.from(dt.files)
  if (files.length) {
    for (const f of files)
      await window.pim.capture({ kind: 'file', path: window.pim.pathForFile(f) }, surface)
    return files.length
  }
  const uri = dt
    .getData('text/uri-list')
    .split('\n')
    .find((l) => l && !l.startsWith('#'))
  if (uri && /^https?:\/\//.test(uri)) {
    await window.pim.capture({ kind: 'url', url: uri.trim() }, surface)
    return 1
  }
  const text = dt.getData('text/plain').trim()
  if (text) {
    await window.pim.capture(
      /^https?:\/\/\S+$/.test(text) ? { kind: 'url', url: text } : { kind: 'text', text },
      surface,
    )
    return 1
  }
  return 0
}
