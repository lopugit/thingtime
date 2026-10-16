# PR #1002 — Mobile device contracts and recoverable file sync core

Branch: `codex/mobile-file-sync` → `develop`.
PR: https://github.com/lopugit/thingtime/pull/1002

This is the first implementation checkpoint toward the full mobile device and
Drive/Photos/Resilio-style sync request. The authoritative requirement/evidence
table and remaining work are in [mobile-file-sync.md](../docs/mobile-file-sync.md).
No native pairing or sync UI is claimed complete by this checkpoint.

## Delivered source

- One platform vocabulary supports iOS/Android through descriptor validation,
  safe server reads, browser types and the public device schema. Existing signed
  pairing, revocation and permission boundaries remain in place. Both manifests
  advertise devices 1.10.0 and pairing-claim 1.1.0.
- A shared reconciliation core detects concurrent edits, delete/edit conflicts
  (including new descendants beneath a deleted folder), invalid/incomplete
  inventories and identity changes. Upload/download/two-way/backup policies are
  explicit. Executors must use conditional, idempotent native/cloud writes.
- Immutable operation runs persist before effects, copy before removal, verify
  receipts and resume uncertain completion with the original IDs. Browser
  IndexedDB and Web Lock helpers provide durable journal/exclusion primitives.

## Verification — 2026-10-17

- 32 file-sync tests, 85 device tests, 95 capability tests and 265 schema tests
  passed; 477 focused tests total. Transfer adapters are synthetic and journal
  tests use fake IndexedDB, including close/reopen and concurrent transactions.
- Targeted lint passed. Full web/Vercel build passed, including packaged static
  output verification. Both compiled discovery handlers returned the expected
  local feature versions when fallback was pinned to the synthetic origin.
- Raw `tsc --noEmit` fails outside changed files. The final diagnostic output
  matches the initial diagnostic output; a new journal typing error found
  during development was fixed. This is not a clean whole-project typecheck.
- Graphify semantic extraction succeeded for the implementation checkpoint.
  The subsequent documentation refresh hit its semantic-shrink guard on the
  changelog, preserving the last complete semantics. The final structural
  refresh does not establish current semantic coverage for these PR notes.
  Legacy cache and unresolved hyperedge warnings also remain.
- The published preview URL responds, but its capability endpoint returned 404.
  Deployed feature validation remains pending.
- No native builds, installations or physical-device tests have been performed
  for this checkpoint. The iOS simulator and Android SDK are available locally
  for the native implementation stages. The conflicted primary checkout was
  preserved; all source work is in the isolated mobile-file-sync worktree.

## Next work

Implement actual native device discovery/pairing with secure credential and
pending-claim recovery; connect it to Things. Then add editable sync roots and
canonical guarded file-version/transfer APIs, native file/Photos workers,
background scheduling, progress/conflict/settings surfaces and real cross-device
acceptance. Keep the full goal active until the evidence table is satisfied.
