# ADR-005: Models propose only

**Status:** Accepted 2026-11-08 with the execution plan. Extended by ADR-006 (Proposed), which says how a decision binds to an assertion revision.

## Context

Fluent model output is indistinguishable from evidence unless the system keeps them apart structurally.

## Decision

Every model output lands as a `suggested` row with a processing run and evidence. Acceptance is a human action through `review.*`. No auto-accept, no agent writes, no external actions (spec D10).

## Consequences

Easier: provenance is total; a bad model never corrupts accepted knowledge. Harder: the inbox needs good bulk review, which is why UI-4 is P0.

## Revisit when

A labelled evaluation set shows a predicate above the agreed precision for auto-accept.
