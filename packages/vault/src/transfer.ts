import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, join } from 'node:path'
import type { Selector, Vault } from './index.ts'

/**
 * Export and import of items as a package the person can open without the application (MET-5) and bring back
 * with every id and link intact (MET-3). A package is a folder:
 *
 *   manifest.json      what is inside, with blob hashes
 *   index.md           every item, linked
 *   items/<id>.md      the item for a reader: metadata, attachments, summary, tags, links, content
 *   items/<id>.json    the item for a machine: every row it owns, ids included
 *   entities.json      the entities the items refer to, with aliases, and the relations between entities
 *   blobs/<hex>.<ext>  the original bytes, content-addressed
 *
 * Embeddings are not exported: they are derived from the fragments and the import reopens the enrich stage, which
 * rebuilds them under the current model and skips extraction already done with the same model.
 */

export const EXPORT_FORMAT = 'pim-export'
export const EXPORT_VERSION = 1

interface Row {
  [k: string]: unknown
}
interface RelationExport extends Row {
  id: string
  subject_kind: string
  subject_id: string
  predicate: string
  object_kind: string
  object_id: string
  author: string
  evidence: { fragment_id: string; role: string }[]
}
interface ItemExport {
  item: Row
  artifact: Row
  capture_events: Row[]
  payloads: Row[]
  runs: Row[]
  fragments: Row[]
  notes: { item: Row; note: Row }[]
  relations: RelationExport[]
  jobs: Row[]
}
interface EntityExport extends Row {
  id: string
  kind: string
  name: string
  normalized: string
  created_at: string
  aliases: { normalized: string; name: string }[]
}
export interface Manifest {
  format: typeof EXPORT_FORMAT
  version: typeof EXPORT_VERSION
  exported_at: string
  app_version: string
  schema_version: number
  items: { id: string; title: string | null; kind: string; file: string }[]
  entities: number
  relations: number
  blobs: { blob_id: string; file: string; mime: string; byte_length: number }[]
}

export interface ExportReport {
  dir: string
  items: number
  blobs: number
  bytes: number
}

export interface ImportReport {
  items: number
  existing: number
  conflicts: string[]
  blobs: number
  entities: number
  relations: number
}

const EXT: Record<string, string> = {
  'text/html': 'html',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/pdf': 'pdf',
  'application/json': 'json',
  'message/rfc822': 'eml',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/aiff': 'aiff',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
}
const blobFile = (blobId: string, mime: string) => {
  const ext = EXT[mime]
  return `${blobId.replace(/^sha256:/, '')}${ext ? `.${ext}` : ''}`
}
const where = (s: Selector) =>
  s.kind === 'page'
    ? `p. ${s.page}`
    : s.kind === 'time'
      ? `${Math.floor(s.start_ms / 60000)}:${String(Math.floor(s.start_ms / 1000) % 60).padStart(2, '0')}`
      : s.kind === 'block'
        ? `¶ ${s.index + 1}`
        : s.kind === 'char'
          ? `chars ${s.start}–${s.end}`
          : 'region'
const kb = (n: number) =>
  n < 1024
    ? `${n} B`
    : n < 1048576
      ? `${Math.round(n / 1024)} kB`
      : `${(n / 1048576).toFixed(1)} MB`
