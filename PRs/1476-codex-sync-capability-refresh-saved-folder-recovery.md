# PR 1476 — saved folder sync recovery

## Observed failures

- A signed Mac app held a pre-deployment `api.files` capability snapshot. One normal Downloads Retry after production reached 1.13.0 refused the old snapshot. A normal app reload fetched 1.13.0 and the same saved job resumed. The original uncertain upload was later verified through the owner-authenticated Files lookup as `terminal-no-effect` under its original operation ID; a null receipt alone was never used as proof.
- The resumed one-way Downloads backup stopped while preparing a file whose cloud parent had not yet arrived in the streaming hint order. Its complete sealed inventory remains the authority for parent creation. The original journal and confirmed operations stay retained.
- The saved Thingtime configuration's automatic setup remained pending while an older strict scanner was attached to an unscheduled attention job. Queue-only recovery cannot retire that scanner, even after the device lane becomes idle.
- Three closed native upload batches returned only `source-changed` members. Existing aggregate diagnostics cannot distinguish a server prepare refusal from a native read/stamp refusal; no common cause is yet proven.

## Changes

The Electron context refreshes an incompatible selected-origin manifest once, preserving owner, origin, window generation and native boundary checks. One-way local child hints that lack a prepared parent remain journaled without publication until a complete sealed reconciliation prepares the parent. Missing parents in a complete inventory and other conflicts still fail closed.

The optional `api.devices-sync-control` 1.6.0 `recoverSavedIntent` command acts only on the exact saved revision, matching policy and interval, idle native lane, unscheduled attention job and retained strict scanner. The selected origin and separately advertised worker version must be compatible. A private status hint selects this path; the worker rechecks the state under the root lock, waits for normal native cancellation, clears the scanner with CAS, and re-admits the original job ID without dropping imports or receipts. First-time and no-strict intents retain queue-only behavior. Pause and changed state cannot revive work.

The native batch emits one allowlisted stage-count summary only when a completed batch has `source-changed` results. It contains no file paths, IDs, digests, byte counts or raw errors. It changes no upload protocol or validation semantics.

## Verification and acceptance boundary

Focused JS tests cover exact admission, lost native cancellation reply, Pause race, old/missing/breaking server and worker versions, first-time queue behavior, remote worker status, and a journal close/reopen before child-parent sealed reconciliation. Capability manifest tests cover both generators. Native batch tests cover unchanged Rust capture, stale capture, server prepare refusals and final-read mutation. Final signed installation and one bounded original-job diagnostic Retry remain separate acceptance steps after merge and production 1.6.0 deployment. Do not infer that the native `source-changed` cause is fixed from the diagnostic counters alone.
