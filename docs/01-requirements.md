# PIM requirements

Nov 8, 2026 · @Areg

**Status:** Proposed, 2026-11-08. Restructured from the approved specification v1.0 (`archive/specification-v1.0.md`, sections 2, 3, 10 and 11). Every requirement id, priority and acceptance criterion is unchanged. New in this document: the purpose statement in full, the domain vocabulary, the list of assumptions the requirements rest on, and the evidence status of each group. One inconsistency is flagged in section 8 for a decision; nothing has been weakened to resolve it.

This is the first document in the lineage (`README.md`). It says what PIM must do and how anyone will know. The design intent (`02-intent.md`) says how PIM intends to do it; the architecture (`03-architecture.md`) says what was built.

## 1. Purpose and the person

**Purpose.** Let one person keep everything they read, hear, watch or write, find any piece of it later by a phrase they remember, open it at the exact place, and see what it connects to and why, with nothing leaving their machine unless they ask for it on that occasion.

The statement names the beneficiary (one person), the change in their situation (what was captured can be found, opened at the place, and connected), and the condition under which the change matters (on their own machine, without a model, without filing).

**The person.** A single user on a Mac with Apple Silicon and at least 16 GB of memory, with local models preferred and remote models used only on request. They already use a browser, email, PDFs, voice memos and video, and they want one capture point rather than one more note-taking app.

**Outcomes that define success.**

1. Any supported source is captured in seconds and the person knows it is safely stored.
2. The original can always be opened from anything derived from it: a summary, a tag, an entity, a link.
3. A known item is found in under 15 seconds from a remembered phrase, without recalling where it was filed.
4. Opening an item shows a bounded, explained neighbourhood: what it relates to, by which kind of relation, asserted by whom, on what evidence.
5. Nothing leaves the machine unless the person asks for it on that occasion.

Every requirement below traces to one of these outcomes. A requirement that traced to none would be a candidate for removal.

## 2. The vocabulary of the domain

The words below carry rules. Each has a definition, a central example, an accepted variation and an excluded case, so that two people reading a requirement read the same thing. The software enforces the identity and lifecycle rules in its schema and contracts (`03-architecture.md`, section 8).

