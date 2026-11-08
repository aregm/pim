# ADR-001: iii as core infrastructure

**Status:** Proposed, 2026-11-08 (accepted with the execution plan)

## Context

Workers in two languages, a stage pipeline and future agents all need a catalog, a queue and traces. Writing them in-app would be a second, worse engine.

## Decision

The iii engine runs under the app from the first commit and owns the function catalog, routing, the stage queue, observers, traces and worker configuration (spec D3). The Electron main process is one worker, distinguished only by owning the vault. Compose starts the engine and every worker from `infra/worker-compose.yaml`. The iii SDKs are used directly; engine and SDK versions are pinned together (`infra/engine.lock`, `package.json`, `workers-py/media/requirements.txt`) and upgraded as one change.

## Consequences

Easier: adding a worker is a compose entry and a function; every stage is traced. Harder: one coordinated upgrade per iii release; Elastic License 2.0 applies to the engine binary.

## Revisit when

A release breaks the protocol twice in a row, or the licence posture (spec D12) conflicts with a hosted offering.
