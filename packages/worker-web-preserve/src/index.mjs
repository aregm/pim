// The worker as compose starts it from the repository: `electron src/index.mjs`.
import { startPreserveWorker } from './preserve.mjs'

startPreserveWorker(process.env.III_URL ?? 'ws://127.0.0.1:49140')
