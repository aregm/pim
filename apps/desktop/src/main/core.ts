import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { statSync, unlinkSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { type CaptureRequest, type Receipt, WebPreserveResult } from '@pim/contracts'
import { type ItemRow, type JobRow, Vault } from '@pim/vault'
import type { IIIClient } from 'iii-sdk'

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.heic': 'image/heic',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.html': 'text/html',
  '.eml': 'message/rfc822',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
}
export const mimeFor = (path: string) =>
  MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

const normalizeUrl = (u: string) => {
  const url = new URL(u)
  url.hash = ''
  return url.href
}
const sha256 = (b: Uint8Array) => `sha256:${createHash('sha256').update(b).digest('hex')}`

/**
 * The trusted core: the only writer to the vault. Receipts are synchronous and small;
 * everything that moves bytes or calls a worker is a job (ADR-003).
 */
export class Core extends EventEmitter {
  readonly vault: Vault
  private timer: NodeJS.Timeout | undefined
  private running = 0
  /** Originals to delete after a `move` capture from a watched folder. */
  private readonly moveAfter = new Map<string, string>()

  private readonly iii: IIIClient

  constructor(vaultDir: string, iii: IIIClient) {
    super()
    this.iii = iii
    this.vault = new Vault(vaultDir)
  }

  /** CAP-1: durable receipt first; preservation follows as a job unless the bytes are already in hand. */
  async receive(
    req: CaptureRequest,
    surface: string,
    opts: { moveOriginal?: boolean } = {},
  ): Promise<Receipt> {
    let receipt: Receipt
    switch (req.kind) {
      case 'url': {
        const url = normalizeUrl(req.url)
        receipt = this.vault.receipt({
          source_kind: 'url',
          source_id: url,
          source_uri: url,
          title: url,
          surface,
          stages: ['preserve'],
        })
        break
      }
      case 'text': {
        const bytes = Buffer.from(req.text, 'utf8')
        const hash = sha256(bytes)
        const title = req.title ?? req.text.split('\n')[0]?.slice(0, 80) ?? 'text'
        receipt = this.vault.receipt({
          source_kind: 'text',
          source_id: hash,
          title,
          content_hash: hash,
          surface,
        })
        if (!receipt.existing) {
          const stored = await this.vault.blobs.putBuffer(bytes)
          this.vault.addPayload(
            receipt.item_id,
            'raw',
            stored.blob_id,
            'text/plain',
            stored.byte_length,
          )
          receipt = { ...receipt, state: this.vault.markPreserved(receipt.item_id, hash) }
        }
        break
      }
      case 'file': {
        const st = statSync(req.path)
        const source_id = `file:${req.path}:${st.size}:${Math.floor(st.mtimeMs)}`
        receipt = this.vault.receipt({
          source_kind: 'file',
          source_id,
          source_uri: `file://${req.path}`,
          title: basename(req.path),
          surface,
          original_path: req.path,
          stages: ['preserve'],
        })
        if (opts.moveOriginal && !receipt.existing) this.moveAfter.set(receipt.item_id, req.path)
        break
      }
    }
    this.emit('changed')
    return receipt
  }

  /** Captures an image already in memory (clipboard). */
  async receiveImage(png: Uint8Array, surface: string): Promise<Receipt> {
    const hash = sha256(png)
    let receipt = this.vault.receipt({
      source_kind: 'image',
      source_id: hash,
      title: `Image ${new Date().toLocaleString()}`,
      content_hash: hash,
      surface,
    })
    if (!receipt.existing) {
      const stored = await this.vault.blobs.putBuffer(png)
      this.vault.addPayload(receipt.item_id, 'raw', stored.blob_id, 'image/png', stored.byte_length)
      receipt = { ...receipt, state: this.vault.markPreserved(receipt.item_id, hash) }
    }
    this.emit('changed')
    return receipt
  }

  items(): ItemRow[] {
    return this.vault.items()
  }

  retry(itemId: string) {
    this.vault.retry(itemId)
    this.emit('changed')
  }

  start() {
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.vault.close()
  }

  private async tick() {
    while (this.running < 2) {
      const job = this.vault.claimJob('preserve')
      if (!job) return
      this.running++
      void this.run(job).finally(() => {
        this.running--
      })
    }
  }

  private async run(job: JobRow) {
    const item = this.vault.item(job.artifact_id)
    if (!item) {
      this.vault.completeJob(job.id)
      return
    }
    try {
      if (item.source_kind === 'file') await this.preserveFile(item)
      else if (item.source_kind === 'url') await this.preserveUrl(item)
      this.vault.completeJob(job.id)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      const state = this.vault.failJob(job.id, message)
      if (state === 'failed') this.vault.markFailed(item.id, message)
      console.error(
        JSON.stringify({
          event: 'job.error',
          stage: job.stage,
          item: item.id,
          attempt: job.attempts + 1,
          message,
        }),
      )
    }
    this.emit('changed')
  }

  private async preserveFile(item: ItemRow) {
    const path = item.source_uri?.replace(/^file:\/\//, '') ?? ''
    const stored = await this.vault.blobs.putFile(path)
    this.vault.addPayload(item.id, 'raw', stored.blob_id, mimeFor(path), stored.byte_length)
    this.vault.markPreserved(item.id, stored.blob_id)
    const original = this.moveAfter.get(item.id)
    if (original) {
      this.moveAfter.delete(item.id)
      unlinkSync(original)
    }
  }

  private async preserveUrl(item: ItemRow) {
    const result = WebPreserveResult.parse(
      await this.iii.trigger({
        function_id: 'preserve::web',
        payload: { url: item.source_uri },
        timeoutMs: 90_000,
      }),
    )
    const raw = await this.vault.blobs.putBuffer(Buffer.from(result.raw_html, 'utf8'))
    this.vault.addPayload(item.id, 'raw', raw.blob_id, 'text/html', raw.byte_length)
    if (result.readable_html) {
      const readable = await this.vault.blobs.putBuffer(Buffer.from(result.readable_html, 'utf8'))
      this.vault.addPayload(
        item.id,
        'normalized',
        readable.blob_id,
        'text/html',
        readable.byte_length,
      )
    }
    if (result.screenshot_png_b64) {
      const shot = await this.vault.blobs.putBuffer(
        Buffer.from(result.screenshot_png_b64, 'base64'),
      )
      this.vault.addPayload(item.id, 'screenshot', shot.blob_id, 'image/png', shot.byte_length)
    }
    const meta = await this.vault.blobs.putBuffer(
      Buffer.from(JSON.stringify({ ...result.metadata, final_url: result.final_url }), 'utf8'),
    )
    this.vault.addPayload(item.id, 'metadata', meta.blob_id, 'application/json', meta.byte_length)
    this.vault.markPreserved(item.id, raw.blob_id, result.title || undefined)
    if (result.title)
      this.vault.db.prepare('UPDATE item SET title = ? WHERE id = ?').run(result.title, item.id)
  }
}
