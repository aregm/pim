# PIM

A local-first desktop application for one person's knowledge: capture anything you read, hear, watch or write, let the machine read it, and later find it by a phrase you remember, open it at the exact place, and see what it connects to and why.

PIM runs on a Mac with Apple Silicon. Everything stays on the machine: the originals, the text extracted from them, the local models' suggestions, and the graph. v0.1 is complete and was verified on 2026-11-08 by a scripted first afternoon with five real pieces (`docs/gates/gate-6.md`).

## The intention

Most of what a person learns arrives as a web page, a PDF, a photo of a whiteboard, a voice memo or a video, not as a note they wrote. Note-taking tools ask for writing first and filing second, and what was never written down cannot be found. Clippers and read-later tools keep the page but not the connection. Cloud assistants remember, but on someone else's computer, and their answers float free of the source.

PIM takes a different position, written down in `docs/specification.md`:

- **Capture first, with a receipt.** One capture point for a link, text, a file or the clipboard. Within a moment the item shows `received`, and `preserved` once the bytes are safely on disk. Capturing the same thing twice yields one item.
- **The original is the truth.** Everything derived, a passage, a transcript line, an OCR box, a tag, an entity, a summary, a link, points back to the exact place in the source: a paragraph, a page and box, a time in the recording. Opening any of them opens the original there.
- **Nothing leaves the machine.** No account, no sync, no telemetry. The engine binds to the loopback interface. Models run locally through Ollama and whisper.cpp; there is no remote model path at all in v0.1.
- **Models propose, you decide.** Tags, entities, summaries and link candidates land as suggestions with the model and prompt recorded, and become yours only when accepted. Every screen works with no model installed.
- **A graph that explains itself.** Each edge carries the evidence it rests on, and the view says why every node is visible.

## What it does today

**Capture** by global shortcut (Cmd+Shift+Space by default) and menu bar item, paste, drag and drop onto the window, the clipboard, watched folders with a copy or move policy, and a loopback endpoint on port 3111 for scripts.

**Modalities**: web pages (a readable copy plus a full-page screenshot), PDF, images, audio, video (the audio track and keyframes at scene changes), plain text, Markdown and `.eml` files.

**Reading** happens in the pipeline: text extraction with selectors for HTML, PDF, text and email; OCR with Apple Vision for photos and image-only PDFs; transcription with whisper.cpp; captions for images and keyframes, embeddings, and schema-constrained extraction of entities, tags, dates and a summary through Ollama. Deterministic links (explicit links between pages, shared rare terms, captures close in time) never wait on a model; model links (shared entities, semantic neighbours) follow.

**Finding**: the Library searches as you type, lexically at once and hybrid with vectors when Ollama is up. A hit opens the item at the passage: the readable page, the rendered PDF page, the highlighted OCR box, or the player positioned at the line.

**Deciding**: the Inbox lists suggestions for review with the keyboard or a click; the item view accepts or rejects a summary, tags, entities and dates in place.

**Seeing**: the Graph screen draws a bounded neighbourhood around an item on WebGL, with dimension toggles, a details panel for the selected node or edge and its cited passages, plus table and timeline projections.

**Keeping**: export of a selection or everything as Markdown and JSON with the attachments, readable without the app and importable with every id and link intact; backup as a snapshot taken while the app runs, a restore test, and restore into a new folder the app switches to; the vault folder changeable in Settings.

## Compared with other personal information managers

| | PIM | Note-taking apps | Web clippers and read-later tools | Cloud AI memory tools |
| --- | --- | --- | --- | --- |
| What you put in | Anything: links, files, photos, recordings, video, text | Mostly what you write | Web pages and articles | Whatever the service ingests |
| Where it lives | Your disk, one SQLite file and a folder of originals | Your disk or their cloud | Their cloud | Their cloud |
| Finding something | A remembered phrase, across modalities, no filing | Titles, folders, backlinks you made | Full text of pages | Chat over the service's index |
| From a derived fact to the source | One click to the exact paragraph, page box or second | A page, if you linked it | The page | Often none |
| Who decides what is true | You; models only suggest, with provenance | You | You | The model's answer |
| Works offline, without a model | Yes | Yes | Partly | No |
| Leaving | Export opens without the app; import keeps every id and link | Usually Markdown | Export varies | Rarely complete |

