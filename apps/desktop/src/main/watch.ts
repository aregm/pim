import { type FSWatcher, statSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { WatchedFolder } from './settings.ts'

/** Watches folders for new files; a file is captured once its size has been stable for a second. */
export class FolderWatcher {
  private watchers: FSWatcher[] = []
  private pending = new Map<string, { size: number; timer: NodeJS.Timeout }>()

  private readonly onFile: (path: string, folder: WatchedFolder) => void

  constructor(onFile: (path: string, folder: WatchedFolder) => void) {
    this.onFile = onFile
  }

  apply(folders: WatchedFolder[]) {
    for (const w of this.watchers) w.close()
    this.watchers = []
    for (const folder of folders) {
      try {
        const w = watch(folder.path, { recursive: true }, (_event, name) => {
          if (!name || name.startsWith('.')) return
          this.settle(join(folder.path, String(name)), folder)
        })
        w.on('error', (e) =>
          console.error(
            JSON.stringify({ event: 'watch.error', path: folder.path, message: String(e) }),
          ),
        )
        this.watchers.push(w)
      } catch (e) {
        console.error(
          JSON.stringify({ event: 'watch.error', path: folder.path, message: String(e) }),
        )
      }
    }
  }

  private settle(path: string, folder: WatchedFolder) {
    let size: number
    try {
      const st = statSync(path)
      if (!st.isFile()) return
      size = st.size
    } catch {
      return
    }
    const prev = this.pending.get(path)
    if (prev) clearTimeout(prev.timer)
    const timer = setTimeout(() => {
      const entry = this.pending.get(path)
      this.pending.delete(path)
      try {
        if (entry && statSync(path).size === entry.size) this.onFile(path, folder)
        else this.settle(path, folder)
      } catch {
        /* removed before capture */
      }
    }, 1000)
    this.pending.set(path, { size, timer })
  }

  close() {
    for (const w of this.watchers) w.close()
  }
}
