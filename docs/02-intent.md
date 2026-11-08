# PIM design intent

Nov 8, 2026 · @Areg

**Status:** Proposed, 2026-11-08. Restructured from the approved specification v1.0 (`archive/specification-v1.0.md`, sections 1, 2, 4 and 11). The purpose, the governing concept, its entailments and the decisions D1 to D13 are the approved text. New: the chain from purpose to form stated as such, the examination of the concept as a metaphor, the alternatives the concept was chosen over, and the volatility analysis. Section 4 is a reconstruction, labelled as one.

This document sits between the requirements (`01-requirements.md`) and the architecture (`03-architecture.md`). The requirements say what must be true. This document says by what idea PIM makes it true, what that idea commits the design to, and which changes the design is built to absorb. The architecture then shows how the idea is laid out in processes, modules and contracts.

## 1. From purpose to form

Design proceeds from a purpose, through the function that serves it and the concept that organises the function, to a form that embodies the concept. Each step is traceable to the one before it, and each can send the design back a step when it turns out to be infeasible.

| Step         | Question it answers                            | For PIM                                                                                                                                                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Purpose**  | Whose situation improves, and how?             | One person keeps everything they read, hear, watch or write, finds any piece by a remembered phrase, opens it at the exact place, and sees what it connects to and why; nothing leaves the machine unless they ask on that occasion                                                                                                                                   |
| **Function** | What transformation, on what operand?          | Preserve captured sources as evidence; derive observations (text, boxes, timings) and proposals (entities, tags, summaries, links) from them on the machine; let the person find, open and judge them. The operand is the person's captured sources and what is derived from them; the attributes that matter are identity, preservation state, provenance and status |
| **Concept**  | By what organising idea does the form do that? | **An evidence ledger with an assertion court.** Originals and their fragments are immutable evidence. Everything derived is an assertion with an author, a run and the evidence it rests on, judged by the person. Views are projections that can be deleted and rebuilt                                                                                              |
| **Form**     | Which elements embody the concept?             | One Electron application (a trusted core and a sandboxed renderer), the iii engine with isolated workers for preservation, parsing, media and models, one SQLite vault with a content-addressed blob store, local models through Ollama and whisper.cpp                                                                                                               |

The why-chain behind the purpose: PIM preserves a page. Why? So the person can open the original later. Why? Because what was never written down cannot be found, and most of what a person learns arrives as a page, a recording or a photo, not as a note they wrote. Why? So that knowing something once is enough to find it again. The chain ends in the person's situation, not in a technology, which is where it should end.

## 2. The system of interest and its context

**Inside the boundary.** The core (the Electron main process), the renderer, the preload bridge, the iii engine and its compose project, the workers (`web-preserve`, `parse`, `media`, `model`, `http`), the vault (database and blobs), the contracts package, and the settings file. These are the things the project can change without asking anyone.

**In the context.** The person; macOS (FileVault, the Keychain, the global shortcut, Apple Vision, the filesystem and watched folders); Ollama and the models it holds; the whisper.cpp model files; the web, from which a captured URL is fetched once; scripts and, later, a browser extension that post to the loopback endpoint. The project depends on these and negotiates with none of them; their behaviour is an assumption (`01-requirements.md`, section 9).

**Ownership is recorded apart from inclusion.** The iii engine is inside the system of interest for analysis, because PIM's behaviour depends on how it routes and supervises, but PIM does not modify it: the engine is a pinned binary, upgraded with its SDKs as one change (ADR-001). Ollama is in the context: PIM detects it and works without it.

**What crosses the boundary**, and therefore needs a contract rather than shared understanding: a captured URL leaving for the web (once, offscreen); HTTP calls to Ollama on loopback; a `POST /capture` arriving on loopback with the secret; files read from watched folders; the vault folder on disk, which the person may copy, back up or move. Nothing else crosses. Any new crossing is a decision, not a feature (AGENTS.md, section 5).

## 3. The governing concept, examined

A concept is also a metaphor, and a metaphor is a batch of requirements nobody wrote. The two halves of PIM's concept are examined below in the same six parts, so their entailments are checked rather than absorbed.

### 3.1 The evidence ledger

