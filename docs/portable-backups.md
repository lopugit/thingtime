# Portable backup storage

This is the portable storage/verification foundation for the whole-backup scope
in [mobile-file-sync.md](mobile-file-sync.md#whole-backup-snapshots-and-timeline-recovery--requested-2026-10-17).
It can independently retain a supplied frozen inventory, resume interrupted byte
capture/copy and recover exact files without the original source. It does **not**
yet create an account-wide inventory, run scheduled cloud jobs or expose a backup
button. Those integrations remain required; a fixture is not a complete account
backup or a demonstrated 100 TB transfer. The internal account inventory producer
below establishes a database snapshot boundary, but refuses unsupported managed
families and is not exposed as a whole-account backup feature.

## Account inventory producer

`api/utils/backups/accountInventory.ts` freezes owner metadata through one
read-only MongoDB snapshot session. Census pages contain at most 128 IDs/kinds;
ordinary/file/attachment families use one projected payload query per page. Large
ordinary content streams one row at a time; Timeline and draft records use
eight-row batches to bound large payloads. Every query
uses the first server-selected cluster timestamp. Ordinary Things use the
canonical `thing-content` Timeline snapshot; files use `file-content` with their
exact retained content version and fingerprint. Root credentials, token grants,
link keys and authentication envelopes are not projected into the vault.
Dedicated Timeline exporters decode their private storage envelopes into the
existing canonical records before retaining them.

The census covers every owned row in the home Things collection. A managed kind
without an approved exporter, missing payload, expired database snapshot,
oversized metadata, changed account or revoked access refuses the plan. It never
skips an unsupported row and then reports complete coverage. Ready owned
attachments, saved themes, drafts/templates/tombstones and all seven Timeline families
have dedicated exporters. Account
identity and other managed families still need coverage; ordinary real accounts
therefore cannot yet complete this producer. Settings in
other collections and device-local data also need separate coverage contracts.

Successful enumeration seals the durable metadata plan before live file byte
capture. Canonical Timeline and draft payloads, plus ordinary Thing snapshots larger
than manifest metadata, are already frozen into verified chunks while the same
database snapshot session is open.
It uses a server `mongo:<seconds>:<increment>` boundary rather than a client clock.
Interrupted enumeration requires a **new snapshot ID**: it cannot restart with
live data under the old timestamp. After the plan is durable, independent file
byte copying may continue beyond the database history window. File availability
still requires retention/pinning; a metadata plan alone does not copy file bytes.

MongoDB 5+ snapshot reads and a sufficient snapshot history window are required.
An expired history window is an explicit failure, not permission to continue
from a newer timestamp. See [MongoDB snapshot read concern](https://www.mongodb.com/docs/v8.0/reference/read-concern-snapshot/).
The central modern index plan installs `{ ownerId: 1, shareId: 1 }` with simple
collation. The producer explicitly hints it. Legacy-compatible databases do not
install it until their existing migration retires legacy indexes; they refuse
the producer rather than exceed MongoDB's 64-index limit or scan all accounts.
The modern default plan uses 52 slots; the full legacy-compatible plan uses 64.
No worker endpoints, scheduling, quota admission, encryption or Timeline backup
lifecycle receipts are introduced by this internal producer.

### Canonical Timeline history in the vault

`timelineRecords.ts` exports events, relational links, branches, branch heads,
snapshot parts, notes and version names. It validates each existing envelope,
owner and deterministic Thing identity. V3 event records retain their separate
links; legacy aggregates retain their existing canonical shape. Cleared version
names retain a bounded revision tombstone. No second history database or new
Timeline content format is introduced.

History payloads may exceed the manifest's 128 KiB metadata limit. The internal
`retainBackupPayload` writer stores a bounded canonical record in the existing
8 MiB chunk/range format before enumeration can finish; the manifest holds its
adapter/version, kind, digest and canonical multipart fingerprint. Timeline
records are bounded at 4 MiB plus 16 KiB overhead. Lost writes, revocation or a
later unsupported family cannot publish a complete plan. Enumeration cannot
resume against newer database content under an old snapshot identity.

`openBackupTimelineRecord` reads and validates the sealed offline copy, including
its canonical payload digest and owner/Thing identity. Archived receipts are
historical data, not authority to replay server mutations. This is not yet an
account restore writer. Canonical `file-content` references now resolve against
ready attachment records at the same database timestamp, including before-images
and retained-conflict effects. Other adapters and their relationships still need
complete closure checks before whole-account recovery is offered.

### Attachment bytes and offline file-version recovery

`attachmentRecords.ts` exports ready owned attachments using the existing
canonical attachment crystal and `thing-content` metadata. Purpose, target,
folder, order and pending/NSFW presentation state remain descriptive. Stored
objects require an already-finalized immutable version and a verified canonical
multipart fingerprint from the configured private attachment store. Object keys,
provider VersionIds, upload IDs, tokens and signed URLs never enter the vault.
Linked media retains its external URL with no stored byte claim; no external
URL is fetched. Unsupported lifecycle states, expired unbound drafts, blocked
media and app/sandbox-managed objects refuse the inventory.

Each bounded census page checks current files and both sides of canonical file
history against owner-filtered attachment batches at the same Mongo timestamp.
Missing/foreign attachments, changed target/version/size or a mismatched
fingerprint refuse the entire plan. Eight concurrent HEAD requests and an
at-most-128-entry immutable cache bound storage load and avoid repeating recent
checks; there is no per-reference Mongo query.
The snapshot window must now also cover these storage HEADs.

An account file is metadata-only in the manifest; its separately inventoried
attachment owns the byte ranges. `resumeAccountBackup` uses the existing
expected-owner, home-plane and exact-version attachment endpoint to copy each
attachment once. It validates ETag, range framing and the full canonical
fingerprint before sealing. It never re-enumerates newer source metadata.
`openAccountBackupFile` and `openAccountBackupFileVersion` resolve current files
or a Timeline event's before/after image to verified offline attachment ranges.
A consumer must finish the iterator before publishing restored output. These
readers do not bypass live authorization or authorize replay of archived receipts.
The selected-folder worker/CLI keeps its existing inline file-byte format;
account-level restore/UI still needs a reviewed writer.

Validation: 57 backup tests and 18 attachment-core tests pass, including ready
attachment purposes, linked media, private-field exclusion, large Unicode
history, no repeated attachment download, interrupted capture, exact offline
version reads and missing/foreign/changed byte refusal. The real disposable
replica retains 351 records (47 Timeline records and 11,603,089 payload bytes)
at one timestamp despite concurrent edits, insertions and deletion of a referenced
attachment. Current, earlier and retained-conflict bytes read identically from
a second vault after deleting the source database, source files and first vault.
The owner/ID index still examines 128 keys versus 2,560 for a 128-row page.

The real authenticated foreground fixture also captures two authorized file
versions after live Trash through `resumeAccountBackup`, copies the sealed vault,
removes the first vault and compares both full byte hashes. Those explicitly
constructed descriptors test the API byte reader; they do not prove whole-account
inventory admission or permanent cloud object deletion. Source-file deletion is
verified separately in the disposable replica/filesystem proof. Neither fixture
establishes complete account restore or measured 100 GB–100 TB throughput.
Run instructions are in the root README.

### Drafts, templates and large ordinary Things

`draftRecords.ts` preserves the existing `AccountDraft` shape, including the exact
editor snapshot string, mode, revision, dates and source provenance. Discarded or
published drafts remain explicit deletion tombstones with no active editor state.
Saved write IDs describe the historical record; they grant no retry authority.
The archive wrapper is bounded to 4 MiB, allowing JSON escaping around the existing
512 KiB editor snapshot and up to 4,096 attachment IDs. Private root fields are
never included. Eight-row payload batches check media in owner-indexed batches
of 128 at the same Mongo timestamp. Each reference must match the exact draft,
post/comment purpose and a durable binding without profile slots or expiry.
Linked media retains only its URL; it does not become an independently saved file.

`thingSnapshots.ts` retains small ordinary `thing-content` snapshots inline and
larger ones as canonical payloads in the existing verified chunk store. It does
not create a second content schema. The retained record limit is 128 MiB; the
existing canonical Thing depth/node bounds still apply. Each ordinary payload is
processed before reading the next row, rather than collecting 128 large records.
The writer owns a copy of input bytes, writes at most 8 MiB per chunk and checks
access/readback between chunks. At most 16 ranges describe one retained record.
These records are bounded, not zero-copy: JSON validation/encoding and offline
reading can hold multiple record-sized buffers. Size the worker memory and Mongo
history window for this work. This is separate from streaming arbitrarily large
file bytes through the existing range transport.

`openBackupDraft` and `openBackupThingSnapshot` validate canonical payloads from
a sealed offline vault. Drafts additionally bind owner, ID, mode and revision;
tombstones remain tombstones. Neither reader imports live state or bypasses the
current API's ownership, revision, quota or restore rules.

Validation for this increment: 69 backup tests and 26 existing draft tests pass.
The disposable replica proof now preserves 357 records, including 47 Timeline
records, 22,064,370 total payload bytes and a 10,080,000-byte ordinary text value.
It interleaves draft deletion, media deletion and a large-content edit after the
census. After deleting the database, original files and first vault, the second
vault recovers exact drafts/templates/tombstones, media, file versions and large
ordinary content. Cancellation between retained chunks leaves no complete plan;
mutating the caller's Buffer cannot change already frozen content. These fixtures
still do not demonstrate remaining managed-family coverage, account restore,
permanent S3 loss, a full backup UI or 100 GB–100 TB throughput.

### Saved themes in account snapshots

`themeSnapshots.ts` uses the existing `theme-content` version 1 Timeline format.
It preserves partial tokens without filling current defaults, including explicit
false/zero/null values, display title, tags, visibility and folder. Dedicated
projection omits private root fields and unrelated crystal fields. The canonical
Timeline allowlist defines theme content; unknown tokens are not promoted to
backup content. Mixed protected kinds and invalid approved values refuse the
complete inventory. Visibility is historical data, not permission to restore
public sharing without a fresh reviewed write.

Small snapshots remain inline. Larger themes use the existing verified payload
chunks with a `backup-theme-content` digest descriptor; the original canonical
snapshot is recovered unchanged. Themes keep the canonical 256 KiB value bound
and are processed one row at a time in owner-indexed batches, at the same Mongo
snapshot as the rest of the inventory. `openBackupThemeSnapshot` validates the
sealed offline content, canonical fields and digest; it does not write live
themes or change the active selection.

Validation: 72 backup tests pass. The disposable storage consistency proof now
preserves 359 records and 22,217,760 payload bytes using 22 bounded queries.
Partial-theme edits and large-theme deletion after the census do not change the
archive; both original snapshots recover from the second vault after removing
the source database/files and first vault. This proves storage behavior on
synthetic data, not UI delivery or complete account coverage. Account identity,
other managed families/settings, relationship closure, retention/pinning, cloud
replication, reviewed account restore and jobs/UI remain unfinished.

## Format and invariants

`app/backups/manifest.ts` is the versioned `thingtime-backup-v1` contract.
The header names the snapshot, canonical Timeline scope and explicit coverage.
The producer supplies a complete immutable inventory boundary. It distinguishes
an actual point in time from a capture interval; the format cannot manufacture
or authenticate that boundary. Coverage must never silently omit inaccessible,
changing or offline sources. The existing cloud folder scan is bounded and does
not supply an account-wide boundary.

Items preserve a Thing identity/revision and its canonical `TimelineSnapshot`.
They are ordered by Thing ID with consecutive ordinals, so verification needs
no in-memory set of every file. Metadata-only items and empty files are distinct.
Metadata is limited to 128 KiB per item: larger metadata needs an explicit
chunked producer adapter, not truncation. Manifest pages contain at most 128
items and 4 MiB; the plan commits their hash chain, count and logical byte total.
Cumulative bytes/chunks use decimal strings and BigInt arithmetic. Per-item
sizes/offsets remain safe integers under the existing content fingerprint limits.

File bytes are independently copied into 8 MiB SHA-256-addressed chunks. Bounded
range pages contain consecutive offsets, lengths and chunk hashes. Capture
writes and reads back each new chunk before publishing its immutable range
receipt. The default page records eight chunks; an interrupted unfinished page
can reread at most 64 MiB. Lost accepted page replies resume without reopening
those captured source bytes. Incomplete capture never receives a completion
seal. Missing/corrupt retained data cannot be repaired by trusting its receipt.

Sealing reads all retained bytes, checks each chunk and reconstructs the exact
canonical multipart fingerprint, even when source part boundaries exceed one
memory chunk. The final manifest digest binds the plan and all ordered range
pages. The completion descriptor fits the existing `TimelineSnapshot` shape
(`backup-snapshot`, version 1); it introduces no parallel Timeline database.
The server lifecycle writer still needs to authorize and append it to Timeline.
A local descriptor alone is not a trusted server receipt or a cryptographic
signature proving who created a snapshot.

## Provider and worker boundaries

`app/api/utils/backups/portableBackup.ts` is a long-running native/worker engine,
not a serverless request handler. `BackupObjectStore` requires durable immutable
create-if-absent writes with exact replay comparison and bounded reads. Providers
own access, quota/admission, retention and physical independence. Product callers
supply scope-bound authorization and cancellation; source adapters must pin the
exact authorized byte version. There are no caller-supplied fetch URLs.

`localBackupStore.ts` implements private app-controlled filesystem storage with
exclusive atomic publication, file/directory sync, bounded descriptor reads and
strict generated keys. It rejects symlinks, non-private directories and a replaced
root. It is intended for an approved private directory owned by the current OS
user, not a shared adversarial directory. It does not provide encryption, a
cloud replica, media fulfillment, garbage collection or snapshot deletion. Shared
chunks must not be removed while any snapshot references them; no purge API is
exposed in this increment. Crashed `.pending-*` files may require later bounded
cleanup and are never treated as committed objects.

`copySealedBackup` validates the sealed source manifest and copies only missing
chunks. It verifies existing destination chunks before reusing them, never
re-downloads already copied source bytes solely to restart, and seals the
destination only after full readback. Metadata work is sequential and bounded in
memory; final verification reads the full destination. Capture and copy can
restart from durable pages/chunks, but a process interruption during verification
currently restarts verification. There is no whole-dataset array, giant browser
blob, ZIP size ceiling or single HTTP deadline in this engine.

`openBackupItem` verifies manifest membership and returns bounded verified ranges
for one item, checking its full fingerprint at iterator completion. Consumers
must stage bytes privately and publish only after that completion. Archived names
and placement are descriptive metadata, never filesystem paths or permissions.
The offline CLI uses an explicit destination and exclusive publication, preserving
existing files. Holding an OS-readable private vault supplies offline access;
this is distinct from an online authenticated product authorization check.

## Validation and remaining integration

`npm --prefix remix run test:backups` covers real filesystem interruption/reopen,
source deletion, independent copy and loss of the first vault, offline CLI restore,
empty files, immutable concurrency, corruption/missing pages/overlaps, wrong
scope, revoked access and cancellation. It validates 100 TB and 10 PB metadata
counters without allocating those byte totals. It does not prove that much data
was transferred or measured sustained throughput.

The opt-in `--portable-backup` extension to
`scripts/file-sync-foreground.integration.mts` uses a disposable real API file,
existing authenticated exact-version download ranges, lost accepted capture,
original-file Trash, independent export, removal of the first local vault and
byte-hash comparison. Its explicit capture-interval header covers that one file.
Cloud source bytes remain retained in private Trash; separate filesystem tests
actually remove the original file and first vault.

Still required for the requested product: server-authoritative complete account
and selected-device inventory; relational protected manifest/job Things and quota;
independently managed cloud copies; bounded worker leases, scheduling, retention
and verification checkpoints; server Timeline lifecycle integration; native
consent/UI and reviewed account-level restore; remote resumable export transport,
encryption/key recovery and physical-media preparation; source-object loss and
large-dataset throughput acceptance. No complete whole-backup release is claimed.

## Cloud folder capture

`api/utils/backups/cloudFolderBackup.ts` connects the engine to the existing
Files inventory and attachment-content APIs. `scripts/backup-cloud.mts` provides
explicit `create` and `resume` commands; [README setup](../README.md#capture-a-selected-cloud-folder)
uses a private caller-supplied full-session configuration, HTTPS/loopback only.
The session file is never stored inside snapshot metadata; no credential
inspection or discovery is performed. No additional server endpoint or secret
is needed. Scoped PATs/app tokens remain refused by the existing account gate.

Preparation compares the selected root's metadata revision with the complete
server inventory, then freezes file identities, revisions, exact byte versions
and empty-folder metadata into the existing immutable plan. `file-content`
snapshots are canonical; `backup-file-folder` describes only filesystem name and
placement, not the folder's ordinary Thing properties or a server Timeline event.
The header records a capture interval and explicit filesystem-only coverage.
Ordinary Things, historical versions, other folders and account settings are
excluded visibly. The existing inventory ceiling (10,000 nodes / 8 MiB) refuses
larger trees rather than producing a partial success. Whole-account enumeration
and a durable server-authoritative point-in-time boundary remain required.

Resume never re-enumerates live state or swaps in a new file revision. It reads
only missing 8 MiB chunks via authorized exact-version 2 MiB attachment ranges,
validates framing/ETag and verifies the complete fingerprint before sealing.
An edit or Trash does not invalidate still-authorized retained bytes. If retention
or access is unavailable, the backup remains incomplete. The session is checked
again immediately before publishing the completion marker, including when all
bytes were already captured. Interrupted metadata preparation cannot be safely
recreated from a changed live tree; start a new UUID if no complete plan exists.

Validation includes source/account changes, incomplete inventory, revoked final
publication, cancellation, empty folders and CLI create/resume against the real
local API. The 17,825,809-byte fixture freezes its tree, then first downloads its
retained bytes after live Trash, verifies an independent hash, and repeats a CLI
resume with zero new captured bytes. The earlier independent-copy/source-loss
checks still run. These are worker/storage checks, not native product or 100 TB
throughput acceptance. No scheduled backup, remote vault, account-wide snapshot,
server Timeline lifecycle or new native permission flow is claimed here.

## Reviewed tree restore

`treeRestorePlan.ts` consumes `openSealedBackup` from the shared portable engine,
validating the entire sealed metadata before target writes. The lazy entry/range
reader makes a constant number of manifest passes, avoiding one full metadata
scan for each restored file. `verifyBackupItemBytes` reuses the same streaming
canonical fingerprint verifier as backup sealing; source parts may exceed the
8 MiB memory chunk. The single-file restore API remains compatible.

Plans accept the current cloud filesystem adapters only, with a maximum of
10,001 items including the root and 32 MiB of retained item metadata. They reject
unsupported types, missing parents, cycles (including the root), unsafe names,
case/Unicode aliases and excessive depth. The external parent of a selected root
is descriptive; the restored root's contents go under the selected recovery
container's `files/`. The review hash binds all metadata, the sealed manifest and
the canonical chosen destination. This does not import arbitrary Thing metadata,
restore ownership/ACLs, grant filesystem access or append a server Timeline event.

`localTreeRestore.ts` exclusively creates the private recovery container and
keeps its identity in the existing durable immutable storage adapter. Resume
requires the same scope, seal, review, destination path and inode. It scans for
unexpected output before writing. Range data is written into private staging,
fsynced and read back before its durable receipt. Resume validates accepted
staged ranges locally and requests only missing chunks. After full-file
fingerprint verification, exclusive hard-link publication preserves any existing
output. The staging link supplies a recoverable identity without duplicating
file bytes. Completed files are locally verified on every resume; changed files
are preserved and refused, never silently reset to the backup.

Per-file publication is atomic; the whole tree is not one atomic directory swap.
Only after checking every expected file/folder and rechecking verified file
identities/timestamps does the worker write its overall completion marker.
Local process exclusion uses one unique candidate per invocation before scanning
for other live PIDs. Dead candidates are ignored rather than raced for deletion;
PID reuse blocks conservatively. It is restricted to a private single-host local
POSIX disk. It is not an adversarial-directory, network-filesystem or cross-host
lock. Candidate count is bounded at 1,024; accumulated crash candidates require
operator review rather than automatic deletion of somebody else's state.

`backup:vault plan-tree`, `restore-tree` and `resume-tree` expose this workflow;
see [commands and destination layout](../README.md#restore-a-saved-folder-tree).
Tests cover a real child-process exit after a synced range, dead-process recovery,
source-chunk removal after a durable checkpoint, zero source reads for completed
files, concurrent refusal, caller cancellation, output edits, disappeared empty
folders, corruption, symlinks, alias/cycle refusal and unchanged output on repeat.
Real API/CLI acceptance restores a 17,825,809-byte captured file and an empty
folder after live Trash, verifies the full output hash, then reuses the output.
These checks establish selected-tree worker recovery, not native restore UI,
whole-account snapshots, generic Things restoration or 100 TB throughput.
