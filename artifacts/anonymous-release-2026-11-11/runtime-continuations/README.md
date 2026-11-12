# Runtime completion and storage foundations — 11 November 2026

Parent source: `0fecb0079`; freshly fetched main `991a3d9d6` is already merged.
This checkpoint tracks actual stream producers, background queues, timed-out
operations and final persistence through the native shutdown reservation.
Native activation 1.1 now negotiates the loaded process contract for both account
modes, with unchanged authority and managed-database liveness checks.

A reviewed backup race is fixed: SDK acceptance and exactly-once fenced receipt
attachment share one tracked continuation, even when abort wins the response.

## Verification

See [verification.json](verification.json) for source/log hashes and separate
batches. Do not sum these overlapping suites as unique tests: native units 48;
stream/backup 129; overview/catalogue/inventory/reply 32; queues 73; SQLite 11.
Raw TypeScript and the zero-baseline ratchet pass; final full lint has zero
errors and 372 warnings. The uncontended production
build and compiled 27-contract smoke pass, including held-admission 503 and
release/recovery. The compiled smoke now waits for actual startup pool cleanup;
the earlier immediate-idle assertion was invalid once that work was tracked.
The progress plan passes 1440/390/320 rendering, full scrolling, filtering,
search and navigation in a clean task-owned Chromium context; browser closed.

## Storage boundary

The new SQLite primitive uses actual temporary files, lossless BSON bytes,
transaction rollback and scoped sessions. A separate process recovers data after
the writer exits without close/checkpoint. It is registered in `test:unit` as
`test:document-store`. No account or native storage provider is activated.
Canonical filter/update/index semantics, ACL/ledger route integration and native
bootstrap/iOS file persistence are required before full offline API acceptance.

## Still separate

Actual automatic native replacement, retained account data and editor-safety
acceptance are required beyond these unit checks. Production trust, publication,
connected canonical MCP artifacts and iOS app/device acceptance remain open.
No existing account data, stable app or shared LLM proxy was changed.

The read-only [production capability check](production-discovery.json) still
finds MCP 2.2 without hosted render/export or native release catalogue capability.
The current connected tool inventory also has no render/export tool. No
production configuration or account content was changed during this check.

## Latest merge and native outcomes

Main advanced during verification; the final integration includes `a5054d78a`
(PR #1476). [Imported checks](main-a505-verification.json) pass 326 tests with
zero skips across sync, Electron folder-sync and both capability registries.
Earlier native artifacts are associated with their exact prepared source hashes,
not retrospectively claimed as runs of this new merge.

- [Initial run](../native-auto-activation/runtime-admission-1.1.0/README.md):
  signed staging and dirty refusal; harness failed to submit Commander.
- [Corrected submission](../native-auto-activation/runtime-admission-1.1.0-submit/verification.json):
  real submission, canonical persisted read and hard reload pass; automatic
  replacement times out after its 150-second observation window.
- [Closed-editor correction](../native-auto-activation/runtime-admission-1.1.0-navigation/verification.json):
  actual renderer confirms the closed default fields are absent. Initial
  text-entry readiness then fails before staging. No automatic replacement or
  desktop/phone drawer action acceptance follows from this run.

All task processes/listeners were cleaned up and temporary trust changes restored.
The corrected harness keeps Enter, persisted acknowledgement, unchanged safety
checks and the fresh-process assertion; it never forces a checkpoint or restart.
Next work is to diagnose the initial editor readiness/focus boundary, then finish
actual automatic replacement and local-account recovery. Unknown hidden drafts
remain protected; only the known closed custom editor is omitted from rendering.

Final combined-tree verification after main a5054d78a: TypeScript/ratchet zero
errors, full lint zero errors/372 warnings, canonical web build and compiled
27-contract smoke plus imported sync 1.6 manifest check pass. The final progress
plan again passes desktop/mobile/narrow rendering and interactions.