**Source domain.** Bookkeeping and registries that record transactions and never erase them; corrections are later entries that refer to earlier ones.

**Imported assumptions.** Entries have identity, provenance and an order. The current state can be computed from the history. Earlier entries stay readable after later ones change the result.

**What it reveals.** That a fragment is an observation of a source, with a selector and a run, and must stay addressable for as long as anything cites it. That a re-run of a parser or a model is a new set of entries, not a replacement. That the search index, the vectors and the graph are derived and can be rebuilt from the ledger. That the date of the source's event (a recording made on Tuesday) and the time of its capture are different columns.

**What it can hide.** Retention: a ledger that never forgets needs a rule for what may be compacted and when. Cost: keeping superseded fragments costs space and makes "current" a query. The temptation to treat the engine's trace store as part of the ledger; it is not, and it must not hold content (section 8 of the architecture).

**Instances.** Event-sourced applications; Git's object graph, where a commit is immutable and a branch is a pointer; Kafka's logs with compaction.

**Diagnostic questions.** Can the evidence card still open a fragment that a later parser run superseded? After a model re-run, is the person's accepted summary still there beside the new suggestion? The review of 2026-11-08 answered both with no: `replaceFragments` deletes, and `upsertNote` overwrites. The concept is right and the implementation departs from it; ADR-006 and repair phase R2 close the gap.

### 3.2 The assertion court

**Source domain.** A court: claims are filed by named parties, judged by one authority, and the judgment is a recorded act that binds the claim, not the filing paper.

**Imported assumptions.** Every claim has an author. The judge is a person, not a clerk. A judgment is an event with an actor and a time. The same claim filed again is the same case; a different claim is a new one.

**What it reveals.** That models are clerks: they file proposals and never decide (D10, ADR-005). That a decision binds to a claim (this page `mentions` this person) and survives a re-filing by a new model run, while a decision on a text (this summary) binds to that text and a new text returns to `suggested`. That a rejection must stop the same clerk from refiling the same claim.

**What it can hide.** That "judge" is a human act with a cost: the inbox has to make judging five suggestions a few keystrokes (UI-4), or the court backs up. That a court with one judge is also a court with one point of failure for throughput; the volume cap on suggestions per day in R5 exists for this reason.

**Instances.** Code review with required approval; moderation queues; any workflow where a proposal and its acceptance are separate records.

**Diagnostic questions.** Is a decision a row with an actor and a time, or a status column that the next run may overwrite? Today it is the latter; ADR-006 makes decisions events. Can any worker file a judgment? Today `kernel::review` is on the shared bus, so yes; repair phase R1 removes it.

### 3.3 Entailments the design accepts

From the approved specification: nothing derived is ever the only copy of anything; every actor is named on every change; a view (graph, timeline, list) is a projection that can be deleted and rebuilt. Added by the examination above, and proposed in ADR-006: observations are superseded, never deleted; assertions are revised, never overwritten; decisions are events.

## 4. The alternatives the concept was chosen over

The specification recorded the chosen concept and a comparison with other product categories, but not the rejected concepts as such. The list below reconstructs them from that comparison and from the non-goals, in the manner of a rational design record written after the fact. It is labelled as a reconstruction so that nobody reads it as the original deliberation.

| Candidate                                                           | Mechanism in two sentences                                                                                                                                                         | Why it was not chosen                                                                                                                                                                                                               |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. A note store with attachments** (the note-taking model)        | The person writes notes; sources attach to notes; links are made by hand or by backlinks between notes. The note is the unit of identity and search                                | Fails the purpose at its first step: most of what the person learns is never written down, so it is never found. Attachments are second-class and derived facts cannot point into them                                              |
| **B. An index over a folder of files** (the document-manager model) | Files stay where they are; an indexer extracts text and metadata into a rebuildable index; search and tags live in the index                                                       | Identity follows the file, so a move or rename breaks every link; nothing addresses a place inside a recording or an image; model output has nowhere to live except as more metadata, indistinguishable from the person's own       |
| **C. A model's memory** (the cloud-assistant model)                 | Sources are summarised into a model's context or a vector store; the person asks questions; the answer is the product                                                              | Outcome 5 forbids leaving the machine; outcome 2 demands opening the original at the place, which a summary cannot do; the answer floats free of its evidence, which is the failure the court half of the concept exists to prevent |
| **D. An evidence ledger with an assertion court** (chosen)          | Originals are preserved as immutable evidence with addressable fragments; everything derived is an authored assertion over that evidence; the person judges; views are projections | Satisfies all five outcomes directly; its costs (storage of superseded observations, a review queue to keep short) are accepted and named in section 3                                                                              |