| Term                  | Definition                                                                                                                                           | Central example                                             | Accepted variation                                                       | Excluded case                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| **Item**              | Anything the vault holds under a stable id: an artifact, a note, an entity, a question                                                               | A captured PDF                                              | A model-written summary (a note) is an item                              | A search result or a graph view; those are projections, not items                        |
| **Artifact**          | One captured source, preserved as immutable bytes under a source identity                                                                            | One web page captured at a URL                              | The same URL captured again is the same artifact with two capture events | The same bytes arriving from a different source are a second artifact marked `duplicate` |
| **Capture event**     | One act of capture: surface, time, and who did it                                                                                                    | Pressing Return in the capture panel                        | A watched-folder scan is a capture event                                 | A retry of a failed stage is not a capture event                                         |
| **Payload**           | One preserved representation of an artifact with a role: raw, normalized, snapshot, screenshot, transcript, keyframe                                 | The raw bytes of a PDF                                      | A readable HTML snapshot of a web page                                   | Fragment text; that is derived from a payload, not a payload                             |
| **Fragment**          | The unit every citation, highlight and embedding points at: a run of text with a selector into a payload                                             | One paragraph of a web page with its block index            | A transcript line with start and end times; an OCR box with coordinates  | A whole document; a fragment is always addressable inside its payload                    |
| **Selector**          | The address of a fragment inside its payload: block index, page and span and box, character span, time range, or box                                 | `{kind: time, start_ms: 0, end_ms: 4120}`                   | A page selector with an optional bounding box                            | A line number in a file; lines are not stable across extractors                          |
| **Assertion**         | Anything derived from evidence and claimed about it: a relation between two nodes, or a note such as a summary                                       | "This page mentions this person"                            | A tag is an assertion (a relation to a tag entity)                       | A fragment; fragments are observations of the source, not claims about it                |
| **Entity**            | A node that assertions can name: person, organisation, concept, place, tag                                                                           | A person named in three captured pages                      | An alias resolved to an existing entity                                  | Two entities merged destructively; resolution adds a `same_as` relation and keeps both   |
| **Evidence**          | The fragments an assertion rests on, with a role of support or context                                                                               | The two paragraphs that mention the person                  | Evidence on both ends of a link between two artifacts                    | An assertion with no evidence for an epistemic predicate; `mentions` may carry none      |
| **Processing run**    | One execution of one processor: its version, model digest, prompt digest, inputs, status and metrics; the author of every derived row                | One run of `extract::text` over one payload                 | A re-run after a model change is a new run                               | A manual edit by the person; the person is the author then, not a run                    |
| **Proposal**          | What a worker returns for one stage: fragments or assertions plus the run that produced them. The core validates and commits it; workers never write | The entities, tags, dates and summary one model run returns | An empty proposal when a stage had nothing to do                         | A worker writing to the vault; that is forbidden by design                               |
| **Decision**          | The person's act on an assertion: accept or reject                                                                                                   | Clicking accept on a suggested link                         | Rejecting a tag the model proposed                                       | Auto-acceptance by a rule or a model; not in v0.1                                        |
| **Job** and **stage** | One unit of pipeline work for one artifact at one stage: `preserve`, `extract`, `link` or `enrich`, with attempts and a lease                        | The `extract` job of one PDF                                | A retry is another attempt within the same job                           | A new job for the same artifact and stage while one is open                              |
| **Vault**             | One folder: `vault.sqlite` and `blobs/`, the whole of one person's knowledge                                                                         | `~/PIM Vault`                                               | A vault restored into a new folder                                       | A second index database; derived tables live in the same file and are rebuilt            |

**States and their meaning.** A capture receipt is `received` (the id is durable), `preserved` (the bytes are on disk and committed), `failed` (preservation did not complete after retries) or `duplicate` (identical bytes already exist under another artifact). An assertion is `suggested` (proposed, not judged), `accepted`, `rejected` or `superseded` (a later revision exists). A job is `open`, `running`, `done` or `failed`. These words are not interchangeable with each other or with informal use: "done" in conversation may mean any of three states here.

## 3. Capture

Serves outcomes 1 and 5.

| ID    | Priority | Requirement                                                                                                                      | Acceptance criterion                                                                                                                                                              |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAP-1 | P0       | Capture a URL, text, file, image or clipboard content by global shortcut, drag and drop, paste, or a watched folder              | A durable receipt id returns within 100 ms p95 for inputs up to 1 MB; the item shows `received` at once and `preserved` only after the encrypted bytes and manifest are committed |
| CAP-2 | P0       | Preserve the original: raw bytes, content hash, capture time, source URI, and for web pages a readable snapshot and a screenshot | The person can open the original bytes or snapshot from any derived object                                                                                                        |
| CAP-3 | P0       | Idempotent capture by source id and content fingerprint                                                                          | Capturing the same file or URL twice creates one artifact with two capture events, never two artifacts                                                                            |
| CAP-4 | P1       | A loopback capture endpoint with a per-install secret, for a browser extension and scripts                                       | `POST /capture` on 127.0.0.1 returns the same receipt as the shortcut; a request without the secret is refused                                                                    |
| CAP-5 | P2       | Browser extension; email account import by selected label                                                                        | Out of v0.1                                                                                                                                                                       |

## 4. Parse and analyze

Serves outcomes 2 and 3.

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

## 5. Metadata and attachment to sources

Serves outcomes 2 and 4.