The nearest existing tools are local document managers that index and classify files. PIM differs in treating voice, video and photos as first-class sources with timed and boxed passages, in attaching evidence to every suggestion and link, and in being built on an open worker architecture (the [iii](https://github.com/iii-hq/iii) engine with typed contracts in `contracts/`), so a new modality or model is one more worker in any language.

## Install

**Requirements.** macOS on Apple Silicon (14 or later), 16 GB of memory recommended, Node.js 26 or later, Python 3.12 with `venv`, and Git. Models are optional and come from [Ollama](https://ollama.com), installed with Homebrew:

```bash
brew install ollama && brew services start ollama
```

```bash
ollama pull nomic-embed-text && ollama pull qwen2.5:7b && ollama pull qwen2.5vl:7b
```

The whisper.cpp speech model downloads on the first transcription into `.tooling/models` (the packaged app uses its own models folder).

**From source.**

```bash
git clone <this repository> pim && cd pim && npm install
```

```bash
npm run setup
```

`npm run setup` downloads the pinned iii engine by checksum (`infra/engine.lock`) and builds the Python runtime for audio and OCR into `.tooling/`. It makes no global changes and can be run again at any time.

**The packaged app.**

```bash
npm run package
```

This stages the engine, the workers and their dependencies into the app and builds `apps/desktop/dist/mac-arm64/PIM.app` and a DMG. The app is not signed or notarised, so on another Mac use right-click, Open the first time. It starts its own engine and workers; Ollama and the Python runtime stay host installs. For audio and OCR, point Settings, Runtime at the Python environment `npm run setup` built (`<repository>/.tooling/py`) and relaunch.

## Run

From source, two terminals in the repository:

```bash
npm run engine
```

```bash
npm run dev
```

The first starts the engine and the workers and stays in the foreground; the second starts the app, which joins that engine. The packaged app needs neither: double-click it. If it finds an engine from `npm run engine` running, it joins that one instead of starting its own.

The two keep separate profiles (`~/Library/Application Support/PIM Dev` for the source build, `PIM` for the packaged app), so both can run at once.

On the first run the app walks through five steps: the vault folder, the shortcut, what works right now (which workers and models answer), one capture of sample text, and finding it again. It takes under a minute.

**Putting things in.** Press the shortcut, paste a link or text and press Return; drop files on the window; choose Capture clipboard in the menu bar; add a watched folder in Settings; or post to the endpoint with the secret shown in Settings:

```bash
curl -s http://127.0.0.1:3111/capture -H "x-pim-secret: $SECRET" -H "content-type: application/json" -d '{"kind":"url","url":"https://en.wikipedia.org/wiki/Lighthouse"}'
```

The body is one of `{"kind":"url","url":…}`, `{"kind":"text","text":…,"title":…}` or `{"kind":"file","path":…}`.

**Getting things out.** Settings has Export everything, Import a package, Back up now, Test a restore and Restore into a new folder; the Library exports a selection. The vault itself is a folder you can copy while the app runs: `vault.sqlite` and `blobs/`.

## Develop and verify

```bash
npm test               # unit tests: vault, contracts, model worker
npm run test:py        # the Python media worker
npm run lint           # Biome
npm run contracts      # regenerates contracts/*.json from the Zod schemas
npm run gate0          # with the engine running: catalog, loopback, telemetry checks
npm run rehearsal      # the first-afternoon rehearsal (add --packaged for PIM.app)
```

**Traces and logs.** The development engine keeps every stage call, log line and metric in memory (`.iii/config/iii-observability.yaml`, memory exporters, nothing sent anywhere), and `npm run engine` also starts iii's console, the ADE, at [http://127.0.0.1:3114](http://127.0.0.1:3114): its Traces page shows each capture as a tree of spans across the core and the workers, and its Workers page shows each worker's log, settings and registered functions. The console binds all interfaces on that port, so keep the macOS firewall on while it runs; the packaged app does not include it.

The rehearsal (`tests/e2e/rehearsal.mjs`) drives a fresh install through first run, five captures, search, opening each at its passage, two accepted links, the graph, an export round trip and a backup with restore test. Its corpus is described in `tests/corpus/README.md`.

Layout: `apps/desktop` (Electron: the main process is the trusted core and the only writer to the vault, the renderer is sandboxed), `packages/vault` (SQLite through `node:sqlite`, FTS5, sqlite-vec, export and backup), `packages/contracts` (the Zod schemas every message obeys), `packages/worker-*` (TypeScript workers: parse, web preserve, model), `workers-py/media` (Python: transcription, OCR, keyframes), `infra` (compose file, setup, engine lock).

Documents: the specification (`docs/specification.md`), the execution plan (`docs/execution-plan.md`), the decision records (`docs/adr/`), the gate records (`docs/gates/`) and the milestone log with every deviation from the plan (`docs/milestones.md`).

## Not yet implemented

v0.1 chose function and interface over the security architecture and the quality budgets, which the specification records as v0.2 targets. What is missing, by area:

- **Encryption and secrets.** The vault is not encrypted by the app; it relies on FileVault. The capture secret sits in `settings.json`, not the Keychain. The schema and blob layout already leave room for per-blob encryption and a vault key.
- **Security hardening.** No access control on the engine bus, no verified egress policy, no separate labelled channel for captured content in model prompts, and no prompt-injection corpus. The renderer sandbox and loopback binding are what the platform gives.
- **Backups** are taken by hand. The daily encrypted snapshot waits for encryption.
- **Capture surfaces.** The browser extension that uses the endpoint, office documents and email accounts beyond dropped `.eml` files.
- **Capture intent** per item (reference, act, learn, develop, ignore) is stored but not shown or changeable.
- **Graph.** Clusters beyond the node budget are counted, not drawn, so there is no semantic zoom; a person-and-source projection is missing beside the table and timeline.
- **Remote models**, opt-in per request, have no code path yet. Grounded question answering over the vault is the first candidate for v0.2.
- **Scale.** The quality budgets (10,000 items, 200,000 fragments, 20 GB of originals) are not measured.
- **Packaging.** The app is unsigned; the Python runtime is not bundled; Windows and Linux builds, with Tesseract and CPU inference as the fallbacks, are not made.
- **By design, out of scope** for v0.1 and v0.2: sharing and sync between people or devices, account connectors, sending or changing anything outside the vault, agents with write authority, a mobile client.

## Licence

No licence yet: the repository is public to read, but no rights to use, copy or redistribute the code are granted until the product posture (personal, open source, commercial) is decided. The iii engine it runs on is under the Elastic License 2.0, which constrains a hosted offering.