A fifth option, D with auto-acceptance of low-risk predicates, was recorded as the alternative to D10 and deferred until a labelled evaluation set exists.

## 5. Principles that follow from the concept

Each principle is a consequence of the concept, names the outcome it serves, and says what it forbids. A proposal that violates one of these is a change of concept, whatever its tests say.

1. **Capture first, with a receipt.** One capture point for a link, text, a file or the clipboard; the receipt is durable within a moment and the item says `received`, then `preserved`. Serves outcome 1. Forbids: a capture that asks a question, or a receipt that is not on disk.
2. **The original is the truth.** Every derived thing points back to a fragment of a payload, and opening it opens the original there. Serves outcome 2. Forbids: deleting or rewriting a payload; a fragment with no selector; a derived row with no run.
3. **Nothing leaves the machine.** No account, no sync, no telemetry; the engine on loopback; models local; a remote model only by per-request consent that names the destination and the data. Serves outcome 5. Forbids: any new outbound path added as an implementation detail.
4. **Models propose, you decide.** Model output lands `suggested` with its run and evidence and becomes the person's only when accepted; every screen works with no model installed. Serves outcomes 3 and 4. Forbids: auto-acceptance, model writes, a stage that blocks on a model.
5. **A graph that explains itself.** Every edge carries its evidence, and the view says why each node is visible; the graph starts from something the person chose and never draws the whole vault. Serves outcome 4. Forbids: an edge without an evidence card; global layouts; centrality as size.

## 6. What should be cheap to change, and what must stay stable

A decomposition is a bet about what will change. The bets PIM makes are listed so they can be checked, and so a change that lands outside them is recognised as the structural change it is.

