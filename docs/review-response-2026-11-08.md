# PIM review response and repair plan

Nov 8, 2026 · @Areg

Answers an external architecture review of the repository at commit 95d6e46, received on 2026-11-08. The review's verdict: PIM's governing concept, an evidence ledger with an assertion court, is not preserved by the implementation, which mutates derived records in place; the "v0.1 complete" claim should be withdrawn until the architecture and the acceptance evidence are corrected.

## Verdict

The review is right on substance: the code mutates the current answer where the specification promises an append-only ledger, and the "v0.1 complete" label claims more than the gates proved. I checked every cited line in the repository as of commit 95d6e46; 13 of the 15 findings hold exactly as written, two are overstated, and none is wrong.

Three corrections to the review's framing:

- **"Local" holds, "private" does not.** Nothing leaves the machine: the engine, the console and the trace store are on loopback or on disk under the repository. But the trace store does hold captured content. Spans for `enrich::extract` carry up to 140 KB of payload each, the `extract::text` spans carry vault blob paths, retention is 30 days and 1 GB on disk. That breaks the specification's own rule that traces exclude payloads (section 8), even though it never breaks the egress rule. Half of this exposure is mine: the console container (ADE on port 3114, all interfaces) was added on 2026-11-08 for the trace demo and is not in the packaged app.
- **Worker sandboxing and bus authentication were deferred by decision, not forgotten.** D13 defers the security architecture to v0.2 and the milestone log records "no RBAC" as a deviation. The review treats them as P0 defects of v0.1. One part of that finding is cheap and worth doing now: `kernel::review`, `kernel::tag` and `kernel::retry` are registered on the shared bus, so any worker can accept a link as if it were the person. The renderer already has its own IPC path for the same actions, so the bus functions can simply go.
- **ADR-001 has a third option the review does not list.** The review says either make SQLite the sole execution authority and demote iii to optional infrastructure, or move execution fully into iii. Areg decided on 2026-11-03 that iii is core infrastructure, not an adapter (D3). The honest fix that respects D3 is to amend ADR-001 so it says what is true: iii owns catalog, routing, supervision, configuration and traces; the vault's job table owns the queue, because exactly-once stage completion needs the same transaction as the fragments it writes. That is a decision for Areg, not a repair.

On the label: the specification's own section 10 gates v0.1 on a 100-source corpus, crash injection at every stage and a 100-query retrieval set. None ran at that scale. Gate 6 is a five-piece rehearsal. "v0.1 feature-complete, acceptance pending" is the defensible wording until the harnesses in R5 pass.

## Findings against the code

Each finding was checked at the cited line in the repository at commit 95d6e46. "Confirmed" means the code does what the review says; "overstated" means the mechanism is real but the conclusion drawn from it is too strong. The reviewer's reproductions (the overwritten summary, the foreign-key failure, the garbage blob) were not re-run; the code paths that produce them were read and agree.