| ID    | Priority | Requirement                                                                                                                    | Acceptance criterion                                                                    |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| MET-1 | P0       | Every derived object records its processing run: processor, version, model digest, prompt or rule digest, inputs, time, status | 100 percent of derived rows have a run id; the run is visible in the UI                 |
| MET-2 | P0       | Human and model content are visibly distinct; model content starts as `suggested`                                              | A suggestion can be accepted, rejected or edited without losing the original suggestion |
| MET-3 | P0       | Stable item ids survive rename, move, export and re-import                                                                     | Round-trip export and import keeps every id and link                                    |
| MET-4 | P1       | Capture intent per item: reference, act, learn, develop, ignore                                                                | Changing intent changes workflow without moving or copying the item                     |
| MET-5 | P1       | Markdown plus JSON export of selected items with attachments and a manifest                                                    | The export opens without the application and every link resolves inside the package     |

## 6. Knowledge graph

Serves outcome 4.

| ID    | Priority | Requirement                                                                                                                                 | Acceptance criterion                                                                          |
| ----- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GRA-1 | P0       | Typed relations with author, evidence fragments, adoption status and time                                                                   | Every visible edge answers: what type, who asserted it, on what evidence, what status         |
| GRA-2 | P0       | Link candidates from explicit links, exact entity matches, shared rare terms, semantic neighbours and time co-occurrence                    | Each candidate names its generator and score components                                       |
| GRA-3 | P0       | A bounded neighbourhood view from any item, person, entity, tag or search, with dimension filters (meaning, evidence, time, people, source) | Never renders the whole vault by default; the budget is a setting with a default of 150 nodes |
| GRA-4 | P1       | Semantic zoom: clusters beyond the budget expand on demand                                                                                  | Expanding a cluster keeps at least one evidence path per visible derived edge                 |
| GRA-5 | P1       | A timeline projection and a person and source projection of the same neighbourhood                                                          | The same item appears once across projections                                                 |

## 7. Privacy and operations

Serves outcome 5. Per D13, only SEC-4 is in v0.1; the rest are v0.2. What v0.1 keeps is what the platform gives: FileVault, Electron's sandbox defaults, the engine on loopback with telemetry off.

| ID    | Priority | Requirement                                                                                                                              | Acceptance criterion                                                                                |
| ----- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| SEC-1 | P2       | Everything at rest is encrypted; the vault key is in the OS keychain with a passphrase-wrapped recovery copy                             | A copied vault directory is unreadable without the key; recovery from the passphrase alone succeeds |
| SEC-2 | P2       | No network traffic except what the person initiates: a captured URL, an opted-in remote model call, an update check that can be disabled | A firewall log of an idle session shows no connections                                              |
| SEC-3 | P2       | Captured content is data, never instructions; model prompts carry it in a separate, labelled channel                                     | The prompt-injection corpus produces no action outside what the person asked                        |
| SEC-4 | P1       | Backup snapshot of the vault directory and a restore test                                                                                | A restore into a fresh directory opens every item and passes search                                 |

## 8. User interface

Serves outcomes 1 to 4. Five principles decide every screen: capture is one keystroke away and never asks a question; nothing has to be filed, since the inbox exists only for exceptions and suggestions; every derived thing opens its source at the exact place; the graph always starts from something the person chose; a slow model never blocks the window.

| ID   | Priority | Requirement                                                                                           | Acceptance criterion                                                                                           |
| ---- | -------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| UI-1 | P0       | Capture in at most two interactions from anywhere on the Mac                                          | Shortcut, paste, Return; the receipt toast appears before the panel closes                                     |
| UI-2 | P0       | Processing never blocks the window; progress is visible per item and per stage                        | The window stays responsive while a 40-minute recording transcribes; the inbox chip changes as stages complete |
| UI-3 | P0       | Every derived element has a visible way to open its source at the exact place                         | Fragment, entity mention, transcript line and citation all highlight or seek the source in one click           |
| UI-4 | P0       | Inbox triage is keyboard-first and bulk-capable                                                       | A new item with five suggestions can be fully reviewed without the mouse                                       |
| UI-5 | P0       | Search returns results as the person types, lexical first                                             | Typing a remembered phrase shows matching items before Return is pressed                                       |
| UI-6 | P1       | Graph interactions are direct: click, double-click, drag, expand, with an evidence card on every edge | A new user finds why two items are linked in one click on the edge                                             |
| UI-7 | P1       | First run to first captured item in under five minutes with no configuration beyond the vault folder  | Measured in the first-afternoon rehearsal                                                                      |

