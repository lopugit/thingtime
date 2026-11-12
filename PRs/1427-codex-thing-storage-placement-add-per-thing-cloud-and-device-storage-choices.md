# PR 1427: per-Thing cloud and device storage choices

Branch: `codex/thing-storage-placement`. Base: `main`.
PR: https://github.com/lopugit/thingtime/pull/1427

## Behavior

The metadata panel and existing Thing context menus offer four editable storage
choices: sync with cloud, keep on this device, cloud only, and cloud plus this
device. Saving a choice reports intent separately from verified local status.
Existing Things inherit their current behavior until explicitly changed.

Private owner/device policies use the canonical Things API, shared unique keys
and independent source/policy/device revisions. `api.things-storage-policy`
1.0.0 exposes the policy and an authorized paged exact attachment manifest.
`api.things` 1.55.0 adds an optional storage-policy revision to generic PATCH:
policy, content and attachment publication are checked in one transaction.
Explicit cloud commands retain their own authorization and behavior.

Browser-managed copies use scoped IndexedDB snapshots and streamed chunks,
exact version/range/fingerprint checks, per-Thing locks and generation fences.
Local pending edits retain their original expected cloud revision and reconcile
before local removal. Foreground refresh visits only enrolled local copies.
Automatic FileSync checks placement before planning, transfer and publication,
including previously queued native uploads. Excluded work produces no receipt.

iOS `fileReplicaVersion` 1.0.0 supplies app-owned verified copies and system
sharing. Offline admission is bound to the live WebView session, paired device,
origin/account and exact file version; online refusals invalidate admission.
Cloud-only removal requires fresh committed cloud proof and verified local
bytes. Unuploaded recovery originals, Photos assets, picker files and Save As
exports are not removed implicitly. Protected or separately managed Thing kinds
and non-home data planes retain their existing workflows.

## LiDAR preparation correction

Build 54 exited during the physical retry before an upload ID or receipt was
saved. No matching termination report was available. An independently reproduced
memory-growth defect in the production preparation loop is fixed by draining
Foundation temporary buffers for each 64 KiB read, including part staging.

The regression fails against the old loop and passes against the correction.
The corrected production code inspected the entire retained 11.36 GB, 1,906-frame
partial archive and staged first/last upload parts with about 16 MiB additional
resident memory. Independent hashes matched the canonical multipart fingerprint.
A verified private backup and the original device source were preserved.

## Verified before publication

- Fourteen focused browser/client storage tests passed, including stale policy,
  identity changes, staged byte corruption, exact byte export and local edits.
- Disposable replica/API tests passed private policy and device ownership,
  concurrent pause versus PATCH, rejected attachment publication, explicit cloud
  writes, app-namespace ownership and automatic FileSync refusal.
- 182 integrated placement/FileSync/API tests, 35 adjacent iOS bridge tests and
  142 capability manifest tests passed. Raw Remix TypeScript passed.
- The final canonical web build passed, including Vercel shell/routing checks.
- Final desktop/mobile Chromium acceptance passed real API edits and reload,
  local pending flush before eviction, foreground refresh, exact 5,632-byte
  download/export hash, cancellation/retry, nested Builder edits and full-page
  scrolling without horizontal overflow. Export uses a test streaming sink in
  place of the operating-system picker.
- Seven native managed-copy tests, seven LiDAR core tests, three durable offline
  admission tests and the memory regression passed. iOS simulator app/test
  targets built successfully.

## Release acceptance

Physical upload, native Share and managed local removal must be checked against
the exact new TestFlight build after the normal main merge. Browser checks do
not establish cold-start offline availability of the entire native web shell.
Production Chrome control timed out before rendered owner verification; this is
a control limitation, not evidence that the production app failed.

The earlier metadata/recovery change is recorded in
[PR 1425](1425-codex-thing-metadata-sizes-show-thing-metadata-sizes-and-preserve-original-lidar-scans.md).
Current release checks and deployment evidence are retained on this PR.
