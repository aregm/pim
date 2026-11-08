import type { ItemView } from '../pim.d.ts'
import { Button, Chip, colors, kindLabel, when } from '../ui.tsx'

const DAY = 24 * 3600 * 1000

/** The inbox is for exceptions and what just arrived: failed items, items still being preserved, and the last day of captures. */
export function Inbox({ items, onOpen }: { items: ItemView[]; onOpen: (id: string) => void }) {
  const recent = Date.now() - DAY
  const shown = items.filter(
    (i) =>
      i.state === 'failed' ||
      i.state === 'received' ||
      new Date(i.last_captured_at).getTime() > recent,
  )
  if (!shown.length)
    return (
      <p style={{ color: colors.muted }}>
        Nothing new. Press the capture shortcut or drop a file anywhere in this window.
      </p>
    )
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {shown.map((i) => (
        <li
          key={i.id}
          style={{
            padding: '10px 0',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={() => onOpen(i.id)}
            style={{
              flex: 1,
              textAlign: 'left',
              background: 'none',
              border: 0,
              cursor: 'pointer',
              fontSize: 14,
              padding: 0,
            }}
          >
            <span style={{ fontSize: 12, color: colors.muted, marginRight: 8 }}>
              {kindLabel(i)}
            </span>
            {i.title ?? i.source_id}
            <Chip state={i.state} />
            {i.capture_count > 1 && (
              <span style={{ fontSize: 12, color: colors.muted, marginLeft: 8 }}>
                captured {i.capture_count} times
              </span>
            )}
            <div style={{ fontSize: 12, color: colors.muted }}>
              {when(i.last_captured_at)}
              {i.error && <span style={{ color: colors.bad }}> · {i.error}</span>}
            </div>
          </button>
          {i.state === 'failed' && (
            <Button onClick={() => void window.pim.retry(i.id)}>Retry</Button>
          )}
          <Button onClick={() => void window.pim.openSource(i.id)}>Open original</Button>
        </li>
      ))}
    </ul>
  )
}
