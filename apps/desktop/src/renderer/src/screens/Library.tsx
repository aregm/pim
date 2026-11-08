import type { ItemView } from '../pim.d.ts'
import { Chip, colors, kindLabel, when } from '../ui.tsx'

export function Library({ items, onOpen }: { items: ItemView[]; onOpen: (id: string) => void }) {
  const shown = items.filter((i) => i.state !== 'duplicate')
  if (!shown.length) return <p style={{ color: colors.muted }}>The vault is empty.</p>
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
      <thead>
        <tr style={{ textAlign: 'left', color: colors.muted, fontSize: 12 }}>
          <th style={{ padding: '6px 0' }}>Kind</th>
          <th>Title</th>
          <th>State</th>
          <th>Captured</th>
        </tr>
      </thead>
      <tbody>
        {shown.map((i) => (
          <tr
            key={i.id}
            onClick={() => onOpen(i.id)}
            style={{ cursor: 'pointer', borderTop: `1px solid ${colors.border}` }}
          >
            <td style={{ padding: '8px 0', color: colors.muted }}>{kindLabel(i)}</td>
            <td>{i.title ?? i.source_id}</td>
            <td>
              <Chip state={i.state} />
            </td>
            <td style={{ color: colors.muted }}>{when(i.last_captured_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
