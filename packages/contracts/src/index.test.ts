import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { exported, HealthResponse, toJsonSchema } from './index.ts'

describe('contracts', () => {
  it('accepts a valid health answer and rejects a bad one', () => {
    expect(
      HealthResponse.safeParse({ worker: 'parse', version: '0.1.0', ok: true, uptime_ms: 3 })
        .success,
    ).toBe(true)
    expect(
      HealthResponse.safeParse({ worker: 'parse', version: '0.1.0', ok: false, uptime_ms: 3 })
        .success,
    ).toBe(false)
  })
  it('matches the committed JSON Schema export', () => {
    for (const [name, schema] of Object.entries(exported)) {
      const committed = readFileSync(
        join(import.meta.dirname, '..', '..', '..', 'contracts', `${name}.json`),
        'utf8',
      )
      expect(JSON.parse(committed)).toEqual(toJsonSchema(schema))
    }
  })
})
