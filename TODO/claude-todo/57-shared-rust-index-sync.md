# 57 — Shared Rust filesystem index and sync

Status: shared engine implemented and exercised in signed macOS builds. Final integrated verification and protected merge are tracked in [PR #1327](https://github.com/lopugit/thingtime/pull/1327). [Plan](../../PLAN/shared-rust-index-sync.md).

- [x] Audit current search, folder browsing and local/remote sync producers.
- [x] Start isolated branch from freshly fetched main; preserve existing work.
- [x] Add scoped durable inventory and reusable observations to the Rust DB.
- [x] Implement strict descriptor-relative capture and verified sealing.
- [x] Persist backup gaps, streaming changes and resumable cursors in Rust.
- [x] Route Mac strict/backup/stream/legacy inventory through the shared store.
- [x] Route live native folder listing through Rust child projections.
- [x] Remove duplicate Commander application/overlay filesystem walks.
- [x] Connect authorized watcher invalidations and bounded recovery.
- [x] Verify shared resource governor regressions and signed helper warm-cache reuse.
- [x] Add iOS in-process Rust and platform observation adapters.
- [x] Run shared Rust, Commander, Swift, iOS simulator, web Sync and release contract regressions.
- [x] Install signed Commander and Thingtime on macOS and verify their running binaries.
- [x] Verify synthetic upload/download byte equality, native consent, window-close continuation, pause and restart, and retained Timeline versions.
- [x] Verify installed Timeline restore, ordinary Files upload and live Sync measurements against independent file hashes and process counters.
- [ ] Verify the final signed bundle and the corrected idle dashboard status.
- [ ] Merge through protected PR checks and verify production deployment.

## TODO at a later date

- Android implementation and physical-device acceptance remain deferred.

Mac inventory routing, Rust persistence and other-platform acceptance are
separate gates. Do not mark them complete based on one backend's unit tests.

The top-level Cargo workspace passed its regression suite, with one opt-in stress test skipped. The embedded Swift fixture exercised scanning, symlinks and cancellation. Both iOS simulator backup/restart and capability tests passed. iOS refuses strict two-way folder coverage while deletion-free Backup and PhotoKit use Rust. On macOS, signed Commander passed a disposable index fixture and signed Thingtime completed an isolated 1 MiB byte round trip. The Mac's requested limits are 40 Mbps for shared transfer and scanning, with a 15% CPU target. Home remains paused.
