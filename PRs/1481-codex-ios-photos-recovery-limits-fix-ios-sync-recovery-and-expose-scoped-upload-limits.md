# PR 1481 — iOS sync recovery and scoped upload limits

PR: https://github.com/lopugit/thingtime/pull/1481

Status at source freeze, 12 November 2026: source and targeted validation are ready for exact-head CI. Installed Photos resume and mixed-media acceptance have passed; ordinary-folder and physical background acceptance remain separate parent-owned work. Delivery receipts belong in the PR timeline; this note records the tested behavior and its limits.

## Problem and behavior

The native Photos worker prepares five reservations concurrently. The canonical cloud-path helper rejected a third active request with HTTP 503, cancelling sibling work before the batch could publish. Its two setup slots now apply fair FIFO backpressure with queued cancellation/deadline cleanup. This is a resource-management bound, not a user-data limit. Current source/grant/owner/destination and publication checks remain enforced.

Device, folder and saved-configuration cards expose MB/s and hourly upload controls. Saved-card controls sit directly after editable identity/mode/destination and before tall activity/transfer content. Supported native Photos hosts negotiate automation 1.6; active lanes share scope policy and hourly accounting. Background pacing is an admission schedule: iOS controls actual wire timing and may start late.

Saved-settings recovery rechecks current authority. A verified owner arriving after foreground activation now triggers the existing native worker kickoff; explicit Pause, future retry and another owner remain refused. Expected budget waits drain admitted siblings and complete a bounded Apple processing slice only after checkpoint save/readback, while the remaining queue stays visibly incomplete. Known short pacing/hourly deadlines are preserved, stale dates have a one-second floor and unknown/transient waits retain 300-second backoff.

Up to five foreground/background slots share admission. Authorized future daemon starts use earliestBeginDate only within signer validity; conservative leases retain accounting until settlement. Signed-expiry failures do not retain phantom calendar slots.

Public contracts are `api.files` 1.13.1 for path-setup backpressure and `api.file-sync-transfer-admissions` 1.5.1 for closed configuration/destination/transfer diagnostic codes. Clients must not call every permission, expiry or 409 response changed settings.

## Validation

- Final combined native 34/34 passed for daemon scheduling, policy scope, expiry, deadline/checkpoint behavior and late-identity startup. A focused 19/19 also covers active-before-identity startup once plus paused/future/other-owner refusal. These overlapping runs are not added together.
- Inventory backpressure 22/22 passed. Combined capability suites 160/160 passed. Full web TypeScript passed after the FIFO/API change. Focused web suites 210+20 and targeted lint passed, with existing warnings only.
- Desktop/mobile control placement and nested Builder editing checks passed.
- The built real API fixture passed five concurrent reservations with distinct upload IDs, then six paired-only refill/upload/publication cycles. It also covers byte integrity, guarded updates/refusals, pause/revision/revocation, credential expiry, logout and device disconnect.
- A normal installed-simulator launch resumed the same interrupted run without rearm, journal edits or cookie injection. All 11 initial files/60,180,001 bytes downloaded through the canonical API and matched their source SHA-256 values, preserving the first file ID/revision. A later normal automatic scan added one PNG (76,168 bytes) and one MP4 (116,645 bytes), reaching 13 files/60,372,814 bytes. All 13 hashes matched; the prior 11 IDs/revisions/hashes stayed unchanged. The installed binary/debug-dylib matched the tested build.
- Same-run upgrade/resume and mixed photo/video checks passed. Separate ordinary-folder Backup acceptance remains parent-owned; modern iOS two-way/download guards are not weakened by this change. A no-login/no-cookie-injection owner probe verified current WebView origin, authenticated owner, paired device and native Photos grant, ruling out missing fixture authentication for the persisted uploading startup case.

## Source and evidence boundaries

NativeDeferredUpload.swift SHA-256: 53247bced3c4180ea49cc6fcd4aa3618d297d5ce19c60b301f1b48f67387b6c5. NativeBackgroundPhotoUpload.swift SHA-256: 9686ad018929e608266de36d00071b5674b546fd50530162052ba823f4c196a0. Incoming main b766776f6 includes unrelated authenticator app-shell changes; CI compiles the combined application. Required main integration also imports PR1478 at main6378ed47: shared MobileFolderBulkReader, folder journal/receipt recovery and scan-progress code. Focused imported checks passed 72 web tests and 5 MobileFolderBulkReader tests with isolated scratch output. The Photos hashes remain unchanged. Simulator Photos evidence is tied to those hashes and does not claim the entire imported app shell/shared-folder behavior was exercised in that binary; CI compiles the combined app.

The old acb20b33 JavaScript CodeQL job completed analysis processing but failed its required check with an installation API rate-limit error at 15:43:53 UTC. This is not a demonstrated product finding; final merged-head security checks still must pass normally. No controller/protection change or credential substitution bypasses that requirement.

The fixture uses disposable account/data and local object storage. It is real PhotoKit/API evidence, not direct S3 daemon or physical iPhone acceptance. Simulator BGTaskScheduler refusal is recorded separately from transfer behavior. Existing uploaded TestFlight 62 contains older source; canonical release allocation must inspect Apple and choose the next build without duplicating that upload.

A bounded semantic refresh of the four large changed historical Markdown files was stopped after slow progress. Their existing semantic content is retained, but complete current reindexing is not claimed. Structural code/report/HTML output and this small evidence note are selected for the final scoped refresh.

## Delivery gates

Require exact-head protected CI, normal main merge, exact-origin production contracts, signed canonical TestFlight packaging/upload and verified Apple internal availability. Installed Photos acceptance passes for this scoped release. Keep ordinary-folder gaps and physical background results explicit; they remain in the parent goal rather than being rewritten as completed. The user goal is working iOS folder and Photos sync, including photo/video/folder uploads and robust resume; tests, upload receipts and Apple processing alone do not establish it.
