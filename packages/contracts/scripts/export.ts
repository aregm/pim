import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { exported, toJsonSchema } from '../src/index.ts'

const dir = join(import.meta.dirname, '..', '..', '..', 'contracts')
mkdirSync(dir, { recursive: true })
for (const [name, schema] of Object.entries(exported)) {
  writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(toJsonSchema(schema), null, 2)}\n`)
}
console.log(`exported ${Object.keys(exported).length} contracts to ${dir}`)
