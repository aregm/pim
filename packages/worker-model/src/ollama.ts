import { createHash } from 'node:crypto'

/** Ollama on localhost only (spec D6). Every call is a plain HTTP request; nothing leaves the machine. */
export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434'

export const sha256 = (s: string) => `sha256:${createHash('sha256').update(s).digest('hex')}`

async function call<T>(path: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(`${OLLAMA_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ollama ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return (await res.json()) as T
}

export interface ModelInfo {
  name: string
  digest: string
}

/** Models Ollama holds, or a thrown error when it is not running. */
export async function listModels(): Promise<ModelInfo[]> {
  const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) })
  if (!res.ok) throw new Error(`ollama /api/tags: ${res.status}`)
  const body = (await res.json()) as { models?: { name: string; digest: string }[] }
  return (body.models ?? []).map((m) => ({ name: m.name, digest: `sha256:${m.digest}` }))
}

const digests = new Map<string, string>()
/** The digest of a model as Ollama reports it, so a changed model is a changed run (PRS-5, MET-1). */
export async function modelDigest(model: string): Promise<string> {
  const hit = digests.get(model)
  if (hit) return hit
  const found = (await listModels()).find((m) => m.name === model || m.name === `${model}:latest`)
  if (!found) throw new Error(`model not installed: ${model}`)
  digests.set(model, found.digest)
  return found.digest
}

export async function embed(model: string, input: string[]): Promise<number[][]> {
  const out = await call<{ embeddings: number[][] }>(
    '/api/embed',
    { model, input, truncate: true },
    600_000,
  )
  if (!Array.isArray(out.embeddings) || out.embeddings.length !== input.length)
    throw new Error(
      `ollama /api/embed returned ${out.embeddings?.length ?? 0} vectors for ${input.length} inputs`,
    )
  return out.embeddings
}

export interface ChatMessage {
  role: 'system' | 'user'
  content: string
  images?: string[]
}

/** One chat completion at temperature zero; `format` is a JSON schema the answer must satisfy. */
export async function chat(
  model: string,
  messages: ChatMessage[],
  format: unknown | undefined,
  timeoutMs: number,
): Promise<string> {
  const out = await call<{ message?: { content?: string } }>(
    '/api/chat',
    {
      model,
      messages,
      stream: false,
      ...(format ? { format } : {}),
      // num_predict caps a runaway answer: a valid chunk answer is well under 2048 tokens.
      options: { temperature: 0, num_ctx: 8192, num_predict: 2048 },
      keep_alive: '10m',
    },
    timeoutMs,
  )
  return out.message?.content ?? ''
}
