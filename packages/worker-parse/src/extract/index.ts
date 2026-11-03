import { readFileSync } from 'node:fs'
import { extractEml } from './eml.ts'
import { extractHtml } from './html.ts'
import { extractPdf } from './pdf.ts'
import { extractText } from './text.ts'
import type { Extraction } from './types.ts'

export type { Extraction, Fragment, Selector } from './types.ts'

/** Dispatch by MIME type. Unknown types yield no fragments rather than an error, so the job completes. */
export async function extract(mime: string, bytes: Uint8Array): Promise<Extraction> {
  const type = mime.split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'text/html') return extractHtml(new TextDecoder().decode(bytes))
  if (type === 'application/pdf') return extractPdf(bytes)
  if (type === 'text/plain' || type === 'text/markdown')
    return extractText(new TextDecoder().decode(bytes))
  if (type === 'message/rfc822') return extractEml(bytes)
  return { fragments: [] }
}

export const extractFile = (mime: string, path: string) => extract(mime, readFileSync(path))
