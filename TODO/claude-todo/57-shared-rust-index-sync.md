# 57 — Shared Rust filesystem index and sync

Status: implementation complete; integration, publication and installed acceptance in progress. [Plan](../../PLAN/shared-rust-index-sync.md).

- [x] Audit current search, folder browsing and local/remote sync producers.
- [x] Start isolated branch from freshly fetched main; preserve existing work.
- [x] Add scoped durable inventory and reusable observations to the Rust DB.
- [x] Implement strict descriptor-relative capture and verified sealing.
- [x] Persist backup gaps, streaming changes and resumable cursors in Rust.
- [x] Route Mac strict/backup/stream/legacy inventory through the shared store.
- [x] Route live native folder listing through Rust child projections.
- [x] Remove duplicate Commander application/overlay filesystem walks.
- [x] Connect authorized watcher invalidations and bounded recovery.
- [ ] Verify shared resource governance and warm-cache performance.
- [x] Add iOS in-process Rust and platform observation adapters.
- [ ] Run regression suites, migration and isolated browser/device acceptance.
- [ ] Merge through protected PR checks and verify final signed installations.
- [ ] Verify synthetic upload/download with paths and Timeline retained.

## TODO at a later date

- Android implementation and physical-device acceptance remain deferred.

Mac inventory routing, Rust persistence and other-platform acceptance are
separate gates. Do not mark them complete based on one backend's unit tests.

Verified: top-level local Cargo workspace; 119 Rust tests passed (one opt-in stress test skipped); embedded Swift scan/symlink/cancellation acceptance; iOS simulator backup/restart + capability tests 2/2. iOS strict two-way folder coverage remains unavailable and is refused explicitly; deletion-free Backup and PhotoKit use Rust. No signed installation of this migration yet.
