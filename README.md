# PIM

A local-first multimodal knowledge desktop: capture anything, parse and analyze it on the machine, keep every derived fact attached to its source, and see the connections as a graph. Electron app, iii engine as core infrastructure, TypeScript and Python workers.

Specification: `docs/specification.md` (approved 2026-11-03). Plan: `docs/execution-plan.md`. Decisions: `docs/adr/`.

## Milestone M0: scaffold and engine

What exists: the Electron shell with the screen navigation, the pinned iii engine started by compose, a TypeScript worker (`parse`) and a Python worker (`media`) that register health functions, the contracts package with JSON Schema export, and the Gate 0 check.

v0.1 vaults are not encrypted (ADR-004). Nothing leaves the machine: the engine binds `127.0.0.1` and runs with telemetry off.

## Milestone M1: capture and inbox

What exists: the capture panel on a global shortcut (default Cmd+Shift+Space) and a menu bar item, paste, drop and clipboard capture, watched folders, a loopback capture endpoint through iii's `http` worker, the vault (SQLite through `node:sqlite`, content-addressed blobs), durable receipts with a job runner for preservation, a web-preserve worker (its own Electron process: readable HTML, full-page screenshot, metadata), and the Inbox, Library, Item and Settings screens. Gate 1 record: `docs/gates/gate-1.md`.

## Milestone M2: item view and search

What exists: the parse worker (`extract::text`) turns HTML, PDF, text, Markdown and `.eml` into fragments with selectors (block index, page plus box plus span, or character span); fragments carry a processing run; FTS5 indexes fragment text and titles; the Library searches as you type with a kind filter; the Item screen shows the source (readable HTML in a sandboxed frame, PDF pages, text, images) and highlights the selected fragment; `kernel::search` exposes the same search on the engine. Gate 2 record: `docs/gates/gate-2.md`.

## Milestone M3: multimodal extraction

What exists: the Python media worker transcribes audio and the audio track of video with whisper.cpp (`media::transcribe`, timed fragments), recognises text in images with Apple Vision (`media::ocr`, boxed fragments) and in image-only PDFs by rendering pages with pdfium (`media::ocr_pdf`), and cuts keyframes at scene changes with PyAV (`media::keyframes`). The Item screen plays audio and video with a transcript that seeks on click and follows playback, shows a keyframe strip, and draws OCR boxes on images. Gate 3 record: `docs/gates/gate-3.md`.

## Run it (macOS on Apple Silicon)

```bash
npm install
npm run setup          # downloads the pinned iii engine by checksum and the Python worker runtime into .tooling/
npm run engine         # terminal 1: engine + workers, stays in the foreground
npm run dev            # terminal 2: the Electron app
npm run gate0          # with the engine running: catalog, loopback, telemetry checks
```

`npm test` runs the unit tests, `npm run lint` runs Biome, `npm run contracts` regenerates `contracts/*.json`.

## Deviations recorded in M3

- OCR uses Apple Vision through pyobjc inside the Python worker instead of a separate Swift helper; Tesseract remains the portable fallback to add for other platforms.
- Transcription is serialized inside the media worker: whisper.cpp contexts are not thread-safe.
- Image and keyframe captions wait for the vision model in M5.
- The media worker's runtime is a `python3 -m venv` with pinned wheels (`workers-py/media/requirements.txt`); `npm run setup` installs it and `npm run test:py` runs its tests.

## Deviations recorded in M2

- The parse worker reads a blob by path, read-only, on the same machine; bytes do not cross the bus. Workers still never write the vault.
- The web viewer blocks scripts, navigation and remote images; captured pages show their text and local structure only.

## Deviations recorded in M1

- SQLite through Node's built-in `node:sqlite` (FTS5 compiled in, extension loading available) instead of better-sqlite3: same engine, no native rebuild against Electron. Spec D4 names the library; the decision, one SQLite database with derived tables, is unchanged.
- The job table is the queue and the core calls stage functions directly with retries and backoff; the engine's queue worker is not added until a stage needs fan-out.
- The capture endpoint secret sits in `settings.json` in v0.1 (spec D13 defers the Keychain).
- The http worker's host is set through `configuration::set` after the first boot; `config_override` alone did not change a running worker.

## Deviations from the plan recorded in M0

- npm workspaces instead of pnpm and Turborepo, and a `python3 -m venv` instead of uv: neither tool is installed on the reference Mac and M0 needs no global installs. The layout is the one from the plan; switching is a tooling change, not a code change.
- No RBAC in M0: spec D13 defers the security architecture to v0.2, and nothing untrusted connects to the engine yet.
- Compose starts the engine and the workers; the Electron app is started separately and joins the engine as the `desktop` worker.

The engine writes its trace archive to `data/` in the repository root while running; it is git-ignored and holds no payloads in M0.
