import type { DatabaseSync } from 'node:sqlite'
import { getLoadablePath } from 'sqlite-vec'

export type VectorKind = 'fragment' | 'artifact' | 'entity'

export interface Neighbour {
  id: string
  distance: number
}

/**
 * Vectors in sqlite-vec virtual tables, one per kind and dimension, created on first use so that a changed
 * embedding model (another dimension) never touches older tables (PRS-5). When the extension cannot load, every
 * query answers empty and the rest of the vault keeps working (PRS-8).
 */
export class Vectors {
  readonly available: boolean
  readonly error: string | null
  private readonly db: DatabaseSync
  private readonly known = new Set<string>()

  constructor(db: DatabaseSync) {
    this.db = db
    let error: string | null = null
    try {
      db.loadExtension(getLoadablePath())
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }
    db.enableLoadExtension(false)
    this.available = error === null
    this.error = error
  }

  private table(kind: VectorKind, dim: number) {
    const name = `vec_${kind}_${dim}`
    if (!this.known.has(name)) {
      this.db.exec(
        `CREATE VIRTUAL TABLE IF NOT EXISTS ${name} USING vec0(id TEXT PRIMARY KEY, v FLOAT[${dim}] distance_metric=cosine)`,
      )
      this.known.add(name)
    }
    return name
  }

  private tables(kind: VectorKind): string[] {
    return (
      this.db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE ?")
        .all(`vec_${kind}_%`) as { name: string }[]
    )
      .map((r) => r.name)
      .filter((n) => /^vec_[a-z]+_\d+$/.test(n))
  }

  put(kind: VectorKind, dim: number, rows: { id: string; vector: Float32Array }[]) {
    if (!this.available || rows.length === 0) return
    const t = this.table(kind, dim)
    const del = this.db.prepare(`DELETE FROM ${t} WHERE id = ?`)
    const ins = this.db.prepare(`INSERT INTO ${t} (id, v) VALUES (?, ?)`)
    for (const r of rows) {
      if (r.vector.length !== dim) throw new Error(`vector of ${r.vector.length} for dim ${dim}`)
      del.run(r.id)
      ins.run(r.id, Buffer.from(r.vector.buffer, r.vector.byteOffset, r.vector.byteLength))
    }
  }

  forget(kind: VectorKind, ids: string[]) {
    if (!this.available || ids.length === 0) return
    for (const t of this.tables(kind)) {
      const del = this.db.prepare(`DELETE FROM ${t} WHERE id = ?`)
      for (const id of ids) del.run(id)
    }
  }

  get(kind: VectorKind, dim: number, ids: string[]): Map<string, Float32Array> {
    const out = new Map<string, Float32Array>()
    if (!this.available || ids.length === 0) return out
    const t = this.table(kind, dim)
    const sel = this.db.prepare(`SELECT v FROM ${t} WHERE id = ?`)
    for (const id of ids) {
      const row = sel.get(id) as { v: Uint8Array } | undefined
      if (row) out.set(id, toFloat32(row.v))
    }
    return out
  }

  /** The k nearest ids by cosine distance, excluding the given ids. */
  nearest(
    kind: VectorKind,
    vector: Float32Array,
    k: number,
    exclude: Set<string> = new Set(),
  ): Neighbour[] {
    if (!this.available || k <= 0) return []
    const t = this.table(kind, vector.length)
    const rows = this.db
      .prepare(`SELECT id, distance FROM ${t} WHERE v MATCH ? AND k = ? ORDER BY distance`)
      .all(
        Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
        k + exclude.size,
      ) as unknown as Neighbour[]
    return rows.filter((r) => !exclude.has(r.id)).slice(0, k)
  }
}

export const toFloat32 = (bytes: Uint8Array) =>
  new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))

/** The normalised mean of vectors: the artifact-level centroid of specification 6.4 step 6. */
export function centroid(vectors: Float32Array[], dim: number): Float32Array {
  const c = new Float32Array(dim)
  for (const v of vectors) for (let i = 0; i < dim; i++) c[i] = (c[i] as number) + (v[i] as number)
  let norm = 0
  for (let i = 0; i < dim; i++) norm += (c[i] as number) ** 2
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < dim; i++) c[i] = (c[i] as number) / norm
  return c
}
