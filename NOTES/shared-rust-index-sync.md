# Shared Rust filesystem index and sync observations

Grounded 2026-11-04 against `main` at `f90f088c41`.

The owner requested the existing Rust indexer and database for every local
index/sync workflow. Commander already uses `commander-indexer` and
`filesystem-index.sqlite3`; Mac backup and streaming upload reuse its walker but
copy observations into Swift inventory databases. Strict two-way/download scans
still use Swift. Live device folder listing and some Commander application and
overlay discovery also repeat enumeration outside Rust.

Relevant boundaries are `Commander/crates/commander-indexer`, the Commander
daemon's indexing and filesystem-change services, AppleFileSync's
`MobileFolderInventory` and `CommanderBackupCapture`, and ThingtimeNode's
`MacFolderSync` and `RemoteFilesystem`. Browser device sync delegates to the
native host. iOS cannot spawn the Mac executable and needs an in-process Rust
adapter; PhotoKit remains the platform authority for photo discovery. Android
work remains deferred by the owner's earlier instruction.

Search visibility is not sync permission. A shared physical observation may be
reused only after the authorized root is reopened and its current identity and
change stamps agree. Search pruning, dropped watcher events, interrupted scans,
or an inaccessible path must never become proof of a deletion. Strict snapshots
need complete, verified membership; backup streaming retains explicit gaps.

PR #1322 removed the short native strict-scan timeout and preserves recovery
tickets. It did not migrate strict scans to Rust or make initial two-way transfer
stream before a complete inventory. PR #1325 repairs cloud Files publication;
that is a separate data-path correction, not indexer reuse.

See the [implementation plan](../PLAN/shared-rust-index-sync.md).

2026-11-04: User explicitly requested one top-level shared engine directory, consumed by local build references without package publishing. Engine, shared search primitives and in-process ABI are now a single `filesystem-indexer/` workspace.
