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
    expect(vault.schemaVersion).toBe(4)
    vault.receipt({ source_kind: 'text', source_id: 'sha256:a', surface: 'test' })
    vault.close()
    const again = new Vault(dir)
    expect(again.schemaVersion).toBe(4)
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

describe('graph', () => {
  const seed = () => {
    const a = vault.receipt({
      source_kind: 'text',
      source_id: 'sha256:a',
      title: 'A',
      surface: 's',
    })
    const b = vault.receipt({
      source_kind: 'text',
      source_id: 'sha256:b',
      title: 'B',
      surface: 's',
    })
    const c = vault.receipt({
      source_kind: 'text',
      source_id: 'sha256:c',
      title: 'C',
      surface: 's',
    })
    for (const [r, text] of [
      [a, 'the quorum met at dawn'],
      [b, 'a quorum was never reached'],
      [c, 'unrelated words only'],
    ] as const) {
      const p = vault.addPayload(r.item_id, 'raw', `sha256:${r.item_id}`, 'text/plain', 1)
      const run = vault.startRun(r.item_id, 'extract::text', '0')
      vault.replaceFragments(r.item_id, p.id, run, 'extract::text', [
        { ordinal: 0, selector: { kind: 'char', start: 0, end: text.length }, text },
      ])
    }
    return { a: a.item_id, b: b.item_id, c: c.item_id }
  }
  it('finds shared rare terms with evidence on both ends', () => {
    const { a, b } = seed()
    const rare = vault.rareTerms(a, 1)
    expect(rare.map((r) => r.term)).toContain('quorum')
    expect(vault.artifactsWithTerm('quorum', a).map((r) => r.artifact_id)).toEqual([b])
  })
  it('deduplicates relations per author, keeps a rejection, and answers the five questions', () => {
    const { a, b } = seed()
    const fa = vault.fragments(a)[0]?.id ?? ''
    const r1 = vault.graph.addRelation({
      subject: { kind: 'item', id: a },
      predicate: 'related_to',
      object: { kind: 'item', id: b },
      author: 'link::shared_terms',
      generator: 'shared_terms',
      score: 0.5,
      evidence: [fa],
    })
    const r2 = vault.graph.addRelation({
      subject: { kind: 'item', id: a },
      predicate: 'related_to',
      object: { kind: 'item', id: b },
      author: 'link::shared_terms',
      generator: 'shared_terms',
      score: 0.7,
      evidence: [fa],
    })
    expect(r2.id).toBe(r1.id)
    expect(r2.score).toBe(0.7)
    vault.graph.setStatus(r1.id, 'rejected')
    const r3 = vault.graph.addRelation({
      subject: { kind: 'item', id: a },
      predicate: 'related_to',
      object: { kind: 'item', id: b },
      author: 'link::shared_terms',
      generator: 'shared_terms',
      score: 0.9,
    })
    expect(r3.status).toBe('rejected')
    vault.graph.setStatus(r1.id, 'accepted')
    const n = vault.neighbourhood({ kind: 'item', id: a })
    const edge = n.edges[0]
    expect(edge).toMatchObject({
      predicate: 'related_to',
      author: 'link::shared_terms',
      status: 'accepted',
      evidence_count: 1,
    })
    expect(n.nodes.find((x) => x.id === b)?.reason).toContain('related_to from A')
  })
  it('tags are entities, and the budget hides what does not fit', () => {
    const { a, b, c } = seed()
    const tag = vault.graph.upsertEntity('tag', ' Meeting ')
    expect(vault.graph.upsertEntity('tag', 'meeting').id).toBe(tag.id)
    for (const id of [a, b, c])
      vault.graph.addRelation({
        subject: { kind: 'item', id },
        predicate: 'tagged',
        object: { kind: 'entity', id: tag.id },
        author: 'user',
        status: 'accepted',
      })
    expect(vault.graph.tags(a)[0]?.entity.name).toBe('Meeting')
    const full = vault.neighbourhood({ kind: 'item', id: a })
    expect(full.nodes.map((n) => n.label).sort()).toEqual(['A', 'B', 'C', 'Meeting'])
    const small = vault.neighbourhood({ kind: 'item', id: a }, { budget: 2 })
    expect(small.nodes).toHaveLength(2)
    expect(small.hidden).toBe(2)
  })
})

