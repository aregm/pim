import { readFile } from 'node:fs/promises'
import {
  CaptionRequest,
  type CaptionResult,
  EmbedRequest,
  type EmbedResult,
  type ModelsStatus,
  SchemaExtractRequest,
} from '@pim/contracts'
import { log, startWorker } from '@pim/worker-kit'
import { extractSchema } from './extract.ts'
import { chat, embed, listModels, modelDigest, OLLAMA_URL, sha256 } from './ollama.ts'

/**
 * The model worker: embeddings, schema-constrained extraction and captions through Ollama on localhost.
 * It never touches the vault; texts and ids come in, proposals go out (specification 4.1, 6.4).
 */

const CAPTION_PROMPT =
  'Describe this image in one or two plain sentences: what it shows, any visible text, and the setting. No preamble.'
const CAPTION_DIGEST = sha256(CAPTION_PROMPT)
const EMBED_BATCH = 32

startWorker({
  name: 'model',
  version: '0.5.0',
  functions: {
    'enrich::models': async (): Promise<ModelsStatus> => {
      try {
        return { ok: true, url: OLLAMA_URL, models: await listModels() }
      } catch (e) {
        return {
          ok: false,
          url: OLLAMA_URL,
          models: [],
          error: e instanceof Error ? e.message : String(e),
        }
      }
    },
    'enrich::embed': async (input: unknown): Promise<EmbedResult> => {
      const req = EmbedRequest.parse(input)
      const t = Date.now()
      const digest = await modelDigest(req.model)
      const vectors: EmbedResult['vectors'] = []
      for (let i = 0; i < req.texts.length; i += EMBED_BATCH) {
        const batch = req.texts.slice(i, i + EMBED_BATCH)
        const out = await embed(
          req.model,
          batch.map((b) => b.text.slice(0, 8_000)),
        )
        batch.forEach((b, j) => {
          vectors.push({ id: b.id, vector: out[j] as number[] })
        })
      }
      const dim = vectors[0]?.vector.length ?? 0
      if (!dim) throw new Error('empty embedding')
      log('enrich.embed', { model: req.model, texts: req.texts.length, dim, ms: Date.now() - t })
      return { model: req.model, model_digest: digest, dim, vectors }
    },
    'enrich::extract': async (input: unknown) => {
      const req = SchemaExtractRequest.parse(input)
      const t = Date.now()
      const out = await extractSchema(req)
      log('enrich.extract', {
        model: req.model,
        fragments: req.fragments.length,
        chunks: out.chunks,
        attempts: out.attempts,
        entities: out.entities.length,
        tags: out.tags.length,
        ms: Date.now() - t,
      })
      return out
    },
    'enrich::caption': async (input: unknown): Promise<CaptionResult> => {
      const req = CaptionRequest.parse(input)
      const t = Date.now()
      const digest = await modelDigest(req.model)
      const image = (await readFile(req.path)).toString('base64')
      const caption = (
        await chat(
          req.model,
          [{ role: 'user', content: CAPTION_PROMPT, images: [image] }],
          undefined,
          300_000,
        )
      ).trim()
      if (!caption) throw new Error('empty caption')
      log('enrich.caption', { model: req.model, chars: caption.length, ms: Date.now() - t })
      return { model: req.model, model_digest: digest, prompt_digest: CAPTION_DIGEST, caption }
    },
  },
})
