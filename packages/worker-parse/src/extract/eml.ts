import { simpleParser } from 'mailparser'
import { extractText } from './text.ts'
import type { Extraction } from './types.ts'

/** Headers as the first fragment, then the body paragraphs; all selectors index into `normalized_text`. */
export async function extractEml(bytes: Uint8Array): Promise<Extraction> {
  const mail = await simpleParser(Buffer.from(bytes))
  const addr = (a: unknown) =>
    a && typeof a === 'object' && 'text' in a ? String((a as { text: string }).text) : ''
  const header = [
    `Subject: ${mail.subject ?? ''}`,
    `From: ${addr(mail.from)}`,
    `To: ${Array.isArray(mail.to) ? mail.to.map(addr).join(', ') : addr(mail.to)}`,
    `Date: ${mail.date?.toISOString() ?? ''}`,
  ].join('\n')
  const body = (mail.text ?? '').trim()
  const normalized_text = `${header}\n\n${body}`
  return { ...extractText(normalized_text), normalized_text }
}
