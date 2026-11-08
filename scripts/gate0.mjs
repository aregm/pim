// Gate 0: the engine runs on loopback with telemetry off and every M0 worker is in the catalog.
// Usage: npm run engine (in another terminal), then `npm run gate0`. Pass --with-desktop when the app is running too.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const iii = join(root, '.tooling/iii/bin/iii')
const expected = ['parse', 'media', ...(process.argv.includes('--with-desktop') ? ['desktop'] : [])]
const failures = []

const listing = JSON.parse(
  execFileSync(iii, ['trigger', 'engine::workers::list'], { encoding: 'utf8', env: { ...process.env, III_URL: 'ws://127.0.0.1:49140' } }),
)
const names = (listing.workers ?? []).map((w) => w.name)
for (const name of expected)
  if (!names.includes(name))
    failures.push(`worker "${name}" is not in the catalog (have: ${names.join(', ')})`)

const lsof = execFileSync('lsof', ['-nP', '-iTCP:49140', '-sTCP:LISTEN'], { encoding: 'utf8' })
const listeners = lsof.split('\n').filter((l) => l.includes('LISTEN'))
if (listeners.length === 0) failures.push('nothing listens on 49140')
for (const l of listeners)
  if (!l.includes('127.0.0.1:49140')) failures.push(`engine port is not loopback-only: ${l.trim()}`)

const pid = listeners[0]?.split(/\s+/)[1]
if (pid) {
  const env = execFileSync('ps', ['-E', '-o', 'command=', '-p', pid], { encoding: 'utf8' })
  if (!/III_TELEMETRY_ENABLED=(false|0|no|off)\b/i.test(env))
    failures.push('engine process does not have III_TELEMETRY_ENABLED=false')
}

if (failures.length) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}
console.log(`PASS gate 0: workers ${names.join(', ')}; engine on 127.0.0.1:49140; telemetry off`)