The screens themselves (capture panel, inbox, library, item, graph, settings, first run) are described with the architecture (`03-architecture.md`, section 4), because which screen shows what is a design choice, not an obligation.

## 9. What the requirements assume

A requirement holds only if the world behaves as assumed. These assumptions are owned and checked separately from the software. If one fails, the affected requirement is not satisfiable as written, and the right response is a decision, not a quieter test.

| ID  | Assumption                                                                                               | Requirements that rest on it | Owner and evidence                                      |
| --- | -------------------------------------------------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| A1  | One person uses one vault from one machine at a time                                                     | CAP-3, PRS-7, MET-3          | The product; enforced by a vault lock (repair phase R1) |
| A2  | The disk is protected by FileVault; the application does not encrypt in v0.1 (D5, ADR-004)               | SEC-1 (deferred), the vault  | The person; stated in the README                        |
| A3  | Ollama, when wanted, answers on `127.0.0.1:11434` and holds the three named models; PIM works without it | PRS-4, PRS-5, PRS-6          | Settings detect it; PRS-8 keeps everything else working |
| A4  | whisper.cpp and Apple Vision run on the reference device at the speeds the quality budgets assume        | PRS-2, PRS-3                 | Gate 3 record; budgets measured in v0.2                 |
| A5  | macOS grants the global shortcut, the menu bar item and filesystem access to the vault folder            | CAP-1, UI-1                  | First run checks and says what is unavailable           |
| A6  | A captured web page is fetched once, offscreen, in a throwaway profile; the page is never trusted        | CAP-2, SEC-3                 | The web-preserve worker's design (`03-architecture.md`) |
| A7  | The iii engine on `127.0.0.1:49140` is the only engine PIM uses, pinned by checksum                      | PRS-7, UI-2                  | `infra/engine.lock`; Gate 0                             |

Solution constraints, as opposed to assumptions about the world, are decisions and live in `02-intent.md`, section 7 (D1 to D13).

## 10. Non-goals

**For v0.1 and v0.2.** Sharing and multi-device sync; email and messaging account connectors beyond dropped `.eml` files; sending, deleting or modifying anything outside the vault; agents with write authority or external tools; a mobile client; Windows and Linux builds; formal policy proofs.

**For this specification, by design.** Replacing email, messaging or task clients; per-action tokens; anything that forecloses a later bridge to the fabric project (the data model keeps `sensitivity` and a reserved `space` concept for that reason, and nothing else is shared).

A non-goal is a boundary, not a judgment. Each is listed so that no v0.1 decision makes it impossible later.

## 11. Verification and acceptance

Verification is against the acceptance criteria above. Per D13, v0.1 is gated by the functional harnesses only; the performance, link quality, prompt-injection, egress and restore harnesses belong to v0.2 and are listed so the repository leaves room for them.

The table adds the status of each harness as of 2026-11-08, from the gate records and the review response. "Pending" means the harness has not run at the stated scale; a requirement whose only evidence is pending is not yet accepted, whatever the feature demonstrates.

