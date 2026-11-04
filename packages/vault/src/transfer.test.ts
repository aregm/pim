import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupVault, restoreVault, verifyVault } from './backup.ts'
import { Vault } from './index.ts'
import { exportItems, importPackage } from './transfer.ts'

let root: string
let vault: Vault
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pim-transfer-'))
  vault = new Vault(join(root, 'a'))
})
afterEach(() => {
  vault.close()
  rmSync(root, { recursive: true, force: true })
})

/** Two text items with fragments, an entity shared by both, a summary note, links with evidence, and jobs. */
async function populate(v: Vault) {
  const ids: string[] = []
  const frags: string[][] = []
  for (const [n, text] of [
    ['one', 'The lighthouse keeper logged the kiosk rollout.'],
    ['two', 'Minutes about the kiosk rollout and the harbour quorum.'],
  ]) {
    const bytes = Buffer.from(text as string)
    const stored = await v.blobs.putBuffer(bytes)
    const r = v.receipt({
      source_kind: 'text',
      source_id: stored.blob_id,
      title: `note ${n}`,
      surface: 'test',
    })
    v.addPayload(r.item_id, 'raw', stored.blob_id, 'text/plain', stored.byte_length)
    v.markPreserved(r.item_id, stored.blob_id)
    const run = v.startRun(r.item_id, 'extract::text', '0.2.0')
    const payload = v.payloads(r.item_id)[0]
    if (!payload) throw new Error('no payload')
    v.replaceFragments(r.item_id, payload.id, run, 'extract::text', [
      {
        ordinal: 0,
        selector: { kind: 'char', start: 0, end: 20 },
        text: (text as string).slice(0, 20),
      },
      {
        ordinal: 1,
        selector: { kind: 'char', start: 20, end: 60 },
        text: (text as string).slice(20),
      },
    ])
    v.finishRun(run)
    v.enqueue(r.item_id, 'extract')
    v.enqueue(r.item_id, 'enrich')
    v.enqueue(r.item_id, 'link')
    for (const j of v.jobs(r.item_id))
      v.completeJob(j.id, j.stage === 'enrich' ? 'skipped: no model' : undefined)
    ids.push(r.item_id)
    frags.push(v.fragments(r.item_id).map((f) => f.id))
  }
  const [a, b] = ids as [string, string]
  const kiosk = v.graph.upsertEntity('project', 'Kiosk rollout', ['kiosk project'])
  const enrich = v.startRun(a, 'enrich::extract', '0.5.0', {
    model_digest: 'sha256:m',
    prompt_digest: 'p',
  })
  v.graph.addRelation({
    subject: { kind: 'item', id: a },
    predicate: 'mentions',
    object: { kind: 'entity', id: kiosk.id },
    author: 'enrich::extract',
    run_id: enrich,
    evidence: [frags[0]?.[1] as string],
  })
  const noteId = v.upsertNote(
    a,
    'enrich::extract',
    'A log about the rollout.',
    'Rollout log',
    enrich,
  )
  v.graph.addRelation({
    subject: { kind: 'item', id: noteId },
    predicate: 'derived_from',
    object: { kind: 'item', id: a },
    author: 'enrich::extract',
    run_id: enrich,
    evidence: [frags[0]?.[0] as string],
  })
  v.finishRun(enrich)
  const tag = v.graph.upsertEntity('tag', 'harbour')
  v.graph.addRelation({
    subject: { kind: 'item', id: b },
    predicate: 'tagged',
    object: { kind: 'entity', id: tag.id },
    author: 'person',
    status: 'accepted',
  })
  const link = v.graph.addRelation({
    subject: { kind: 'item', id: a },
    predicate: 'shares_terms',
    object: { kind: 'item', id: b },
    author: 'link::terms',
    generator: 'shared_terms',
    score: 0.8,
    evidence: [frags[0]?.[1] as string, frags[1]?.[0] as string],
  })
  v.graph.setStatus(link.id, 'accepted')
  return { ids, frags, kiosk, tag, link, noteId }
}

