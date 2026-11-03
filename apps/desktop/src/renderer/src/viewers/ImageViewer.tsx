import type { FragmentView } from '../pim.d.ts'

/** PRS-2: the image with one box per recognised line; the selected box is highlighted. */
export function ImageViewer({
  blobId,
  alt,
  fragments,
  selected,
  onSelect,
}: {
  blobId: string
  alt: string
  fragments: FragmentView[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  const boxes = fragments.filter((f) => f.selector.kind === 'box')
  return (
    <div style={{ padding: 16, display: 'flex', justifyContent: 'center' }}>
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <img
          src={window.pim.blobUrl(blobId)}
          alt={alt}
          style={{ maxWidth: '100%', display: 'block' }}
        />
        {boxes.map((f) =>
          f.selector.kind === 'box' ? (
            <button
              key={f.id}
              type="button"
              title={f.text}
              onClick={() => onSelect(f.id)}
              style={{
                position: 'absolute',
                left: `${f.selector.x * 100}%`,
                top: `${f.selector.y * 100}%`,
                width: `${f.selector.w * 100}%`,
                height: `${f.selector.h * 100}%`,
                border: `2px solid ${f.id === selected ? '#e3b800' : 'rgba(47,95,209,.6)'}`,
                background: f.id === selected ? 'rgba(255,242,168,.45)' : 'transparent',
                borderRadius: 3,
                padding: 0,
                cursor: 'pointer',
              }}
            />
          ) : null,
        )}
      </div>
    </div>
  )
}
