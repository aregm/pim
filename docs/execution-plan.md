# PIM Execution Plan v0.1

Nov 3, 2026 · @Areg

**Status:** Approved on 2026-11-03, repository at ~/pim, working name PIM kept. Executes the approved specification (docs/specification.md). M0 started the same day.

## 1. Milestones and gates

&#91;embedded content: milestones · M0 to M6 with their gates\]

The order follows D13: the interface arrives with the first functional milestone and every milestone leaves a usable app. Models enter only at M5, so M1 to M4 work with nothing installed beyond the app itself. Each gate names the specification requirements it proves; a milestone is done when its gate passes on the reference Mac, not when its tasks are closed. No dates are set; M0 and M1 are sized in section 4 and the rest are sized when their predecessor's gate passes.

## 2. Repository layout

One pnpm workspace with the Electron app, the TypeScript workers and the shared contracts as packages, plus one Python workspace for the ML worker. iii's engine binary is not vendored; the setup script downloads the pinned version by checksum into a repository-local tooling directory, the same way fabric isolates its toolchain.

```text
pim/
├─ apps/
│  └─ desktop/                 Electron app: main (core), preload, renderer
│     ├─ src/main/             vault, jobs, capture surfaces, iii worker, IPC handlers
│     ├─ src/preload/          the typed IPC bridge, nothing else
│     ├─ src/renderer/         React screens: capture, inbox, library, item, graph, settings
│     └─ electron-builder.yml
├─ packages/
│  ├─ contracts/               Zod schemas: IPC, proposals, worker functions; JSON Schema export
│  ├─ vault/                   SQLite schema, migrations, queries, blob store (used by main only)
│  ├─ worker-kit/              shared iii worker bootstrap for TS workers (register, health, logging)
│  ├─ worker-web-preserve/     offscreen capture of URLs
│  ├─ worker-parse/            HTML, PDF, text, Markdown, eml to fragments
│  └─ worker-link-layout/      link generators, ForceAtlas2 layouts
├─ workers-py/
│  └─ media/                   speech (whisper.cpp), OCR, keyframes, captions; uv-managed
├─ infra/
│  ├─ worker-compose.yaml      engine, main worker, every worker, loopback, telemetry off
│  ├─ engine.lock              pinned iii engine version and checksums per platform
│  └─ setup.sh                 downloads engine and Python runtime into .tooling/
├─ contracts/                  generated JSON Schemas, committed, read by the Python worker
├─ docs/
│  ├─ specification.md         this specification, exported from the approved doc
│  ├─ execution-plan.md        this plan
│  └─ adr/                     ADR-001 onward
├─ tests/
│  ├─ corpus/                  the capture corpus manifest (files stay out of git)
│  └─ e2e/                     Playwright: first-afternoon rehearsal
├─ .tooling/                   engine binary, Python runtime (git-ignored)
├─ package.json  pnpm-workspace.yaml  turbo.json  biome.json
└─ README.md
```

| Concern                   | Tool                                                  | Note                                                                                                             |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Package manager and tasks | pnpm, Turborepo                                       | One `pnpm dev` starts compose, the engine, the workers and the app with Vite reload                              |
| Language and build        | TypeScript 5, Vite, electron-vite                     | Strict mode everywhere; the renderer is a plain Vite React app                                                   |
| Lint and format           | Biome                                                 | Same choice as iii, so contributors meet one style                                                               |
| Schemas                   | Zod with JSON Schema export                           | `packages/contracts` is the only place a shape is defined; the Python worker validates against the exported JSON |
| Database                  | better-sqlite3, FTS5, sqlite-vec                      | Migrations as numbered SQL files with a test that applies them to an empty and a populated vault                 |
| Python                    | uv with a locked environment and a pinned interpreter | Started by compose; health function registered on the engine                                                     |
| Tests                     | Vitest, Playwright for Electron                       | Unit tests per package; the rehearsal as the end-to-end test                                                     |
| CI                        | GitHub Actions on macOS Apple Silicon runners         | Build, lint, unit tests, Gate 0 catalog check; the rehearsal runs on demand                                      |

## 3. First architecture decision records

Each record is written as Proposed and lands in `docs/adr/` with the first commit; accepting this plan accepts them.