| Harness                                                                              | What it proves                        | Gate                                                                                                                 | Status on 2026-11-08                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Capture corpus of 100 real sources across the six modalities                         | CAP-1 to CAP-3, PRS-1 to PRS-3, MET-1 | 99 percent captured and preserved after retries; every fragment resolves to its span, box or time                    | Pending (R5); five pieces ran in Gate 6                                      |
| Crash injection at every job stage and at receipt                                    | PRS-7, SEC-4                          | Restart resumes each job once; no duplicate fragments or relations                                                   | Pending (R3 builds it, R5 runs it)                                           |
| Performance harness on the reference device with the synthetic corpus                | Quality budgets                       | All p95 targets met; results stored per commit                                                                       | v0.2                                                                         |
| Retrieval set: 100 known-item queries, 100 exploratory questions with judged results | Outcome 3                             | 90 percent known-item success within 15 seconds                                                                      | Pending (R5)                                                                 |
| Link quality set: 200 labelled candidate pairs per predicate                         | GRA-2, D10                            | Precision and recall tracked per predicate and generator; no aggregate hides a weak predicate                        | Pending (R5); Gate 4 recorded volumes, no threshold                          |
| Prompt-injection corpus: 50 documents with embedded instructions                     | SEC-3                                 | Zero actions outside the person's request; zero egress                                                               | v0.2                                                                         |
| Egress test: idle session and a full processing run under a firewall log             | SEC-2                                 | No connections except the captured URLs and localhost                                                                | v0.2; Gate 0 checks the loopback binding and the telemetry flag              |
| Restore drill                                                                        | SEC-1, SEC-4                          | A snapshot restores into a fresh directory, opens every item, passes search; recovery from passphrase alone succeeds | Partly: Gate 6 restored and opened; verification is being strengthened in R1 |
| Export round trip                                                                    | MET-3, MET-5                          | Export then import preserves every id and relation                                                                   | Ran in Gate 6 on five items                                                  |

**First-afternoon rehearsal (v0.1 gate).** With five real pieces of information: clip one web page, drop one PDF, add one photo of a whiteboard, record one voice memo, add one video file; then find each by a remembered phrase, open each derived element back to its source, accept two suggested links, and open the graph from one item. The rehearsal passes when every step works without reading documentation, no step waits on a model, and UI-1 to UI-7 hold. It ran on 2026-11-08 (`gates/gate-6.md`) against the packaged app and the development build; two checks (the viewer's highlight and the edge card by keyboard) were recorded as unverified.

A model, prompt, parser or ranker change runs against the retrieval, link and injection sets before it ships; a regression on any gate blocks the change.

The current label that follows from this table is **v0.1 feature-complete, acceptance pending**. The repair plan (`04-execution-plan.md`, phase R5) builds a requirement matrix with one row per v0.1 requirement and the harness that proves it.

## 12. Review of the requirements against themselves

The checks are the ones a requirements review applies: traceability, clarity, verifiability, coverage, validity, consistency, changeability.

- **Traceability.** Every id traces to an outcome (sections 3 to 8) and to a harness (section 11). Gaps: MET-4 and GRA-4 have no harness yet; both are P1 and the gate records say they are not implemented.
- **Clarity.** Section 2 fixes the terms. Open point: "capture time" (CAP-2) versus "event time" (GRA-5's timeline) are different clocks and both appear in the data model; the architecture names them.
- **Verifiability.** Each criterion names a measurement. Those that depend on a corpus are pending, not failed.
- **Coverage.** Scenarios covered: missing input (PRS-8), duplicate input (CAP-3), partial failure (PRS-7), restore (SEC-4). Not covered by any criterion: two instances opening one vault (assumption A1; repair phase R1 adds the lock and a test), and a URL whose content changed since the last capture (today a no-op; the ledger model in ADR-006 proposes capture versions). Both are recorded as decisions to take, not as silent additions.
- **Consistency.** One inconsistency found. CAP-1's criterion says `preserved` arrives after "the encrypted bytes" are committed, while D5 and ADR-004 defer encryption to v0.2. Either the criterion drops the word for v0.1 or it is read as "the bytes, encrypted once D5 lands". This is Areg's call; the text above is left as approved.
- **Changeability.** Ids are stable and are cited in code comments, gate records and tests; a change to a requirement is a change to this file and to the matrix R5 builds.

## 13. Changes from specification v1.0

Structure only, except where noted. The purpose statement is written out; the vocabulary table, the assumption table (section 9), the status column of section 11 and the self-review (section 12) are new. The screen table moved to the architecture. The decisions table (D1 to D13) moved to the intent document. No requirement, priority or criterion changed. The flagged inconsistency in CAP-1 awaits a decision.
