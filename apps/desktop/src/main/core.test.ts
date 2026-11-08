/**
 * What happens to in-flight work when a worker stops mid-flow (PRS-7, review finding P1-3).
 *
 * The core is driven with a scripted stand-in for the engine: `trigger` answers as a worker would, including
 * dying in the middle of a call. Time is faked so the 5 s, 10 s, 20 s backoff and the 60 s job lease pass in
 * milliseconds. Each test asserts what the code does today; where the repair plan (R1) changes the behaviour,
 * the assertion says so, so the test is a record of the current semantics and flips deliberately when R1 lands.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Vault } from '@pim/vault'
import type { IIIClient } from 'iii-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Core } from './core.ts'

type Trigger = (req: {
  function_id: string
  payload: unknown
  timeoutMs?: number
}) => Promise<unknown>

/** A parse worker that can be stopped and started between calls; the engine reports a stopped worker as a rejected call. */
class ScriptedWorker {
  calls: string[] = []
  down = false
  readonly fragments = [
    {
      ordinal: 0,
      selector: { kind: 'block', index: 0 },
      text: 'The harbour lights came on at dusk.',
    },
    {
      ordinal: 1,
      selector: { kind: 'block', index: 1 },
      text: 'A second paragraph about the tide.',
    },
  ]
  readonly client: IIIClient

  constructor() {
    const trigger: Trigger = async ({ function_id }) => {
      this.calls.push(function_id)
      if (function_id === 'enrich::models')
        return { ok: false, url: 'http://127.0.0.1:11434', models: [], error: 'not running' }
      if (function_id === 'extract::text') {
        if (this.down) throw new Error('worker parse disconnected during the call')
        return { fragments: this.fragments }
      }
      throw new Error(`FUNCTION_NOT_FOUND: ${function_id}`)
    }
    this.client = { trigger } as unknown as IIIClient
  }
}

let dir: string
let worker: ScriptedWorker
let core: Core | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pim-core-'))
  worker = new ScriptedWorker()
})
afterEach(async () => {
  vi.useRealTimers()
  if (core) await core.stop(0)
  core = undefined
  rmSync(dir, { recursive: true, force: true })
})

/** A text capture: the bytes are in hand, so the item is `preserved` at once and owes only an `extract` job. */
async function capturePreservedText(c: Core) {
  const receipt = await c.receive(
    { kind: 'text', text: 'The harbour lights came on at dusk.' },
    'test',
  )
  expect(receipt.state).toBe('preserved')
  return receipt.item_id
}

const job = (v: Vault, itemId: string, stage: string) =>
  v.jobs(itemId).find((j) => j.stage === stage)
const runs = (v: Vault, itemId: string, processor: string) =>
  v.db
    .prepare(
      'SELECT status, error FROM processing_run WHERE artifact_id = ? AND processor = ? ORDER BY started_at',
    )
    .all(itemId, processor) as { status: string; error: string | null }[]