describe('embeddings and notes (M5)', () => {
  it('stores vectors under a run, finds neighbours, invalidates only embeddings on a model change', () => {
    expect(vault.vectors.available).toBe(true)
    const a = vault.receipt({ source_kind: 'text', source_id: 'sha256:v1', surface: 'test' })
    const b = vault.receipt({ source_kind: 'text', source_id: 'sha256:v2', surface: 'test' })
    for (const id of [a.item_id, b.item_id]) vault.markPreserved(id, `sha256:c${id}`)
    const payload = vault.addPayload(a.item_id, 'raw', 'sha256:blob', 'text/plain', 10)
    const runA = vault.startRun(a.item_id, 'extract::text', '0.2.0')
    vault.replaceFragments(a.item_id, payload.id, runA, 'extract::text', [
      { ordinal: 0, selector: { kind: 'char', start: 0, end: 5 }, text: 'alpha' },
      { ordinal: 1, selector: { kind: 'char', start: 6, end: 10 }, text: 'beta' },
    ])
    const frags = vault.fragments(a.item_id)
    expect(frags[0]?.processor).toBe('extract::text')
    const run = vault.startRun(a.item_id, 'enrich::embed', '0.5.0', { model_digest: 'sha256:m1' })
    const vec = (x: number, y: number) => new Float32Array([x, y, 0, 0])
    vault.putEmbeddings(a.item_id, run, 'm', 'sha256:m1', 4, [
      { fragment_id: frags[0]?.id as string, vector: vec(1, 0) },
      { fragment_id: frags[1]?.id as string, vector: vec(0.9, 0.1) },
    ])
    expect(vault.run(run)?.model_digest).toBe('sha256:m1')
    expect(vault.embeddingCount(a.item_id)).toEqual({ count: 2, model_digest: 'sha256:m1' })
    expect(vault.fragmentsToEmbed(a.item_id, 'sha256:m1')).toHaveLength(0)
    expect(vault.fragmentsToEmbed(a.item_id, 'sha256:m2')).toHaveLength(2)
    const near = vault.nearestFragments(vec(1, 0), 5)
    expect(near[0]?.text).toBe('alpha')
    expect(vault.artifactVector(a.item_id)?.dim).toBe(4)
    expect(vault.nearestArtifacts(vec(1, 0), 5).map((n) => n.id)).toEqual([a.item_id])
    // the model changes: only embeddings go, fragments stay (PRS-5)
    expect(vault.invalidateEmbeddings(a.item_id, 'sha256:m2')).toBe(2)
    expect(vault.fragments(a.item_id)).toHaveLength(2)
    expect(vault.embeddingCount(a.item_id).count).toBe(0)
    expect(vault.nearestFragments(vec(1, 0), 5)).toHaveLength(0)
  })

  it('keeps one note per artifact and author and reads its review status', () => {
    const a = vault.receipt({ source_kind: 'text', source_id: 'sha256:n1', surface: 'test' })
    const run = vault.startRun(a.item_id, 'enrich::extract', '0.5.0')
    const note = vault.upsertNote(a.item_id, 'enrich::extract', 'A summary.', 'Cleaned title', run)
    const rel = vault.graph.addRelation({
      subject: { kind: 'item', id: note },
      predicate: 'derived_from',
      object: { kind: 'item', id: a.item_id },
      author: 'enrich::extract',
      run_id: run,
    })
    expect(vault.notes(a.item_id)).toMatchObject([
      { text: 'A summary.', status: 'suggested', relation_id: rel.id },
    ])
    expect(vault.upsertNote(a.item_id, 'enrich::extract', 'Another.', null, run)).toBe(note)
    expect(vault.notes(a.item_id)[0]?.text).toBe('Another.')
    expect(vault.items().map((i) => i.id)).not.toContain(note)
    const e = vault.graph.upsertEntity('person', 'Priya Raman', ['P. Raman'])
    expect(vault.graph.upsertEntity('person', 'p. raman').id).toBe(e.id)
    expect(vault.graph.aliases(e.id)).toEqual(['P. Raman'])
  })
})
