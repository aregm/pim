import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'

/**
 * The packaged app brings its own engine: the pinned iii binary, the TypeScript workers (run by the app's own
 * Node, `ELECTRON_RUN_AS_NODE`), the web-preserve worker (the app launched with `--web-preserve`) and the
 * Python media worker when a runtime is configured. It is started only when nothing answers at the engine URL,
 * so a repository engine (`npm run engine`) keeps precedence. State lives under the app's user data.
 */

export interface RuntimeLayout {
  /** The staged runtime: `iii`, `packages/`, `workers-py/`, `node_modules/`, `config/`. */
  dir: string
  /** Where the engine keeps its configuration and traces (`<userData>/engine`). */
  stateDir: string
  /** Where whisper models are downloaded. */
  modelsDir: string
  engineUrl: string
  /** The app binary: Node for the workers under `ELECTRON_RUN_AS_NODE`, quoted for the shell. */
  node: string
  /** The shell command that launches this app (the binary alone when packaged, Electron plus the main script in development). */
  app: string
  pythonRuntime: string | null
  ollamaUrl: string
}

export const runtimeDir = (resourcesPath: string, packaged: boolean): string | undefined => {
  const dir = process.env.PIM_RUNTIME ?? (packaged ? join(resourcesPath, 'runtime') : undefined)
  return dir && existsSync(join(dir, 'iii')) ? dir : undefined
}

export const pythonPresent = (runtime: string | null) =>
  Boolean(runtime && existsSync(join(runtime, 'bin', 'python')))

/** True when something accepts connections at the engine URL. */
export function engineListening(url: string, timeoutMs = 1500): Promise<boolean> {
  const { hostname, port } = new URL(url)
  return new Promise((resolve) => {
    const socket = connect({ host: hostname, port: Number(port) })
    const done = (ok: boolean) => {
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

export const quote = (s: string) => `"${s.replace(/"/g, '\\"')}"`

export function composeFile(l: RuntimeLayout): string {
  const { hostname, port } = new URL(l.engineUrl)
  const worker = (name: string, path: string, run: string, env: Record<string, string> = {}) =>
    [
      `  ${name}:`,
      `    worker: path://${path}`,
      '    restart: on-failure',
      // the daemon sets III_URL itself; it is reserved in compose
      ...(Object.keys(env).length
        ? [
            '    environment:',
            ...Object.entries(env).map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`),
          ]
        : []),
      '    scripts:',
      `      run: ${JSON.stringify(run)}`,
    ].join('\n')
  const containers = [
    worker('parse', join(l.dir, 'packages/worker-parse'), `${l.node} src/index.ts`, {
      ELECTRON_RUN_AS_NODE: '1',
    }),
    worker('model', join(l.dir, 'packages/worker-model'), `${l.node} src/index.ts`, {
      ELECTRON_RUN_AS_NODE: '1',
      OLLAMA_URL: l.ollamaUrl,
    }),
    worker('web-preserve', join(l.dir, 'packages/worker-web-preserve'), `${l.app} --web-preserve`),
  ]
  if (pythonPresent(l.pythonRuntime))
    containers.push(
      worker(
        'media',
        join(l.dir, 'workers-py/media'),
        `${quote(join(l.pythonRuntime as string, 'bin', 'python'))} src/main.py`,
        { PIM_MODELS_DIR: l.modelsDir },
      ),
    )
  return `# Written by PIM on start; edit settings in the app, not here.
namespace: pim
engine:
  url: ${l.engineUrl}
  workers:
    configuration:
      adapter:
        name: fs
        config:
          directory: ./.iii/config
    iii-worker-manager:
      host: ${hostname}
      port: ${port}
containers:
${containers.join('\n')}
  http:
    worker: package://api.workers.iii.dev/http
    version: "0.22.8"
    restart: on-failure
    config_override:
      host: 127.0.0.1
      port: 3111
`
}

/** Writes the compose project under the state directory and starts `iii compose --up` there. */
export function startEngine(l: RuntimeLayout, log: (line: string) => void): ChildProcess {
  mkdirSync(join(l.stateDir, '.iii', 'config'), { recursive: true })
  mkdirSync(l.modelsDir, { recursive: true })
  const file = join(l.stateDir, 'worker-compose.yaml')
  writeFileSync(file, composeFile(l))
  // the http worker's binding is configuration, not only config_override (see docs/gates/gate-1.md)
  const httpConfig = join(l.stateDir, '.iii', 'config', 'pim-http.yaml')
  if (!existsSync(httpConfig)) writeFileSync(httpConfig, HTTP_CONFIG)
  // compose takes III_URL in its environment as "an engine already exists", so the app's own copy must not leak
  const { III_URL: _url, ELECTRON_RUN_AS_NODE: _node, ...env } = process.env
  const child = spawn(join(l.dir, 'iii'), ['compose', '--up', '-f', file], {
    cwd: l.stateDir,
    env: { ...env, III_TELEMETRY_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr])
    stream?.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) log(line)
    })
  return child
}

export async function waitForEngine(url: string, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (await engineListening(url, 500)) return true
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

const HTTP_CONFIG = `id: pim-http
name: HTTP
description: HTTP server settings — host/port binding, CORS, request timeout, concurrency limit, and global middleware.
metadata:
  ui_form: http
value:
  concurrency_request_limit: 1024
  cors:
    allowed_methods:
    - GET
    - POST
    - PUT
    - DELETE
    - OPTIONS
    allowed_origins:
    - '*'
  default_timeout: 30000
  host: 127.0.0.1
  port: 3111
  webhook_listener: null
`