describe('a worker stops mid-flow (PRS-7)', () => {
  it('the attempt fails without committing anything, and the next attempt after backoff finishes the work once', async () => {
    core = new Core(dir, worker.client)
    const itemId = await capturePreservedText(core)
    vi.useFakeTimers()
    worker.down = true
    core.start()
    await vi.advanceTimersByTimeAsync(10)

    // The call went out and the worker died: the job is open again with one attempt counted, nothing was written.
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(1)
    let extract = job(core.vault, itemId, 'extract')
    expect(extract?.state).toBe('open')
    expect(extract?.attempts).toBe(1)
    expect(extract?.last_error).toMatch(/disconnected/)
    expect(core.vault.fragments(itemId)).toHaveLength(0)
    expect(runs(core.vault, itemId, 'extract::text')).toEqual([
      { status: 'failed', error: 'worker parse disconnected during the call' },
    ])
    expect(core.vault.item(itemId)?.state).toBe('preserved')

    // Backoff is 5 s before the second attempt; a tick before then does not claim it.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(1)

    // The worker is back. The second attempt commits the fragments exactly once and the pipeline moves on.
    worker.down = false
    await vi.advanceTimersByTimeAsync(3_000)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(2)
    extract = job(core.vault, itemId, 'extract')
    expect(extract?.state).toBe('done')
    expect(core.vault.fragments(itemId).map((f) => f.text)).toEqual(
      worker.fragments.map((f) => f.text),
    )
    expect(runs(core.vault, itemId, 'extract::text').map((r) => r.status)).toEqual([
      'failed',
      'done',
    ])
    expect(job(core.vault, itemId, 'link')).toBeDefined()
    expect(job(core.vault, itemId, 'enrich')).toBeDefined()
    expect(core.vault.item(itemId)?.state).toBe('preserved')
  })

  it('a worker that stays down fails the job after three attempts; today that also marks the preserved artifact failed', async () => {
    core = new Core(dir, worker.client)
    const itemId = await capturePreservedText(core)
    vi.useFakeTimers()
    worker.down = true
    core.start()

    // Attempts at 0 s, 5 s and 15 s (backoff 5 s then 10 s); nothing after the third.
    await vi.advanceTimersByTimeAsync(10)
    await vi.advanceTimersByTimeAsync(5_000)
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(3)

    const extract = job(core.vault, itemId, 'extract')
    expect(extract?.state).toBe('failed')
    expect(extract?.attempts).toBe(3)
    expect(core.vault.fragments(itemId)).toHaveLength(0)
    expect(runs(core.vault, itemId, 'extract::text').map((r) => r.status)).toEqual([
      'failed',
      'failed',
      'failed',
    ])
    // The bytes are safely on disk, yet the artifact is shown as failed because any stage's third failure marks
    // the artifact (review P1-3). R1 proposes that only the preserve stage may do that; this line then reads 'preserved'.
    expect(core.vault.item(itemId)?.state).toBe('failed')

    // Retry with the worker back: the job runs once more and the fragments arrive, but the artifact is left
    // `received`, because retry resets it and nothing after extraction sets it back (review P1-3; R1 changes this).
    worker.down = false
    core.retry(itemId)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(4)
    expect(job(core.vault, itemId, 'extract')?.state).toBe('done')
    expect(core.vault.fragments(itemId)).toHaveLength(2)
    expect(core.vault.item(itemId)?.state).toBe('received')
  })

  it('the core itself dies mid-stage: on restart the interrupted run is closed and the job resumes once the lease expires', async () => {
    // Instance A takes the capture and dies while the extract call is in flight: the job is leased for 60 s and
    // its run is `running`. Simulated through the vault, which is what a dead process leaves behind on disk.
    const a = new Core(dir, worker.client)
    const itemId = await capturePreservedText(a)
    await a.stop(0)
    const leftovers = new Vault(dir)
    const claimed = leftovers.claimJob('extract')
    expect(claimed?.artifact_id).toBe(itemId)
    leftovers.startRun(itemId, 'extract::text', '0.2.0')
    leftovers.close()

    // Instance B starts against the same vault with a healthy worker.
    vi.useFakeTimers()
    core = new Core(dir, worker.client)
    core.start()
    await vi.advanceTimersByTimeAsync(10)

    // The run left `running` is closed as interrupted at start; the job still shows as running under A's lease.
    expect(runs(core.vault, itemId, 'extract::text')).toEqual([
      { status: 'failed', error: 'interrupted' },
    ])
    expect(job(core.vault, itemId, 'extract')?.state).toBe('running')
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(0)

    // 59 s later the lease still holds and nothing has run: in-flight work waits for the lease, up to 60 s.
    await vi.advanceTimersByTimeAsync(59_000)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(0)
    expect(core.vault.fragments(itemId)).toHaveLength(0)

    // Past the lease the job is claimed again and completes exactly once: two runs, one set of fragments.
    await vi.advanceTimersByTimeAsync(2_000)
    expect(worker.calls.filter((c) => c === 'extract::text')).toHaveLength(1)
    expect(job(core.vault, itemId, 'extract')?.state).toBe('done')
    expect(core.vault.fragments(itemId)).toHaveLength(2)
    expect(runs(core.vault, itemId, 'extract::text').map((r) => r.status)).toEqual([
      'failed',
      'done',
    ])
    expect(core.vault.item(itemId)?.state).toBe('preserved')
  })
})
