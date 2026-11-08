import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, rmSync, statSync, unlinkSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import {
  CaptionResult,
  type CaptureRequest,
  EmbedResult,
  Extraction,
  Keyframes,
  ModelsStatus,
  type Receipt,
  SchemaExtractResult,
  type Selector,
  WebPreserveResult,
} from '@pim/contracts'
import { type EntityRow, type ItemRow, type JobRow, type SearchHit, Vault } from '@pim/vault'
import type { IIIClient } from 'iii-sdk'

/** Ollama model names; the digests are read from Ollama and recorded on every run (D6, MET-1). */
export interface ModelSettings {
  embed: string
  text: string
  vision: string
}
export const DEFAULT_MODELS: ModelSettings = {
  embed: 'nomic-embed-text',
  text: 'qwen2.5:7b',
  vision: 'qwen2.5vl:7b',
}
/** Prefix of the job note left when the enrich stage had nothing to work with; such jobs wake when models appear. */
const SKIPPED = 'skipped: '
const EMBED_BATCH = 64
/** Cosine distance under which two artifact centroids count as semantic neighbours. */
const SEMANTIC_MAX_DISTANCE = 0.3
/** Cosine distance under which two entity names of one kind are proposed as possible duplicates. */
const DUPLICATE_MAX_DISTANCE = 0.15

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
  private modelsTimer: NodeJS.Timeout | undefined
  private running = 0
  /** Model stages run one at a time so a slot stays free for the quick, deterministic stages (UI-2). */
  private enriching = 0
  models: ModelSettings = { ...DEFAULT_MODELS }
  private modelsSeen: { at: number; status: ModelsStatus } | null = null
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
          // The bytes are already in hand: no preserve job, so extraction is queued here.
          if (receipt.state === 'preserved') {
            this.vault.enqueue(receipt.item_id, 'extract')
            void this.tick()
          }
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

  requeue(itemId: string, stage: string) {
    this.vault.requeue(itemId, stage)
  }

  start() {
    const interrupted = this.vault.closeStaleRuns()
    if (interrupted) console.log(JSON.stringify({ event: 'runs.interrupted', count: interrupted }))
    for (const stage of ['extract', 'enrich', 'link']) {
      const added = this.vault.backfill(stage)
      if (added) console.log(JSON.stringify({ event: 'jobs.backfill', stage, added }))
    }
    this.timer = setInterval(() => void this.tick(), 1000)
    // Skipped enrichment wakes when Ollama appears; the check is cheap and local.
    this.modelsTimer = setInterval(() => void this.modelsStatus(true), 60_000)
    void this.modelsStatus(true)
    void this.tick()
  }

  /** Lexical always (PRS-8); with `hybrid`, semantic neighbours of the query are fused in by reciprocal rank. */
  async search(query: string, limit = 50, hybrid = false): Promise<SearchHit[]> {
    const lexical = this.vault.search(query, limit).map((h) => ({ ...h, why: 'lexical' as const }))
    if (!hybrid || !query.trim()) return lexical
    const status = await this.modelsStatus()
    if (!status.ok || !this.digestOf(status, this.models.embed)) return lexical
    let vector: Float32Array
    try {
      const out = await this.embedTexts([{ id: 'q', text: query }], 30_000)
      vector = Float32Array.from(out.vectors[0]?.vector ?? [])
    } catch (e) {
      console.error(JSON.stringify({ event: 'search.semantic.error', message: String(e) }))
      return lexical
    }
    if (vector.length === 0) return lexical
    const semantic = new Map<string, { fragment_id: string; text: string }>()
    for (const h of this.vault.nearestFragments(vector, limit * 2))
      if (!semantic.has(h.item_id)) semantic.set(h.item_id, h)
    const score = new Map<string, number>()
    lexical.forEach((h, i) => {
      score.set(h.item_id, (score.get(h.item_id) ?? 0) + 1 / (60 + i))
    })
    ;[...semantic.keys()].forEach((id, i) => {
      score.set(id, (score.get(id) ?? 0) + 1 / (60 + i))
    })
    const byId = new Map(lexical.map((h) => [h.item_id, h]))
    const out: SearchHit[] = []
    for (const [id, s] of [...score.entries()].sort((a, b) => b[1] - a[1])) {
      if (out.length >= limit) break
      const lex = byId.get(id)
      const sem = semantic.get(id)
      if (lex) out.push({ ...lex, score: s, why: sem ? 'both' : 'lexical' })
      else if (sem) {
        const item = this.vault.item(id)
        if (!item || item.state === 'duplicate') continue
        out.push({
          item_id: id,
          title: item.title,
          source_kind: item.source_kind,
          state: item.state,
          score: s,
          snippet: sem.text.length > 160 ? `${sem.text.slice(0, 160)}…` : sem.text,
          fragment_id: sem.fragment_id,
          last_captured_at: item.last_captured_at,
          why: 'semantic',
        })
      }
    }
    return out
  }

  // ---- M5: models through Ollama; everything they produce is suggested with a run (ADR-005, 6.4) ----

  /** Whether the model worker reaches Ollama and which models exist; cached for 20 s. */
  async modelsStatus(force = false): Promise<ModelsStatus> {
    if (!force && this.modelsSeen && Date.now() - this.modelsSeen.at < 20_000)
      return this.modelsSeen.status
    let status: ModelsStatus
    try {
      status = ModelsStatus.parse(
        await this.iii.trigger({ function_id: 'enrich::models', payload: {}, timeoutMs: 5_000 }),
      )
    } catch (e) {
      status = {
        ok: false,
        url: '',
        models: [],
        error: `model worker: ${e instanceof Error ? e.message : String(e)}`,
      }
    }
    const wasOk = this.modelsSeen?.status.ok ?? false
    this.modelsSeen = { at: Date.now(), status }
    if (status.ok && !wasOk) {
      const woken = this.vault.requeueWhere('enrich', SKIPPED)
      if (woken) {
        console.log(JSON.stringify({ event: 'jobs.woken', stage: 'enrich', woken }))
        void this.tick()
      }
    }
    return status
  }

  private digestOf(status: ModelsStatus, model: string) {
    return (
      status.models.find((m) => m.name === model || m.name === `${model}:latest`)?.digest ?? null
    )
  }

  private async embedTexts(texts: { id: string; text: string }[], timeoutMs: number) {
    return EmbedResult.parse(
      await this.iii.trigger({
        function_id: 'enrich::embed',
        payload: { model: this.models.embed, texts },
        timeoutMs,
      }),
    )
  }

  private runView(runId: string | null) {
    const r = runId ? this.vault.run(runId) : undefined
    return r
      ? {
          id: r.id,
          processor: r.processor,
          version: r.version,
          model_digest: r.model_digest,
          prompt_digest: r.prompt_digest,
          started_at: r.started_at,
        }
      : null
  }

  /** Model summaries of an item with their review status and run (MET-1, MET-2). */
  notes(itemId: string) {
    return this.vault.notes(itemId).map((n) => ({ ...n, run: this.runView(n.run_id) }))
  }

  /**
   * The enrich stage: captions, embeddings, then schema extraction. Returns a note instead of throwing when there
   * is nothing to do, so the stage completes and the item still reaches `link` (PRS-8).
   */
  private async enrich(item: ItemRow): Promise<string | undefined> {
    if (item.state !== 'preserved') return `${SKIPPED}item is ${item.state}`
    const status = await this.modelsStatus(true)
    if (!status.ok) return `${SKIPPED}models unavailable (${status.error ?? 'no answer'})`
    const missing = [this.models.embed, this.models.text].filter((m) => !this.digestOf(status, m))
    if (missing.length) return `${SKIPPED}models not installed: ${missing.join(', ')}`
    if (this.digestOf(status, this.models.vision)) await this.captions(item, status)
    if (this.vault.fragments(item.id).length === 0) return `${SKIPPED}no fragments`
    await this.embedArtifact(item, status)
    await this.extractSchema(item, status)
    return undefined
  }

  /** PRS-4: one caption per image and per video keyframe, stored as fragments of the raw payload, marked by their run. */
  private async captions(item: ItemRow, status: ModelsStatus) {
    const digest = this.digestOf(status, this.models.vision) as string
    const payloads = this.vault.payloads(item.id)
    const raw = payloads.find((p) => p.role === 'raw')
    if (!raw) return
    const targets: { blob_id: string; selector: Selector }[] = []
    if (raw.mime.startsWith('image/'))
      targets.push({ blob_id: raw.blob_id, selector: { kind: 'box', x: 0, y: 0, w: 0, h: 0 } })
    const index = payloads.find((p) => p.role === 'keyframes')
    if (raw.mime.startsWith('video/') && index) {
      const parsed = JSON.parse(readFileSync(this.vault.blobs.pathFor(index.blob_id), 'utf8')) as {
        keyframes: { at_ms: number; blob_id: string }[]
      }
      for (const kf of parsed.keyframes.slice(0, 12))
        targets.push({
          blob_id: kf.blob_id,
          selector: { kind: 'time', start_ms: kf.at_ms, end_ms: kf.at_ms },
        })
    }
    if (targets.length === 0) return
    if (this.vault.lastRun(item.id, 'enrich::caption')?.model_digest === digest) return
    const run = this.vault.startRun(item.id, 'enrich::caption', '0.5.0', {
      model_digest: digest,
      params: { model: this.models.vision, images: targets.length },
    })
    try {
      const out = []
      for (const [i, t] of targets.entries()) {
        const r = CaptionResult.parse(
          await this.iii.trigger({
            function_id: 'enrich::caption',
            payload: { model: this.models.vision, path: this.vault.blobs.pathFor(t.blob_id) },
            timeoutMs: 300_000,
          }),
        )
        this.vault.describeRun(run, { prompt_digest: r.prompt_digest })
        out.push({ ordinal: 10_000 + i, selector: t.selector, text: r.caption })
      }
      this.vault.replaceFragments(item.id, raw.id, run, 'enrich::caption', out)
      this.vault.finishRun(run)
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  /** PRS-5: a vector per fragment from the current model; vectors from any other model are dropped first. */
  private async embedArtifact(item: ItemRow, status: ModelsStatus) {
    const digest = this.digestOf(status, this.models.embed) as string
    const stale = this.vault.invalidateEmbeddings(item.id, digest)
    const todo = this.vault.fragmentsToEmbed(item.id, digest).filter((f) => f.text.trim())
    if (todo.length === 0) return
    const run = this.vault.startRun(item.id, 'enrich::embed', '0.5.0', {
      model_digest: digest,
      params: { model: this.models.embed, fragments: todo.length, stale_removed: stale },
    })
    try {
      for (let i = 0; i < todo.length; i += EMBED_BATCH) {
        const batch = todo.slice(i, i + EMBED_BATCH)
        const out = await this.embedTexts(
          batch.map((f) => ({ id: f.id, text: f.text })),
          600_000,
        )
        if (out.model_digest !== digest)
          throw new Error(`embedding model changed during the run: ${out.model_digest}`)
        this.vault.putEmbeddings(
          item.id,
          run,
          out.model,
          out.model_digest,
          out.dim,
          out.vectors.map((v) => ({ fragment_id: v.id, vector: Float32Array.from(v.vector) })),
        )
      }
      this.vault.finishRun(run)
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  /** PRS-6 and 6.4 step 5: schema-constrained extraction committed in one transaction, all of it suggested. */
  private async extractSchema(item: ItemRow, status: ModelsStatus) {
    const digest = this.digestOf(status, this.models.text) as string
    const fragments = this.vault.fragments(item.id).filter((f) => f.text.trim())
    if (fragments.length === 0) return
    const inputs = createHash('sha256')
      .update(fragments.map((f) => f.id).join('\n'))
      .digest('hex')
    const last = this.vault.lastRun(item.id, 'enrich::extract')
    if (
      last?.model_digest === digest &&
      last.params_json &&
      (JSON.parse(last.params_json) as { inputs?: string }).inputs === inputs
    )
      return // same model, same fragments: the proposals already exist
    const run = this.vault.startRun(item.id, 'enrich::extract', '0.5.0', {
      model_digest: digest,
      params: { model: this.models.text, inputs, fragments: fragments.length },
    })
    try {
      const result = SchemaExtractResult.parse(
        await this.iii.trigger({
          function_id: 'enrich::extract',
          payload: {
            model: this.models.text,
            title: item.title,
            source: item.source_uri ?? item.source_id,
            fragments: fragments.map((f) => ({ id: f.id, text: f.text })),
          },
          timeoutMs: 3_600_000,
        }),
      )
      this.vault.describeRun(run, {
        model_digest: result.model_digest,
        prompt_digest: result.prompt_digest,
      })
      const known = new Set(fragments.map((f) => f.id))
      const evidence = (ids: string[]) => ids.filter((id) => known.has(id))
      const me = { kind: 'item' as const, id: item.id }
      const author = 'enrich::extract'
      const created: EntityRow[] = []
      this.vault.db.exec('BEGIN')
      try {
        for (const e of result.entities) {
          const existing = this.vault.graph.findEntity(e.kind, e.name)
          const ent = this.vault.graph.upsertEntity(e.kind, e.name, e.aliases)
          if (!existing) created.push(ent)
          this.vault.graph.addRelation({
            subject: me,
            predicate: 'mentions',
            object: { kind: 'entity', id: ent.id },
            author,
            generator: result.model,
            ...(e.aliases.length ? { score_json: { aliases: e.aliases } } : {}),
            run_id: run,
            evidence: evidence(e.evidence),
          })
        }
        for (const t of result.tags)
          this.vault.graph.addRelation({
            subject: me,
            predicate: 'tagged',
            object: { kind: 'entity', id: this.vault.graph.upsertEntity('tag', t.label).id },
            author,
            generator: result.model,
            run_id: run,
            evidence: evidence(t.evidence),
          })
        for (const d of result.dates)
          this.vault.graph.addRelation({
            subject: me,
            predicate: 'occurred_at',
            object: { kind: 'entity', id: this.vault.graph.upsertEntity('date', d.iso).id },
            author,
            generator: result.model,
            run_id: run,
            evidence: evidence(d.evidence),
          })
        if (result.summary) {
          const note = this.vault.upsertNote(
            item.id,
            author,
            result.summary.text,
            result.title,
            run,
          )
          this.vault.graph.addRelation({
            subject: { kind: 'item', id: note },
            predicate: 'derived_from',
            object: me,
            author,
            generator: result.model,
            run_id: run,
            evidence: evidence(result.summary.evidence),
          })
        }
        this.vault.db.exec('COMMIT')
      } catch (e) {
        this.vault.db.exec('ROLLBACK')
        throw e
      }
      await this.resolveEntities(created, status, run)
      this.vault.finishRun(run)
      console.log(
        JSON.stringify({
          event: 'enrich.extract',
          item: item.id,
          entities: result.entities.length,
          tags: result.tags.length,
          dates: result.dates.length,
          summary: !!result.summary,
          chunks: result.chunks,
          attempts: result.attempts,
        }),
      )
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  /** New entities get a name vector; a close existing name of the same kind becomes a `possible_duplicate` proposal. */
  private async resolveEntities(created: EntityRow[], status: ModelsStatus, run: string) {
    const digest = this.digestOf(status, this.models.embed)
    const candidates = created.filter((e) => e.kind !== 'tag' && e.kind !== 'date')
    if (!digest || candidates.length === 0) return
    const out = await this.embedTexts(
      candidates.map((e) => ({ id: e.id, text: `${e.kind}: ${e.name}` })),
      120_000,
    )
    const rows = out.vectors.map((v) => ({ entity_id: v.id, vector: Float32Array.from(v.vector) }))
    for (const r of rows) {
      const ent = candidates.find((c) => c.id === r.entity_id) as EntityRow
      for (const n of this.vault.nearestEntities(r.vector, 3, [r.entity_id])) {
        const other = this.vault.graph.entity(n.id)
        if (!other || other.kind !== ent.kind || n.distance > DUPLICATE_MAX_DISTANCE) continue
        this.vault.graph.addRelation({
          subject: { kind: 'entity', id: ent.id },
          predicate: 'possible_duplicate',
          object: { kind: 'entity', id: other.id },
          author: 'enrich::resolve',
          generator: this.models.embed,
          score: Math.round((1 - n.distance) * 1000) / 1000,
          score_json: { distance: Math.round(n.distance * 1000) / 1000 },
          run_id: run,
        })
      }
    }
    this.vault.putEntityVectors(digest, out.dim, rows)
  }

  /** Stops claiming jobs, waits for the running ones (bounded), then closes the vault. */
  async stop(waitMs = 30_000) {
    if (this.timer) clearInterval(this.timer)
    if (this.modelsTimer) clearInterval(this.modelsTimer)
    this.timer = undefined
    const until = Date.now() + waitMs
    while (this.running > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, 200))
    this.vault.close()
  }

  private async tick() {
    if (!this.timer) return
    while (this.running < 2) {
      // Deterministic links come before enrichment: a link never waits on a model (spec 7, rehearsal).
      const job =
        this.vault.claimJob('preserve') ??
        this.vault.claimJob('extract') ??
        this.vault.claimJob('link') ??
        (this.enriching === 0 ? this.vault.claimJob('enrich') : undefined)
      if (!job) return
      this.running++
      if (job.stage === 'enrich') this.enriching++
      void this.run(job).finally(() => {
        this.running--
        if (job.stage === 'enrich') this.enriching--
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
      let note: string | undefined
      if (job.stage === 'extract') await this.extract(item)
      else if (job.stage === 'enrich') note = await this.enrich(item)
      else if (job.stage === 'link') await this.link(item)
      else if (item.source_kind === 'file') await this.preserveFile(item)
      else if (item.source_kind === 'url') await this.preserveUrl(item)
      this.vault.completeJob(job.id, note)
      if (job.stage === 'preserve' && this.vault.item(item.id)?.state === 'preserved')
        this.vault.enqueue(item.id, 'extract')
      // links run twice: right after extraction on what is deterministic, and again once models have added to it
      if (job.stage === 'extract') {
        this.vault.requeue(item.id, 'link')
        this.vault.requeue(item.id, 'enrich')
      }
      if (job.stage === 'enrich') this.vault.requeue(item.id, 'link')
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

  // ---- GRA-2: deterministic link candidates, each with its generator, score parts and evidence ----

  private async link(item: ItemRow) {
    if (item.state === 'duplicate') return
    const run = this.vault.startRun(item.id, 'link::candidates', '0.4.0')
    try {
      const me = { kind: 'item' as const, id: item.id }
      const skip = (id: string) => id === item.id || this.vault.item(id)?.state === 'duplicate'
      // 1. explicit links in the readable HTML to pages that are also in the vault
      const htmlPayloads = this.vault.payloads(item.id)
      const readable =
        htmlPayloads.find((p) => p.role === 'normalized' && p.mime === 'text/html') ??
        htmlPayloads.find((p) => p.role === 'raw' && p.mime === 'text/html')
      if (readable) {
        const html = readFileSync(this.vault.blobs.pathFor(readable.blob_id), 'utf8')
        const seen = new Set<string>()
        for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
          const target = this.vault.itemForUrl(m[1] ?? '')
          if (!target || skip(target) || seen.has(target)) continue
          seen.add(target)
          this.vault.graph.addRelation({
            subject: me,
            predicate: 'related_to',
            object: { kind: 'item', id: target },
            author: 'link::explicit_link',
            generator: 'explicit_link',
            score: 1,
            score_json: { href: m[1] },
            run_id: run,
          })
        }
      }
      // 2. shared rare terms: score = sum of 1/doc over shared terms; evidence from both ends
      const scores = new Map<string, { score: number; terms: string[]; evidence: Set<string> }>()
      for (const t of this.vault.rareTerms(item.id)) {
        for (const other of this.vault.artifactsWithTerm(t.term, item.id)) {
          if (skip(other.artifact_id)) continue
          const entry = scores.get(other.artifact_id) ?? {
            score: 0,
            terms: [],
            evidence: new Set<string>(),
          }
          entry.score += 1 / t.doc
          entry.terms.push(t.term)
          entry.evidence.add(t.fragment_id)
          entry.evidence.add(other.fragment_id)
          scores.set(other.artifact_id, entry)
        }
      }
      const ranked = [...scores.entries()]
        .filter(([, v]) => v.terms.length >= 2 || v.score >= 0.5)
        .sort((a, b) => b[1].score - a[1].score)
        .slice(0, 10)
      for (const [other, v] of ranked)
        this.vault.graph.addRelation({
          subject: me,
          predicate: 'related_to',
          object: { kind: 'item', id: other },
          author: 'link::shared_terms',
          generator: 'shared_terms',
          score: Math.round(v.score * 1000) / 1000,
          score_json: { terms: v.terms.slice(0, 8) },
          run_id: run,
          evidence: [...v.evidence].filter(Boolean),
        })
      // 3. captured within ten minutes of each other, a weak signal
      for (const near of this.vault
        .capturedNear(item.id, 10 * 60_000)
        .sort((a, b) => a.minutes - b.minutes)
        .slice(0, 5)) {
        if (skip(near.artifact_id)) continue
        this.vault.graph.addRelation({
          subject: me,
          predicate: 'related_to',
          object: { kind: 'item', id: near.artifact_id },
          author: 'link::co_capture',
          generator: 'co_capture',
          score: 0.1,
          score_json: { minutes_apart: Math.round(near.minutes * 10) / 10 },
          run_id: run,
        })
      }
      // 4. shared entities, proposed or accepted on both ends (6.4 step 7)
      // An accepted entity on both ends counts 1, a proposed one 0.5, a proposed tag 0: suggestions from
      // generic model tags alone do not become link proposals.
      for (const shared of this.vault.graph.sharedEntities(item.id)) {
        if (skip(shared.artifact_id) || shared.score < 1) continue
        this.vault.graph.addRelation({
          subject: me,
          predicate: 'related_to',
          object: { kind: 'item', id: shared.artifact_id },
          author: 'link::shared_entities',
          generator: 'shared_entities',
          score: shared.score,
          score_json: { entities: shared.entities.slice(0, 8) },
          run_id: run,
          evidence: shared.evidence,
        })
      }
      // 5. semantic neighbours: nearest artifact centroids; evidence is the closest fragments of each end
      const mine = this.vault.artifactVector(item.id)
      if (mine) {
        for (const n of this.vault.nearestArtifacts(mine.vector, 5, [item.id])) {
          if (n.distance > SEMANTIC_MAX_DISTANCE || skip(n.id)) continue
          const theirs = this.vault.artifactVector(n.id)
          const evidence = [
            ...this.vault
              .nearestFragments(mine.vector, 40)
              .filter((f) => f.item_id === n.id)
              .slice(0, 2),
            ...(theirs
              ? this.vault
                  .nearestFragments(theirs.vector, 40)
                  .filter((f) => f.item_id === item.id)
                  .slice(0, 2)
              : []),
          ].map((f) => f.fragment_id)
          this.vault.graph.addRelation({
            subject: me,
            predicate: 'related_to',
            object: { kind: 'item', id: n.id },
            author: 'link::semantic_neighbours',
            generator: 'semantic_neighbours',
            score: Math.round((1 - n.distance) * 1000) / 1000,
            score_json: { distance: Math.round(n.distance * 1000) / 1000 },
            run_id: run,
            evidence,
          })
        }
      }
      this.vault.finishRun(run)
    } catch (e) {
      this.vault.finishRun(run, e instanceof Error ? e.message : String(e))
      throw e
    }
  }

  // ---- review: the only way a relation becomes accepted (ADR-005) ----

  review(relationId: string, status: 'accepted' | 'rejected') {
    this.vault.graph.setStatus(relationId, status)
    this.emit('changed')
  }

  tag(itemId: string, label: string) {
    const entity = this.vault.graph.upsertEntity('tag', label)
    const r = this.vault.graph.addRelation({
      subject: { kind: 'item', id: itemId },
      predicate: 'tagged',
      object: { kind: 'entity', id: entity.id },
      author: 'user',
      status: 'accepted',
    })
    if (r.status !== 'accepted') this.vault.graph.setStatus(r.id, 'accepted')
    this.emit('changed')
    return entity
  }

  untag(relationId: string) {
    this.vault.graph.deleteRelation(relationId)
    this.emit('changed')
  }

  /** Relations of an item with their evidence and the other end's label, for the Item screen and the inbox. */
  relations(itemId: string) {
    return this.vault.graph.relationsOf({ kind: 'item', id: itemId }).map((r) => this.describe(r))
  }

  suggestions() {
    return this.vault.graph.suggestions().map((r) => this.describe(r))
  }

  private describe(r: ReturnType<Vault['graph']['relation']> & object) {
    const label = (kind: 'item' | 'entity', id: string) =>
      kind === 'item'
        ? (this.vault.item(id)?.title ?? id)
        : (this.vault.graph.entity(id)?.name ?? id)
    return {
      ...r,
      score_json: r.score_json ? JSON.parse(r.score_json) : null,
      subject_label: label(r.subject_kind, r.subject_id),
      object_label: label(r.object_kind, r.object_id),
      evidence: this.vault.graph.evidence(r.id),
      run: this.runView(r.run_id),
    }
  }
}
