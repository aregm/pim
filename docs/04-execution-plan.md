# PIM execution plan

Nov 8, 2026 · @Areg

**Status:** v0.1 (milestones M0 to M6) delivered on 2026-11-08; the record is `milestones.md` and `gates/`. The repair phases R0 to R5 below are Proposed, drawn from `review-response-2026-11-08.md`; R0 and R2 need approval before they start, R1 does not. The v0.1 plan as approved is kept verbatim at `archive/execution-plan-v0.1.md`.

This is the fourth document in the lineage. It turns the requirements, the intent and the architecture into ordered work with a gate at the end of each phase. A phase is done when its gate record in `gates/` says so, not when its tasks are closed.

## 1. Where things stand

Every feature of v0.1 exists and was exercised by the first-afternoon rehearsal on the packaged app and the development build (Gate 6). The acceptance harnesses the requirements name (a 100-source corpus, crash injection at every stage, a 100-query retrieval set) have not run, and an external review on 2026-11-08 found that the implementation mutates derived records where the concept promises a ledger. The defensible label is therefore **v0.1 feature-complete, acceptance pending**, and the work below is what returns it to "complete".

## 2. Repository layout, as it is

One npm workspace for the Electron app, the TypeScript workers and the shared packages, plus a Python virtual environment for the media worker. The engine binary is not vendored; `npm run setup` downloads the pinned version by checksum into `.tooling/`.

```text
pim/
├─ apps/desktop/               Electron: main (the core), preload (the bridge), renderer (the screens)
├─ packages/
│  ├─ contracts/               Zod schemas for every crossing shape; JSON Schema export
│  ├─ vault/                   SQLite schema and migrations, blobs, graph, vectors, transfer, backup
│  ├─ blocks/                  the shared rule for HTML block selectors
│  ├─ worker-kit/              TypeScript worker bootstrap
│  ├─ worker-parse/            extract::text
│  ├─ worker-web-preserve/     preserve::web
│  └─ worker-model/            enrich::*
├─ workers-py/media/           media::* (whisper.cpp, Apple Vision, PyAV)
├─ infra/                      worker-compose.yaml, engine.lock, setup.sh
├─ contracts/                  generated JSON Schemas, committed
├─ docs/                       this lineage: README, 01 to 04, adr/, gates/, milestones.md, archive/
├─ tests/                      corpus manifest; e2e/rehearsal.mjs
├─ scripts/                    gate0.mjs
└─ .tooling/                   engine binary and Python runtime (git-ignored)
```

Tooling that differs from the v0.1 plan, recorded in `milestones.md`: npm workspaces instead of pnpm and Turborepo; `python3 -m venv` with pinned wheels instead of uv; `node:sqlite` instead of better-sqlite3. None changed a decision.

## 3. Working agreement

- One short branch per task, one pull request per task, CI green before merge. CI runs lint, the contracts drift check, the unit tests, the Python tests and Gate 0.
- Every pull request carries the change report of AGENTS.md section 7: behaviour and non-goals, contracts changed, decisions touched, dependencies, assumptions, specification and test changes listed apart, evidence, residual judgment.
- A change to the requirements, the intent, the architecture, an ADR, a contract, a test or a gate threshold is a specification change: its own commit, approved by Areg before it merges. ADRs are written as Proposed and never edited once accepted; a reversal is a new record that supersedes.
- A phase closes with a gate record in `gates/` saying what ran, on which machine and commit, and what it could not show.
- Every third-party version is pinned: Electron, the iii engine and SDKs together, the Python interpreter and wheels, models by digest.

## 4. The repair phases

Six phases in dependency order. Sizes are working days for one person and order the work rather than promise dates. The findings each phase answers are in the review response by number.

### R0: honest labels and the records (half a day, needs approval)

- README and `milestones.md` relabelled as in section 1.
- ADR-006 (the ledger data model) and ADR-007 (the queue of record) accepted or amended; ADR-001 and ADR-005 carry the pointers; the intent and architecture documents updated to match once accepted.
- The CAP-1 wording decided (`01-requirements.md`, section 12).
- The trace-capture rule written into the architecture as it will be enforced by R1.

Done when the documents say what the code does and nothing in the repository claims a gate that did not run.

### R1: stop the bleeding (2 to 3 days, no specification change)

Fixes inside the current schema, each with a unit or gate test.