| #    | Finding                                                      | Assessment                                    | What the code shows                                                                                                                                                                                                                                                                                                                                                                                                                         | Phase                    |
| ---- | ------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| P0-1 | Accepted assertions change silently on rerun                 | Confirmed                                     | `Graph.addRelation` updates generator, score, run and evidence of an existing row and leaves `status` alone; `upsertNote` replaces a summary's text in place while the note's review relation keeps its status. MET-2 says a suggestion is edited "without losing the original".                                                                                                                                                            | R2                       |
| P0-2 | The data model cannot hold an evidence ledger                | Confirmed                                     | `replaceFragments` deletes the previous run's fragments; `relation_evidence` references `fragment(id)` with foreign keys on, so a parser rerun after linking fails, and when it does not fail the old observation is gone. Model-created entities enter `entity` directly and steer `enrich::resolve` before any review.                                                                                                                    | R2                       |
| P0-3 | "Local and private" is contradicted by the traces            | Overstated on "local", confirmed on "private" | `trace_storage` keeps 30 days and 1 GB on disk; `enrich::extract` spans hold up to 140 KB of payload and `extract::text` spans hold blob paths. All of it stays on the machine. The console on 3114 binds all interfaces and is a 2026-11-08 development addition only.                                                                                                                                                                     | R1                       |
| P0-4 | Worker trust boundaries do not enforce authority             | Confirmed; partly deferred by D13             | `ExtractRequest.path` is an absolute blob path the parser opens itself; `kernel::review`, `kernel::tag` and `kernel::retry` are plain bus functions any worker can call. Sandboxing and bus authentication are v0.2 by decision; the bus-exposed human mutations are not.                                                                                                                                                                   | R1 (bus), v0.2 (sandbox) |
| P1-1 | Artifact identity conflates source, bytes and version        | Confirmed                                     | `receipt()` keys on (source_kind, source_id) and returns the existing item for a known URL, so changed content at one URL is never re-preserved; `markPreserved` marks identical bytes from another source `duplicate`; no table names the payload version an assertion came from. Files are keyed with size and mtime, so they do get new artifacts.                                                                                       | R2                       |
| P1-2 | ADR-001 is falsified                                         | Confirmed, and already recorded               | ADR-001 assigns the stage queue to iii; `Core.tick` claims from the vault's `job` table and the milestone log says so. The remedy needs a decision (see Decisions), not a code change first.                                                                                                                                                                                                                                                | R0                       |
| P1-3 | Concurrency and job state lose work                          | Confirmed, every bullet                       | `job` is unique on (artifact_id, stage) and `requeue` only reopens `done` or `failed` rows, so a rerun asked during a running link is dropped. Any stage's third failure calls `markFailed` on the artifact. `retry` sets the artifact to `received` and `enrich` skips anything not `preserved`, so a retry after a failed enrich is a no-op that leaves the item `received` for good. No `requestSingleInstanceLock`, no vault lock file. | R1, R3                   |
| P1-4 | The contracts backbone is incomplete                         | Confirmed                                     | The parser casts `input as ExtractRequest` from a local interface; the Python media worker reads dictionaries; `pim.d.ts` retypes views by hand; the preload bridge passes `unknown` and raw strings; IPC has no version or typed error.                                                                                                                                                                                                    | R4                       |
| P1-5 | Restore verification certifies corrupt backups               | Confirmed                                     | `verifyVault` compares file size to `byte_length` and runs one word search over the newest 50 fragments. Blob ids are SHA-256 digests, so a hash comparison costs one pass.                                                                                                                                                                                                                                                                 | R1                       |
| P1-6 | Release evidence demonstrates features, not acceptance       | Confirmed                                     | Specification section 10 gates v0.1 on a 100-source corpus, crash injection at every stage and a 100-query retrieval set. Gate 6 ran five pieces, four of them generated; the rehearsal drives drop by IPC and checks the viewer and graph for existence. Gate 4 recorded 122 `co_capture` suggestions on 27 items with no precision or volume threshold.                                                                                   | R0 (label), R5           |
| A-1  | Clipboard images are not extracted until restart             | Confirmed                                     | `receiveImage` preserves and never enqueues `extract`; the text path two functions above does.                                                                                                                                                                                                                                                                                                                                              | R1                       |
| A-2  | Receipt and blob are not one transaction                     | Confirmed                                     | For text and images the receipt commits, then the blob is written, then `markPreserved` runs; a crash between leaves a `received` item with no job.                                                                                                                                                                                                                                                                                         | R3                       |
| A-3  | Schema extraction and entity resolution commit separately    | Confirmed                                     | `extractSchema` commits at line 525 and `resolveEntities` runs after it in its own statements.                                                                                                                                                                                                                                                                                                                                              | R3                       |
| A-4  | `item(id)` scans a 10,000-row projection                     | Confirmed                                     | `items(10_000).find(...)`. One `WHERE id = ?` query.                                                                                                                                                                                                                                                                                                                                                                                        | R1                       |
| A-5  | 600 synchronous ForceAtlas2 iterations in the renderer       | Confirmed                                     | `Graph.tsx` line 117. The library ships a web-worker supervisor.                                                                                                                                                                                                                                                                                                                                                                            | R1                       |
| A-6  | Imports trust archive paths and acceptance state             | Confirmed                                     | `transfer.ts` joins `blobFile(...)` names from the package into the vault and imports `status` as exported.                                                                                                                                                                                                                                                                                                                                 | R3                       |
| A-7  | Migration has no pre-migration backup and no version ceiling | Confirmed                                     | `migrate()` applies every version above the stored one and never checks for a stored version above its own.                                                                                                                                                                                                                                                                                                                                 | R1                       |
| A-8  | v0.2 encryption is a migration and recovery redesign         | Agreed                                        | ADR-004 defers it; the plan should treat it as a schema and key-management change, not a feature.                                                                                                                                                                                                                                                                                                                                           | v0.2                     |

