# Milestones and deviations

The record of what each milestone delivered and where it departed from the plan (`archive/execution-plan-v0.1.md`), kept as it was written at the time. Each gate's full record is in `gates/`.

## Milestone M0: scaffold and engine

What exists: the Electron shell with the screen navigation, the pinned iii engine started by compose, a TypeScript worker (`parse`) and a Python worker (`media`) that register health functions, the contracts package with JSON Schema export, and the Gate 0 check.

v0.1 vaults are not encrypted (ADR-004). Nothing leaves the machine: the engine binds `127.0.0.1` and runs with telemetry off.

## Milestone M1: capture and inbox

What exists: the capture panel on a global shortcut (default Cmd+Shift+Space) and a menu bar item, paste, drop and clipboard capture, watched folders, a loopback capture endpoint through iii's `http` worker, the vault (SQLite through `node:sqlite`, content-addressed blobs), durable receipts with a job runner for preservation, a web-preserve worker (its own Electron process: readable HTML, full-page screenshot, metadata), and the Inbox, Library, Item and Settings screens. Gate 1 record: `docs/gates/gate-1.md`.

## Milestone M2: item view and search

What exists: the parse worker (`extract::text`) turns HTML, PDF, text, Markdown and `.eml` into fragments with selectors (block index, page plus box plus span, or character span); fragments carry a processing run; FTS5 indexes fragment text and titles; the Library searches as you type with a kind filter; the Item screen shows the source (readable HTML in a sandboxed frame, PDF pages, text, images) and highlights the selected fragment; `kernel::search` exposes the same search on the engine. Gate 2 record: `docs/gates/gate-2.md`.

## Milestone M3: multimodal extraction

What exists: the Python media worker transcribes audio and the audio track of video with whisper.cpp (`media::transcribe`, timed fragments), recognises text in images with Apple Vision (`media::ocr`, boxed fragments) and in image-only PDFs by rendering pages with pdfium (`media::ocr_pdf`), and cuts keyframes at scene changes with PyAV (`media::keyframes`). The Item screen plays audio and video with a transcript that seeks on click and follows playback, shows a keyframe strip, and draws OCR boxes on images. Gate 3 record: `docs/gates/gate-3.md`.

## Milestone M4: knowledge graph

What exists: entities and typed relations with evidence and status (schema v3); three deterministic link generators that run as a `link` stage after extraction (explicit links between captured pages, shared rare terms through the FTS5 vocabulary, captures close in time); a budgeted neighbourhood query that says why each node is visible; `kernel::neighborhood`, `kernel::relations`, `kernel::review`, `kernel::tag` on the engine; the Graph screen on Sigma.js 4 (ForceAtlas2 layout, items as circles coloured by kind, entities as diamonds, arrows coloured by dimension, suggested edges faint) with dimension toggles, a details panel on the right for the selected node or edge (its metadata, its connections, and every cited passage as a row that opens the item at that page, paragraph or time), highlight of the selection and its neighbours, drag to pin, double-click to refocus, and table and timeline projections; tags and connections on the Item screen; and inbox triage of suggestions with the keyboard. Gate 4 record: `docs/gates/gate-4.md`.

## Milestone M5: enrichment with models

What exists: a model worker (`packages/worker-model`, TypeScript) that talks to Ollama on localhost only and registers `enrich::models`, `enrich::embed`, `enrich::extract` and `enrich::caption`; an `enrich` stage in the core between extract and link that captions images and video keyframes, embeds every fragment (vectors in sqlite-vec, one virtual table per model dimension, plus an artifact centroid) and runs schema-constrained extraction at temperature zero in Ollama's JSON-schema mode (entities with kind and aliases, tags, dates, a summary and a cleaned title, each with evidence fragment ids, chunked with overlap, validated and retried up to three times, committed in one transaction); entity resolution by kind and normalised name or alias with `possible_duplicate` proposals for close name vectors; two more link generators (`shared_entities`, `semantic_neighbours` over artifact centroids with the closest fragments of both ends as evidence); hybrid search in the Library (reciprocal rank fusion of FTS5 and vector neighbours, lexical alone when Ollama is down); the summary, suggested entities, tags and dates on the Item screen with accept and reject in place; caption fragments marked as model output; a Models section in Settings that detects Ollama and lets the three model names change. Everything the models produce is `suggested` with a processing run that records the model and prompt digests (ADR-005, MET-1). Schema v4. Gate 5 record: `docs/gates/gate-5.md`.

Deviations from the plan: the worker receives fragment texts in the request instead of fetching them through the core (one hop less, same bounded context); captions live as fragments of the raw payload under their own processor instead of a separate caption table; the cleaned title is kept on the note, not applied to the item. Ollama is installed with Homebrew (`brew install ollama`, run as a Homebrew service) and the models are `nomic-embed-text`, `qwen2.5:7b` and `qwen2.5vl:7b`; `infra/setup.sh` does not install them.

## Milestone M6: export, backup, first run, packaging

What exists: export of selected items (Library) or everything (Settings) as a folder of Markdown and JSON with the attachments and a manifest that opens without the app (`packages/vault/src/transfer.ts`); import of such a package that keeps every id, link and attachment and reopens enrichment so vectors are rebuilt (MET-3, MET-5); backup as a snapshot folder taken while the app runs, a restore test into a temporary folder that opens every item and runs a search, and a restore into a fresh folder the app then switches to (SEC-4); the vault folder changeable in place; a first-run screen (vault folder, shortcut, what works right now, capture one item, find it again) with the time to the first searchable item in the log (UI-7); the deterministic link stage moved ahead of model enrichment so no suggestion waits on a model; `npm run package`, which stages the pinned engine, the TypeScript workers with their production dependencies and the Python worker's sources into the app and builds an unsigned `PIM.app` and DMG with electron-builder; the packaged app starts its own engine when none answers (the TypeScript workers run on the app's Node, the web-preserve worker is the app launched with `--web-preserve`, the media worker runs from the Python runtime named in Settings); and the first-afternoon rehearsal as a Playwright script (`npm run rehearsal`, `tests/e2e/rehearsal.mjs`) over the corpus described in `tests/corpus/README.md`. Gate 6 record: `docs/gates/gate-6.md`.

Deviations from the plan: the Python runtime is not packaged (spec 5: a pinned interpreter); the packaged app uses the environment `infra/setup.sh` builds, named in Settings, and says in first run what is unavailable without it. The app is not signed or notarised. Backups are manual; the daily encrypted snapshot waits for encryption in v0.2. Playwright drives file captures through the same call the drop handler makes, since the operating system's drag cannot be scripted.

## Deviations recorded in M4

- Link candidates are computed in the core from the vault, and the layout runs in the renderer; the planned link-and-layout worker is not needed at this size.
- Model-extracted entities and captions arrived in M5; in M4 the only entities were tags the person added.
- Clusters beyond the budget (GRA-4) are not drawn yet; the view reports how many nodes it hid.

## Deviations recorded in M3

- OCR uses Apple Vision through pyobjc inside the Python worker instead of a separate Swift helper; Tesseract remains the portable fallback to add for other platforms.
- Transcription is serialized inside the media worker: whisper.cpp contexts are not thread-safe.
- Image and keyframe captions arrived in M5 through the vision model.
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
