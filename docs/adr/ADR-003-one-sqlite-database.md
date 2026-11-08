# ADR-003: One SQLite database with derived tables

**Status:** Proposed, 2026-11-03 (accepted with the execution plan)

## Context

Personal scale; transactions across items, assertions, runs and jobs matter more than parallel writes. A second database would need cross-database atomicity the app cannot promise.

## Decision

One `vault.sqlite` per vault via better-sqlite3 in WAL mode, a single serialized writer in the main process, FTS5 and sqlite-vec as derived tables, and the `job` table as the queue of record (spec D4). The engine queue dispatches; the job table is the truth and replays open jobs on start.

## Consequences

Easier: backup is one file plus blobs; rebuild is a command. Harder: index rebuilds compete with interactive reads, so indexing yields.

## Revisit when

Vector queries miss their budget at one million fragments, or multi-device sync arrives.
