import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'

export interface WatchedFolder {
  path: string
  /** `copy` leaves the original in place; `move` deletes it once the vault holds the bytes. */
  policy: 'copy' | 'move'
}

export interface Settings {
  vaultDir: string
  shortcut: string
  watchedFolders: WatchedFolder[]
  /** Per-install secret for the loopback capture endpoint (CAP-4). Plain file in v0.1 per spec D13. */
  captureSecret: string
}

const file = () => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  const defaults: Settings = {
    vaultDir: join(app.getPath('userData'), 'vault'),
    shortcut: 'CommandOrControl+Shift+Space',
    watchedFolders: [],
    captureSecret: randomBytes(24).toString('hex'),
  }
  if (!existsSync(file())) {
    saveSettings(defaults)
    return defaults
  }
  return { ...defaults, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<Settings>) }
}

export function saveSettings(s: Settings) {
  mkdirSync(dirname(file()), { recursive: true })
  writeFileSync(file(), `${JSON.stringify(s, null, 2)}\n`)
}