const snapshot = (v: Vault) => ({
  items: v.db.prepare('SELECT id, kind, title FROM item ORDER BY id').all() as object[],
  artifacts: v.db
    .prepare(
      'SELECT item_id, source_kind, source_id, state, content_hash FROM artifact ORDER BY item_id',
    )
    .all() as object[],
  fragments: v.db
    .prepare('SELECT id, artifact_id, ordinal, selector_json, text FROM fragment ORDER BY id')
    .all() as object[],
  relations: v.db
    .prepare(
      'SELECT id, subject_kind, subject_id, predicate, object_kind, object_id, status, author, score FROM relation ORDER BY id',
    )
    .all() as object[],
  evidence: v.db
    .prepare(
      'SELECT relation_id, fragment_id, role FROM relation_evidence ORDER BY relation_id, fragment_id',
    )
    .all() as object[],
  entities: v.db
    .prepare('SELECT id, kind, name, normalized FROM entity ORDER BY id')
    .all() as object[],
  aliases: v.db
    .prepare('SELECT entity_id, normalized, name FROM entity_alias ORDER BY entity_id, normalized')
    .all() as object[],
  notes: v.db
    .prepare('SELECT item_id, artifact_id, author, text, title FROM note ORDER BY item_id')
    .all() as object[],
  runs: v.db
    .prepare(
      'SELECT id, artifact_id, processor, model_digest, status FROM processing_run ORDER BY id',
    )
    .all() as object[],
  payloads: v.db
    .prepare(
      'SELECT id, artifact_id, role, blob_id, mime, byte_length FROM artifact_payload ORDER BY id',
    )
    .all() as object[],
})

describe('export (MET-5)', () => {
  it('writes a package that opens without the app: index, items, attachments, and every link resolves', async () => {
    const { ids, kiosk } = await populate(vault)
    const dir = join(root, 'pkg')
    const report = exportItems(vault, ids, dir, '0.1.0')
    expect(report.items).toBe(2)
    expect(report.blobs).toBe(2)
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    expect(manifest.format).toBe('pim-export')
    expect(manifest.items.map((i: { id: string }) => i.id)).toEqual(ids)
    expect(manifest.entities).toBe(2)
    const index = readFileSync(join(dir, 'index.md'), 'utf8')
    const md = readFileSync(join(dir, 'items', `${ids[0]}.md`), 'utf8')
    for (const text of [index, md])
      for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
        const target = decodeURI(m[1] as string)
        const base = text === index ? dir : join(dir, 'items')
        expect(existsSync(join(base, target)), `${target} resolves`).toBe(true)
      }
    expect(md).toContain('## Summary (enrich::extract, suggested)')
    expect(md).toContain('Kiosk rollout (project, suggested)')
    expect(md).toContain(`shares_terms → [note two](${ids[1]}.md) (accepted, link::terms)`)
    expect(md).toContain('chars 0–20: The lighthouse keepe')
    expect(readdirSync(join(dir, 'blobs')).every((f) => f.endsWith('.txt'))).toBe(true)
    const entities = JSON.parse(readFileSync(join(dir, 'entities.json'), 'utf8'))
    expect(entities.entities.find((e: { id: string }) => e.id === kiosk.id).aliases).toEqual([
      { normalized: 'kiosk project', name: 'kiosk project' },
    ])
  })
  it('marks links to items outside the package', async () => {
    const { ids } = await populate(vault)
    const dir = join(root, 'pkg-one')
    exportItems(vault, [ids[0] as string], dir, '0.1.0')
    const md = readFileSync(join(dir, 'items', `${ids[0]}.md`), 'utf8')
    expect(md).toContain('note two (not in this package)')
  })
})

