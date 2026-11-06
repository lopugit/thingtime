# PR 1399 — Authorized external-drive reconnect

6 November 2026. Branch `codex/external-drive-reconnect`, based on `main`
`520fb4ec7ad85490957aab667b6a4ce71ff2a017`.

## Failure and recovery contract

A real, task-owned APFS volume retained its UUID, root inode, nonstale security
bookmark and bytes after reconnect, but received a different device number.
Native captures correctly refused their old `st_dev:inode` namespace. Generic
failures then sent the automatic job to attention instead of reconciliation.

Keep the original grant and connection. Resolve without UI or automatic
mounting. Distinguish missing volumes from deleted roots on online volumes.
Use UUID/inode/birth continuity as an additional fence, never permission to
reuse old entry stamps. Replace obsolete disposable Rust generations and close
only the old local hint prefix in the durable journal. Every observation,
cursor, operation ID and uncertain/confirmed receipt remains retained until
the ordinary guarded consumer and fresh sealed reconciliation finish.

Explicitly abandoned captures keep `retired`/interrupted status even after
remount. Cache invalidation uses its own private `reindex` state. Account,
configuration, permission, explicit Pause and deletion-propagation fences remain
upstream of effects.

## Publication and private data

Different-device ordinary downloads use the existing verified on-volume
candidate-copy and atomic rename protocol. New private checkpoints retain
root, candidate, displaced-target and journal continuity plus the private
marker hash. Recover pre-rename preparation, post-rename lost receipts and
two-step displacement without repeating an uncertain swap. Later user edits
remain pending; missing legacy proof remains a refusal.

Persistent receipt aliases protect completed journals and portable link
envelopes independently of receipt lookup. Both native Swift and shared Rust
scan paths require UUID/inode/birth and marker or full-envelope hash. Existing
current-attachment receipts can acquire that extra proof only after their
original attachment identity and bytes are verified. An unbound legacy journal
is an unreadable gap, never an ordinary upload subtree. Known mismatching UUIDs
cannot borrow an otherwise matching device number. Alias comparison ignores
only obsolete attachment identity after persistent proofs match.

`commander-platform` contains the narrow, descriptor-only Darwin UUID syscall;
the shared indexer and core retain `forbid(unsafe_code)`. There is no additional
walker, filesystem index, MCP or credential path. Mac local contracts are file
access 1.20.0 and publication 1.3.0.

## Verification

`DriveReconnectTests` use disposable images, synthetic data and an isolated
private receipt registry. Cases include same/different mountpoints with device
renumbering; a replacement volume at the old path; old capture migration;
staged offsets; pre/post-rename and two-step recovery; later edits; replaced
journals; complete-before-detach scans before lookup; portable links; legacy
receipt migration/refusal; wrong UUIDs; repeated attachment aliases; and
abandonment followed by remount.

Run the full Apple package with `THINGTIME_TEST_DRIVE_REMOUNT=1`. Set
`THINGTIME_SYMLINK_TEST_DESTINATION` only to a task-owned FAT32 image to exercise
the existing unsupported-filesystem tests. Build the real shared helper first.
Run the Rust workspace, Mac folder/photo/controller/filesystem suites, canonical
client file-sync suite, Electron folder-host tests, scoped lint and typecheck.
The PR and task evidence retain exact tested source and results.

A bounded semantic Graphify attempt did not complete. The canonical AST refresh
provides a usable immutable snapshot and HTML; changed documentation is not
claimed semantically current. Disk images do not prove physical USB behavior.
Final deployed acceptance and signed installation are independent gates. This
task never ejects a user volume, modifies a real sync grant/configuration, or
replaces another task's installed app.
