# PR 1049: Resumable home indexing and explicit partial backup coverage

The installed home backup failed before uploading because strict native scans
reject links and special entries and large scans outlive a single request.
Mac file access 1.9 adds Gitignore policies to the backup-only asynchronous
capture with durable skips introduced in 1.8.
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
- Installed update preparation exposed a shutdown crash: the visibility cleanup
  accessed `window.webContents` after Electron destroyed the window. Cleanup now
  retains the original event emitter; a regression makes the destroyed getter
  throw and verifies cleanup and late events remain safe.
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
  are clear in the integrated typecheck output. The full Electron host suite
  passes 231 tests after the final bridge and shutdown regressions.
  Signed head933df88 was installed with stable signing identity. Further installed
  shutdown acceptance found a late navigation-error dialog; load failures during
  Quit and window recreation during service cleanup are now suppressed.
  The desktop host now admits scan-status/cancel/skips with the same identity
  fences; 21 focused host/window regressions pass.
- Semantic graph refresh was attempted through the local proxy but returned
  hollow chunks and failed the semantic shrink guard. The previous semantic
  data is preserved; structural refresh is used and new prose is not claimed
  semantically indexed.

## Open acceptance

The installed 933df88 release contains partial capture and reconnect changes,
but clean Quit/reopen and the first real home upload remain unverified. The
user additionally requested Gitignore-style rules and dependency defaults before
that upload. This extends saved file-sync configuration to version 2 (older
clients refuse it), `api.things` 1.38 and native Mac `fileAccess` 1.9. Shared/native
matching, baseline retention and editable rule controls are implemented.
The shared Git oracle corpus covers 16 groups; isolated browser acceptance
passes all 10 checks, including no upload after Save, path explanations, custom
rules/defaults and individual Builder editing at desktop/mobile sizes. The final combined file-sync suite passes 390 tests plus one module-mock test.
Native final checks pass four matcher tests (including the 16-group shared
corpus and a 61-path Git oracle) and two focused Mac cancellation/policy tests.
Signed installed acceptance remains required.
No successful home upload is claimed. Links remain skipped until canonical
link-content and restore support is implemented. Upload-time changes still stop
the run for review. Large-volume throughput and native cache capacity are not
proven. Android is deferred.


## Follow-up verification notes

The standalone Electron pending-load fixture could not run under the enforced
macOS network sandbox: Electron's nested sandbox initialization failed. No
sandbox or network protection was disabled. The focused unit regression passed;
final signed installed-app acceptance is still required.