| Expected change                                                      | What stays stable                                                            | Where the boundary is                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| A better local model, a new prompt, a different embedding dimension  | Fragments, item ids, accepted decisions; the shape of a proposal             | The model worker and its contracts; every run records model and prompt digests, so a change is a new run, not an edit (MET-1, PRS-5) |
| A better parser or extractor for a modality                          | Payloads and their ids; the selector kinds; everything that cites a fragment | The parse and media workers; `extractor_version` on payloads; superseded fragments stay readable (ADR-006)                           |
| A new modality or capture surface                                    | The receipt, the job stages, the proposal shape                              | One more worker and one more contract; one more branch in the stage table (`03-architecture.md`, section 7)                          |
| A new iii engine release                                             | Function names and contracts; what the core owns                             | The pin in `infra/engine.lock` and the SDKs, upgraded as one change (ADR-001)                                                        |
| A new screen or a redesign of one                                    | Everything: the renderer holds no persistent state                           | The preload bridge and the IPC contract                                                                                              |
| A new link generator                                                 | The relation table; the evidence requirement; the inbox                      | A generator is named on every candidate with its score components (GRA-2); it can be tuned or demoted without touching others        |
| Encryption at rest (v0.2)                                            | Item ids, blob ids, manifests, the blob directory layout                     | Per-blob encryption with wrapped keys changes bytes on disk and nothing above them (ADR-004)                                         |
| How jobs are dispatched (the engine's queue, fan-out, more machines) | The `job` table as the record of what is owed; exactly-once completion       | ADR-007: the vault owns the queue of record; the engine routes and supervises; a dispatcher can change behind that                   |

**What the design does not prepare for**, by decision: sync between devices or people, agents with write authority, a second canonical store. Preparing for them would cost machinery today for a future that D1 to D13 and the non-goals exclude. If one arrives, the boundaries themselves are reconsidered, and that is a new intent document, not a patch.

**What must never move.** Item ids, blob ids and fragment selectors (MET-3); the rule that the core is the only writer; the rule that nothing leaves; the status vocabulary and what each state means (`01-requirements.md`, section 2).

## 7. Decisions that bound the design space

The thirteen decisions approved with the specification, in short form. The approved wording with each alternative is in `archive/specification-v1.0.md`, section 1. Where a decision has a record, the record governs; where the implementation departed from the wording, the departure is noted and the record that resolves it named.

| #   | Topic                    | Decision                                                                                                                                                                        | Record and notes                                                                                                                                           |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Name and repository      | Working name PIM; its own repository, no code dependency on fabric                                                                                                              | Done                                                                                                                                                       |
| D2  | Desktop framework        | Electron with TypeScript, React and Vite; renderer sandboxed, no Node in the renderer; privileged work in the main process                                                      | Standing                                                                                                                                                   |
| D3  | Process topology and bus | iii is core infrastructure from the first commit, not an adapter; the main process is the trusted core and one worker; parsers, media and models are separate worker processes  | ADR-001. The sentence "the engine owns the stage queue" is not what was built; ADR-007 (Proposed) records the queue of record in the vault                 |
| D4  | Canonical store          | One SQLite database per vault, WAL, FTS5, sqlite-vec, one serialized writer, derived tables rebuildable                                                                         | ADR-003. Built with `node:sqlite` instead of better-sqlite3; the decision is unchanged                                                                     |
| D5  | Encryption at rest       | v0.1 relies on FileVault; application-level encryption is a v0.2 target and the layout leaves room for it                                                                       | ADR-004                                                                                                                                                    |
| D6  | Local models             | Ollama for embeddings and text models; whisper.cpp for speech; Apple Vision OCR with Tesseract as the portable fallback; remote models off by default, per-request consent only | Standing; OCR runs through pyobjc in the media worker, not a Swift helper                                                                                  |
| D7  | Graph rendering          | Sigma.js on WebGL over graphology for bounded neighbourhoods; ForceAtlas2 layout                                                                                                | Standing; layout runs in the renderer today, to move to a worker thread in R1                                                                              |
| D8  | Capture surfaces in v0.1 | Shortcut, drag and drop, clipboard, watched folder, loopback endpoint; the browser extension in v0.2                                                                            | Done                                                                                                                                                       |
| D9  | Modalities in v0.1       | Web page, PDF, image, audio, video file, text, Markdown, `.eml`; office documents and email accounts in v0.2                                                                    | Done                                                                                                                                                       |
| D10 | AI authority             | Models propose only; no auto-accept, no agent writes, no external actions                                                                                                       | ADR-005, extended by ADR-006 (Proposed)                                                                                                                    |
| D11 | Platform                 | macOS on Apple Silicon first; the code stays portable                                                                                                                           | Standing                                                                                                                                                   |
| D12 | Licence posture          | No licence until the product posture is decided; the engine's Elastic License 2.0 constrains a hosted offering                                                                  | Standing; the repository is public to read                                                                                                                 |
| D13 | v0.1 priorities          | Functionality and interface first; the security architecture and the quality budgets are v0.2 targets and do not gate v0.1                                                      | Standing, with one exception taken in R1: where a v0.1 promise is broken today (traces holding content, review functions on the bus, one writer per vault) |

## 8. Open questions

Decisions that change this document or a record, awaiting Areg. None is made by default.

1. Relabel v0.1 as "feature-complete, acceptance pending" in the README and the milestone log (review response, decision 1).
2. ADR-007: the vault's `job` table as the queue of record, with D3's wording updated to match (review response, decision 2, recorded as a superseding record rather than an edit).
3. ADR-006: the ledger data model, including how decisions bind to assertion revisions (review response, decisions 3 and 4).
4. CAP-1's criterion mentions encrypted bytes while D5 defers encryption (`01-requirements.md`, section 12).
5. Trace payload capture in development: off by default with one-hour retention, or on with a short retention (review response).

## 9. Changes from specification v1.0

Sections 1, 3.3 (first sentence), 5 and 7 carry the approved text in a new arrangement. Sections 2, 3.1, 3.2, 4 and 6 are new analysis of the approved concept and change no decision; section 4 is labelled as a reconstruction. Section 8 collects decisions already raised elsewhere and adds the CAP-1 wording.