- **Traces.** Trace storage off, retention one hour, payload attributes off, in `.iii/config/iii-observability.yaml` and the packaged app's generated engine config. Test: capture a page, read the trace store, assert no attribute holds fragment text or a blob path.
- **Human-only mutations.** Remove `kernel::review`, `kernel::tag` and `kernel::retry` from the bus. Test: a worker calling `kernel::review` gets function-not-found.
- **One writer per vault.** `requestSingleInstanceLock` and a `vault.lock` file with the owner's pid; a second opener refuses with a clear message. Test: two instances, the second refuses.
- **Clipboard images** enqueue `extract` once preserved. Test: paste an image, assert the job before any restart.
- **Retry and failure, minimal form.** Only the `preserve` stage can mark an artifact failed; a downstream failure leaves the artifact `preserved` and the job `failed`; `retry` reopens failed jobs; a re-run requested during a run sets `rerun_requested`, which completion turns into a fresh open job. Tests: fail enrich three times, retry, enrich runs and the item stays `preserved`; requeue link during a run, it runs again after.
- **Backup verification.** Hash every blob against its id; `PRAGMA integrity_check` and `foreign_key_check`; counts against a manifest written at backup; one payload decoded per modality. Test: a same-length garbage blob returns not ok, naming the blob.
- **Migration safety.** Refuse a vault whose version is above the code's; copy the database before migrating. Tests: a v99 vault refuses; a v3 vault migrates and leaves the copy.
- **Small ones.** `item(id)` by primary key; ForceAtlas2 in a worker thread, stopped when the layout settles.

Done when the gate record lists each test green and the trace store of a fresh capture holds no content.

### R2: the ledger data model, schema v5 (6 to 8 days, after ADR-006)

- Capture versions between artifact and payload; a URL whose bytes changed gets a new version instead of a no-op.
- Fragments superseded, never deleted; FTS and vectors index current fragments; evidence can point at a superseded fragment and the card says so.
- Relation and note revisions, appended; `addRelation` and `upsertNote` append instead of overwriting.
- Decisions as append-only events; `status` as a projection, following the binding rules of ADR-006.
- Provisional entities until a relation naming them is accepted; resolution prefers non-provisional matches; the graph draws provisional entities dashed.
- Migration v4 to v5 with the pre-migration copy; export format v2 with revisions and decisions; v1 packages import as the migration maps.

Done when: accept a summary, re-run the model, the accepted text stays with a new suggestion beside it; re-run a parser after linking, it succeeds and the old fragments open from the evidence card; every v4 test vault migrates and round-trips through export and import.

### R3: the job protocol (3 to 4 days, after R2)

- A generation on every open job; completion and failure conditional on the generation claimed, so a stale worker cannot close a newer run.
- Three outcome classes: retryable, terminal, ambiguous; terminal does not retry; ambiguous re-runs only idempotent stages.
- A per-job timeout and cancellation.
- Inline captures write the blob first, then receipt, payload and `preserved` in one transaction.
- Schema extraction and entity resolution in one transaction, or resolution as its own run.
- Import validates every package path against the destination and imports decisions as events with actor `import`.
- The crash-injection harness, used here and in R5.

Done when crash injection at every stage boundary resumes each job exactly once with no duplicate fragments, revisions or decisions.

### R4: one contract registry (3 days, beside R3)

- Every TypeScript worker parses its input with the contract; no cast on a boundary, enforced by a lint rule.
- Generated Python models from the JSON Schemas, checked in and diffed in CI like the JSON.
- Renderer types derived from the contracts; `pim.d.ts` a re-export.
- The preload bridge typed end to end; an IPC envelope with a version, a request id and a typed error; unknown versions refused.

Done when a deliberately wrong payload is refused at every worker and IPC entry.

### R5: acceptance evidence (5 days plus corpus time; needs Areg's material)

- A capture corpus of 100 real sources across the six modalities, supplied or approved by Areg, captured through the real surfaces. Gate: 99 percent preserved after retries; every fragment resolves.
- Crash injection at each stage boundary and at receipt. Gate: every job resumes once, no duplicates.
- A retrieval set of 100 known-item queries. Gate: the recall target at k=10.
- Link quality: 200 labelled suggestions, a precision floor per generator, an inbox volume cap; `co_capture` tuned or demoted until it passes.
- The rehearsal extended to verify the viewer's highlight, the edge card and keyboard review.
- `docs/acceptance.md`: one row per v0.1 requirement with the harness and the last result.

Done when the matrix has no empty row for a v0.1 requirement, and the label returns to "v0.1 complete".

## 5. Order and effort

R1 first and alone, because it removes the exposures and the data-loss paths that exist today. R0 in parallel as documents for approval. R2 after ADR-006 is accepted. R3 after R2, because generations and transactions change the same functions. R4 beside R3 in different files. R5 last, with its crash harness built in R3. About 20 to 23 working days, roughly the size of M3 to M6 together.

## 6. What stays in v0.2, and why

D13 defers the security architecture and the quality budgets, and this plan keeps that line except where a v0.1 promise is broken today. In v0.2 as designed: scoped read handles for workers instead of blob paths; caller authentication on the bus; OS sandboxing and network denial for workers; encryption at rest as a schema and key-management migration on v5 with a tested restore path; the performance budgets measured on the R5 corpus; the browser extension; office documents and email accounts; semantic zoom in the graph; signing and notarisation; the bundled Python runtime.

## 7. Decisions needed before R0 closes

1. The relabel of v0.1.
2. ADR-007, the queue of record (a superseding record, not an edit of ADR-001).
3. ADR-006, the ledger data model with the decision-binding rules.
4. The CAP-1 wording.
5. Trace payload capture in development: off by default with one-hour retention (proposed), or on with a short retention.
6. Duplicate bytes from a second source: keep the `duplicate` state for v0.1 (proposed) and let ADR-006 decide.
