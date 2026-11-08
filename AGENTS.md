# AGENTS.md

How to work on PIM, whether you are a person or a coding agent. The rules come from the design method in _System Design Not For Interviews_ (Melik-Adamyan and Kurapov, https://github.com/aregm/System-Design-textbook), applied to this repository. The method in one sentence: a change is a candidate; the recorded decisions define what is acceptable; the executable checks reject what they can see; the owner changes the decisions. You propose. You do not decide alone.

This file is deliberately short. It points at the records instead of repeating them, because a rule that lives only in a prompt is not enforced, it is remembered.

## 1. Read what the task's boundary owns, not the whole repository

The design knowledge is layered. Read the layer the task touches, then follow declared relationships outward.

| Question                                                                                | Where the answer is                                                                          |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Why PIM exists, for whom, and what is out of scope                                      | `docs/01-requirements.md` sections 1 and 10                                                  |
| What must be true, as testable obligations with ids (CAP-, PRS-, MET-, GRA-, SEC-, UI-) | `docs/01-requirements.md` sections 3 to 8; the words they use, section 2                     |
| The governing concept, its entailments, and what should be cheap to change              | `docs/02-intent.md`                                                                          |
| Which container owns what and must not do what; the contracts on four axes              | `docs/03-architecture.md` sections 3, 5 and 7                                                |
| The data model                                                                          | `docs/03-architecture.md` section 8                                                          |
| Worker functions and the renderer-to-core contract                                      | `packages/contracts/src/index.ts`, `contracts/*.json`, `docs/03-architecture.md` section 7.2 |
| Decisions taken, each with the alternative it rejected                                  | `docs/02-intent.md` section 7 (D1 to D13), `docs/adr/`                                       |
| What was built, where it deviated from the plan, and the evidence                       | `docs/milestones.md`, `docs/gates/`                                                          |
| What is known to be wrong and the order it will be repaired in                          | `docs/review-response-2026-11-08.md`                                                         |

A task on the parse worker needs the `ExtractRequest` and `Extraction` contracts, the parse worker's row in the architecture's container table and the gate 2 record. It does not need the graph code. A task on the renderer needs the IPC contract and the renderer's "must not" column in that table. Read more only along a dependency you can name.

## 2. Before changing anything, say what you are betting on

A design is a set of bets about the future, and a good decomposition is the one that stays coherent as the system changes. Before you write code, answer these in the task notes or the pull request, a few sentences each:

- **The why-chain.** Which requirement id or decision does this change serve? If the chain ends in "because the code was like this", the element may be history rather than purpose. Say so instead of preserving it blindly.
- **Fact or choice.** Which parts of the request are constraints (a decision, a contract, a platform limit) and which are free choices? Do not treat a previous implementation's choice as an obligation, and do not treat an obligation as negotiable.
- **The mechanism, not the component name.** If more than one arrangement satisfies the requirement, describe each in two or three sentences: what information it treats as authoritative, what it can do, and how it recovers after an interruption. "Add a service" is not a mechanism. Say which you chose, why, and which you rejected.
- **What should be cheap to change, and what must stay stable.** Name the change you are preparing for and the change you are deliberately not preparing for.
- **Complexity you add.** Say whether a new state, table, status or branch is inherent to the obligation or contributed by your approach. If you move a responsibility rather than remove it, say where it went.

Discovering that a requirement is hard does not authorise weakening it quietly. Record the proposed change and who owns it, then stop for a decision (section 5).

## 3. Words are part of the architecture

PIM's vocabulary carries rules. An **artifact** is immutable evidence. A **fragment** is the unit every citation points to. Everything derived is an **assertion** (a `relation`, a note, a tag) with an author, a processing run and the fragments it rests on. An **entity** is a node that assertions can name. A receipt is `received`, `preserved`, `failed` or `duplicate`. An assertion is `suggested`, `accepted`, `rejected` or `superseded`. Model output is a proposal; acceptance is a human act (ADR-005).

- Do not give an existing word a second meaning, and do not reuse a word for a thing with a different identity or lifecycle. A retry is an attempt within a job, not a new job. A re-extraction creates a new processing run, not a new artifact.
- When a term is ambiguous, write down its central example, an accepted variation and an excluded case, then put the rule in a type or a check where the software can enforce it.
- Before adopting a metaphor (queue, pipeline, ledger, cache), list what it makes you assume and check each assumption against the contract. The specification's own metaphor, an evidence ledger with an assertion court, has its entailments written out in §4. A new metaphor gets the same treatment or is not used.
- A reader unfamiliar with the code should be able to predict behaviour from the names. If a name misleads, rename it; renaming is maintenance.

## 4. Boundaries, contracts and interfaces

The container table in `docs/03-architecture.md` section 3 is binding. The main process is the only writer to the vault. The renderer never reaches Node, the filesystem or the network. Workers never touch the vault and return proposals, never writes. The iii engine holds no canonical state.

An interface is a relationship, not a signature. Every function registered on the engine and every IPC handler states four things in its contract's doc comment: **representation** (the shape, which `packages/contracts` enforces), **meaning** (what the value denotes: which blob, which units, what an absent field means), **timing and ordering** (may it arrive twice, out of order, late) and **failure** (who retries, who gives up, what state each side is left in). Types alone cover the first.

- Every shape that crosses a process boundary is defined once as a Zod schema in `packages/contracts` and exported to `contracts/` (ADR-002). The receiving side parses it. A cast such as `input as ExtractRequest` is a known defect listed in the review response, not a convention to copy.
- Errors are **retryable**, **terminal** or **ambiguous**. Design for the ambiguous case: a stage must be safe to run twice. Retries without idempotency corrupt data under load; retries without backoff and a budget amplify an outage.
- **One writer per invariant.** Whoever may change a piece of state owns the properties it must satisfy. Do not keep two copies of a fact that must agree (a record and a queue entry, a status column and a derived flag); derive one from the other or write both in one transaction.
- Preserve the fact a later action will need. If a decision depends on when something happened or what it was before, keep that; do not overwrite it. The ledger changes proposed in the review response exist for this reason.
- Compatibility has four senses: wire, source, semantic, behavioural. Changing what a field or a status means is a breaking change even when the JSON still parses. A change to the vault schema bumps the version and ships with a migration and a test that opens the previous version.
- Anything that waits on a model, the network or another process has a timeout and a stated behaviour on expiry. Slow is worse than dead.
- When you draw or move a boundary, trace three executions across it: the normal one, one interrupted between two writes, and the change you expect. An obligation that falls between two parts belongs to neither and will be lost.

Prefer deep modules to shallow ones: an interface that makes the wrong operation unavailable (a handle that reads one artifact) beats a wide interface plus a comment asking callers to behave.

## 5. Decisions: when to stop and ask

Some changes are implementation. Others reopen a decision. The second kind needs the owner, Areg Melik-Adamyan, before the code is written, not after. A change is a **decision delta** when it does any of the following:

- changes the meaning of a status, a predicate, an id or a table's rule (`docs/01-requirements.md` section 2, `docs/03-architecture.md` section 8);
- moves a responsibility across a row of the container table, or lets a container do something in its "must not" column;
- contradicts a D-decision (`docs/02-intent.md` section 7) or an ADR, including the alternatives they rejected: an adapter layer around iii (D3), security or performance gates in v0.1 (D13), auto-accepting model output (D10);
- adds a path by which bytes leave the machine, gives a model write authority, or gives a worker access to the vault;
- changes an acceptance criterion, a gate threshold, or what a harness measures.

For such a change, write the decision first as an ADR in `docs/adr/`, status Proposed, in the format the existing records use: Context, Decision, Consequences (the costs as well as the gains), Revisit when. Name the alternative you rejected and why. Then stop; do not implement past the decision while it is open. Edits to the requirements, the intent or the architecture documents are shown as a proposal before they are applied.

A decision record is a why-chain written down. Its rationale must name a live quality the decision serves, not a historical circumstance. If an existing record's premise is now false, say so; superseding a record is how the corpus stays honest.

## 6. Executable checks reject; prose only guides

What a constraint can be checked by, it should be checked by. The checks that exist today, and what each can and cannot see:

| Check               | Command                                               | Quantifies over                                                                   |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Formatting and lint | `npm run lint`                                        | Syntax and style, Markdown included                                               |
| Contract drift      | `npm run contracts && git diff --exit-code contracts` | The Zod schemas and their JSON export agree; nothing about meaning                |
| Unit tests          | `npm test`, `npm run test:py`                         | The cases the tests enumerate: vault, contracts, model worker, media worker       |
| Gate 0              | `npm run gate0` with the engine running               | Catalog, loopback binding and telemetry flags at one moment                       |
| Rehearsal           | `npm run rehearsal`                                   | One scripted afternoon over the five-piece corpus; not crash injection, not scale |

Run the checks that cover your change before you say it is done, and say which ran. "Verified" without a named check is a claim, not evidence. State the boundary: "the unit tests pass; nothing exercises the restart path" is the honest form.

**Protect the examiner.** A change that deletes or weakens a test, loosens a schema, widens a contract, edits an ADR or the specification, or changes a gate's threshold is a specification change. It goes in its own commit, labelled as such, and needs approval. It never ships in the same change as the implementation it would let through; a green build obtained that way counts for nothing.

**Add a check when you add a rule.** A constraint worth a comment is worth a test, a schema restriction or a dependency rule when its violation would matter, it recurs across changes, and the consequence is observable. Each new check names the decision it protects, so a future reader knows whether a failure means the candidate is wrong or the rule is stale. Test the check once: introduce the violation and confirm it fails.

**A prototype is validation only if a negative result is possible.** Before building an experiment, write down what outcome would reject the idea. A demonstration is designed to succeed and proves nothing.

## 7. The change report

Every pull request description, and every handoff from an agent, says the following. Short is fine; missing is not.

1. The requested behaviour and the explicit non-goals.
2. Modules and public contracts changed.
3. Decisions touched (D-ids, ADRs) and whether their meaning changed. "None" is a valid and useful answer.
4. Dependencies added or removed, including npm and Python packages and engine version pins.
5. Assumptions introduced, and who should confirm them.
6. Specification, test, schema and check changes, listed separately from the implementation.
7. Evidence: which checks ran, on which commit, with what result, and what no check covered.
8. What still depends on judgment.

A three-line change that moves authority across a boundary deserves design review even when every test is green. A large refactor whose decision delta is empty can be assessed mostly through contracts and evidence.

## 8. Facts about this repository that the method does not tell you

- **Nothing leaves the machine.** The engine binds `127.0.0.1:49140` with telemetry off (`infra/worker-compose.yaml`, `III_TELEMETRY_ENABLED=false`). There is no remote model path. Any new outbound connection is a decision delta, not a feature.
- The engine port is deliberately not iii's default; other engines run on the reference machine. Do not change it, and never stop or reconfigure an engine this repository did not start.
- The engine and both SDKs are pinned together (`infra/engine.lock`, `package.json`, `workers-py/media/requirements.txt`) and upgraded as one change (ADR-001).
- The source build and the packaged app keep separate profiles (`PIM Dev` and `PIM`) and can run at once.
- Biome formats everything, Markdown included; run `npm run lint` on docs too.
- Scratch files and tool output do not belong in the repository. Use a directory outside it.
- Commit only when asked. A commit's subject says what changed and for whom, in the imperative; an agent adds a `Co-Authored-By` trailer naming itself. The repository has no git identity configured; do not add one to its config.
- The design's current label is "v0.1 feature-complete, acceptance pending". The repair phases in the review response start only on the owner's go-ahead; that document records which decisions are still open.

## 9. The question to keep asking

From the book's preface: what will change in five years, when most of the people who built this are gone, and where do we want that change to be cheap? If your change makes that question harder to answer, write down why it is worth it.
