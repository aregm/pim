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

/** Every contract that is exported to `contracts/*.json` for the Python worker. */
export const exported = {
  health: HealthResponse,
  ping: PingResponse,
} as const

export const toJsonSchema = (schema: z.ZodType) =>
  z.toJSONSchema(schema, { target: 'draft-2020-12' })
