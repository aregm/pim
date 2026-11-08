import { z } from 'zod'

/** Answer of every `<worker>::health` and of `kernel::health`. */
export const HealthResponse = z.object({
  worker: z.string().min(1),
  version: z.string().min(1),
  ok: z.literal(true),
  uptime_ms: z.number().int().nonnegative(),
})
export type HealthResponse = z.infer<typeof HealthResponse>

/** Answer of `kernel::ping`. */
export const PingResponse = z.object({ pong: z.literal(true), at: z.iso.datetime() })
export type PingResponse = z.infer<typeof PingResponse>

/** One engine worker as `engine::workers::list` reports it; only the fields the app reads. */
export const EngineWorker = z.object({ name: z.string(), id: z.string() }).loose()
export const EngineWorkersList = z.object({ workers: z.array(EngineWorker) }).loose()
export type EngineWorkersList = z.infer<typeof EngineWorkersList>

/** What any capture surface hands to the core (`kernel::receipt`, the capture panel, the endpoint). */
export const CaptureRequest = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.url() }),
  z.object({ kind: z.literal('text'), text: z.string().min(1), title: z.string().optional() }),
  z.object({ kind: z.literal('file'), path: z.string().min(1) }),
])
export type CaptureRequest = z.infer<typeof CaptureRequest>

export const Receipt = z.object({
  item_id: z.string(),
  state: z.enum(['received', 'preserved', 'failed', 'duplicate']),
  existing: z.boolean(),
})
export type Receipt = z.infer<typeof Receipt>

/** What `preserve::web` returns for one URL. Bytes travel base64 in v0.1; channels come with large pages. */
export const WebPreserveResult = z.object({
  url: z.url(),
  final_url: z.url(),
  title: z.string(),
  metadata: z.record(z.string(), z.string()),
  raw_html: z.string(),
  readable_html: z.string().nullable(),
  text: z.string().nullable(),
  screenshot_png_b64: z.string().nullable(),
})
export type WebPreserveResult = z.infer<typeof WebPreserveResult>

/** What the core hands `extract::text` (the parse worker) for one payload. */
export const ExtractRequest = z.object({
  artifact_id: z.string(),
  payload_id: z.string(),
  mime: z.string(),
  path: z.string(),
})
export type ExtractRequest = z.infer<typeof ExtractRequest>

export const Selector = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('block'), index: z.number().int().nonnegative() }),
  z.object({
    kind: z.literal('page'),
    page: z.number().int().positive(),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }),
  z.object({
    kind: z.literal('char'),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }),
])
export type Selector = z.infer<typeof Selector>

export const Extraction = z.object({
  fragments: z.array(
    z.object({ ordinal: z.number().int().nonnegative(), selector: Selector, text: z.string() }),
  ),
  normalized_text: z.string().optional(),
  pages: z.number().int().nonnegative().optional(),
})
export type Extraction = z.infer<typeof Extraction>

export const SearchRequest = z.object({
  query: z.string(),
  limit: z.number().int().positive().max(200).optional(),
})

/** Every contract that is exported to `contracts/*.json` for the Python worker. */
export const exported = {
  health: HealthResponse,
  ping: PingResponse,
  capture_request: CaptureRequest,
  receipt: Receipt,
  web_preserve_result: WebPreserveResult,
  extract_request: ExtractRequest,
  extraction: Extraction,
} as const

export const toJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-2020-12' })
