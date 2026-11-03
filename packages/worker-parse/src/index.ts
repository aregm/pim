import { startWorker } from '@pim/worker-kit'

// M0: health only. M2 adds extract::text for HTML, PDF, text, Markdown and eml.
startWorker({ name: 'parse', version: '0.1.0' })
