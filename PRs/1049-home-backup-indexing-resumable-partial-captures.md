# PR 1049: Resumable home indexing and explicit partial backup coverage

The installed home backup failed before uploading because strict native scans
reject links and special entries and large scans outlive a single request.
Mac file access 1.8 adds a backup-only asynchronous capture with durable skips.
Supported files can proceed while coverage remains explicitly partial.

## Contracts and recovery

- Scope-bound native start/status/cancel/skip paging; no-follow reads, per-file
  hashing and authority checks before sealing or disclosing results.
- Existing strict scans remain strict. Only backup with deletion propagation
  disabled accepts partial observations; prior facts beneath gaps are retained.
- Device journals retain capture IDs, skip pages and confirmed receipts across
  lifecycle interruptions. One native generation restart is automatic; repeated
  interruptions need attention. Stop is durable and cancels the native job.
- Ordinary editable Builder blocks expose coverage and bounded skip navigation.
  Offline/network/power waits remain eligible and are displayed as waiting.
- Progress path: `/settings/things`, Sync connections, inside the device app.
  Remote browser progress viewing is not implemented.

## Validation

- Native worker: 16 Apple inventory and 27 Mac adapter tests passed, including
  unreadable subtrees, grant loss, cancellation during sealing and strict scans.
- Final peer review found and fixed scoped RPC suspend cancelling a background
  capture and provisional count retraction after a late path collision being
  rejected by the client. The actual suspend wire path has a native regression;
  17 native-inventory/partial-backup TypeScript tests pass after both fixes.
- Shared worker: final 39 focused tests passed; broader 59-test and
  maintenance/runtime suites passed before the final restart changes.
- Integrated canonical file-sync suite: 378 TypeScript tests and one module-mock
  test passed. Follow-up runtime/viewer (13) and partial recovery (6) checks pass.
- Isolated home browser checks pass with 301 skips in 128/128/45 pages, Builder
  nested edits/save/reload and desktop/mobile top-to-bottom overflow checks.
  Offline/online and persistent renderer lifecycle checks also pass. An accepted
  upload followed by a transport failure stays runnable and recovers the same
  job and receipt without duplication. Strict captures show no coverage panel.
- Full TypeScript checking has pre-existing diagnostics outside this change;
  the new coverage viewer ref typing was corrected and owned-file diagnostics
  are clear in the integrated typecheck output. Electron host suite:227passed.
  Final signed install remains pending.
- Semantic graph refresh was attempted through the local proxy but returned
  hollow chunks and failed the semantic shrink guard. The previous semantic
  data is preserved; structural refresh is used and new prose is not claimed
  semantically indexed.

## Open acceptance

The currently installed release still predates these changes. Real home upload,
automatic scheduling and reconnect acceptance are pending final signed install.
No successful home upload is claimed. Links remain skipped until canonical
link-content and restore support is implemented. Upload-time changes still stop
the run for review. Large-volume throughput and native cache capacity are not
proven. Android is deferred.
