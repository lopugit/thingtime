# PR 1481 — iOS sync recovery and scoped upload limits

PR: https://github.com/lopugit/thingtime/pull/1481

Status at source freeze, 12 November 2026: source and targeted validation are ready for exact-head CI. Installed final-bundle resume, mixed-media/folder and physical acceptance remain separate gates. Delivery receipts belong in the PR timeline; this note records the tested behavior and its limits.

## Problem and behavior

The native Photos worker prepares five reservations concurrently. The canonical cloud-path helper rejected a third active request with HTTP 503, cancelling sibling work before the batch could publish. Its two setup slots now apply fair FIFO backpressure with queued cancellation/deadline cleanup. This is a resource-management bound, not a user-data limit. Current source/grant/owner/destination and publication checks remain enforced.

Device, folder and saved-configuration cards expose MB/s and hourly upload controls. Saved-card controls sit directly after editable identity/mode/destination and before tall activity/transfer content. Supported native Photos hosts negotiate automation 1.6; active lanes share scope policy and hourly accounting. Background pacing is an admission schedule: iOS controls actual wire timing and may start late.

Saved-settings recovery rechecks current authority. A verified owner arriving after foreground activation now triggers the existing native worker kickoff; explicit Pause, future retry and another owner remain refused. Expected budget waits drain admitted siblings and complete a bounded Apple processing slice only after checkpoint save/readback, while the remaining queue stays visibly incomplete. Known short pacing/hourly deadlines are preserved, stale dates have a one-second floor and unknown/transient waits retain 300-second backoff.

Up to five foreground/background slots share admission. Authorized future daemon starts use earliestBeginDate only within signer validity; conservative leases retain accounting until settlement. Signed-expiry failures do not retain phantom calendar slots.

Public contracts are `api.files` 1.13.1 for path-setup backpressure and `api.file-sync-transfer-admissions` 1.5.1 for closed configuration/destination/transfer diagnostic codes. Clients must not call every permission, expiry or 409 response changed settings.

## Validation

- Final combined native 32/32 passed for daemon scheduling, policy scope, expiry and deadline/checkpoint behavior. A subsequent focused 19/19 passed after the late-identity kickoff change, covering active-before-identity startup once plus paused/future/other-owner refusal. These overlapping runs are not added together.
- Inventory backpressure 22/22 passed. Combined capability suites 160/160 passed. Full web TypeScript passed after the FIFO/API change. Focused web suites 210+20 and targeted lint passed, with existing warnings only.
- Desktop/mobile control placement and nested Builder editing checks passed.
- The built real API fixture passed five concurrent reservations with distinct upload IDs, then six paired-only refill/upload/publication cycles. It also covers byte integrity, guarded updates/refusals, pause/revision/revocation, credential expiry, logout and device disconnect.
- A real PhotoKit PNG of 9,448,788 bytes was downloaded through canonical content and matched the original SHA-256. This establishes one exact-byte result, not complete backup or physical background behavior.
- Final same-interrupted-run upgrade/resume, mixed photo/video and separate folder acceptance are being run independently. A no-login/no-cookie-injection owner probe verified current WebView origin, authenticated owner, paired device and native Photos grant, ruling out missing fixture authentication for the persisted uploading startup case.

## Source and evidence boundaries

NativeDeferredUpload.swift SHA-256: 53247bced3c4180ea49cc6fcd4aa3618d297d5ce19c60b301f1b48f67387b6c5. NativeBackgroundPhotoUpload.swift SHA-256: 9686ad018929e608266de36d00071b5674b546fd50530162052ba823f4c196a0. Incoming main b766776f6 includes unrelated authenticator app-shell changes; CI compiles the combined application. Simulator Photos logic evidence is tied to the recorded runtime hashes and does not establish that entire imported app shell was exercised in that fixture.

The fixture uses disposable account/data and local object storage. It is real PhotoKit/API evidence, not direct S3 daemon or physical iPhone acceptance. Simulator BGTaskScheduler refusal is recorded separately from transfer behavior. Existing uploaded TestFlight 62 contains older source; canonical release allocation must inspect Apple and choose the next build without duplicating that upload.

A bounded semantic refresh of the four large changed historical Markdown files was stopped after slow progress. Their existing semantic content is retained, but complete current reindexing is not claimed. Structural code/report/HTML output and this small evidence note are selected for the final scoped refresh.

## Delivery gates

Require exact-head protected CI, normal main merge, exact-origin production contracts, signed canonical TestFlight packaging/upload and verified Apple internal availability. Keep installed resume and physical background results explicit. The user goal is working iOS folder and Photos sync, including photo/video/folder uploads and robust resume; tests, upload receipts and Apple processing alone do not establish it.