| ADR                                                  | Decision                                                                                                                                                                                                                                              | Context                                                                                                                                                                             | Consequences                                                                                                                                                                                                   | Revisit when                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| ADR-001 iii as core infrastructure                   | The iii engine runs under the app from the first commit and owns the function catalog, routing, the stage queue, observers, traces and worker configuration; the main process is one worker; compose starts everything (spec D3)                      | Workers in two languages, a stage pipeline, and future agents all need a catalog, a queue and traces; writing them in-app would be a second, worse engine                           | Easier: adding a worker is a compose entry and a function; every stage is traced. Harder: the engine binary and SDKs are pinned together and upgraded as one change; Elastic License 2.0 applies to the engine | A release breaks the protocol twice in a row, or the licence posture (D12) conflicts with a hosted offering |
| ADR-002 Contracts as the backbone                    | Every shape that crosses a process boundary (IPC, proposals, worker functions) is defined once in `packages/contracts` as a Zod schema and exported as JSON Schema; the Python worker validates against the export; CI fails when the export is stale | Three runtimes (renderer, main, Python) must agree on the same shapes; drift is the most common cause of silent data loss in pipelines                                              | Easier: one place to read a contract; validation on both sides for free. Harder: a schema change is a visible, reviewed change                                                                                 | Never; this is the backbone                                                                                 |
| ADR-003 One SQLite database with derived tables      | One `vault.sqlite` per vault via better-sqlite3 in WAL mode, a single serialized writer in the main process, FTS5 and sqlite-vec as derived tables, and the `job` table as the queue of record (spec D4)                                              | Personal scale; transactions across items, assertions, runs and jobs matter more than parallel writes; a second database would need cross-database atomicity the app cannot promise | Easier: backup is one file plus blobs; rebuild is a command. Harder: index rebuilds compete with interactive reads, so indexing yields                                                                         | Vector queries miss their budget at 1 million fragments, or multi-device sync arrives                       |
| ADR-004 Encryption deferred with a compatible layout | v0.1 relies on FileVault; ids, blob manifests and the blob directory layout are designed now so that per-blob encryption and SQLite3MultipleCiphers in v0.2 change no identifiers and need no re-import (spec D5, D13)                                | Functionality and interface first; encryption is a bounded later change if the layout is right from the start                                                                       | Easier: v0.1 ships without native cipher builds. Harder: v0.1 vaults are plaintext on disk and the README says so                                                                                              | At the start of v0.2, or earlier if the vault leaves the person's machine                                   |
| ADR-005 Models propose only                          | Every model output lands as a `suggested` row with a processing run and evidence; acceptance is a human action through `review.*`; no auto-accept, no agent writes, no external actions (spec D10)                                                    | Fluent model output is indistinguishable from evidence unless the system keeps them apart structurally                                                                              | Easier: provenance is total; a bad model never corrupts accepted knowledge. Harder: the inbox needs good bulk review, which is why UI-4 is P0                                                                  | A labelled evaluation set shows a predicate above the agreed precision for auto-accept                      |

## 4. Task lists for M0 and M1

Sizes are rough, for one developer, and are there to order work rather than to promise dates: M0 about one working week, M1 about two. Each task is one pull request.

### M0: scaffold and engine

- [x] Create the repository at the agreed location; pnpm workspace, Turborepo, Biome, strict TypeScript; README with the one-command start
- [x] `apps/desktop`: electron-vite scaffold with context isolation and sandbox on; an empty window with the six-screen navigation shell
- [x] `infra/setup.sh` and `infra/engine.lock`: download the pinned iii engine by checksum into `.tooling/`; refuse to run an unpinned version
- [x] `infra/worker-compose.yaml`: engine bound to `127.0.0.1`, `III_TELEMETRY_ENABLED=false`, RBAC with a local auth function; entries for the main worker, `worker-parse` and `workers-py/media`
- [x] `packages/worker-kit`: TypeScript worker bootstrap (register, health function, structured logs, graceful stop)
- [x] Main process joins the engine as a worker and registers `kernel::ping` and `kernel::health`
- [x] `workers-py/media`: uv project with a pinned interpreter, registers `media::health` through the Python SDK
- [x] `packages/contracts`: Zod schemas with JSON Schema export, the health contract, and a CI check that the export is committed
- [x] `pnpm dev` starts compose, the engine, the workers and the app with reload; `pnpm test` runs unit tests
- [x] CI on a macOS Apple Silicon runner: build, lint, unit tests, Gate 0 check
- [x] Gate 0 script: `engine::workers::list` shows main, parse and media; the engine port is bound to loopback; telemetry is off

### M1: capture and inbox

- [x] `packages/vault`: schema v1 (`item`, `artifact`, `capture_event`, `artifact_payload`, `job`), migration runner, single-writer connection, tests on empty and populated vaults
- [x] Blob store: staged write, fsync, atomic rename, content hash, deduplication by hash
- [x] `kernel::receipt` in the main process with CAP-3 idempotency by source id and content hash
- [x] Job table and stage dispatch through the engine queue; replay of open jobs on start; retries with backoff; `failed` state
- [x] Capture panel window: global shortcut, menu bar item, paste, drop, typed text; receipt toast; the panel closes itself
- [x] Drag and drop onto the main window; clipboard capture
- [x] Watched folder with a copy-or-move policy per folder
- [x] Loopback capture endpoint: registry `http` worker in compose, `capture::url`, `capture::text`, `capture::file` with a per-install secret
- [x] `worker-web-preserve`: offscreen sandboxed window, readable HTML, full-page screenshot, metadata; payloads committed through the core; `kernel::preserved`
- [x] Inbox screen: items with state chips, retry for failed stages, open original
- [x] Library screen with recent items; settings for vault folder, watched folders and shortcut
- [x] Gate 1 run: five real captures reach `preserved`; a repeated capture collapses; the window stays responsive during a large file copy

## 5. Working agreement and decisions before the first commit

**How the work runs.**

- Trunk-based development: one short branch per task, one pull request per task, CI green before merge, no direct pushes to `main`.
- A milestone closes with a recorded gate run in `docs/gates/` (what was run, on which machine, the result), not with the last task.
- Changes to the specification or to an ADR are proposed in a pull request and approved by you before they merge, as with the fabric documents.
- Every third-party version is pinned: Electron, the iii engine and SDKs together, the Python interpreter, models by digest.
- The specification and this plan are exported into `docs/` with the first commit and kept in sync with the approved documents.

**Decisions needed before the first commit.**

- [ ] Repository location on this machine; proposed `~/pim`, a sibling of `~/fabric`
- [ ] Product name, or keep the working name PIM for the repository and package names
- [ ] GitHub remote: a private repository under your account, created after the local repository exists
- [ ] The reference Mac for gate runs: this machine, or another

On your approval of this plan and those four answers, M0 starts with the first task.