const md = (s: string) => s.replace(/[\\`*_[\]<>]/g, (c) => `\\${c}`)
const link = (file: string) => encodeURI(file)

const all = (vault: Vault, sql: string, ...params: (string | number)[]) =>
  vault.db.prepare(sql).all(...params) as unknown as Row[]
const one = (vault: Vault, sql: string, ...params: (string | number)[]) =>
  vault.db.prepare(sql).get(...params) as unknown as Row | undefined

/** Every row an item owns, plus the relations that touch it or its notes. */
function collect(vault: Vault, id: string): ItemExport | undefined {
  const item = one(vault, 'SELECT * FROM item WHERE id = ?', id)
  const artifact = one(vault, 'SELECT * FROM artifact WHERE item_id = ?', id)
  if (!item || !artifact) return undefined
  const notes = all(vault, 'SELECT * FROM note WHERE artifact_id = ? ORDER BY created_at', id).map(
    (note) => ({
      note,
      item: one(vault, 'SELECT * FROM item WHERE id = ?', note.item_id as string) ?? {},
    }),
  )
  const owned = [id, ...notes.map((n) => n.note.item_id as string)]
  const marks = owned.map(() => '?').join(',')
  const relations = all(
    vault,
    `SELECT * FROM relation WHERE (subject_kind = 'item' AND subject_id IN (${marks})) OR (object_kind = 'item' AND object_id IN (${marks})) ORDER BY created_at`,
    ...owned,
    ...owned,
  ).map((r) => ({
    ...r,
    evidence: all(
      vault,
      'SELECT fragment_id, role FROM relation_evidence WHERE relation_id = ?',
      r.id as string,
    ) as { fragment_id: string; role: string }[],
  })) as RelationExport[]
  return {
    item,
    artifact,
    capture_events: all(vault, 'SELECT * FROM capture_event WHERE artifact_id = ? ORDER BY at', id),
    payloads: all(
      vault,
      'SELECT * FROM artifact_payload WHERE artifact_id = ? ORDER BY created_at',
      id,
    ),
    runs: all(vault, 'SELECT * FROM processing_run WHERE artifact_id = ? ORDER BY started_at', id),
    fragments: all(vault, 'SELECT * FROM fragment WHERE artifact_id = ? ORDER BY ordinal', id),
    notes,
    relations,
    jobs: all(vault, 'SELECT * FROM job WHERE artifact_id = ? ORDER BY created_at', id),
  }
}

function renderItem(
  vault: Vault,
  x: ItemExport,
  inPackage: Map<string, string>,
  entities: Map<string, EntityExport>,
): string {
  const item = x.item
  const a = x.artifact
  const lines: string[] = [`# ${md((item.title as string | null) ?? (a.source_id as string))}`, '']
  lines.push(`- Kind: ${a.source_kind}`)
  if (a.source_uri) lines.push(`- Source: <${a.source_uri}>`)
  const first = x.capture_events[0]?.at as string | undefined
  lines.push(
    `- Captured: ${first ?? item.created_at}${x.capture_events.length > 1 ? ` (${x.capture_events.length} captures)` : ''}`,
  )
  lines.push(`- State: ${a.state}`)
  if (a.content_hash) lines.push(`- Content hash: \`${a.content_hash}\``)
  lines.push(`- Id: \`${item.id}\``, '')
  if (x.payloads.length) {
    lines.push('## Attachments', '')
    for (const p of x.payloads)
      lines.push(
        `- [${p.role} (${p.mime}, ${kb(p.byte_length as number)})](../blobs/${link(blobFile(p.blob_id as string, p.mime as string))})`,
      )
    lines.push('')
  }
  const entityName = (id: string) => entities.get(id)?.name ?? id
  const itemLabel = (id: string) => {
    const title = one(vault, 'SELECT title FROM item WHERE id = ?', id)?.title as
      | string
      | null
      | undefined
    const file = inPackage.get(id)
    return file
      ? `[${md(title ?? id)}](${link(basename(file))})`
      : `${md(title ?? id)} (not in this package)`
  }
  for (const n of x.notes) {
    const rel = x.relations.find(
      (r) => r.predicate === 'derived_from' && r.subject_id === n.note.item_id,
    )
    lines.push(
      `## Summary (${n.note.author}, ${rel?.status ?? 'suggested'})`,
      '',
      n.note.text as string,
      '',
    )
  }
  const byPredicate = (p: string, status?: string) =>
    x.relations.filter(
      (r) => r.predicate === p && r.subject_id === item.id && (!status || r.status === status),
    )
  const tagsAccepted = byPredicate('tagged', 'accepted').map((r) => entityName(r.object_id))
  const tagsSuggested = byPredicate('tagged', 'suggested').map((r) => entityName(r.object_id))
  if (tagsAccepted.length || tagsSuggested.length) {
    lines.push('## Tags', '')
    if (tagsAccepted.length) lines.push(`- Accepted: ${tagsAccepted.map(md).join(', ')}`)
    if (tagsSuggested.length) lines.push(`- Suggested: ${tagsSuggested.map(md).join(', ')}`)
    lines.push('')
  }
  const mentions = byPredicate('mentions').filter((r) => r.status !== 'rejected')
  if (mentions.length) {
    lines.push('## Entities', '')
    for (const r of mentions) {
      const e = entities.get(r.object_id)
      lines.push(`- ${md(e?.name ?? r.object_id)} (${e?.kind ?? 'entity'}, ${r.status})`)
    }
    lines.push('')
  }
  const links = x.relations.filter(
    (r) =>
      r.subject_kind === 'item' &&
      r.object_kind === 'item' &&
      r.predicate !== 'derived_from' &&
      r.status !== 'rejected',
  )
  if (links.length) {
    lines.push('## Links', '')
    for (const r of links) {
      const other = r.subject_id === item.id ? r.object_id : r.subject_id
      const arrow = r.subject_id === item.id ? '→' : '←'
      lines.push(`- ${r.predicate} ${arrow} ${itemLabel(other)} (${r.status}, ${r.author})`)
    }
    lines.push('')
  }
  if (x.fragments.length) {
    lines.push('## Content', '')
    const processorOf = new Map(x.runs.map((r) => [r.id as string, r.processor as string]))
    for (const f of x.fragments) {
      const sel = JSON.parse(f.selector_json as string) as Selector
      const model = (processorOf.get(f.run_id as string) ?? '').startsWith('enrich::')
        ? ' (model)'
        : ''
      lines.push(`- ${where(sel)}${model}: ${(f.text as string).replace(/\s+/g, ' ')}`)
    }
    lines.push('')
  }
  return `${lines.join('\n')}\n`
}

/** Writes the package; `dir` must not exist or must be empty. */
export function exportItems(
  vault: Vault,
  ids: string[],
  dir: string,
  appVersion: string,
): ExportReport {
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`${dir} is not empty`)
  mkdirSync(join(dir, 'items'), { recursive: true })
  mkdirSync(join(dir, 'blobs'), { recursive: true })
  const exports = new Map<string, ItemExport>()
  for (const id of ids) {
    const x = collect(vault, id)
    if (x) exports.set(id, x)
  }
  // entities the items refer to, and the relations between those entities
  const entities = new Map<string, EntityExport>()
  for (const x of exports.values())
    for (const r of x.relations)
      for (const [kind, id] of [
        [r.subject_kind, r.subject_id],
        [r.object_kind, r.object_id],
      ] as [string, string][]) {
        if (kind !== 'entity' || entities.has(id)) continue
        const e = one(vault, 'SELECT * FROM entity WHERE id = ?', id)
        if (!e) continue
        entities.set(id, {
          ...(e as EntityExport),
          aliases: all(
            vault,
            'SELECT normalized, name FROM entity_alias WHERE entity_id = ?',
            id,
          ) as {
            normalized: string
            name: string
          }[],
        })
      }
  const entityIds = [...entities.keys()]
  const entityRelations: RelationExport[] = entityIds.length
    ? (all(
        vault,
        `SELECT * FROM relation WHERE subject_kind = 'entity' AND object_kind = 'entity' AND subject_id IN (${entityIds.map(() => '?').join(',')}) AND object_id IN (${entityIds.map(() => '?').join(',')})`,
        ...entityIds,
        ...entityIds,
      ).map((r) => ({ ...r, evidence: [] })) as unknown as RelationExport[])
    : []
  // blobs, content-addressed, each once
  const blobs = new Map<string, Manifest['blobs'][number]>()
  let bytes = 0
  for (const x of exports.values())
    for (const p of x.payloads) {
      const blob_id = p.blob_id as string
      if (blobs.has(blob_id)) continue
      const file = `blobs/${blobFile(blob_id, p.mime as string)}`
      copyFileSync(vault.blobs.pathFor(blob_id), join(dir, file))
      blobs.set(blob_id, {
        blob_id,
        file,
        mime: p.mime as string,
        byte_length: p.byte_length as number,
      })
      bytes += p.byte_length as number
    }
  const inPackage = new Map([...exports.keys()].map((id) => [id, `items/${id}.md`]))
  const manifest: Manifest = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    app_version: appVersion,
    schema_version: vault.schemaVersion,
    items: [...exports.values()].map((x) => ({
      id: x.item.id as string,
      title: x.item.title as string | null,
      kind: x.artifact.source_kind as string,
      file: `items/${x.item.id}.json`,
    })),
    entities: entities.size,
    relations:
      [...exports.values()].reduce((n, x) => n + x.relations.length, 0) + entityRelations.length,
    blobs: [...blobs.values()],
  }
  for (const x of exports.values()) {
    writeFileSync(join(dir, 'items', `${x.item.id}.json`), `${JSON.stringify(x, null, 2)}\n`)
    writeFileSync(join(dir, 'items', `${x.item.id}.md`), renderItem(vault, x, inPackage, entities))
  }
  writeFileSync(
    join(dir, 'entities.json'),
    `${JSON.stringify({ entities: [...entities.values()], relations: entityRelations }, null, 2)}\n`,
  )
  const index = [
    '# PIM export',
    '',
    `Exported ${manifest.exported_at} by PIM ${appVersion}: ${manifest.items.length} item${manifest.items.length === 1 ? '' : 's'}, ${blobs.size} attachment${blobs.size === 1 ? '' : 's'}.`,
    '',
    ...manifest.items.map(
      (i) => `- [${md(i.title ?? i.id)}](${link(`items/${i.id}.md`)}) · ${i.kind}`,
    ),
    '',
  ]
  writeFileSync(join(dir, 'index.md'), `${index.join('\n')}\n`)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, items: exports.size, blobs: blobs.size, bytes }
}