## Decisions before the work starts

Four of the repairs change the specification or an ADR, so they wait for approval. Everything in R1 is a bug fix inside the current design and can start at once.

1. **Relabel v0.1.** README and `docs/milestones.md` say "v0.1 is complete". Proposed wording: "v0.1 is feature-complete; the acceptance harnesses of specification section 10 are pending (see R5)." The label returns to "complete" when R5 passes.
2. **ADR-001, amended rather than reopened.** Keep D3 (iii is core infrastructure). Change the ADR's decision to: iii owns the function catalog, routing, worker supervision, configuration and traces; the vault's `job` table owns the queue, because a stage's completion and the rows it writes must commit in one SQLite transaction. Record why the engine queue was not adopted. The alternative the review prefers, moving execution into iii with inbox/outbox semantics, costs a second transactional store and gains nothing the job table lacks once R3 is done. My recommendation is the amendment.
3. **ADR-005, extended.** Add: a human decision is an append-only event bound to one assertion revision. A new revision of a summary returns to `suggested` beside the accepted one; a new revision of a relation (same subject, predicate, object) keeps its decision because the claim is unchanged, and the new run is recorded as a re-confirmation. A rejection of a relation binds to the claim, not to the revision, so a generator does not re-propose what the person refused. A rejection of a summary binds to that text.
4. **ADR-006, new: the ledger data model.** Resource → capture version → payload; observations (fragments) are never deleted, only superseded; assertion revisions are immutable; decisions are events; current status, search index and graph are projections that can be rebuilt. This is the schema v5 design that R2 implements. Written as Proposed, approved before R2 starts.

Two smaller choices inside those, flagged so they are not made by default:

- Trace payload capture in development: off by default with an opt-in flag for a debugging session, or kept on with a short retention. I propose off by default, retention one hour, no disk store; the console stays a development-only compose entry.
- Duplicate bytes from a second source: keep today's `duplicate` state (one artifact, a pointer to the twin), or make it a second capture version of one resource. I propose keeping `duplicate` for v0.1 and letting ADR-006 decide; blob deduplication already happens in the store.

## Repair plan

Six phases, in dependency order. R1 needs no approval and starts first. R2 is the large one and depends on ADR-006. Each phase ends with a gate record in `docs/gates/` like the milestones did, and each item names the test that proves it. Sizes are working days for one person.

### R0: honest labels and amended decisions (half a day, needs approval)

- README and `docs/milestones.md` relabelled as decided above.
- ADR-001 amended, ADR-005 extended, ADR-006 written, all `Proposed`; specification section 4 ("the engine owns the queue") and D3's wording updated to match once accepted.
- Specification section 8 gains the trace-capture rule as it will be enforced (R1), not as an aspiration.

Done when: the documents say what the code does, and nothing in the repository claims a gate that did not run.

### R1: stop the bleeding (2 to 3 days, no spec change)

Surgical fixes inside the current schema. Each has a unit or gate test.

