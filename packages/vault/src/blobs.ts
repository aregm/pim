import { createHash } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs'
import { open } from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { uuidv7 } from './id.ts'

export interface StoredBlob {
  blob_id: string
  byte_length: number
  existed: boolean
}

/**
 * Content-addressed files: staged write, fsync, atomic rename, deduplicated by hash (ADR-004 keeps this layout).
 * `blob_id` is `sha256:<hex>`; the file lives at `<dir>/<hex[0..2]>/<hex>`.
 */
export class BlobStore {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
    mkdirSync(join(dir, 'tmp'), { recursive: true })
  }

  pathFor(blobId: string): string {
    const hex = blobId.replace(/^sha256:/, '')
    return join(this.dir, hex.slice(0, 2), hex)
  }

  has(blobId: string): boolean {
    return existsSync(this.pathFor(blobId))
  }

  async putFile(sourcePath: string): Promise<StoredBlob> {
    return this.putStream(createReadStream(sourcePath))
  }

  async putBuffer(bytes: Uint8Array): Promise<StoredBlob> {
    const hash = createHash('sha256').update(bytes).digest('hex')
    return this.commitTemp(await this.writeTemp(bytes), hash, bytes.byteLength)
  }

  async putStream(source: NodeJS.ReadableStream): Promise<StoredBlob> {
    const temp = join(this.dir, 'tmp', uuidv7())
    const hash = createHash('sha256')
    let length = 0
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        hash.update(chunk)
        length += chunk.length
        cb(null, chunk)
      },
    })
    await pipeline(source, counter, createWriteStream(temp))
    return this.commitTemp(temp, hash.digest('hex'), length)
  }

  private async writeTemp(bytes: Uint8Array): Promise<string> {
    const temp = join(this.dir, 'tmp', uuidv7())
    const fh = await open(temp, 'w')
    try {
      await fh.writeFile(bytes)
    } finally {
      await fh.close()
    }
    return temp
  }

  private async commitTemp(temp: string, hex: string, byteLength: number): Promise<StoredBlob> {
    const blob_id = `sha256:${hex}`
    const final = this.pathFor(blob_id)
    if (existsSync(final)) {
      unlinkSync(temp)
      return { blob_id, byte_length: statSync(final).size, existed: true }
    }
    const fh = await open(temp, 'r+')
    try {
      await fh.sync()
    } finally {
      await fh.close()
    }
    mkdirSync(join(this.dir, hex.slice(0, 2)), { recursive: true })
    renameSync(temp, final)
    return { blob_id, byte_length: byteLength, existed: false }
  }
}
