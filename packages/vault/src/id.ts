import { randomBytes } from 'node:crypto'

/** UUIDv7: time-ordered, so ids sort by creation and index well. */
export function uuidv7(now = Date.now()): string {
  const b = randomBytes(16)
  b.writeUIntBE(now, 0, 6)
  b[6] = (0x70 | (b[6] as number & 0x0f)) & 0xff
  b[8] = (0x80 | (b[8] as number & 0x3f)) & 0xff
  const h = b.toString('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