- **Traces.** `.iii/config/iii-observability.yaml`: `trace_storage.enabled: false`, `retention_seconds: 3600`, `max_attribute_bytes` to the minimum the engine accepts; payload attributes off through the SDK or a span-collapse rule, whichever the engine offers (to check against iii 0.25.0's observability schema). The packaged app's generated engine config (`engine.ts`) gets the same values. Test: capture one page, read the trace store, assert no span attribute contains fragment text or a blob path. The console stays a development compose entry; the README's note about 3114 says to start it only when needed.
- **Human-only mutations.** Remove `kernel::review`, `kernel::tag` and `kernel::retry` from the bus; the renderer's IPC handlers already call `core.review` and `core.tag` directly. Test: a worker triggering `kernel::review` gets `FUNCTION_NOT_FOUND`.
- **One writer per vault.** `app.requestSingleInstanceLock()` in `app.ts`; a `vault.lock` file with the owner's pid and worker name opened exclusively in `Vault`'s constructor; a second opener gets a clear error and the UI says which process holds it. Test: two instances on one vault directory, the second refuses.
- **Clipboard images.** `receiveImage` enqueues `extract` when the state is `preserved`, as the text path does. Test: paste an image, assert an `extract` job exists before any restart.
- **Retry and failure semantics, minimal form.** `markFailed` only from the `preserve` stage; a downstream failure leaves the artifact `preserved` and the job `failed` (the item view already shows job state). `retry` reopens failed jobs and resets the artifact state only when the preserve job was the one that failed. `requeue` on a `running` job sets a new `rerun_requested` column that `completeJob` turns into a fresh `open` row. Test: fail enrich three times, retry, assert enrich runs and the item stays `preserved`; requeue link during a run, assert it runs again after completion.
- **Backup verification.** `verifyVault` hashes every blob against its SHA-256 id, runs `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, compares item, payload and fragment counts with a manifest written by `backupVault`, and decodes one payload per modality present. Test: the reviewer's own case, a same-length garbage blob, returns `ok: false` naming the blob.
- **Migration safety.** Refuse to open a vault whose `schema_version` is above the code's; copy `vault.sqlite` to `vault.sqlite.pre-vN` before applying a migration. Test: a v99 database refuses with a message; a v3 database migrates and leaves the copy.
- **Small ones.** `item(id)` by primary key; ForceAtlas2 through `graphology-layout-forceatlas2/worker` with a stop after layout settles.

Done when: gate record R1 lists each test green, and the trace store of a fresh capture holds no content.

### R2: the ledger data model, schema v5 (6 to 8 days, after ADR-006)

The largest change and the one the review is really about. The projection tables the UI reads today stay, so screens change little; what changes is what is authoritative.

- **Capture versions.** `capture_version (id, artifact_id, content_hash, captured_at)` between `artifact` and `artifact_payload`; a URL whose preserved bytes differ from the last version gets a new version instead of a no-op; fragments and runs reference the version.
- **Observations are superseded, never deleted.** `fragment` gains `superseded_by_run_id`; `replaceFragments` marks instead of deleting; FTS and vectors index only current fragments; `relation_evidence` can point at a superseded fragment and the evidence card says so. The reviewer's foreign-key failure disappears by construction.
- **Assertion revisions.** `relation` keeps the stable identity (subject, predicate, object, author); a new `relation_revision (id, relation_id, run_id, generator, score, score_json, evidence, created_at)` holds each run's proposal immutably. `note` likewise gets `note_revision` with the text. `addRelation` and `upsertNote` append.
- **Decisions are events.** `decision (id, relation_id, revision_id, decision, actor, decided_at)` append-only; `relation.status` becomes a projection updated by a trigger or by `Graph.setStatus`, following the ADR-005 rules above (relations keep their decision across revisions, summaries return to `suggested`).
- **Provisional entities.** `entity.provisional` set for model-created entities until a relation naming them is accepted; `enrich::resolve` prefers non-provisional matches; the graph shows provisional entities dashed.
- **Migration v4 to v5** with the R1 pre-migration copy; existing rows become revision 1 with a synthetic decision event where status is not `suggested`. Export format v2 carries revisions and decisions; import of v1 packages maps as the migration does.

Done when: the reviewer's reproduction (accept a summary, rerun the model) leaves the accepted text in place with a new suggested revision beside it; a parser rerun after linking succeeds and the old fragments are still readable from the evidence card; every v4 test vault migrates and round-trips through export and import.

### R3: the job protocol (3 to 4 days)

- `job.generation` incremented on every open; `completeJob` and `failJob` are conditional on the generation they were claimed with, so a stale worker cannot close a newer run.
- Outcome classes in the core: retryable (transport, model busy), terminal (unsupported mime, schema invalid) and ambiguous (timeout after the call left); terminal failures do not retry, ambiguous ones re-run only idempotent stages.
- Per-job timeout and cancellation; the lease heartbeat stops on cancel.
- Inline captures (text, image) write the blob first, then receipt, payload and `markPreserved` in one transaction; an orphan blob in the content-addressed store is harmless and swept by backup.
- Schema extraction and entity resolution in one transaction, or resolution as its own run with its own revision rows.
- Import validates every package path against the destination (`resolve` inside the vault directory or refuse) and imports decisions as events with actor `import`, never as bare accepted status.

Done when: crash injection at every stage boundary (R5's harness, built here first) resumes each job exactly once with no duplicate fragments, revisions or decisions.

### R4: one contract registry (3 days)

- Every TypeScript worker parses its input with the zod schema from `@pim/contracts` (`ExtractRequest.parse`, not a cast).
- `npm run contracts` already emits JSON Schema; add a generated Python module (pydantic models via `datamodel-codegen`) that the media worker validates against, checked in and diffed in CI like the JSON.
- Renderer view types derived with `z.infer` from contracts; `pim.d.ts` becomes a re-export.
- The preload bridge typed end to end; an IPC envelope `{ v: 1, request_id, ... }` with a typed error shape; the main process rejects unknown versions.

Done when: no `as X` cast remains on a cross-process boundary (a lint rule enforces it) and a deliberately wrong payload is refused at every worker and IPC entry.

### R5: acceptance evidence (5 days plus corpus time, needs Areg's material)

Builds the harnesses specification section 10 names for v0.1 and a matrix from each requirement to the test that proves it.

- **Capture corpus of 100 real sources** across the six modalities: Areg supplies or approves the set; the harness captures each through the real surfaces (native drop via Playwright's drag API, the panel, the endpoint) and asserts preservation and span resolution. Gate: 99 percent preserved after retries.
- **Crash injection** at each stage boundary and at receipt (kill before commit, after commit, mid-blob). Gate: every job resumes once, no duplicates.
- **Retrieval set** of 100 known-item queries over that corpus. Gate: the specification's recall target at k=10.
- **Link quality**: a labelled sample of 200 suggestions with a precision floor per generator and an inbox volume cap (suggestions per day per 100 items); `co_capture` tuned or demoted until it passes.
- **Rehearsal** extended to verify the viewer's highlight, the graph edge card and keyboard review, the two items Gate 6 left unverified.
- **Requirement matrix** `docs/acceptance.md`: one row per CAP, PRS, MET, UI and SEC requirement with the harness and the last result.

Done when: the matrix has no empty row for a v0.1 requirement and the label returns to "v0.1 complete".

### Order and effort

R1 first and alone (it removes the exposures and the data-loss paths that exist today). R0 in parallel as documents for approval. R2 after ADR-006 is approved; R3 after R2 because generations and transactions change the same functions; R4 can run beside R3 (different files); R5 last, with its crash harness started in R3. About 20 to 23 working days in total, roughly the size of M3 to M6 together, which matches the review's point that this is architecture work and not a patch list.

## What stays in v0.2, and why

D13 defers the security architecture and the quality budgets to v0.2, and this plan keeps that line except where a v0.1 promise is broken today (the traces, the bus-exposed review functions, one writer per vault). The rest of the review's security findings are real and belong to v0.2 as designed:

- **Scoped read handles for workers** instead of absolute blob paths: a per-job capability token the core issues and the blob protocol honours, or blobs streamed over the bus. Needs the engine's channel or a local file-descriptor hand-off; a design question for v0.2, not a patch.
- **Caller authentication on the bus** (the specification's RBAC row): tokens the core issues to its own compose containers. Depends on how iii's auth function and RBAC behave in the pinned version; the earlier decision to skip RBAC in v0.1 stands.
- **OS sandboxing and network denial for workers**: macOS `sandbox-exec` profiles or App Sandbox entitlements per worker; interacts with packaging and signing, which are also v0.2.
- **Encryption at rest** (ADR-004): treated as a schema and key-management migration built on R2's v5 model and R1's pre-migration copies, with a restore path tested by the R1 verifier before any key is introduced.
- **Performance budgets** from specification section 9, measured on the 100-source corpus once R5 has it.

The one thing not to carry forward from v0.1 is the habit the review names: marking a requirement passed on a five-piece demonstration. R5's matrix is how that stops.
