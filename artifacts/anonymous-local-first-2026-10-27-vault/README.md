# Native password capacity acceptance — 27 October 2026

The native persistence mechanisms passed. Combined large-entry and 66 MiB PasswordManager UI acceptance remains incomplete. No product runtime changes were made.

## Passed in a clean native run

`vault-primitives/native-primitives.json` records real Chromium IndexedDB execution with the product's WorkspaceDatabase and LocalPasswordVault primitives:

- 205 refresh pages and exact reopened entries.
- Discovery across 257 delegated account partitions; cancellation preserves accounting.
- Superseded pulls cannot resurrect stale entries.
- An injected `QuotaExceededError` at native `IDBObjectStore.put` rolls back the complete native transaction and permits retry. This is fault injection, not actual browser quota exhaustion.

The transport and identities were synthetic. This proves native local mechanisms, not authenticated account or provider acceptance. The clean run passed one test, explicitly skipped the UI test, and had no OOM event.

## Failed UI attempts and evidence limits

`vault-initial-failure` preserves the initial 30-second large-note fill timeout. `vault` preserves the bounded retry: the textarea was visible, enabled and editable, and a small fill succeeded; filling 100,000 hardlines then timed out at 150 seconds and the container recorded an OOM kill.

`vault-final` used the same repeated large Unicode content with spaces replacing the hardline separators and a final multiline sentinel. Normal large-note fill and Save returned, but the 66 MiB `setInputFiles` call timed out at 30 seconds and the container recorded an OOM kill. Exact large-value cold readback, completed upload, export and responsive checks were not reached. A returned Save action alone is not exact persistence acceptance.

The OOM event is real, but its process and cause are unknown. A tool timeout alone does not establish a product capacity defect. No successful screenshot was captured: screenshot attempts after browser loss failed. Desktop/mobile full-scroll and overflow checks therefore remain outstanding.

Only whole-test cgroup before/after counters and final memory-current readings were captured. No memory sample immediately before upload, per-process RSS, peak-memory trace or allocator profile was captured, so the upload's incremental memory cannot be calculated.

## Source-only memory-path review

`PasswordAttachments.tsx` holds a File reference and supplies `file.stream()` to `storage.uploadFile`. `fileCrypto.ts` reads one 1 MiB frame and yields one AES-GCM frame. `passwordFiles.ts` hashes and awaits persistence of each encrypted frame before advancing; it retains a part count and digests, not an explicit array of all file frames. `storage.ts` makes two defensive Uint8Array copies in its queued putBytes path, plus IndexedDB's structured-clone work; these copies are per frame. No explicit all-frame accumulation was found in that product upload path.

The UI/test still retain the large controlled note, a 66 MiB Node Buffer and the temporary source file. Browser file-input transport, rendering, IndexedDB internals and subprocess memory were not profiled. These are possible contributors, not established root causes. The ordinary attachment download later buffers a Blob, and portable export buffers an archive, but neither stage was reached in the failed upload run.

## Quota evidence unavailable

In `vault-final`, CDP accepted `Storage.overrideQuotaForOrigin`, but a 16 MiB native IndexedDB write was not refused with a nominal 1 MiB override. The override's enforcement in that browser context is unverified. No native-enforcement, naturally full-device or quota-retry acceptance is claimed. The subsequent source-only handling change records this outcome explicitly instead of asserting a refusal; it was linted and bundle-checked but not browser-rerun.

## Isolation, cleanup and provenance

Every run used the task manager's network-none, 4096 MiB, one-CPU, sandboxed container with disposable anonymous/synthetic identities. Network-denial, boundary and package receipts are retained per run. Every cleanup receipt reports an empty remaining-container set.

`provenance.json` distinguishes executed final package/bundle hashes, reconstructed executed final source hashes, current source hashes and earlier package digest receipts. Full noisy failure stdout remains only in ignored `tmp/continuation/vault-*.log`; published failure receipts contain compact messages. No secrets or real account data were used.

The two opt-in source files pass scoped ESLint and bundle checks. Their UI test intentionally remains capable of failing on the observed stress path; no extra runtime retries or resource increases were made to obtain a pass.
