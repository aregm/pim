import { startWorker } from '@pim/worker-kit'
import { extractFile } from './extract/index.ts'

interface ExtractRequest {
  artifact_id: string
  payload_id: string
  mime: string
  /** Blob path on this machine; the worker reads it and never writes (see docs/gates/gate-2.md). */
  path: string
}

startWorker({
  name: 'parse',
  version: '0.2.0',
  functions: {
    'extract::text': async (input: unknown) => {
      const req = input as ExtractRequest
      const t = Date.now()
      const out = await extractFile(req.mime, req.path)
      console.log(
        JSON.stringify({
          event: 'extract.text',
          mime: req.mime,
          fragments: out.fragments.length,
          ms: Date.now() - t,
        }),
      )
      return out
    },
  },
})
