# PIM Specification: Multimodal Knowledge Desktop

Nov 8, 2026 · @Areg

**Status:** Approved on 2026-11-08, version 1.0, with D3, D5 and D13 as revised during review. The execution plan follows as a separate document.

A separate Electron application, in its own repository, that captures multimodal sources, parses and analyzes them locally, stores metadata and derived knowledge attached to the original evidence, and draws visual graphs of connected knowledge. It takes the principles and data model of the Personal Knowledge Fabric but shares no code with it. The earlier design sketch (Doc) is superseded by this document where they differ.

## 1. Decisions that need your approval

Each row is a proposed default with the alternative kept for the record. Approving the document approves the defaults; strike any row to pick the alternative.

| #   | Topic                    | Proposed default                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Alternative                                                                                              |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| D1  | Name and repository      | Working name **PIM**; a new repository `pim` with no code dependency on `fabric`, created only after approval                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pick the product name now                                                                                |
| D2  | Desktop framework        | **Electron** with TypeScript, React and Vite; context isolation on, renderer sandboxed, no Node in the renderer; all privileged work in the main process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Tauri, as fabric chose                                                                                   |
| D3  | Process topology and bus | **iii is the core infrastructure from the first commit.** The engine owns the catalog, routing, the stage queue, observers, traces and worker configuration; the app starts the engine and every worker through a compose file. The Electron **main process is the trusted core**, the only writer to the database, and itself one worker on the engine. Parsing, OCR, transcription, embeddings and models are **separate worker processes** (TypeScript through Electron's utility process API, Python for the ML stack) that register their functions on the engine. The iii SDK is used directly; engine and SDK are pinned and upgraded together | Rejected on 2026-11-08: iii behind a replaceable adapter with child processes as a second implementation |
| D4  | Canonical store          | One **SQLite** database per vault via better-sqlite3 in WAL mode, with FTS5 for lexical search and sqlite-vec for vectors; one serialized writer in the core; derived tables rebuildable                                                                                                                                                                                                                                                                                                                                                                                                                                                              | A second disposable index database, as fabric specifies                                                  |
| D5  | Encryption at rest       | **v0.1 relies on FileVault** and the macOS Keychain for secrets; application-level encryption (SQLite3MultipleCiphers, per-blob keys, a recovery passphrase) is a v0.2 target and the schema keeps room for it                                                                                                                                                                                                                                                                                                                                                                                                                                        | Encrypted from day one (rejected on 2026-11-08 in favour of functionality first)                         |
| D6  | Local models             | **Ollama** for embeddings and text models through its localhost API; **whisper.cpp** for speech; **Apple Vision** OCR through a small Swift helper on macOS with Tesseract as the portable fallback; remote models off by default and only by per-request consent                                                                                                                                                                                                                                                                                                                                                                                     | Bundle llama.cpp server instead of requiring Ollama                                                      |
| D7  | Graph rendering          | **Sigma.js** on WebGL over a graphology graph for bounded neighbourhoods; ForceAtlas2 layout computed in a worker and cached as derived data                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Cytoscape.js on canvas; D3 force                                                                         |
| D8  | Capture surfaces in v0.1 | Global shortcut, drag and drop, clipboard, watched folder, and a loopback capture endpoint; the browser extension that uses the endpoint ships in v0.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Extension in v0.1                                                                                        |
| D9  | Modalities in v0.1       | Web page (readable snapshot and screenshot), PDF, image, audio, video file (audio track and keyframes), plain text and Markdown, `.eml` files dropped in; office documents and email accounts in v0.2                                                                                                                                                                                                                                                                                                                                                                                                                                                 | A smaller v0.1 of web, PDF and text                                                                      |
| D10 | AI authority             | Models **propose only**: tags, entities, summaries, link candidates land in `suggested` state with full provenance; no auto-accept, no agent writes, no external actions in v0.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Auto-accept the low-risk `mentions` predicate after an evaluation set exists                             |
| D11 | Platform                 | **macOS on Apple Silicon** first; the code stays portable (Windows, Linux) with Tesseract and CPU inference as the fallbacks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Windows in parallel                                                                                      |
| D12 | Licence posture          | Repository **private** until the product posture (personal, open source, commercial) is decided; the iii engine's Elastic License 2.0 is noted as a constraint on a hosted offering                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Apache 2.0 from the first commit                                                                         |
| D13 | v0.1 priorities          | **Functionality and an easy-to-use interface come first.** The security architecture (section 8) and the quality budgets (section 9) are recorded as v0.2 targets and do not gate v0.1; v0.1 keeps only what the platform gives for free: FileVault, Electron's sandbox defaults, the engine on loopback with telemetry off                                                                                                                                                                                                                                                                                                                           | Security and budgets as v0.1 gates (rejected on 2026-11-08)                                              |

## 2. Purpose, user and non-goals

PIM is a local-first desktop application in which one person captures anything they read, hear, watch or write, and later finds it, sees what it connects to, and understands why. The application preserves the original evidence, derives metadata and knowledge from it on the machine, attaches every derived fact to the exact place in the source it came from, and draws the connections as a graph the person can navigate.

**The person.** A single user on a Mac with Apple Silicon and at least 16 GB of memory, with local models preferred and remote models used only on request. They already use a browser, email, PDFs, voice memos and video, and they want one capture point rather than one more note-taking app.

**Outcomes that define success.**

1. Any supported source is captured in seconds and the person knows it is safely stored.
2. The original can always be opened from anything derived from it: a summary, a tag, an entity, a link.
3. A known item is found in under 15 seconds from a remembered phrase, without recalling where it was filed.
4. Opening an item shows a bounded, explained neighbourhood: what it relates to, by which kind of relation, asserted by whom, on what evidence.
5. Nothing leaves the machine unless the person asks for it on that occasion.

**Non-goals for this specification.** Sharing or synchronising between people or devices; replacing email, messaging or task clients; sending, deleting or modifying anything in an external system; agents with write authority; formal policy proofs or per-action tokens; a mobile client. Each is a possible later phase and is listed in section 11 so that nothing here forecloses it.

## 3. Scope and requirements

The product has five capabilities plus the interface that carries them, and each requirement below belongs to one of them. Per D13, functionality and the interface (3.1 to 3.4 and 3.6) define v0.1; the privacy requirements in 3.5 are v0.2 except backup. Priority **P0** is the first usable build, **P1** completes v0.1, **P2** is v0.2.

### 3.1 Capture

| ID    | Priority | Requirement                                                                                                                      | Acceptance criterion                                                                                                                                                              |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-1 | P0       | Capture a URL, text, file, image or clipboard content by global shortcut, drag and drop, paste, or a watched folder              | A durable receipt id returns within 100 ms p95 for inputs up to 1 MB; the item shows `received` at once and `preserved` only after the encrypted bytes and manifest are committed |
| CAP-2 | P0       | Preserve the original: raw bytes, content hash, capture time, source URI, and for web pages a readable snapshot and a screenshot | The person can open the original bytes or snapshot from any derived object                                                                                                        |
| CAP-3 | P0       | Idempotent capture by source id and content fingerprint                                                                          | Capturing the same file or URL twice creates one artifact with two capture events, never two artifacts                                                                            |
| CAP-4 | P1       | A loopback capture endpoint with a per-install secret, for a browser extension and scripts                                       | `POST /capture` on 127.0.0.1 returns the same receipt as the shortcut; a request without the secret is refused                                                                    |
| CAP-5 | P2       | Browser extension; email account import by selected label                                                                        | Out of v0.1                                                                                                                                                                       |

### 3.2 Parse and analyze

| ID    | Priority | Requirement                                                                                           | Acceptance criterion                                                                       |
| ----- | -------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| PRS-1 | P0       | Text extraction for HTML, PDF, plain text and Markdown into fragments with page and character offsets | Every fragment resolves to a page and span the viewer can highlight                        |
| PRS-2 | P0       | OCR for images and scanned PDFs into fragments with bounding boxes                                    | A bounding box drawn on the image covers the recognised text                               |
| PRS-3 | P0       | Speech transcription for audio and the audio track of video into timestamped fragments                | Clicking a transcript fragment seeks the player to its start time within 1 s               |
| PRS-4 | P1       | Keyframes from video and a caption per keyframe and per image                                         | Keyframes carry a timestamp; captions are marked as model output                           |
| PRS-5 | P0       | Embeddings per fragment with a local model, recorded with model digest and dimension                  | Changing the embedding model invalidates only embeddings, not fragments                    |
| PRS-6 | P1       | Entity and keyword candidates, a short summary, and tag suggestions per artifact, schema-constrained  | Invalid model output is rejected and retried, never partially committed                    |
| PRS-7 | P0       | Resumable background processing with visible state per stage                                          | Killing the app mid-stage and restarting resumes the job once, with no duplicate fragments |
| PRS-8 | P0       | Lexical search, hybrid search, and navigation work while no model is installed or running             | Search returns lexical results with Ollama stopped                                         |

### 3.3 Metadata and attachment to sources

| ID    | Priority | Requirement                                                                                                                    | Acceptance criterion                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| MET-1 | P0       | Every derived object records its processing run: processor, version, model digest, prompt or rule digest, inputs, time, status | 100 percent of derived rows have a run id; the run is visible in the UI                 |
| MET-2 | P0       | Human and model content are visibly distinct; model content starts as `suggested`                                              | A suggestion can be accepted, rejected or edited without losing the original suggestion |
| MET-3 | P0       | Stable item ids survive rename, move, export and re-import                                                                     | Round-trip export and import keeps every id and link                                    |
| MET-4 | P1       | Capture intent per item: reference, act, learn, develop, ignore                                                                | Changing intent changes workflow without moving or copying the item                     |
| MET-5 | P1       | Markdown plus JSON export of selected items with attachments and a manifest                                                    | The export opens without the application and every link resolves inside the package     |

### 3.4 Knowledge graph

| ID    | Priority | Requirement                                                                                                                                 | Acceptance criterion                                                                          |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GRA-1 | P0       | Typed relations with author, evidence fragments, adoption status and time                                                                   | Every visible edge answers: what type, who asserted it, on what evidence, what status         |
| GRA-2 | P0       | Link candidates from explicit links, exact entity matches, shared rare terms, semantic neighbours and time co-occurrence                    | Each candidate names its generator and score components                                       |
| GRA-3 | P0       | A bounded neighbourhood view from any item, person, entity, tag or search, with dimension filters (meaning, evidence, time, people, source) | Never renders the whole vault by default; the budget is a setting with a default of 150 nodes |
| GRA-4 | P1       | Semantic zoom: clusters beyond the budget expand on demand                                                                                  | Expanding a cluster keeps at least one evidence path per visible derived edge                 |
| GRA-5 | P1       | A timeline projection and a person and source projection of the same neighbourhood                                                          | The same item appears once across projections                                                 |

### 3.5 Privacy and operations

| ID    | Priority | Requirement                                                                                                                              | Acceptance criterion                                                                                |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SEC-1 | P2       | Everything at rest is encrypted; the vault key is in the OS keychain with a passphrase-wrapped recovery copy                             | A copied vault directory is unreadable without the key; recovery from the passphrase alone succeeds |
| SEC-2 | P2       | No network traffic except what the person initiates: a captured URL, an opted-in remote model call, an update check that can be disabled | A firewall log of an idle session shows no connections                                              |
| SEC-3 | P2       | Captured content is data, never instructions; model prompts carry it in a separate, labelled channel                                     | The prompt-injection corpus produces no action outside what the person asked                        |
| SEC-4 | P1       | Backup snapshot of the vault directory and a restore test                                                                                | A restore into a fresh directory opens every item and passes search                                 |

### 3.6 User interface

The interface is the product in v0.1. Five principles decide every screen: capture is one keystroke away and never asks a question; nothing has to be filed, since the inbox exists only for exceptions and suggestions; every derived thing opens its source at the exact place; the graph always starts from something the person chose; and a slow model never blocks the window.

**Screens.**

| Screen        | What it shows                                                                                                                                                                                                                                                                    | Main interactions                                                                                                                                            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Capture panel | A small floating panel opened by the global shortcut or the menu bar icon, with a text field that accepts a URL, text or pasted image, and a drop zone                                                                                                                           | Paste or drop, press Return, see a receipt toast with the item's title; the panel closes itself                                                              |
| Inbox         | New items with a state chip (`received`, `preserved`, `extracting`, `enriched`, `failed`), suggested tags, entities and links grouped by item, and an intent picker                                                                                                              | Accept or reject suggestions one by one or for a whole item; set intent; retry a failed stage; keyboard triage with j, k, a, r                               |
| Library       | Everything captured, as a list or grid, with filters for kind, source, time and tag, and a search box that returns lexical results as the person types, with a hybrid toggle                                                                                                     | Open, multi-select, tag, export; search results show why they matched                                                                                        |
| Item          | Three panes: the source viewer (web snapshot, PDF, image with boxes, audio or video player with a scrolling transcript), the derived panel (summary, entities, tags, fragments) and the connections panel (a small neighbourhood and a list with the reason for each connection) | Click a fragment, entity or transcript line to highlight or seek the source; accept or reject a suggestion in place; open the full graph from any connection |
| Graph         | The bounded neighbourhood of the current focus with dimension toggles, clusters for what is beyond the budget, and an evidence card for a selected edge                                                                                                                          | Click to preview, double-click to refocus, drag to pin, expand a cluster, switch to the timeline or table projection                                         |
| Settings      | Vault folder, watched folders, shortcut, models detected (Ollama, whisper), export, backup                                                                                                                                                                                       | Change and see the effect at once; no restart                                                                                                                |

**First run.** Choose a vault folder, confirm the shortcut, and capture one sample item; the app detects Ollama and whisper.cpp if present and says what works without them. A new user reaches their first captured, searchable item in under five minutes with no configuration beyond the folder.

| ID   | Priority | Requirement                                                                                           | Acceptance criterion                                                                                           |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| UI-1 | P0       | Capture in at most two interactions from anywhere on the Mac                                          | Shortcut, paste, Return; the receipt toast appears before the panel closes                                     |
| UI-2 | P0       | Processing never blocks the window; progress is visible per item and per stage                        | The window stays responsive while a 40-minute recording transcribes; the inbox chip changes as stages complete |
| UI-3 | P0       | Every derived element has a visible way to open its source at the exact place                         | Fragment, entity mention, transcript line and citation all highlight or seek the source in one click           |
| UI-4 | P0       | Inbox triage is keyboard-first and bulk-capable                                                       | A new item with five suggestions can be fully reviewed without the mouse                                       |
| UI-5 | P0       | Search returns results as the person types, lexical first                                             | Typing a remembered phrase shows matching items before Return is pressed                                       |
| UI-6 | P1       | Graph interactions are direct: click, double-click, drag, expand, with an evidence card on every edge | A new user finds why two items are linked in one click on the edge                                             |
| UI-7 | P1       | First run to first captured item in under five minutes with no configuration beyond the vault folder  | Measured in the first-afternoon rehearsal                                                                      |

## 4. Concept and architecture

**Governing concept.** An evidence ledger with an assertion court. Artifacts and their fragments are immutable evidence. Everything derived from them (text, entities, embeddings, summaries, links) is an assertion with an author, a processing run, the fragments it rests on, and a lifecycle from `suggested` to `accepted` or `rejected`. The person is the only judge; models are clerks that file proposals. The metaphor implies, and the design accepts, that nothing derived is ever the only copy of anything, that every actor is named on every change, and that a view (graph, timeline, list) is a projection that can be deleted and rebuilt.

&#91;embedded content: process topology · Electron core, local bus, isolated workers\]

**Why these boundaries.** Seams follow trust and volatility. The renderer handles untrusted layout and user input, so it never holds a database handle or a filesystem primitive; it asks the main process through a typed IPC contract. Parsers and models crash, change versions and read untrusted bytes, so each runs in its own process with a narrow contract and returns proposals, never writes. iii is the core infrastructure, not a replaceable transport: the engine owns the catalog, routing, queue, observers and traces, and the main process is one worker among several, distinguished only by owning the vault (D3).

| Component              | Responsibility                                                                                                                                  | Owns                                                           | Must not                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------- |
| Main process (core)    | Receipts, preservation state, transactions, jobs, policy on what becomes accepted, capture surfaces, the loopback endpoint                      | `vault.sqlite`, the blob store, the vault key, the job table   | Parse untrusted content or run a model in-process |
| Renderer               | Inbox, item view with source viewer, search, graph, timeline; all state from IPC                                                                | Nothing persistent beyond view preferences                     | Reach Node, the filesystem or the network         |
| iii engine and compose | The catalog of every function, routing, the stage queue, observers, traces and worker configuration; compose starts and supervises every worker | The live registry, the compose file, the engine binary version | Hold canonical state                              |
| Web preserve worker    | Load a URL in an offscreen, sandboxed window with no Node integration; emit readable HTML, screenshot, metadata                                 | Its own temporary profile                                      | Share the app's session or origin                 |
| Parse worker           | HTML, PDF, Markdown, text, `.eml` to fragments with selectors                                                                                   | Extractor versions                                             | Touch the vault                                   |
| Speech and OCR worker  | whisper.cpp transcription, OCR, keyframe captions                                                                                               | Model binaries and their digests                               | Network access                                    |
| Model worker           | Embeddings, schema-constrained extraction, summaries through Ollama's localhost API                                                             | Prompt templates and their digests                             | Decide adoption status                            |
| Link and layout worker | Candidate links from several generators; ForceAtlas2 layouts for a neighbourhood                                                                | Generator versions, layout cache                               | Write `same_as` or causal relations directly      |

### 4.1 Where iii and the local models are used

iii is the runtime underneath everything outside the window; the local LLM is one worker that only produces proposals. The two tables say exactly where each applies in v0.1 and where it does not.

| iii capability         | Used for in v0.1                                                                                                                                                                                            | Not used for                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Compose                | Starts the engine, the main-process worker, the TypeScript workers (web preserve, parse, link and layout), the Python worker (speech and OCR) and the model worker; restarts any that crash                 | The renderer, which Electron owns                                                  |
| Catalog and routing    | Every pipeline stage is a function with an id and schema (`preserve::web`, `extract::transcribe`, `enrich::embed`, `view::layout`); the core calls stages by id and writes no per-worker IPC or port wiring | Renderer to main calls, which stay Electron IPC                                    |
| Queue                  | Each artifact's stages are enqueued with retries, backoff and a dead-letter path                                                                                                                            | Being the record: the `job` table in SQLite is the record and re-enqueues on start |
| Observers              | The core observes stage completions and failures to update inbox state chips (UI-2) and record processing runs; cron triggers drive watched-folder scans and periodic re-linking                            | Any write to the vault; observers only inform the core                             |
| Traces                 | Every stage call is traced with payloads excluded; the settings screen uses traces to explain a stuck item                                                                                                  | Storing content: fragment text, titles and URLs never enter a trace                |
| Channels               | Audio and video bytes between the core and workers, instead of JSON payloads                                                                                                                                | Anything the database holds                                                        |
| Registry `http` worker | The loopback capture endpoint (D8), which the browser extension calls in v0.2                                                                                                                               | Serving the UI                                                                     |
| Configuration worker   | Worker settings: model names, binary paths, watched folders                                                                                                                                                 | Vault settings, which live in the database                                         |

| Local model                             | Used for in v0.1                                                                             | Output lands as                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Embedding model through Ollama          | A vector per fragment, for semantic search and semantic link candidates                      | Derived `embedding` rows, rebuilt when the model changes            |
| Text model through Ollama               | Schema-constrained extraction per artifact: entities, tags, a short summary, a cleaned title | `suggested` relations and a `note` item, each with a processing run |
| Vision model through Ollama             | A caption per image and per video keyframe                                                   | Caption fragments marked as model output                            |
| whisper.cpp (a local model, not an LLM) | Transcription of audio and video audio tracks                                                | Timestamped fragments                                               |
| Apple Vision or Tesseract (not an LLM)  | OCR of images and scanned PDF pages                                                          | Fragments with bounding boxes                                       |

The local LLM is not used for OCR, transcription, search ranking, deciding what becomes accepted, or anything that writes. Grounded question answering over the vault is not in v0.1; it is the first candidate for v0.2 once the retrieval set exists.

## 5. Data model

&#91;embedded content: data model · canonical tables and the one derived table\]

The model is the fabric canonical model reduced to what v0.1 needs, in one SQLite database. Relations connect two nodes, each an item or an entity, and are the only way knowledge is expressed: a tag is a relation to a tag entity, a summary is a `note` item related by `derived_from`, a citation is a relation with evidence. Every row below is either canonical (survives everything) or derived (deleted and rebuilt from canonical rows and history).

| Table                       | Canonical or derived   | Key fields                                                                                                                                      | Rule                                                                |
| --------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `item`                      | Canonical              | `id` UUIDv7, `kind` (artifact, note, entity, question), `intent`, `sensitivity`, timestamps                                                     | Ids never change; deletion is a tombstone                           |
| `artifact`, `capture_event` | Canonical              | `source_uri`, `source_id`, `content_hash`, one event per capture with surface and time                                                          | Same `source_id` or `content_hash` means the same artifact (CAP-3)  |
| `artifact_payload`          | Canonical              | `role` raw, normalized, snapshot, screenshot, transcript, keyframe; `blob_id`, `mime`, `digest`, `extractor_version`                            | Raw bytes are never rewritten; a new extractor adds a new payload   |
| `fragment`                  | Canonical              | `payload_id`, `ordinal`, `selector_json` with page and character span, bounding box, or start and end milliseconds; `text_blob_id`              | The unit every citation, highlight and embedding points at          |
| `entity`                    | Canonical              | `kind` person, organisation, concept, place, tag; `names`, `resolved_to`                                                                        | Resolution never merges destructively; it adds `same_as` relations  |
| `relation`                  | Canonical              | `subject`, `predicate`, `object`, `status` suggested, accepted, rejected, superseded; `author` person or processor; `run_id`; validity interval | An edge is an assertion, not a fact; several may disagree           |
| `relation_evidence`         | Canonical              | `relation_id`, `fragment_id`, `role` support or context                                                                                         | Required for every epistemic predicate; optional for `mentions`     |
| `processing_run`            | Canonical              | `processor`, `version`, `model_digest`, `prompt_digest`, `input_ids`, `status`, `metrics`                                                       | Every derived row carries a run; a run can be re-executed           |
| `job`                       | Canonical, operational | `artifact_id`, `stage`, `state`, `attempts`, `lease_until`, `next_run_at`, `idempotency_key`                                                    | The job table is the queue of record; the bus queue is a dispatcher |
| `embedding`                 | Derived                | `fragment_id`, `model_digest`, `dim`, vector in sqlite-vec                                                                                      | Rebuilt when the model changes                                      |
| `fts_fragment`              | Derived                | FTS5 external-content table over fragment text                                                                                                  | Rebuilt from fragments on demand                                    |
| `layout`                    | Derived                | neighbourhood key, positions, layout version                                                                                                    | Coordinates are view state and never meaning                        |

**Predicate vocabulary for v0.1.** Provenance: `derived_from`, `quotes`, `captured_from`. Semantic: `about`, `mentions`, `same_as`, `possible_duplicate`, `tagged`. Work: `related_to`, `part_of`. Temporal: `occurred_at`, `before`. Epistemic predicates (`supports`, `contradicts`, `causes`) exist in the schema but no generator proposes them in v0.1.

**Blob store.** Content-addressed files under the vault directory, written by staged file then fsync then atomic rename. In v0.1 they rely on FileVault; per-blob encryption with keys wrapped by a vault key arrives with D5 in v0.2, without changing ids or manifests.

## 6. Processing pipeline and worker contracts

Processing is a job DAG per artifact. The receipt is the only synchronous step; every stage after it is an idempotent worker function that takes an artifact payload and returns a **proposal**, which the core validates and commits. A stage's idempotency key is the artifact payload, the stage name and the processor version, so a changed parser or model re-runs only its own stage and everything downstream.

### 6.1 Stages by modality

| Modality               | Preserve                                                                 | Extract                                                             | Enrich                                           |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------ |
| Web page               | Readable HTML, full-page screenshot, metadata (title, author, published) | HTML to fragments with character spans                              | embed, entities, summary, links                  |
| PDF                    | Raw bytes                                                                | pdf.js text per page with spans; OCR for pages without a text layer | embed, entities, summary, links                  |
| Image                  | Raw bytes, thumbnail                                                     | OCR with bounding boxes; caption                                    | embed (text of OCR and caption), entities, links |
| Audio                  | Raw bytes                                                                | whisper.cpp transcript, segments with start and end ms              | embed, entities, summary, links                  |
| Video file             | Raw bytes, keyframes at scene changes with timestamps                    | Transcript of the audio track; caption per keyframe                 | embed, entities, summary, links                  |
| Text, Markdown, `.eml` | Raw bytes                                                                | Paragraph fragments; headers and attachments for `.eml`             | embed, entities, summary, links                  |

Enrichment runs only after extraction has committed, and `links` runs last because it reads the embeddings and entities of the whole vault.

### 6.2 Worker functions

Every worker registers functions with request and response JSON Schemas; the schemas are the contract and live in the repository under `contracts/`.

| Function              | Worker          | Input                          | Output                                                                          |
| --------------------- | --------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| `preserve::web`       | Web preserve    | `{ url }`                      | readable HTML, screenshot PNG, metadata, as blobs plus a manifest               |
| `extract::text`       | Parse           | `{ payload_id, mime }`         | fragments with `selector` and `text`                                            |
| `extract::ocr`        | Speech and OCR  | `{ payload_id }`               | fragments with `bbox` and `text`, with per-fragment confidence                  |
| `extract::transcribe` | Speech and OCR  | `{ payload_id, language? }`    | fragments with `start_ms`, `end_ms`, `text`                                     |
| `extract::keyframes`  | Speech and OCR  | `{ payload_id }`               | keyframe payloads with `at_ms`; captions as fragments                           |
| `enrich::embed`       | Model           | `{ fragment_ids }`             | vectors with `model_digest`, `dim`                                              |
| `enrich::extract`     | Model           | `{ artifact_id, schema_id }`   | entities, tags, summary, schema-validated                                       |
| `enrich::links`       | Link and layout | `{ artifact_id }`              | relation candidates with `generator`, `score_components`, evidence fragment ids |
| `view::layout`        | Link and layout | `{ node_ids, edge_ids, seed }` | positions, layout version                                                       |

A proposal is one JSON document per stage:

```json
{
  "schema": "pim.proposal/1",
  "run": { "processor": "extract::transcribe", "version": "0.1.0", "model_digest": "sha256:..." },
  "inputs": ["payload:019..."],
  "fragments": [{ "selector": { "kind": "time", "start_ms": 0, "end_ms": 4120 }, "text": "..." }],
  "relations": [
    {
      "predicate": "mentions",
      "object": { "entity": { "kind": "person", "name": "..." } },
      "evidence": [0]
    }
  ],
  "status": "suggested"
}
```

The core rejects a proposal whose run, inputs or selectors do not validate; nothing from a rejected proposal is committed. Retries are three per stage with exponential backoff, after which the job is `failed` and appears in the inbox with its error.

### 6.3 Renderer to core contract

The renderer calls the core only through a typed, versioned IPC surface exposed by the preload script: `capture.*` (url, text, files, clipboard), `items.*` (get, list, search, neighbourhood, timeline), `review.*` (accept, reject, edit a suggestion; set intent), `source.*` (open original, resolve a fragment to a viewer position), `jobs.*` (status, retry), `export.*` (preview, run), `settings.*`. Every call carries a request id and returns typed results or a typed error; large payloads (images, audio) stream through a blob URL served by a custom protocol handler that checks the vault key, never through a file path.

### 6.4 How the local model creates metadata and graph edges

For one artifact, from the moment its fragments exist to the moment edges appear in the graph:

1. **When the model runs.** After `extract::*` has committed fragments, the core enqueues `enrich::embed`, then `enrich::extract`, then `enrich::links`. The model worker never touches the database; it receives fragment ids and fetches their text through the core.
2. **What the model sees.** A bounded context, never the vault: the artifact's title and source metadata, then its fragments in order, each prefixed with its id, chunked to the model's context window with overlap. The system message holds the task and the JSON schema; the content travels in a separate message part labelled as data, so instructions inside a captured page are text to extract from, not commands.
3. **What it is asked for.** One structured answer per chunk in Ollama's JSON-schema mode at temperature zero: entities with kind, aliases and evidence fragment ids; tags with evidence; dates with evidence; a summary with evidence; a cleaned title. For long artifacts the worker merges per-chunk entities and tags by normalised name and writes the final summary from the chunk summaries, keeping evidence ids throughout.
4. **Validation before anything is stored.** The worker checks the output against the schema, drops any evidence id that was not in its input, normalises names, and retries up to three times on invalid output. What survives is one proposal carrying a processing run: model digest, prompt template digest, parameters and input fragment ids.
5. **How the core turns it into metadata.** Entities are resolved against existing `entity` rows by kind and normalised name or alias; a close embedding match creates a `possible_duplicate` relation rather than a merge; no match creates a new entity. Each mention becomes a `relation` (artifact `mentions` entity, status `suggested`, author the processor, run id) with `relation_evidence` rows pointing at the fragments. A tag becomes a tag entity plus a `tagged` relation; a date becomes an `occurred_at` relation; the summary becomes a `note` item linked by `derived_from`, visibly marked as model output.
6. **Embeddings.** `enrich::embed` writes one vector per fragment to the derived `embedding` table plus an artifact-level centroid, feeding semantic search and the next stage.
7. **How edges between artifacts are proposed.** `enrich::links` is deterministic and calls no LLM in v0.1. Its generators: explicit links and citations in the content; shared resolved entities; shared rare terms from FTS5; nearest neighbours over fragment embeddings aggregated per artifact above a threshold; capture-time or event-time co-occurrence. Each candidate becomes a `related_to` or `about` relation in `suggested` state with its generator, score components and evidence fragments on both ends.
8. **How the graph changes.** Suggested relations appear in the inbox grouped by item and, when toggled on, as dashed edges in the neighbourhood. Accepting sets status `accepted` and the edge becomes solid and enters neighbourhood construction and ranking. Rejecting keeps the row as `rejected`, hides it, and stops the same generator from re-proposing it for the same inputs. Nothing becomes an accepted edge without that click in v0.1.
9. **Re-running.** A new model, prompt or parser creates a new processing run and new suggested rows; accepted relations from earlier runs are kept, and superseded suggestions are marked so the inbox does not refill with duplicates.

The schema the extraction stage returns per chunk:

```json
{
  "entities": [
    {
      "name": "...",
      "kind": "person|organisation|concept|place",
      "aliases": [],
      "evidence": ["f12", "f15"]
    }
  ],
  "tags": [{ "label": "...", "evidence": ["f3"] }],
  "dates": [{ "iso": "2026-03-01", "evidence": ["f7"] }],
  "summary": { "text": "...", "evidence": ["f1", "f2", "f9"] },
  "title": "..."
}
```

## 7. Knowledge graph view

The graph is an instrument for answering "what does this connect to, and why", not a picture of the database. It always starts from a focus (an item, entity, tag, search result or time range) and shows a bounded neighbourhood.

**What is drawn.** Nodes are items and entities; edges are accepted relations by default, with suggested relations shown in a distinct style only when the person toggles them on. Node size follows degree inside the visible neighbourhood, never global centrality. Colour encodes node kind; edge style encodes status (accepted solid, suggested dashed); a selected edge opens a card that answers the five questions from GRA-1: type, who asserted it, evidence fragments (clickable, opening the source at the exact span, box or time), status, and why it is visible in this view.

**Dimensions.** The person combines filters that select which relations and nodes enter the neighbourhood:

| Dimension          | Predicates and signals                                                         | Default                                   |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------- |
| Meaning            | `about`, `tagged`, semantic neighbours above a threshold                       | On                                        |
| Evidence           | `derived_from`, `quotes`, `captured_from`, `relation_evidence` paths           | On                                        |
| People and sources | `mentions` of person and organisation entities, source domain, capture surface | On                                        |
| Time               | `occurred_at`, `before`, capture time, transcript time ranges                  | Off, available as the timeline projection |
| Suggested          | Any relation in `suggested` state                                              | Off                                       |

**Construction under a budget.** The default budget is 150 nodes. The view includes the focus and pinned nodes, then adds neighbours by accepted edges in the selected dimensions ordered by evidence count and recency, then semantic neighbours, until the budget is reached. Beyond the budget, nodes are grouped into clusters labelled by their shared entity or tag; expanding a cluster replaces it with its members while keeping at least one evidence path for every visible derived edge (GRA-4). Layout is ForceAtlas2 run in the link and layout worker, seeded deterministically from the neighbourhood key so the same view lays out the same way, and cached in the derived `layout` table.

**Projections.** The same neighbourhood can be shown as a graph, a timeline (nodes placed by their time dimension), or a table sorted by any column; switching projections does not change membership. Nothing in the graph is editable except accepting or rejecting a suggested edge and pinning a node, both of which go through `review.*`.

**Rendering.** Sigma.js draws on WebGL in the renderer from a graphology graph built from IPC results; the renderer never computes layout for more than the budget and never holds more than the visible neighbourhood. Frame time stays at 60 fps at the default budget on the reference Mac; the budget setting warns above 500 nodes.

## 8. Security and privacy, a v0.2 target

Per D13, none of this section gates v0.1. v0.1 ships with what the platform gives for free: FileVault for the disk, Electron's sandbox and context isolation as they come, the engine bound to loopback with telemetry off. The architecture below is the target for v0.2 and is kept here so that v0.1 decisions do not block it: ids, manifests and the blob layout are already compatible with per-blob encryption.

The threat model for v0.1 is a lost or stolen laptop, a malicious captured document, a compromised parser, and unintended network egress. Same-user malware on an unlocked machine is out of scope and said so in the product.

| Threat                                      | Control                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lost device, copied vault directory         | SQLite3MultipleCiphers for the database, per-blob authenticated encryption, vault key in the macOS Keychain through `safeStorage`, a recovery copy wrapped by an Argon2id passphrase; automatic lock after idle                                                                                                                              |
| Malicious captured HTML, PDF or office file | Never rendered in the app's origin; web pages load in an offscreen sandboxed window with no Node, no session sharing and a throwaway profile; PDFs render through pdf.js in the sandboxed renderer; parsers run in separate processes that the core restarts on crash                                                                        |
| Prompt injection through captured content   | Content reaches a model only as labelled data in a separate message part; the model's output is schema-validated and lands as `suggested`; no model output can call a tool, change a setting or trigger a capture                                                                                                                            |
| Unintended egress                           | No network code in workers except the web preserve worker (the captured URL) and the model worker (Ollama on localhost, or a remote provider only with a per-request consent dialog that names the destination and the data); update checks are a setting, off by default; the iii engine runs with telemetry disabled and bound to loopback |
| Compromised renderer                        | Context isolation and sandbox on, `nodeIntegration` off, a strict content security policy, IPC validated with schemas in the main process, no `file://` access, blobs served through a protocol handler that checks the vault is unlocked                                                                                                    |
| Loopback capture endpoint abuse             | Bound to 127.0.0.1 with a per-install random secret stored in the Keychain; the extension and scripts present it; rate limited; refused when the vault is locked                                                                                                                                                                             |
| Bus exposure                                | The iii engine binds `127.0.0.1`, RBAC is on with an auth function that accepts only tokens the core issued to its own workers, every worker is a known compose entry, and trace capture excludes payloads                                                                                                                                   |
| Corruption or loss                          | One serialized writer, WAL with `synchronous=FULL`, staged blob writes with fsync and atomic rename, daily encrypted snapshot, and a restore test the person can run from settings                                                                                                                                                           |

No analytics or crash reporting leaves the machine unless the person exports a support bundle by hand. Logs never contain fragment text, titles or URLs beyond their hash.

## 9. Technology choices and later quality budgets

Per D13, the budgets below are not v0.1 gates. They are recorded now so that v0.1 is measured against them when v0.2 starts, and so that no v0.1 choice makes them unreachable. The technology choices do apply to v0.1.

**Reference device and corpus.** A Mac with Apple Silicon and 16 GB of memory; a corpus of 10,000 items, 200,000 fragments and 20 GB of blobs for the v0.2 budgets, with 100,000 items as the stretch harness.

| Budget                                    | Target                                               | Where it is measured                              |
| ----------------------------------------- | ---------------------------------------------------- | ------------------------------------------------- |
| Capture receipt, inputs up to 1 MB        | p95 100 ms                                           | Core, from IPC call to committed receipt          |
| Lexical search, first results             | p95 50 ms                                            | Core, FTS5 query                                  |
| Hybrid search                             | p95 250 ms with lexical results streamed first       | Core, excluding first model download              |
| Neighbourhood query at the default budget | p95 100 ms                                           | Core                                              |
| Graph interaction                         | 60 fps at 150 nodes                                  | Renderer, frame times                             |
| Cold start to usable window               | p50 400 ms, p95 900 ms                               | App, with workers and the bus starting afterwards |
| Transcription                             | at least 5 times real time on the reference device   | Speech worker                                     |
| Background work under interaction         | Workers yield; no UI frame over 32 ms caused by them | App                                               |

Model latency is reported separately and never implied by the UI: deterministic results appear first, model results arrive progressively with their run state.

**Technology choices, each with the requirement it serves and the trigger to reconsider.**

| Choice                                                                                                                             | Serves                                                             | Reconsider when                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Electron, TypeScript, React, Vite; electron-builder for packaging; versions pinned                                                 | D2; one language across UI, core and TS workers; mature sandboxing | Package size or memory measured as a user-visible problem                                          |
| better-sqlite3, FTS5, sqlite-vec, WAL, single writer; the multiple-ciphers build when D5 lands in v0.2                             | D4, D5, RET budgets                                                | Corpus above 1 million fragments or vector queries over the budget                                 |
| iii engine as core infrastructure: engine binary, SDKs and compose file in the repo, engine and SDK pinned together, telemetry off | D3; catalog, queue, traces, cross-language workers                 | Not in v0.1; the licence posture is tracked under D12 and the overhead gate at the first milestone |
| Python workers packaged with a pinned interpreter and locked dependencies, started by compose                                      | whisper.cpp bindings, OCR, future ML                               | A TS equivalent reaches parity                                                                     |
| whisper.cpp with Metal; Apple Vision OCR via a Swift helper; Tesseract fallback                                                    | PRS-2, PRS-3 on the reference device                               | A better local model passes the evaluation set                                                     |
| Ollama for embeddings and text models; model digests recorded                                                                      | D6, PRS-5, PRS-6                                                   | Bundling llama.cpp removes an install step without losing quality                                  |
| Sigma.js, graphology, ForceAtlas2 in a worker                                                                                      | D7, GRA-3, 60 fps                                                  | Frame budget fails at the default budget                                                           |
| Zod schemas shared between IPC, proposals and contracts, exported to JSON Schema                                                   | Section 6 contracts, SEC-3                                         | Never; this is the backbone                                                                        |
| Vitest for unit tests, Playwright for Electron end-to-end tests                                                                    | Section 10                                                         | Never                                                                                              |

## 10. Verification and risks

**Verification is against the acceptance criteria in section 3.** Per D13, v0.1 is gated by the functional harnesses only: the capture corpus, crash injection, the retrieval set, the export round trip and the first-afternoon rehearsal. The performance, link quality, prompt-injection, egress and restore harnesses are built when v0.2 starts and are listed here so the repository layout leaves room for them.

| Harness                                                                              | What it proves                        | Gate                                                                                                                 |
| ------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Capture corpus of 100 real sources across the six modalities                         | CAP-1 to CAP-3, PRS-1 to PRS-3, MET-1 | 99 percent captured and preserved after retries; every fragment resolves to its span, box or time                    |
| Crash injection at every job stage and at receipt                                    | PRS-7, SEC-4                          | Restart resumes each job once; no duplicate fragments or relations                                                   |
| Performance harness on the reference device with the synthetic corpus                | Section 9 budgets                     | All p95 targets met; results stored per commit                                                                       |
| Retrieval set: 100 known-item queries, 100 exploratory questions with judged results | Outcome 3, RET budgets                | 90 percent known-item success within 15 seconds                                                                      |
| Link quality set: 200 labelled candidate pairs per predicate                         | GRA-2, D10                            | Precision and recall tracked per predicate and generator; no aggregate hides a weak predicate                        |
| Prompt-injection corpus: 50 documents with embedded instructions                     | SEC-3                                 | Zero actions outside the person's request; zero egress                                                               |
| Egress test: idle session and a full processing run under a firewall log             | SEC-2                                 | No connections except the captured URLs and localhost                                                                |
| Restore drill                                                                        | SEC-1, SEC-4                          | A snapshot restores into a fresh directory, opens every item, passes search; recovery from passphrase alone succeeds |
| Export round trip                                                                    | MET-3, MET-5                          | Export then import preserves every id and relation                                                                   |

**First-afternoon rehearsal (v0.1 gate).** With five real pieces of information: clip one web page, drop one PDF, add one photo of a whiteboard, record one voice memo, add one video file; then find each by a remembered phrase, open each derived element back to its source, accept two suggested links, and open the graph from one item. The rehearsal passes when every step works without reading documentation, no step waits on a model, and UI-1 to UI-7 hold.

A model, prompt, parser or ranker change runs against the retrieval, link and injection sets before it ships; a regression on any gate blocks the change.

**Risks.**

| Risk                                                                                              | Why it matters                                                      | Mitigation                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Electron memory and package size                                                                  | A desktop app that feels heavy loses the "immediate" promise        | Renderer holds only the visible neighbourhood; workers start lazily; measure at every milestone against the cold-start budget                                                                 |
| Native module builds (SQLite with ciphers, sqlite-vec, whisper bindings) across Electron versions | Build breakage stalls every release                                 | Pin Electron and rebuild in CI for every version; prebuilt binaries where available; a smoke test that opens an encrypted vault                                                               |
| Python packaging on macOS                                                                         | A broken interpreter breaks transcription and OCR                   | Ship a pinned interpreter and locked dependencies inside the app bundle; health check at start; degrade to "transcription unavailable" without blocking capture                               |
| iii churn, licence and defaults                                                                   | Monthly breaking changes; ELv2; telemetry and open ports by default | Engine and SDK pinned together and upgraded as one change, with a budgeted migration per release; compose file sets loopback, RBAC and telemetry off; gate on overhead at the first milestone |
| Graph becomes a hairball                                                                          | More links reduce orientation                                       | Budget, clusters, typed edges, suggested edges off by default, and the link quality set                                                                                                       |
| Model output pollutes knowledge                                                                   | Fluent summaries and links indistinguishable from evidence          | Everything model-made stays `suggested` with a run and evidence; acceptance is a human act in v0.1                                                                                            |
| Encryption makes a lost passphrase a lost vault                                                   | Strong at-rest encryption has no back door                          | Keychain unlock for daily use, a printed recovery kit at setup, a restore drill that includes recovery                                                                                        |
| Apple Vision helper is macOS-only                                                                 | Portability                                                         | Tesseract fallback behind the same `extract::ocr` contract                                                                                                                                    |

## 11. Relation to fabric, out of scope, and what approval unlocks

**Relation to fabric.** PIM takes four things from the fabric documents and nothing else: the canonical-versus-derived rule, the evidence-and-assertion data model, the principle that policy sits outside the model, and the truthful capture states (`received`, `preserved`). It shares no code, no crate and no build tooling with the fabric repository. The Isabelle gate, per-action tokens, the Noise relay and the Rendezvous protocol are fabric's; they are not part of PIM, and the data model keeps a `sensitivity` field and a `space` concept reserved so that a future bridge to fabric remains possible without a migration.

**Out of scope for v0.1 and v0.2.** Sharing and multi-device sync; email and messaging account connectors beyond dropped `.eml` files; sending, deleting or modifying anything outside the vault; agents with write authority or external tools; a mobile client; Windows and Linux builds; formal policy proofs.

**What approval unlocks.** On approval, and only then, the next document is the execution plan: milestones with gates, the repository layout, the first ADRs (iii as core infrastructure, encryption and recovery, contracts as the backbone), and the first milestone's task list. The order of milestones proposed for that plan puts the interface first: capture and the inbox with their screens, then the item view with the source viewer and search, then extraction per modality, then the graph, and enrichment by models last, so that every earlier milestone is usable with no model installed.

- [ ] Approve the decisions in section 1, with any rows struck
- [ ] Confirm the product name for D1, or keep the working name
- [ ] Confirm the reference device for section 9

Sources: the fabric PRD and architecture documents for the principles and data model; the iii repository at commit d1dd672 for the bus; the framework memo and the design sketch linked above.
