# Shared Rust index and sync backend

Evidence: [current workflow inventory](../NOTES/shared-rust-index-sync.md).
Task branch: `codex/shared-rust-index-sync`, initially based on freshly fetched
`main` at `f90f088c41b60553abeaf9314daa223ddbe9c438`.

## P0 — One durable observation store

Extend the existing Rust engine and Commander SQLite database with additive,
independently versioned inventory tables. Preserve old search readers. Keep
search membership, sync grant membership, immutable generations, coverage gaps,
and change cursors distinct. Reuse file hashes only after current full change
stamps and physical identity match. Do not copy each inventory into Swift SQL.

## P0 — Every current Mac entry point

Route strict, backup, streaming, legacy scan, and live child-folder listing
through the shared engine. Retain native owner/grant checks and exact-path
mutation/read fencing. Commander application discovery and live overlays use
the Rust catalogue or Rust child queries. Existing enabled search watchers may
forward invalidations; this must not override disabled activity settings or
start a new Home watcher. Active sync watchers remain grant-scoped.

## P0 — Correct incremental recovery

Persist generation identity and change sequence across reconnects. Commit the
first eligible streaming entry immediately, then bounded batches. Sealed strict
generations are complete and immutable; provisional rows cannot authorize
deletion. Watch loss, remounts and changed exclusions require authoritative
reconciliation. Retain useful verified observations when a job pauses.

## P1 — Portable host adapters

Keep browser management on the same native route. Provide an in-process Rust
library adapter for iOS folder indexing and a platform-fed observation adapter
where PhotoKit owns enumeration. Android remains in the later-work section.
Do not describe a Mac-only executable migration as all-platform completion.

## Verification and release gates

- Match existing fingerprints, relative paths, symlink representation and
  exclusion behavior; `.git` remains included unless explicitly excluded.
- Test namespace races, nested directory mutation, unreadable entries, scope
  isolation, collisions, cache invalidation, interrupted generations and replay.
- Prove warm scans avoid unchanged content reads, and shared concurrent work
  respects configured scan/transfer budgets and CPU targets.
- Exercise search and sync simultaneously, live folder pagination, upload-only,
  two-way and download-only transfer, pause/restart, watcher loss and remount.
- Verify native capability negotiation and migrations, then final signed Mac
  installations and a synthetic cloud-to-device round trip. Keep Home paused.
- Record actual performance counters and tested source revisions. Unavailable
  hardware/platform acceptance remains explicitly incomplete.

Implementation is tracked in [the task checklist](../TODO/claude-todo/57-shared-rust-index-sync.md).

Source ownership: `filesystem-indexer/` is canonical for Rust engine/database and shared search primitives. Host packages reference local paths; keep UI/platform adapters in their native packages and preserve crate/binary wire names.
