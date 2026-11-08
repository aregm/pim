# ADR-006: The ledger data model

**Status:** Proposed, 2026-11-08. Extends ADR-005. Implemented by repair phase R2 as vault schema v5 once accepted.

## Context

The governing concept is an evidence ledger with an assertion court: originals and their fragments are immutable evidence, everything derived is an authored assertion over that evidence, and the person judges. Schema v4 cannot represent that. An external review on 2026-11-08 showed, at the cited lines: a model re-run overwrites an accepted relation's generator, score and evidence and replaces a note's text in place (P0-1); re-extraction deletes the previous fragments, so evidence that points at them fails its foreign key or silently loses its observation (P0-2); a URL whose content changed is never re-preserved (P1-1). MET-2 promises that a suggestion can be edited "without losing the original"; the code does not keep it.

## Decision

Vault schema v5 represents the ledger directly.

- **Capture versions.** `capture_version (id, artifact_id, content_hash, captured_at)` sits between `artifact` and `artifact_payload`. A capture whose preserved bytes differ from the artifact's latest version creates a new version; payloads, fragments and runs reference the version. Identical bytes arriving from a second source keep today's `duplicate` state in v0.1; whether that becomes a second version of one resource is decided when v0.2 starts.
- **Observations are superseded, never deleted.** `fragment` gains `superseded_by_run_id`. Re-extraction marks the previous run's fragments superseded instead of deleting them. FTS and vector tables index current fragments only. `relation_evidence` may point at a superseded fragment, and the evidence card says so.
- **Assertions are revised, never overwritten.** `relation` keeps the stable identity (subject, predicate, object, author). Each run's proposal is an immutable row in `relation_revision (id, relation_id, run_id, generator, score, score_json, evidence, created_at)`. `note` likewise gets `note_revision (id, note_id, run_id, text, created_at)`. `addRelation` and `upsertNote` append.
- **Decisions are events.** `decision (id, relation_id or note_id, revision_id, decision, actor, decided_at)` is append-only. `relation.status` and the note's status become projections of the decision events, maintained by the vault.
- **How a decision binds.** A decision on a relation binds to the claim (subject, predicate, object): a new revision from a new run keeps the decision, and the new run is recorded as a re-confirmation. A rejection of a relation binds to the claim too, so a generator does not re-propose what the person refused. A decision on a note binds to that revision's text: a new text returns to `suggested` beside the accepted one.
- **Provisional entities.** `entity.provisional` is set for model-created entities until a relation naming them is accepted. Resolution prefers non-provisional matches. The graph draws provisional entities dashed.
- **Migration and transfer.** Migration v4 to v5 runs after the pre-migration copy R1 introduces. Existing rows become revision 1 with a synthetic decision event where status is not `suggested`, actor `migration`. Export format v2 carries revisions and decisions; v1 packages import as the migration maps them.

## Options considered

**A. Keep v4 and patch the overwrites** (compare before updating, keep a shadow copy of accepted rows). Rejected: every new writer would have to remember the rule; the concept would remain a convention, not a structure, and the fragment deletion would stay.

**B. Full event sourcing**: every write an event, every table a projection. Rejected for v0.1: it is the ledger taken to its limit, and it costs a replay engine and a second way to read everything the UI reads today, for no obligation the requirements state.

**C. Revisions and decision events over the current tables** (chosen). The projection tables the UI reads stay, so screens change little; what changes is what is authoritative.

## Consequences

Easier: the person's decisions survive every re-run; re-extraction is safe; a changed page is captured as a new version; the evidence card always has something to open; export carries history. Harder: "current" becomes a query; the vault grows with superseded fragments and needs a retention rule in v0.2; migration v4 to v5 is the first one that rewrites meaning, so it ships with the pre-migration copy and round-trip tests on every v4 test vault.

## Revisit when

Retention of superseded observations costs more than the quality budgets allow, or multi-device sync arrives and the ledger needs a merge rule.
