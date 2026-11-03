import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  type CaptureRequest,
  Extraction,
  Keyframes,
  type Receipt,
  WebPreserveResult,
} from '@pim/contracts'
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
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
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
    const added = this.vault.backfill('extract')
    if (added) console.log(JSON.stringify({ event: 'jobs.backfill', stage: 'extract', added }))
    this.timer = setInterval(() => void this.tick(), 1000)
    void this.tick()
  }

  search(query: string, limit?: number) {
    return this.vault.search(query, limit)
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.vault.close()
  }

  private async tick() {
    while (this.running < 2) {
      const job = this.vault.claimJob('preserve') ?? this.vault.claimJob('extract')
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
    const heartbeat = setInterval(() => this.vault.extendLease(job.id), 20_000)
    try {
      if (job.stage === 'extract') await this.extract(item)
      else if (item.source_kind === 'file') await this.preserveFile(item)
      else if (item.source_kind === 'url') await this.preserveUrl(item)
      this.vault.completeJob(job.id)
      if (job.stage === 'preserve' && this.vault.item(item.id)?.state === 'preserved')
        this.vault.enqueue(item.id, 'extract')
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
    } finally {
      clearInterval(heartbeat)
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

  /** PRS-1 to PRS-4: fragments from the payload the viewer shows; the processor depends on the MIME type. */
  private async extract(item: ItemRow) {
    const payloads = this.vault.payloads(item.id)
    const source =
      payloads.find((p) => p.role === 'normalized' && p.mime === 'text/html') ??
      payloads.find((p) => p.role === 'raw')
    if (!source) throw new Error('no payload to extract from')
    const path = this.vault.blobs.pathFor(source.blob_id)
    const type = source.mime.split('/')[0]
    if (type === 'audio' || type === 'video') {
      await this.runProcessor(item, source.id, 'media::transcribe', '0.3.0', { path }, 1_800_000)
      if (type === 'video') await this.keyframes(item, path)
      return
    }
    if (type === 'image') {
      await this.runProcessor(item, source.id, 'media::ocr', '0.3.0', { path }, 300_000)
      return
    }
    const count = await this.runProcessor(
      item,
      source.id,
      'extract::text',
      '0.2.0',
      { artifact_id: item.id, payload_id: source.id, mime: source.mime, path },
      120_000,
    )
    // a PDF with no text layer is a scan: recognise the rendered pages
    if (source.mime === 'application/pdf' && count === 0)
      await this.runProcessor(item, source.id, 'media::ocr_pdf', '0.3.0', { path }, 900_000)
  }

  /** One processing run per worker call; fragments replace the processor's earlier ones. Returns the fragment count. */
  private async runProcessor(
    item: ItemRow,
    payloadId: string,
    processor: string,
    version: string,
    payload: unknown,
    timeoutMs: number,
  ) {
    const run = this.vault.startRun(item.id, processor, version)
    try {
      const result = Extraction.parse(
        await this.iii.trigger({ function_id: processor, payload, timeoutMs }),
      )
      let target = payloadId
      if (result.normalized_text !== undefined) {
        const stored = await this.vault.blobs.putBuffer(Buffer.from(result.normalized_text, 'utf8'))
        const existing = this.vault
          .payloads(item.id)
          .find((p) => p.role === 'normalized' && p.mime === 'text/plain')
        target = (
          existing ??
          this.vault.addPayload(
            item.id,
            'normalized',
            stored.blob_id,
            'text/plain',
            stored.byte_length,
          )
        ).id
      }
      this.vault.replaceFragments(item.id, target, run, processor, result.fragments)
      this.vault.finishRun(run)
      return result.fragments.length
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  /** PRS-4: keyframes at scene changes, each a payload with its time in the index payload. */
  private async keyframes(item: ItemRow, path: string) {
    const run = this.vault.startRun(item.id, 'media::keyframes', '0.3.0')
    const scratch = join(this.vault.dir, 'scratch', run)
    mkdirSync(scratch, { recursive: true })
    try {
      const result = Keyframes.parse(
        await this.iii.trigger({
          function_id: 'media::keyframes',
          payload: { path, scratch_dir: scratch, max_frames: 40 },
          timeoutMs: 900_000,
        }),
      )
      const index = []
      for (const kf of result.keyframes) {
        const stored = await this.vault.blobs.putFile(kf.path)
        this.vault.addPayload(item.id, 'keyframe', stored.blob_id, 'image/jpeg', stored.byte_length)
        index.push({ at_ms: kf.at_ms, blob_id: stored.blob_id })
      }
      const json = Buffer.from(
        JSON.stringify({ duration_ms: result.duration_ms, keyframes: index }),
        'utf8',
      )
      const stored = await this.vault.blobs.putBuffer(json)
      this.vault.addPayload(
        item.id,
        'keyframes',
        stored.blob_id,
        'application/json',
        stored.byte_length,
      )
      this.vault.finishRun(run)
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  }
}
