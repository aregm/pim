import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { toFtsQuery, Vault } from './index.ts'

let dir: string
let vault: Vault
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pim-vault-'))
  vault = new Vault(dir)
})
afterEach(() => {
  vault.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('schema', () => {
  it('migrates an empty vault to the current version and reopens a populated one', () => {
    expect(vault.schemaVersion).toBe(2)
    vault.receipt({ source_kind: 'text', source_id: 'sha256:a', surface: 'test' })
    vault.close()
    const again = new Vault(dir)
    expect(again.schemaVersion).toBe(2)
    expect(again.items()).toHaveLength(1)
    again.close()
    vault = new Vault(dir)
  })
})

describe('receipt (CAP-3)', () => {
  it('creates one artifact per source identity and counts repeated captures', () => {
    const first = vault.receipt({
      source_kind: 'url',
      source_id: 'https://example.com/a',
      surface: 'panel',
      stages: ['preserve'],
    })
    const second = vault.receipt({
      source_kind: 'url',
      source_id: 'https://example.com/a',
      surface: 'folder',
    })
    expect(first.existing).toBe(false)
    expect(second.existing).toBe(true)
    expect(second.item_id).toBe(first.item_id)
    const [row] = vault.items()
    expect(row?.capture_count).toBe(2)
    expect(vault.jobs(first.item_id)).toHaveLength(1)
  })
  it('marks a second artifact with the same content as a duplicate', () => {
    const a = vault.receipt({ source_kind: 'file', source_id: 'file:/a', surface: 'drop' })
    const b = vault.receipt({ source_kind: 'file', source_id: 'file:/b', surface: 'drop' })
    expect(vault.markPreserved(a.item_id, 'sha256:same')).toBe('preserved')
    expect(vault.markPreserved(b.item_id, 'sha256:same')).toBe('duplicate')
    expect(vault.item(b.item_id)?.duplicate_of).toBe(a.item_id)
  })
})

describe('blobs', () => {
  it('stores by content hash, deduplicates, and keeps the bytes', async () => {
    const src = join(dir, 'in.txt')
    writeFileSync(src, 'hello')
    const one = await vault.blobs.putFile(src)
    const two = await vault.blobs.putBuffer(Buffer.from('hello'))
    expect(one.blob_id).toBe(two.blob_id)
    expect(two.existed).toBe(true)
    expect(readFileSync(vault.blobs.pathFor(one.blob_id), 'utf8')).toBe('hello')
    expect(one.byte_length).toBe(5)
  })
})

describe('jobs', () => {
  it('leases, retries with backoff, fails after three attempts, and can be retried by hand', () => {
    const r = vault.receipt({
      source_kind: 'url',
      source_id: 'u',
      surface: 's',
      stages: ['preserve'],
    })
    const job = vault.claimJob('preserve')
    expect(job?.state).toBe('running')
    expect(vault.claimJob('preserve')).toBeUndefined()
    expect(vault.failJob(job?.id ?? '', 'boom')).toBe('open')
    expect(vault.claimJob('preserve')).toBeUndefined() // backoff not elapsed
    const row = vault.jobs(r.item_id)[0] as NonNullable<ReturnType<typeof vault.jobs>[0]>
    vault.db.prepare("UPDATE job SET next_run_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(row.id)
    expect(vault.claimJob('preserve')?.id).toBe(row.id)
    expect(vault.failJob(row.id, 'boom')).toBe('open')
    vault.db.prepare("UPDATE job SET next_run_at = '2000-01-01T00:00:00Z' WHERE id = ?").run(row.id)
    vault.claimJob('preserve')
    expect(vault.failJob(row.id, 'boom')).toBe('failed')
    vault.markFailed(r.item_id, 'boom')
    vault.retry(r.item_id)
    expect(vault.jobs(r.item_id)[0]?.state).toBe('open')
    expect(vault.item(r.item_id)?.state).toBe('received')
    const again = vault.claimJob('preserve')
    vault.completeJob(again?.id ?? '')
    expect(vault.jobs(r.item_id)[0]?.state).toBe('done')
  })
})

describe('fragments and search', () => {
  it('stores fragments under a run, replaces on re-run, and finds items by phrase prefix', () => {
    const r = vault.receipt({
      source_kind: 'text',
      source_id: 'sha256:t',
      title: 'Meeting notes',
      surface: 's',
    })
    const payload = vault.addPayload(r.item_id, 'raw', 'sha256:t', 'text/plain', 10)
    const run1 = vault.startRun(r.item_id, 'extract::text', '0.1.0')
    vault.replaceFragments(r.item_id, payload.id, run1, 'extract::text', [
      {
        ordinal: 0,
        selector: { kind: 'char', start: 0, end: 20 },
        text: 'Budget approved for the kiosk rollout',
      },
      { ordinal: 1, selector: { kind: 'char', start: 21, end: 40 }, text: 'Next review on Friday' },
    ])
    vault.finishRun(run1)
    const run2 = vault.startRun(r.item_id, 'extract::text', '0.1.1')
    vault.replaceFragments(r.item_id, payload.id, run2, 'extract::text', [
      {
        ordinal: 0,
        selector: { kind: 'char', start: 0, end: 20 },
        text: 'Budget approved for the kiosk rollout',
      },
    ])
    expect(vault.fragments(r.item_id)).toHaveLength(1)
    const hits = vault.search('kiosk roll')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.item_id).toBe(r.item_id)
    expect(hits[0]?.snippet).toContain('[kiosk]')
    expect(vault.search('meeting')[0]?.item_id).toBe(r.item_id) // title match
    expect(vault.search('nothing-here')).toHaveLength(0)
    expect(vault.search('')).toHaveLength(0)
  })
  it('builds safe FTS queries', () => {
    expect(toFtsQuery('kiosk roll')).toBe('"kiosk"* "roll"*')
    expect(toFtsQuery('"exact phrase" other')).toBe('"exact phrase" "other"*')
    expect(toFtsQuery('a-b (c)')).toBe('"ab"* "c"*')
  })
})
