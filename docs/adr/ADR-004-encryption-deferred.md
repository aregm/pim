# ADR-004: Encryption deferred with a compatible layout

**Status:** Accepted 2026-11-08 with the execution plan. The v0.2 work is treated as a schema and key-management migration on the model of ADR-006, with a restore path tested first (`04-execution-plan.md`, section 6).

## Context

Functionality and the interface come first (spec D13). Encryption is a bounded later change if the layout is right from the start.

## Decision

v0.1 relies on FileVault. Ids, blob manifests and the blob directory layout are designed so that per-blob encryption and SQLite3MultipleCiphers in v0.2 change no identifiers and need no re-import (spec D5).

## Consequences

Easier: v0.1 ships without native cipher builds. Harder: v0.1 vaults are plaintext on disk, and the README says so.

## Revisit when

At the start of v0.2, or earlier if a vault leaves the person's machine.
