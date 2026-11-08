import { join } from 'node:path'
import { startPreserveWorker } from '@pim/worker-web-preserve/preserve'
import { app } from 'electron'

// A second instance of the app binary: it must not share the app's profile directory with the running app.
app.setPath('userData', join(app.getPath('temp'), 'pim-web-preserve'))
startPreserveWorker(process.env.III_URL ?? 'ws://127.0.0.1:49140')
