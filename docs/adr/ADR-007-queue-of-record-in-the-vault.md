# ADR-007: The vault's job table is the queue of record

**Status:** Proposed, 2026-11-08. Supersedes one clause of ADR-001 ("the stage queue") and one sentence of ADR-003 ("the engine queue dispatches"). D3 is unchanged: iii is core infrastructure, not an adapter.

## Context

ADR-001 assigned the stage queue to the iii engine. Since M1 the core has claimed jobs from the vault's `job` table and called stage functions directly with retries and backoff; the milestone log recorded the deviation ("the engine's queue worker is not added until a stage needs fan-out"). The review of 2026-11-08 named the gap (P1-2): the record says one thing and the code does another, and the design's reasoning for the choice was never written down. A record that does not describe the system cannot be revalidated.

The reason the vault owns the queue is transactional. A stage's completion and the rows it writes (fragments, relations, a run) must commit together, or a crash between them either loses work or duplicates it. SQLite gives that in one transaction when the job row lives in the same database. A queue in the engine would need an outbox in the vault and an acknowledgement protocol to achieve the same, which is a second transactional store for no gain at one person's scale.

## Decision

The iii engine owns the function catalog, routing, worker supervision and restart, worker configuration and traces. The vault's `job` table owns the queue of record: what is owed, to which artifact, at which stage, with how many attempts and under which lease. The core claims jobs from that table, calls stage functions through the engine, and completes or fails the job in the same transaction as the rows the stage produced. Open jobs are replayed on start, so the scheduler is level-triggered and needs no durable action log.

The engine's queue and observers remain available for fan-out across workers or machines if a stage ever needs it; adopting them would be a new record.

## Options considered

**A. Move execution into iii** with inbox and outbox semantics, as the review preferred. Rejected: it adds a second store that must agree with the vault, and an acknowledgement protocol, to reach the exactly-once completion the job table has by construction.

**B. Demote iii to optional infrastructure** and make SQLite the sole authority for everything including routing. Rejected by D3 on 2026-11-03: workers in two languages, a catalog, supervision and traces would have to be rebuilt in the app.

**C. Split the ownership** (chosen): the engine routes and supervises; the vault records what is owed.

## Consequences

Easier: exactly-once stage completion with the fragments it writes; recovery by replay; the engine can be restarted without losing work. Harder: the core is a scheduler as well as a writer, and R3 must give it generations, outcome classes, timeouts and cancellation; fan-out beyond one machine is not available without a new decision.

## Revisit when

A stage needs fan-out across machines, or the engine offers a transactional hand-off that the vault can join.