const columns = (row: Row) => Object.keys(row)
const insert = (vault: Vault, table: string, row: Row, orIgnore = false) => {
  const cols = columns(row)
  vault.db
    .prepare(
      `INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    )
    .run(...cols.map((c) => row[c] as string | number | null))
}
const exists = (vault: Vault, sql: string, ...params: string[]) =>
  one(vault, sql, ...params) !== undefined

/**
 * Brings a package back. Items already in the vault (same id) are left as they are and counted as existing; an
 * item whose source identity exists under another id is a conflict and is skipped. Entities are matched by id,
 * then by kind and name; relations keep their ids when both ends exist.
 */
export async function importPackage(vault: Vault, dir: string): Promise<ImportReport> {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest
  if (manifest.format !== EXPORT_FORMAT || manifest.version !== EXPORT_VERSION)
    throw new Error(
      `not a PIM export package (${manifest.format ?? 'unknown'} ${manifest.version ?? ''})`,
    )
  if (manifest.schema_version > vault.schemaVersion)
    throw new Error(
      `the package comes from schema ${manifest.schema_version}, this app has ${vault.schemaVersion}`,
    )
  const report: ImportReport = {
    items: 0,
    existing: 0,
    conflicts: [],
    blobs: 0,
    entities: 0,
    relations: 0,
  }
  // 1. blobs, verified by hash as they land
  for (const b of manifest.blobs) {
    const stored = await vault.blobs.putFile(join(dir, b.file))
    if (stored.blob_id !== b.blob_id)
      throw new Error(`${b.file} does not hash to ${b.blob_id}; nothing imported`)
    if (!stored.existed) report.blobs++
  }
  // 2. entities, by id, then by kind and name or alias
  const entityFile = JSON.parse(readFileSync(join(dir, 'entities.json'), 'utf8')) as {
    entities: EntityExport[]
    relations: RelationExport[]
  }
  const entityId = new Map<string, string>()
  for (const e of entityFile.entities) {
    const { aliases, ...row } = e
    let id = e.id
    if (!exists(vault, 'SELECT 1 FROM entity WHERE id = ?', e.id)) {
      const twin = vault.graph.findEntity(e.kind, e.name)
      if (twin) id = twin.id
      else {
        insert(vault, 'entity', row)
        report.entities++
      }
    }
    entityId.set(e.id, id)
    for (const a of aliases)
      insert(vault, 'entity_alias', { entity_id: id, normalized: a.normalized, name: a.name }, true)
  }
  // 3. items, one transaction each
  const relations: RelationExport[] = [...entityFile.relations]
  for (const entry of manifest.items) {
    const x = JSON.parse(readFileSync(join(dir, entry.file), 'utf8')) as ItemExport
    const id = x.item.id as string
    relations.push(...x.relations)
    if (exists(vault, 'SELECT 1 FROM item WHERE id = ?', id)) {
      report.existing++
      continue
    }
    const twin = one(
      vault,
      'SELECT item_id FROM artifact WHERE source_kind = ? AND source_id = ?',
      x.artifact.source_kind as string,
      x.artifact.source_id as string,
    )
    if (twin) {
      report.conflicts.push(
        `${entry.title ?? id}: its source is already in the vault as ${twin.item_id}`,
      )
      continue
    }
    vault.db.exec('BEGIN')
    try {
      insert(vault, 'item', x.item)
      const duplicateOf = x.artifact.duplicate_of as string | null
      insert(vault, 'artifact', {
        ...x.artifact,
        duplicate_of:
          duplicateOf && exists(vault, 'SELECT 1 FROM artifact WHERE item_id = ?', duplicateOf)
            ? duplicateOf
            : null,
      })
      for (const r of x.capture_events) insert(vault, 'capture_event', r)
      for (const r of x.payloads) insert(vault, 'artifact_payload', r)
      for (const r of x.runs) insert(vault, 'processing_run', r)
      for (const r of x.fragments) insert(vault, 'fragment', r)
      for (const n of x.notes) {
        insert(vault, 'item', n.item)
        insert(vault, 'note', n.note)
      }
      // enrichment is derived and rebuilt here (embeddings are not in the package); links are recomputed
      for (const j of x.jobs) {
        const stage = j.stage as string
        const reopen = stage === 'enrich' || stage === 'link' || j.state === 'running'
        insert(vault, 'job', {
          ...j,
          state: reopen ? 'open' : j.state,
          attempts: reopen ? 0 : j.attempts,
          lease_until: null,
          last_error: reopen ? null : j.last_error,
        })
      }
      vault.db.exec('COMMIT')
      report.items++
    } catch (e) {
      vault.db.exec('ROLLBACK')
      throw e
    }
  }
  // 4. relations whose both ends exist now, ids kept; a tuple that already exists under another id is left alone
  const seen = new Set<string>()
  for (const r of relations) {
    if (seen.has(r.id)) continue
    seen.add(r.id)
    const map = (kind: string, id: string) => (kind === 'entity' ? (entityId.get(id) ?? id) : id)
    const subject = map(r.subject_kind, r.subject_id)
    const object = map(r.object_kind, r.object_id)
    const endExists = (kind: string, id: string) =>
      kind === 'entity'
        ? exists(vault, 'SELECT 1 FROM entity WHERE id = ?', id)
        : exists(vault, 'SELECT 1 FROM item WHERE id = ?', id)
    if (!endExists(r.subject_kind, subject) || !endExists(r.object_kind, object)) continue
    if (exists(vault, 'SELECT 1 FROM relation WHERE id = ?', r.id)) continue
    const { evidence, ...row } = r
    const before = vault.db.prepare('SELECT COUNT(*) n FROM relation').get() as { n: number }
    insert(vault, 'relation', { ...row, subject_id: subject, object_id: object }, true)
    const after = vault.db.prepare('SELECT COUNT(*) n FROM relation').get() as { n: number }
    if (after.n === before.n) continue
    report.relations++
    for (const ev of evidence)
      if (exists(vault, 'SELECT 1 FROM fragment WHERE id = ?', ev.fragment_id))
        insert(
          vault,
          'relation_evidence',
          { relation_id: r.id, fragment_id: ev.fragment_id, role: ev.role },
          true,
        )
  }
  return report
}
