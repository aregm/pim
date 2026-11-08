# ADR-002: Contracts as the backbone

**Status:** Accepted 2026-11-08 with the execution plan. Enforcement is completed by repair phase R4 (parsing at every worker, generated Python models, a typed IPC envelope); the decision is unchanged.

## Context

Three runtimes (renderer, main, Python) must agree on the same shapes; drift is the most common cause of silent data loss in pipelines.

## Decision

Every shape that crosses a process boundary (IPC, proposals, worker functions) is defined once in `packages/contracts` as a Zod schema and exported as JSON Schema into `contracts/`. The Python worker validates against the export. CI fails when the export is stale.

## Consequences

Easier: one place to read a contract; validation on both sides. Harder: a schema change is a visible, reviewed change.

## Revisit when

Never; this is the backbone.
