import { useEffect, useState } from 'react'
import type { ItemView, PayloadView } from '../pim.d.ts'
import { Button, Chip, colors, kindLabel, when } from '../ui.tsx'

const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1048576).toFixed(1)} MB`

/** M1: identity, state, payload manifest. M2 adds the source viewer and fragments. */
export function Item({ item }: { item: ItemView }) {
  const [payloads, setPayloads] = useState<PayloadView[]>([])
  useEffect(() => {
    void window.pim.payloads(item.id).then(setPayloads)
  }, [item.id])
  return (
    <div>
      <h2 style={{ marginTop: 0 }}>
        {item.title ?? item.source_id}
        <Chip state={item.state} />
      </h2>
      <p style={{ color: colors.muted, fontSize: 13 }}>
        {kindLabel(item)} · {item.source_uri ?? item.source_id} · captured {item.capture_count} time
        {item.capture_count === 1 ? '' : 's'}, last {when(item.last_captured_at)}
        {item.duplicate_of && <> · duplicate of an earlier capture</>}
        {item.error && <span style={{ color: colors.bad }}> · {item.error}</span>}
      </p>
      <Button onClick={() => void window.pim.openSource(item.id)}>Open original</Button>
      <h3>Preserved payloads</h3>
      {payloads.length === 0 && <p style={{ color: colors.muted }}>none yet</p>}
      <ul>
        {payloads.map((p) => (
          <li key={p.id} style={{ fontSize: 13 }}>
            <strong>{p.role}</strong> · {p.mime} · {kb(p.byte_length)} ·{' '}
            <code style={{ color: colors.muted }}>{p.blob_id.slice(0, 23)}…</code>
          </li>
        ))}
      </ul>
    </div>
  )
}