describe('import (MET-3)', () => {
  it('round-trips into a fresh vault with every id, link and blob, and search works there', async () => {
    const { ids } = await populate(vault)
    const dir = join(root, 'pkg')
    exportItems(vault, ids, dir, '0.1.0')
    const fresh = new Vault(join(root, 'b'))
    try {
      const report = await importPackage(fresh, dir)
      expect(report).toMatchObject({
        items: 2,
        existing: 0,
        conflicts: [],
        blobs: 2,
        entities: 2,
        relations: 4,
      })
      expect(snapshot(fresh)).toEqual(snapshot(vault))
      expect(fresh.search('lighthouse').map((h) => h.item_id)).toEqual([ids[0]])
      for (const p of fresh.payloads(ids[0] as string))
        expect(fresh.blobs.has(p.blob_id)).toBe(true)
      // enrichment and linking are reopened so vectors are rebuilt; preservation and extraction are not
      const stages = Object.fromEntries(fresh.jobs(ids[0] as string).map((j) => [j.stage, j.state]))
      expect(stages).toEqual({ extract: 'done', enrich: 'open', link: 'open' })
    } finally {
      fresh.close()
    }
  })
  it('leaves existing items alone and matches entities by name when ids differ', async () => {
    const { ids } = await populate(vault)
    const dir = join(root, 'pkg')
    exportItems(vault, ids, dir, '0.1.0')
    const again = await importPackage(vault, dir)
    expect(again).toMatchObject({ items: 0, existing: 2, blobs: 0, entities: 0, relations: 0 })
    const other = new Vault(join(root, 'c'))
    try {
      const theirs = other.graph.upsertEntity('project', 'kiosk rollout')
      const report = await importPackage(other, dir)
      expect(report.entities).toBe(1)
      const mention = other.db
        .prepare("SELECT object_id FROM relation WHERE predicate = 'mentions'")
        .get() as { object_id: string }
      expect(mention.object_id).toBe(theirs.id)
    } finally {
      other.close()
    }
  })
  it('refuses a package whose bytes do not match their hash and imports nothing', async () => {
    const { ids } = await populate(vault)
    const dir = join(root, 'pkg')
    exportItems(vault, ids, dir, '0.1.0')
    const blob = readdirSync(join(dir, 'blobs'))[0] as string
    unlinkSync(join(dir, 'blobs', blob))
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(dir, 'blobs', blob), 'tampered')
    const fresh = new Vault(join(root, 'd'))
    try {
      await expect(importPackage(fresh, dir)).rejects.toThrow(/does not hash/)
      expect(fresh.items()).toHaveLength(0)
    } finally {
      fresh.close()
    }
  })
})

describe('backup and restore (SEC-4)', () => {
  it('snapshots the vault while open, restores into a fresh folder, and the restore opens every item and passes search', async () => {
    await populate(vault)
    const { dir, manifest } = await backupVault(vault, join(root, 'backups'), '0.1.0')
    expect(manifest).toMatchObject({ format: 'pim-backup', items: 2, blobs: 2 })
    expect(existsSync(join(dir, 'vault.sqlite'))).toBe(true)
    const target = join(root, 'restored')
    restoreVault(dir, target)
    const report = verifyVault(target)
    expect(report).toMatchObject({ ok: true, items: 2, payloads: 2, missing_blobs: [] })
    expect(report.search?.found).toBe(true)
    expect(() => restoreVault(dir, target)).toThrow(/not empty/)
  })
  it('reports a restore whose bytes are missing', async () => {
    await populate(vault)
    const { dir } = await backupVault(vault, join(root, 'backups'), '0.1.0')
    const shard = readdirSync(join(dir, 'blobs'))[0] as string
    rmSync(join(dir, 'blobs', shard), { recursive: true })
    const target = join(root, 'restored-2')
    restoreVault(dir, target)
    const report = verifyVault(target)
    expect(report.ok).toBe(false)
    expect(report.missing_blobs.length).toBeGreaterThan(0)
  })
})
