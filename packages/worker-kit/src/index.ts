import { HealthResponse } from '@pim/contracts'
import { registerWorker } from 'iii-sdk'

export const ENGINE_URL = process.env.III_URL ?? 'ws://127.0.0.1:49140'

type Handler = (input: unknown) => Promise<unknown> | unknown

export interface WorkerSpec {
  name: string
  version: string
  functions?: Record<string, Handler>
}

export const log = (event: string, fields: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ at: new Date().toISOString(), event, ...fields }))

/** Connects to the engine, registers `<name>::health` plus the given functions, stops cleanly on SIGTERM. */
export function startWorker(spec: WorkerSpec) {
  const started = Date.now()
  const iii = registerWorker(ENGINE_URL, { workerName: spec.name })
  iii.registerFunction(`${spec.name}::health`, async () =>
    HealthResponse.parse({
      worker: spec.name,
      version: spec.version,
      ok: true,
      uptime_ms: Date.now() - started,
    }),
  )
  for (const [id, handler] of Object.entries(spec.functions ?? {}))
    iii.registerFunction(id, handler)
  const stop = async (signal: string) => {
    log('worker.stop', { worker: spec.name, signal })
    await iii.shutdown()
    process.exit(0)
  }
  process.once('SIGTERM', () => void stop('SIGTERM'))
  process.once('SIGINT', () => void stop('SIGINT'))
  log('worker.start', { worker: spec.name, version: spec.version, engine: ENGINE_URL })
  return iii
}
