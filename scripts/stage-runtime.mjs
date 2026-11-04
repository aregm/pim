// Assembles apps/desktop/runtime/, which electron-builder ships as Resources/runtime: the pinned iii engine, the
// TypeScript workers with their production dependencies, and the Python media worker's sources. The packaged
// app writes a compose file for this layout and starts the engine itself (apps/desktop/src/main/engine.ts).
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const runtime = join(root, 'apps/desktop/runtime')
const lock = readFileSync(join(root, 'infra/engine.lock'), 'utf8')
const engineVersion = /^version=(.+)$/m.exec(lock)?.[1]
const iii = join(root, '.tooling/iii/bin/iii')
if (!existsSync(iii)) throw new Error('no engine in .tooling: run npm run setup first')
const installed = execSync(`"${iii}" --version`).toString().trim()
if (installed !== engineVersion)
  throw new Error(`.tooling holds iii ${installed}, engine.lock pins ${engineVersion}`)

rmSync(runtime, { recursive: true, force: true })
mkdirSync(join(runtime, 'packages'), { recursive: true })
cpSync(iii, join(runtime, 'iii'))
const WORKERS = [
  'contracts',
  'worker-kit',
  'blocks',
  'worker-parse',
  'worker-web-preserve',
  'worker-model',
]
for (const p of WORKERS) {
  const from = join(root, 'packages', p)
  const to = join(runtime, 'packages', p)
  cpSync(join(from, 'package.json'), join(to, 'package.json'))
  cpSync(join(from, 'src'), join(to, 'src'), {
    recursive: true,
    filter: (f) => !f.endsWith('.test.ts'),
  })
}
cpSync(join(root, 'workers-py/media'), join(runtime, 'workers-py/media'), {
  recursive: true,
  filter: (f) => !f.includes('__pycache__') && !f.includes('/tests'),
})
cpSync(join(root, 'contracts'), join(runtime, 'contracts'), { recursive: true })
writeFileSync(
  join(runtime, 'package.json'),
  `${JSON.stringify(
    {
      name: 'pim-runtime',
      private: true,
      version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
      engine: engineVersion,
      workspaces: WORKERS.map((p) => `packages/${p}`),
    },
    null,
    2,
  )}\n`,
)
// production dependencies only, resolved from the repository's lock so the package matches what was tested
cpSync(join(root, 'package-lock.json'), join(runtime, 'package-lock.json'))
execSync('npm install --omit=dev --ignore-scripts --no-audit --no-fund --no-package-lock', {
  cwd: runtime,
  stdio: 'inherit',
})
rmSync(join(runtime, 'package-lock.json'), { force: true })
console.log(`runtime staged in ${runtime}: iii ${engineVersion}, ${WORKERS.length} packages`)
