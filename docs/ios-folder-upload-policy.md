# iOS folder backup upload policy

Folder **Backup (keep deleted files)** can apply upload speed and rolling hourly
payload allowances at device, granted-folder and configuration scope. Controls
use decimal MB/s by default, optional Mbps (one byte is eight bits), and MB/GB
per hour. Blank configuration values inherit stricter device/folder policy;
unset ordinary-folder rates retain the legacy unlimited default. Photos keeps
its existing 625,000 bytes/s (5 Mbps) default.

Device/folder saves parse the complete current draft, so editing another field
or repeating a unit event preserves earlier unsaved values. A saved v5 iOS
Backup keeps its direction and upload-policy contract, including an empty
inherited policy; unsupported direction transitions are disabled. Automatic
policy recovery only considers runnable/scheduled admissions, so a second
config on the same device cannot reopen completed or attention work.

The independent native `fileUploadPolicyVersion` 1.1.0 capability supports only
uploads. It does not claim CPU, scanning, download, strict watcher or two-way
limits. Native upload 1.7 retains the old `upload-part` action: a fresh native
pairing status supplies the device identity, and device/folder budgets and pacing
apply. If saved device/folder caps exist, native reloads the selected origin once
before legacy byte dispatch, only after proving the document has no editing
controls or native sheet, so the current client can retain the exact hourly
wait protocol. Pagehide preserves its runnable journal and original reservation.
An editing document is preserved and reports the client compatibility dependency.
A still-stale server after that one refresh fails closed with an explicit client
deployment dependency; it never loops or ignores the caps. Unlimited legacy bytes have no configuration attribution and conservatively
count against a later configuration allowance. Current clients use the additive
`upload-part-authorized` action with the exact saved configuration. Native whole
file and deferred paths enforce the same policy and fresh saved authority.

Multipart retry is reconciled against the provider, rather than a local byte
cache or progress offset. The new clients require
`api.attachment-upload-parts` 1.3 and `api.file-sync-transfer-admissions` 1.7,
and opt in with `reconcileAcceptedParts: true`. Only an exact provider-confirmed
part number, length and canonical checksum may return `alreadyUploaded: true`.
Owner, pending reservation, expiry and admission authority are checked again
after provider awaits. Native whole/part/deferred and browser consumers validate
the echoed checksum before skipping the PUT, preserve final source/composite
verification, and report zero new payload bytes for the verified skip. Existing
consumed or uncertain hourly usage is never refunded. A fresh host can therefore
finish a file across several allowances smaller than the entire file.

Legacy requests retain full signed grants without the additional lookup; old
callers ignoring additive metadata never receive a zero-byte admission. Missing
or malformed provider proof fails closed for opted-in callers; transient lookup
failures retain the same original operation for retry. Pre-fix provider parts
without canonical checksums remain a documented recovery limitation. The real
provider role needs the existing `s3:ListMultipartUploadParts` permission; see
README's private attachment role and verification procedure. Local acceptance
does not prove that production permission.

Configuration policy is ordinary private File Sync Thing data:
`configurationVersion: 5`, `uploadPolicy: { uploadBytesPerSecond?,
uploadBytesPerHour? }`. Version 5 is limited to folder backup, no propagated
deletes, no unsupported generic resource or ignore settings. Photos v4 is
unchanged. Clients negotiate `api.things` 1.64.0, `api.things-update` 1.28.0 and
`api.file-sync-transfer-admissions` 1.6.0 on the exact selected origin. Older
native hosts refuse v5 before dispatch. Batch contracts remain closed to v5;
this change does not broaden their canonical authorization bytes.

The existing `NativePhotoTransferPolicy-v1` and `NativePhotoUploadBudget-v1`
files are retained. Photos and folder workers share owner/origin/device usage.
Device and folder caps aggregate concurrent configurations. Policy edits never
reset consumption; failed/partial sends count and uncertain reservations remain
charged across relaunch. One part must fit in each applicable hourly allowance.
Verified device/folder policy saves wake matching armed native work and durable
hourly-wait jobs through revision-guarded scheduling updates. Consumption,
receipts, unrelated conditions and explicit Pause remain intact. Speed edits
apply at the next part; already-started bytes can finish under their captured
limits.

A smaller allowance produces an actionable minimum-part wait, retaining the
original source, reservation and pending operation. Timed waits persist their
native deadline and resume through normal saved-job discovery; iOS still owns
background scheduling. Explicit Pause wins over discovery and policy edits.

An existing backup can replace only its upload policy while retaining the same
owner, device, local/remote folder, mode, deletion choice, network, power and
exclusions. Under the existing root lock, fresh authority and native disarming
precede parking old plan heads. The old plans, operation IDs and uncertain
receipts remain intact. A fresh plan checks saved copies; it does not replay
old publication IDs as new work. General settings/direction migration is outside
this change.

## Verification and remaining acceptance

- Focused TypeScript tests cover v1/v4 preservation, v5 saved/draft roundtrip,
  independent capability negotiation, exact hourly waits, old-host refusal and
  current-client authorized-part dispatch.
- Paged and legacy interrupted-publication regressions cover v1-to-v5 policy
  migration, reload, saved-copy preservation and no duplicate publications.
- Native tests cover exact scope refusal, historical Photos/ordinary defaults,
  scoped aggregate caps, policy edits, relaunch, uncertain and unattributed bytes.
- Browser runner: `node remix/scripts/test-folder-upload-limits-ui.mjs` checks
  desktop/phone controls, units, save/reload, unavailable host, absence of duplicate unsupported
  resource controls, full-page overflow and separately editable nested Builder blocks.
- Simulator app and test-bundle compilation are source validation. Actual native
  byte pacing/hourly resumption and installed-device acceptance remain separate
  parent-coordinated checks before release.

Continuation branch `codex/ios-folder-upload-limits`, worktree
`/Users/lopu/.codex-2/worktrees/ios-folder-upload-limits/thingtime`, starts at
`67dd46de2ec82f4a9b7ea6ab0b662222dab706b3`. Canonical main was fetched immediately
before creation and observed separately at
`1125ca1a95bdb8a1946a58b14a53c4c5981d408b`. Frozen Photos PR 1481, installed apps,
personal phone and unrelated fixture state were not changed.
