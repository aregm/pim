import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { backup } from 'node:sqlite'
import { Vault } from './index.ts'

/**
 * SEC-4: a backup is a snapshot folder, `pim-backup-<time>/`, with an online copy of the database (consistent
 * while the app keeps writing), the blobs, and `backup.json`. A restore copies it into a fresh, empty folder; the
 * restore test does that into a temporary folder, opens every item and runs a search.
 */

export const BACKUP_FORMAT = 'pim-backup'

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: 1
  created_at: string
  app_version: string
  schema_version: number
  items: number
  blobs: number
  bytes: number
}

export interface VerifyReport {
  ok: boolean
  items: number
  payloads: number
  missing_blobs: string[]
  /** The search that was run and what it found; absent when the vault has no fragments to search for. */
  search: { query: string; found: boolean } | null
  schema_version: number
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)

function copyBlobs(from: string, to: string): { blobs: number; bytes: number } {
  let blobs = 0
  let bytes = 0
  mkdirSync(to, { recursive: true })
  for (const shard of readdirSync(from)) {
    if (shard === 'tmp') continue
    const dir = join(from, shard)
    if (!statSync(dir).isDirectory()) continue
    cpSync(dir, join(to, shard), { recursive: true })
    for (const f of readdirSync(dir)) {
      blobs++
      bytes += statSync(join(dir, f)).size
    }
  }
  return { blobs, bytes }
}

export async function backupVault(
  vault: Vault,
  destination: string,
  appVersion: string,
): Promise<{ dir: string; manifest: BackupManifest }> {
  const dir = join(destination, `pim-backup-${stamp()}`)
  mkdirSync(dir, { recursive: true })
  await backup(vault.db, join(dir, 'vault.sqlite'))
  const { blobs, bytes } = copyBlobs(vault.blobs.dir, join(dir, 'blobs'))
  const items = (vault.db.prepare('SELECT COUNT(*) n FROM artifact').get() as { n: number }).n
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: 1,
    created_at: new Date().toISOString(),
    app_version: appVersion,
    schema_version: vault.schemaVersion,
    items,
    blobs,
    bytes,
  }
  writeFileSync(join(dir, 'backup.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { dir, manifest }
}

export function readBackupManifest(dir: string): BackupManifest {
  const file = join(dir, 'backup.json')
  if (!existsSync(file)) throw new Error(`${dir} holds no backup.json`)
  const m = JSON.parse(readFileSync(file, 'utf8')) as BackupManifest
  if (m.format !== BACKUP_FORMAT) throw new Error(`${dir} is not a PIM backup`)
  if (!existsSync(join(dir, 'vault.sqlite'))) throw new Error(`${dir} holds no vault.sqlite`)
  return m
}

/** Copies a backup into `target`, which must not exist or must be empty. */
export function restoreVault(backupDir: string, target: string): BackupManifest {
  const manifest = readBackupManifest(backupDir)
  if (existsSync(target) && readdirSync(target).length) throw new Error(`${target} is not empty`)
  mkdirSync(target, { recursive: true })
  cpSync(join(backupDir, 'vault.sqlite'), join(target, 'vault.sqlite'))
  if (existsSync(join(backupDir, 'blobs')))
    copyBlobs(join(backupDir, 'blobs'), join(target, 'blobs'))
  else mkdirSync(join(target, 'blobs'), { recursive: true })
  return manifest
}

/** Opens a vault directory, checks that every payload's bytes are there, and searches for a word it holds. */
export function verifyVault(dir: string): VerifyReport {
  const vault = new Vault(dir)
  try {
    const payloads = vault.db
      .prepare('SELECT blob_id, byte_length FROM artifact_payload')
      .all() as { blob_id: string; byte_length: number }[]
    const missing = payloads
      .filter((p) => {
        const path = vault.blobs.pathFor(p.blob_id)
        return !existsSync(path) || statSync(path).size !== p.byte_length
      })
      .map((p) => p.blob_id)
    const items = (vault.db.prepare('SELECT COUNT(*) n FROM artifact').get() as { n: number }).n
    let search: VerifyReport['search'] = null
    const sample = vault.db
      .prepare('SELECT artifact_id, text FROM fragment ORDER BY created_at DESC LIMIT 50')
      .all() as { artifact_id: string; text: string }[]
    for (const f of sample) {
      const word = f.text.split(/\s+/).find((w) => /^\p{L}{5,}$/u.test(w))
      if (!word) continue
      search = { query: word, found: vault.search(word).some((h) => h.item_id === f.artifact_id) }
      break
    }
    return {
      ok: missing.length === 0 && (search?.found ?? true),
      items,
      payloads: payloads.length,
      missing_blobs: missing,
      search,
      schema_version: vault.schemaVersion,
    }
  } finally {
    vault.close()
  }
}
