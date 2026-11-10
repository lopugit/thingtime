# PR 1062 — Stream device file transfers as indexing produces entries

Device backups previously waited for the full inventory and plan before sending payloads. This change commits native index revisions durably, prepares a bounded transfer queue, and executes eligible uploads concurrently. The existing journal, priorities, authorization checks, receipts and restart semantics remain authoritative. Partial inventory coverage never authorizes deletion or proves a complete backup.

## Implementation

- Commander emits the first eligible revision immediately, then bounded batches; filesystem changes include revisions to previously indexed paths.
- Native long-poll requests use a separate lane so ordinary file reads continue.
- The shared journal durably spools index pages before advancing cursors, separates planning from transfer, and preserves uncertain-operation identities and earlier receipts.
- Cloud API `api.files` 1.8.0 supplies root-scoped Timeline deltas and change-stream wake-ups. The download adapter consumes a watermark before snapshot traversal, bounds its queue, and preserves raw provenance and cursors against stale snapshot revisions.
- Individually editable progress blocks show simultaneous indexing/transfers and growing totals without claiming completion early.

## Verified checkpoint

- Shared file sync: 485 passing tests, including real nonempty fixture payloads before indexing finishes, revision reversion, lost-response reopen, bounded queues and completion races.
- Mac native: 198 tests, two platform skips, no failures.
- Commander: 39 library, eight integration and one smoke test passing.
- Progress UI: eight unit tests and isolated desktop/mobile Builder editing, save/reload, expanded hierarchy and scrolling acceptance.
- Cloud API: 56 file tests, 108 capability tests, and real disposable Mongo replica snapshot/delta/change-stream acceptance.
- Electron units: 244/245 on the whole run; the unrelated process-group cleanup failure passed a focused retry.
- Typecheck ratchet: 92 errors against the existing baseline of 89; no changed file-sync errors. The baseline was not changed.

## Still open

- Resolve the Electron host fixture's nested Chromium/OS sandbox incompatibility without weakening network isolation.
- Canonical app build, built-server manifest smoke, PR checks/review, merge and signed installed acceptance.
- Prove a real home-folder payload reached cloud storage by independently downloading it and comparing bytes/hash. No actual payload has been claimed verified at this checkpoint.
- Graph code refresh completed; documentation semantic freshness remains unverified after the earlier semantic backend failure.

No user files are removed by this change. Android remains deferred. The installed preceding build is stopped at the preparation error described below; its existing journal remains intact.

## Installed failure found during validation

The installed preceding build completed preparation and reported `This cloud writer requires a file upload or remote Trash operation`, with 0 of 43,264 operations confirmed. The native index represents empty regular files with SHA-256(empty), while the cloud binding previously required a nonempty multipart fingerprint. A regression reproduces the resulting whole-backup preparation failure. The correction adds canonical empty-file storage and restore through the existing attachment, file and receipt contracts; it does not skip empty files or substitute nonempty placeholder payloads.

Client regression checks pass for empty binding preparation alongside nonempty files, upload and restore receipt recovery, canonical digest validation, and no empty multipart/range operations. Native restore validation passed, including actual empty creation/replacement, stale-version refusal and durable receipt recovery. The combined shared suite passed 485 tests; real isolated Mongo backend acceptance passed for upload, a real zero-byte object download, fingerprint, commit/replay, restore, immutable receipts and access refusal. This exercises production handlers with the durable local object store; live S3 and installed-app acceptance remain outstanding. Attachment/capability suites and the eight-initializer storage race regression also passed.

Independent review found and fixed interrupted empty-object finalization: same-request retries now reach the existing active/stale lease checks, preserving the attachment, stored version and quota reservation. The new recovery regression and full attachment suite pass (12 + 302 tests).
