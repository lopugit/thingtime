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

## Independent S3 replica worker

`s3BackupStore.ts` implements the same immutable `BackupObjectStore` as the local
vault. `backup:replica upload|download VAULT SNAPSHOT_UUID` transfers a **sealed**
snapshot between an explicitly chosen local vault and an independently configured
S3 destination. It streams the existing 8 MiB chunks and bounded metadata pages;
it does not build a whole-backup Blob or ZIP. Retrying the same snapshot verifies
and reuses retained chunks. Completion follows a full destination readback, and
JSON-line progress distinguishes copying, verifying and completion. Decimal byte
counters preserve totals beyond JavaScript's integer precision.

The destination is bound to the configured endpoint, bucket, prefix and canonical
Timeline scope. Its namespace is `PREFIX/scopes/SHA256(timelineScopeKey(scope))/v1/`.
There is no automatic use of the primary attachment bucket, browser sessions,
AWS profiles, ambient credential chain, bucket provisioning, ACL changes or GC.
The app must supply current authorization, quota and credentials from its vault.
Namespace hashing is not authorization: the provider IAM policy must enforce the
chosen prefix. An independently retained snapshot is only as complete as its
manifest's stated coverage.

Providers must implement atomic `PutObject If-None-Match: *`, SHA-256 upload
checksums, AES256 server-side encryption and strong read-after-write consistency.
An existing key succeeds only after exact byte comparison; a conflicting object
is never overwritten. Conditional 409 retries are bounded; other provider errors
fail closed. Reads require a bounded Content-Length and reject truncation,
encoding, checksum mismatches and namespace escape. Requests stay on the selected
endpoint, have a 60-second bound, and observe cancellation and authorization
before/after effects and while consuming response bytes. AWS destinations require
the expected 12-digit bucket owner. Other providers may explicitly use null only
when they do not support that header. This is an S3 protocol adapter, **not a
claim that Backblaze B2 or another provider supports every required operation**.
See [AWS conditional writes](https://docs.aws.amazon.com/AmazonS3/latest/userguide/conditional-writes.html).

The operator/native-process CLI accepts one bounded JSON handoff on a private
stdin pipe (16 KiB maximum, 30-second handoff timeout). It refuses regular-file
stdin; no credential values belong in arguments, shell history or logs. The
handoff contains exactly `destination`, `scope` and `credentials`:

```json
{
  "destination": {
    "endpoint": "https://s3.REGION.amazonaws.com",
    "region": "REGION",
    "bucket": "independent-backup-bucket",
    "prefix": "approved-backups",
    "expectedBucketOwner": "123456789012"
  },
  "scope": {"apiOrigin": "https://your-thingtime.example", "ownerId": "OWNER_ID", "dataPlane": "home"},
  "credentials": {"accessKeyId": "FROM_VAULT", "secretAccessKey": "FROM_VAULT"}
}
```

These are placeholders, not a credential file to create. A scoped temporary
credential also supplies `sessionToken` and ISO `expiration`; expired credentials
stop the worker, and fresh credentials can resume the same snapshot. Provider
errors and parser input are not echoed. The SDK receives detached credential
objects because it annotates them internally; vault-owned objects remain intact.
The shipped CLI is a worker handoff interface; a user-facing vault selector,
native background job and restore controls are still required.

The existing bucket must be private, independently retained, encrypted, and
configured without expiry/deletion that could orphan shared chunks. Give the
worker only scoped GetObject/PutObject and prefix-restricted ListBucket (needed
for distinguishing missing objects); enforce conditional writes in bucket policy
where supported. Download-only workers need no PutObject permission. Provisioning,
live IAM/revocation acceptance, retention/pinning, client-side encryption and key
recovery, scheduling, full account coverage and measured 100 GB–100 TB transfer
remain open. No external provider was modified for this implementation.

`s3BackupStore.test.ts` exercises the real AWS SDK over a disposable loopback HTTP
protocol fixture with synthetic credentials. It kills the actual CLI after an
accepted 8 MiB chunk, resumes without reuploading it, removes the original vault,
downloads and verifies the replica, and retries the download with zero new copied
bytes. It also checks immutable races, credential mutation, revocation, wrong
scope, expiry, redirects, unsafe destinations and corrupt/oversized/truncated
responses. `--local-http-fixture` permits literal loopback HTTP only for that
explicit test; normal use requires HTTPS. This is not live cloud durability,
installed-app acceptance, a full-account backup or a 100 TB benchmark.

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
existing canonical records before retaining them. The dedicated account adapter
decodes only approved profile content and preferences from the user envelope.

The census covers every owned row in the home Things collection. A managed kind
without an approved exporter, missing payload, expired database snapshot,
oversized metadata, changed account or revoked access refuses the plan. It never
skips an unsupported row and then reports complete coverage. Ready owned
attachments, saved themes, drafts/templates/tombstones and all seven Timeline families
have dedicated exporters, along with stored notification history and approved account profile content and private
preferences. Subscription authority is recorded as an explicit source exclusion. Credentials/security state and other managed families still need
coverage; ordinary real accounts cannot yet rely on this producer for a complete
account backup. Settings in
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

### Stored references and historical notifications — 2026-11-06

The owner census now validates ordinary stored composition, explicit render
Component, schema, Action, media and active theme/algorithm references against
its own pinned source rows. It does not fetch current revisions or another
owner's content. Reference discovery never supplies an ACL, grant, destination
identity or permission to execute an archived Action.

Private SQLite scratch retains records, aliases and deduplicated persisted
component contexts. Generator frames traverse stored trees without the
renderer count/depth or 512-instance policies; cancellation and authorization
checks occur during traversal. RAM includes one materialized source record,
its parser tree/scopes and bounded metadata pages, rather than the account graph.
Scratch uses available disk and is removed on normal exits. A transformed
recursive component context is explicitly unsupported; identical contexts and
ordinary Action cycles terminate. Runtime-selected outputs, render/media merge
formats, formatted media and repeated scalar media interpolation remain explicit
unsupported discovery, never silently certified prefixes. Public/system/foreign
dependency capture remains a required separate authorized path.

Valid dangling or external pointers do **not** prevent preservation of the
owner's data. The producer appends `backup-reference-coverage` v1 evidence pages
with at most 128 issues each and an encoded-byte flush below the manifest item budget. A single oversized diagnostic is represented by UTF-8 byte count and SHA-256, explicitly labelled as diagnostic metadata; the full saved reference stays in its original retained source record. Discovery completeness applies specifically to
`ordinary-composition-and-account-selections`; resolution, unsupported traversal
and excluded authority are separate measured fields. `wholeAccountReady` is
always false. Duplicate owner aliases are unresolved ambiguity: real Action
execution orders equal-version aliases by `createdAt`, whereas shared composition
uses `updatedAt` and `shareId`. The backup does not invent a winner. Required
functional restore must refuse unresolved or unsupported closure even though
those source records remain recoverable.

Evidence IDs use the archive-only `~.backup-coverage:<snapshot UUID>:<16-digit
page>` namespace. Canonical generic Thing creation rejects its dot. The portable
reader binds the UUID and contiguous page sequence to the enclosing header;
other adapters cannot use the reserved namespace. Evidence is included in the
sealed manifest and receives no new user-Thing destination on restore review.
This is an additive archive adapter with an explicit compatibility boundary:
older readers may reject new snapshots containing the namespace/adapter. Old
snapshots and their existing adapters remain readable by the updated reader.

`notification-content` v1 retains only approved stored message/actor fields,
subject links and historical time/read/history-only state. The generic streamed
payload primitive stores it as `backup-notification-content` v1 without a new
message-size cap. It never loads a newer actor profile, captures delivery keys,
provider diagnostics, secret envelopes or live dedupe authority, nor re-emits a
notification. Live subscription entitlement records are instead represented by
`backup-source-exclusion` v1 (`live-entitlement-authority`); their private payloads
are not read or restored. Other managed families still need approved exporters
or explicit reviewed exclusion contracts and otherwise refuse census admission.

`npm --prefix remix run test:backups:references` uses a disposable replica, real
signup and canonical API handlers/utils. It completes the actual legacy-index
migration/cache-drain path, captures five ordinary records and two notifications
including large detail, updates a component after the server snapshot, compares
independent API readbacks, deletes ordinary sources and the first vault, and
recovers from the independent copy. A permitted foreign pointer survives with
unresolved evidence while its private target remains unreadable. The fixture
also compares the two real alias entry points. This proves the internal capture
worker and offline readers; native UI, public backup admission, complete
credential/settings/device coverage and full-account restore remain open.

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

`thingSnapshots.ts` retains legacy-valid small `thing-content@1` snapshots inline.
Other ordinary content uses `backup-thing-content@2`, with descriptor
`{codec:"canonical-json-utf8-v1",sha256}` and the same approved canonical content
projection. Version 1 bytes, IDs and its bounded reader remain unchanged; unknown
adapter/codec versions refuse. Version 2 removes the backup-only 100,000-node,
94-level JSON and 128 MiB serialized-payload ceilings. It does not widen source
storage or destination-writer contracts or declare complete account coverage.

The general inert JSON encoder walks iteratively, escapes strings in bounded
fragments and emits at most 64 KiB at a time. Sorted object keys follow the legacy
JSON integer-property ordering. Accessors, hidden properties, non-JSON values
and live cycles refuse. Existing local flatted persistence is a different graph
format: its saved strings/tags remain exact inert content, without guessing Dates
or evaluating function tags. Native Date/cyclic objects are not valid server
ordinary-content values and are not silently converted.

Capture measures a pinned Thing's exact canonical size/SHA, then streams it into
8 MiB immutable chunks and eight-range pages with readback. There is no aggregate
record buffer or range-count ceiling; the existing safe-integer size/multipart
protocol remains authoritative. The second pass must match the measured size
and hash. Interrupted writes never produce an inventory item/plan seal, and
identical pinned replay safely reuses immutable objects after lost acknowledgement.
Interrupted account enumeration still requires a new database boundary/ID.

Offline v2 reads reuse the installed `@streamparser/json` parser, check multipart
and whole-payload hashes, then stream canonical re-encoding before returning one
materialized Thing. No whole-record bytes/text are collected. The source/result
Thing, largest scalar and property enumeration/sorting still need their actual
runtime memory. Strict hidden/extra-property validation reflects a full own-key
list even for arrays, so temporary reflection memory scales with container width; this is bounded per record, not a guarantee of constant RAM for
an arbitrarily large individual Thing. Backpressure keeps encoded buffers, range
pages and whole-backup traversal bounded. MongoDB's BSON limits, available memory,
disk capacity and snapshot-history window remain concrete runtime constraints.

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
synthetic data, not UI delivery or complete account coverage. Account security,
other managed families/settings, relationship closure, retention/pinning, cloud
replication, reviewed account restore and jobs/UI remain unfinished.

### Account profile content and private preferences

`timeline/accountContent.ts` defines the shared `account-content` v1 snapshot
shape. `accountSnapshots.ts` is its owner-only storage adapter. It preserves
profile identity labels, display name, biography, linked avatar/banner URLs,
managed image references, birthday, email visibility, read-receipt preference,
active theme/algorithm references, stored notification switches, personal Lopu
instructions and recent reactions. Missing preferences stay absent; false,
null, disabled instructions and reaction order/duplicates stay exact. External
URLs remain links and are never fetched or claimed as independently saved bytes.

A user must own its exact identity. Only this family reads its private BinData;
malformed JSON/UTF-8, plaintext, invalid approved values or excessive bounds
refuse the whole plan with value-free diagnostics. Password hashes, email,
vault keys, endpoint credentials, security flags, permissions, subscription
allowances and unknown private fields never enter this content format. These
exclusions are stated in the inventory coverage; this is not a total account
security backup. Normalized public-user responses are deliberately not used:
they add defaults and runtime quota/authority that are not historical content.

The snapshot value is bounded to 1 MiB and retained in verified chunks while the
same Mongo snapshot is open. Managed profile images must be owned, ready,
durably bound to this user and the exact avatar/banner slot, with the profile
purpose. Missing, foreign, expired, rebinding or wrong-slot media refuses the
plan. Their bytes are captured once through the existing attachment path.
`openBackupAccountSnapshot` recovers only a sealed, digest-verified snapshot for
the same owner/origin. It does not sign in, alter active selections, grant access
or write live profile/settings values; those require current authorized writers.

Validation: 76 backup tests pass. The new unit coverage includes source mutation,
independent-vault copy/source removal, exact preference preservation, media bytes
and relationship refusal, corrupt binary/private data, foreign scope and chunk
damage. These tests use the production secure-envelope builder with an injected
snapshot cursor; they do not establish real signup/profile API integration or
live account restoration. Those acceptance gates, credential recovery and
remaining managed families stay open.

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
excluded visibly. Creation requires Files 1.5.0 and streams its bounded NDJSON
pages. `cloudBackupTree.ts` uses Node 24's built-in SQLite in a private disposable
workspace to reject duplicate IDs, case/Unicode path aliases and mismatched
physical parents, then enumerate canonical Thing-ID order. It retains no
whole-tree array. No durable header is written until the exact generation,
terminal count and EOF pass. Truncation, trailing errors, changed identity or
scratch exhaustion refuse the capture; scratch files are removed on every exit.
The default SQLite index budget is 512 MiB (the internal `maxScratchBytes`
option accepts 64 KiB–8 GiB); this is a preparation bound, not a retention or
content-byte quota. SQLite cache is 2 MiB, with memory mapping disabled. The
server's snapshot lifetime/frontier bounds still apply. Whole-account enumeration
and a durable server-authoritative point-in-time boundary remain required.
Existing saved plans retain their format and can resume using Files 1.2.0; no
fallback silently reduces a new capture to the old 10,000-node inventory.

Resume never re-enumerates live state or swaps in a new file revision. It reads
only missing 8 MiB chunks via authorized exact-version 2 MiB attachment ranges,
validates framing/ETag and verifies the complete fingerprint before sealing.
An edit or Trash does not invalidate still-authorized retained bytes. If retention
or access is unavailable, the backup remains incomplete. The session is checked
again immediately before publishing the completion marker, including when all
bytes were already captured. Interrupted metadata preparation cannot be safely
recreated from a changed live tree; start a new UUID if no complete plan exists.

The paged regression captures 10,051 generated nodes plus the root, verifies the
sealed Thing-ID order, and recovers the original nonempty file bytes after its
synthetic live inventory disappears. The disposable Mongo fixture additionally
uses real signup, Things writers and Files/auth Request handlers to capture 135
folders across two pages and preserve their pre-edit metadata in a 136-item
sealed vault. These are distinct from HTTP and large-volume cloud acceptance.

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

The planner accepts the current cloud filesystem adapters and uses the same
private Node 24 SQLite workspace as cloud capture. It streams sealed items into
indexed storage, resolves physical ancestry in bounded batches, then exposes
ordinal and path lookups plus parent-first folder iteration. The previous
10,001-item/32-MiB whole-tree memory limit is removed. The default preparation
index is capped at 512 MiB on disk, with a 2 MiB SQLite cache and memory mapping
disabled; internal callers can choose a bounded `BackupWorkspaceOptions.maxBytes`
up to 8 GiB. This is a metadata workspace budget, not a restored-content quota.
Plans reject unsupported types, missing/non-folder parents, disconnected and
root cycles, unsafe names, case/Unicode aliases and excessive depth. The external parent of a selected root
is descriptive; the restored root's contents go under the selected recovery
container's `files/`. The review hash binds all metadata, the sealed manifest and
the canonical chosen destination. The v1 review digest and recovery receipts
remain unchanged, including for snapshots reviewed before this disk index. This
does not import arbitrary Thing metadata,
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
These final verification identities also live in the disposable index; output
inspection counts entries and performs indexed lookups rather than retaining a
whole-tree Map/Set. Every normal success/error closes and removes scratch state.
A killed process can leave private scratch files behind; they are never reused
as authority or recovery state, and durable receipts stay in the destination.
Local process exclusion uses one unique candidate per invocation before scanning
for other live PIDs. Dead candidates are ignored rather than raced for deletion;
PID reuse blocks conservatively. It is restricted to a private single-host local
POSIX disk. It is not an adversarial-directory, network-filesystem or cross-host
lock. Candidate count is bounded at 1,024; accumulated crash candidates require
operator review rather than automatic deletion of somebody else's state.

`backup:vault plan-tree`, `restore-tree` and `resume-tree` expose this workflow;
see [commands and destination layout](../README.md#restore-a-saved-folder-tree).
The review command streams its existing JSON entries array with stdout
backpressure; it does not assemble the entire output in memory.
Tests cover a real child-process exit after a synced range, dead-process recovery,
source-chunk removal after a durable checkpoint, zero source reads for completed
files, concurrent refusal, caller cancellation, output edits, disappeared empty
folders, corruption, symlinks, alias/cycle refusal and unchanged output on repeat.
Real API/CLI acceptance restores a 17,825,809-byte captured file and an empty
folder after live Trash, verifies the full output hash, then reuses the output.
Scale regressions restore 10,051 folders plus a nonempty file, resume without
source reads, check the legacy review digest, and run the actual CLI against
32,002 items exceeding 32 MiB of item metadata under a 64 MiB V8 heap limit.
That heap limit is not a claim about total process RSS. Scratch exhaustion,
cancellation and use after close refuse safely; ordinary exits remove scratch.
These checks establish selected-tree worker recovery, not native restore UI,
whole-account snapshots, generic Things restoration or 100 TB throughput.

### Real account handler and snapshot integration

`test:backups:account-profile` owns a disposable replica and uses unmodified
signup, profile, notification, chat-settings and Lopu-instruction Request
handlers. Cookies, live sessions, secure envelopes and database transactions are
real. The macOS OS network policy confines the database and worker to one private
loopback port; an enforced-denial preflight covers hostnames, direct IPs and
redirects before starting the fixture. It never seeds account documents directly.
`readBackupAccountContent`,
shared with the inventory producer, returns only the canonical approved content
and checks current authorization around its bounded, exact-owner query.
The single account lookup uses the existing unique share-ID index; the full
owner census retains its mandatory modern owner/ID index and never falls back to
a scan. Thus a fresh legacy-compatible database can validate one account's
content without pretending whole-account enumeration is ready.

The test compares independent API readbacks with the retained values,
interleaves real profile and private preference changes under one server snapshot,
then seals and copies the record, removes the first vault and recovers it exactly.
An explicit fixture restore uses current profile/settings writers and a fresh
Lopu revision; archived identities/revisions supply no authority. Logout refuses
new live reads while exact-owner offline recovery still works. The fresh database
also refuses complete inventory without the required index migration.

This proof covers production Request handlers and MongoDB, not the Nitro HTTP
adapter, browser UI, managed image restoration, complete account restore or new
backup endpoints. The older `account-snapshot.integration.mts` storage/index
experiment uses synthetic direct-database records and is not real signup evidence.
See the root README for dependencies and isolation details.

## Source version retention — 2026-10-19

The authenticated cloud-folder/account capture worker now negotiates
`api.attachment-content` 1.15.0 and acquires bounded owner-only holds for every
frozen-plan item still needing source bytes before capture. Batches contain at
most 64 exact attachment/version pairs. The worker streams the existing plan,
keeps bounded memory, renews at half the earliest lease duration and refuses
completion after expiry or failed acquisition. Complete range receipts avoid
contacting removed sources on retry; the final seal still verifies every retained
chunk and the original whole-file multipart fingerprint.

Holds last 24 hours and only extend a protected aggregate attachment deadline.
They do not create a separate history format, duplicate object-byte charge or an
unbounded list of jobs. Finishing one job cannot release another job's hold.
Deletion becomes pending, keeps the bytes billed and permits only the owning
account's explicit exact-version retained range reads. Ordinary/public/shared
reads remain unavailable after deletion. Cleanup transactionally closes renewal
before deleting the exact object version and refunding once. Retained range
responses also recheck the live session after the storage read.

This is bounded source retention, not a finished retention-policy product.
Metadata enumeration itself does not pin bytes: acquisition may refuse if a
source disappeared before capture began. An interrupted worker must resume before
its hold expires to guarantee continued availability; after expiry it can resume
only if required source bytes still exist. Early per-job release, configurable
policies, independently verified full-account coverage, backup chunk pruning,
native job/vault UI and 100 TB acceptance remain open. Existing backup stores have
no deletion/GC operation, so this change does not prune shared chunks.

Deployment requires all attachment deletion/reaper writers sharing the database
to run the retention-aware code, and provider lifecycle policies must preserve
held versions. Older deployments or external bucket administrators do not honor
these application holds. A capability response alone does not prove that fleet or
provider rollout. No production mutation or rollout is performed by this branch.

Run `npm --prefix remix run test:attachments:retention` for the disposable replica
proof: actual signup/content Request handlers and production attachment/accounting
utilities, real Mongo transactions, atomic refusal, concurrent renewal, deferred
billing and exactly-once cleanup. Its object transport and expiry clock are
synthetic; OS network isolation denies other destinations before the fixture
starts. It requires local `mongod`, `mongosh` and macOS `sandbox-exec` and refuses a
permissive fallback. `test:backups`, `test:attachments` and
`test:api-capabilities` cover worker recovery, authorization and negotiation.


### Retention validation checkpoint — 2026-10-19

The desktop cookie proxy now admits the retention POST on the existing content
route only under its unchanged local-origin, expected-server, actor and home-plane
checks. Regression tests refuse changed/missing identities and cross-site writes
before consuming their body. This does not install or activate a native backup UI.

Validation: 95 backup, 292 attachment, 96 capability and 9 proxy tests pass.
The isolated Mongo replica proof exercises authenticated production handlers,
atomic batch refusal, concurrent renewal, deletion deferral, expiry fencing and
exact-once storage refunds. Object transport and expiry time are synthetic; the
OS boundary denies non-test destinations. The built Nitro server advertises
content 1.15.0 and delete/abort/cleanup 1.2.0, rejects unauthenticated retention
with 401, and rejects an unscoped retained read with 400. Targeted lint passes;
the full TypeScript check retains 91 existing diagnostics with none in the
changed retention/backup/route files. Live provider, installed app, full-account
coverage and large-scale acceptance remain open.


## Account restore admission and durable review plans

`api/utils/backups/accountRestorePlan.ts` is a local/native worker planning
boundary. It reads a sealed independent vault without contacting the original
account or source files. It does not call destination writers, expose a mutation
endpoint, sign in, replace an account, replay historical receipts or restore
permissions. Actual writer coordination and full-account delivery remain open.

`prepareAccountRestorePlan` requires an explicit UUID v4 plan ID, source snapshot,
source authorization and destination owner/origin/root/revision/capability values.
The same ID resumes immutable accepted pages; a new ID allocates distinct content
identities. Those identities are allocation intentions, never permission to write
or overwrite anything. Changing source seal, destination or contracts requires a
new plan and review. Destination capability values are bound into review; they
must be negotiated and authorization rechecked by a future writer coordinator.

The planner validates each retained byte stream once and decodes the existing
canonical ordinary, file, attachment, theme, draft, account and Timeline formats.
Account files require metadata-only descriptors and exact owned attachment
fingerprint/size/version closure. The shared stored-composition discoverer and
remapper identify executable references and aliases. Executable cycles are valid;
folder containment cycles, missing/foreign references, ambiguous aliases and
unsupported adapters/versions become explicit review issues. Malformed known
payloads, corrupt bytes and contradictory file closure refuse plan sealing.
Context-dependent composition, template media, draft and historical relationship
closure remain explicitly incomplete rather than being silently assumed complete.

A private SQLite index supplies bounded pagination and is discarded on close.
Account planning uses available-disk mode with a 2 MiB SQLite cache, disabled
memory mapping and disk temporary storage; it imposes no application total-graph
size ceiling. A caller can explicitly request a disk resource budget. Actual
filesystem capacity and SQLite format limits still apply. Existing selected-tree
and cloud-capture consumers retain their current workspace policies.
It is not durable task state or a server/Vercel database. Immutable
`restore-plans/<planId>/header.json`, `pages/<ordinal>.json` and `sealed.json`
objects use the existing provider key grammar and compare-on-replay storage.
The plan seal binds the exact source descriptor, destination, contracts, ordered
review records, discovered family counts and issues. It means **plan sealed**,
not restoration complete. No source snapshot or backup format is changed.

`openAccountRestorePlan` checks the exact review hash, source seal hash and
normalized destination. Before exposing its bounded record iterator, it verifies
all pages and pins their hashes in fresh private scratch storage; each page is
checked against its pin before yielding records. Callers must close the returned
plan in `finally`, including for never-consumed handles. Iterator completion,
early break and errors also close scratch automatically; explicit close is
idempotent. Scratch loss requires
reopening and revalidating the immutable pages, never trusting scratch receipts.

The versioned `AccountRestoreCoverage` contract separates `planIntegrity`,
`sourceCoverage`, `writerReadiness` and `wholeAccountReady`. Existing portable v1
headers describe coverage in prose, so their source coverage remains `unknown`.
Missing managed/security/settings/device families cannot be inferred absent from
an inventory that lacks them. No canonical writer coordinator is shipped here;
writer readiness is `unavailable` and whole-account readiness is always false.
Reference discovery is explicitly `partial`, including schema-specific and
managed relationships beyond the current discoverers. All plans include
machine-readable unverified-coverage, incomplete-reference-discovery and
writers-unavailable issues. There is deliberately no positive whole-account-ready fixture.

`test:backups` exercises an actual independent sealed mixed graph after removing
live source records and the first vault, large retained ordinary content,
executable and structural cycles, foreign dependencies, unsupported versions,
accepted-page interruption/reopen, destination/review changes, corrupt retained
bytes and page mutation between validation and iteration. Separate file fixtures
cover exact independent attachment bytes and contradictory closure refusal.
These are worker/storage tests, not installed restore UI, full account restore,
live S3 durability, complete history import or measured 100 GB–100 TB acceptance.


When a source contains ordinary-record v1 entries, coverage records their legacy
serializer envelope as `sourceFormatLimitations`: 100,000 JSON nodes and 128 MiB
of retained JSON payload. Sources containing only v2 ordinary records do not
advertise those v1 limitations. These are legacy processing budgets, not a
product data-size contract. The streaming codec retains v1 reader compatibility
and removes these backup-only limits for new v2 entries. Managed-family coverage,
reference discovery and destination writers remain independently gated;
`wholeAccountReady` stays false. Tests cover a scalar beyond 128 MiB, more than
100,000 nodes, deep content, fixed legacy bytes, independent source loss and
immutable retry. A fresh-worker regression separately measures reflection/heap/RSS for 500,000
array elements under a 128 MiB JS heap; bounded chunk writes alone are not total
RAM evidence. These are not 100 GB/100 TB physical-transfer measurements.


Interrupted preparation revalidates the sealed source inventory and bytes before
resealing the same review. Accepted review pages are reused immutably, but this
phase does not checkpoint a long full-byte validation pass; durable verification
checkpoints remain a separate large-volume acceptance requirement.


## Selected ordinary graph execution primitives — 2026-11-06

`api/utils/backups/ordinaryRestoreTransaction.ts` provides internal atomic and
resumable creation primitives for an **explicitly selected, closed ordinary
content graph** within the explicit `ordinary-composition-v1` reference domain.
Its separate `thingtime-selected-ordinary-restore-v1` review is
not a whole-account restore plan. Existing account plans remain non-executable,
writer readiness remains unavailable for whole-account restoration, and
`wholeAccountReady` remains false. No public restore endpoint, MCP or installed
restore workflow is added.

Reviews bind the new operation identity, independent source seal, exact selected
command hashes/count, destination owner/origin/root/revision and compatible
semantic contracts. The runtime rechecks its canonical capability registry and
current authenticated principal. The initial lane supports the principal's own
full browser/service session on the home data plane; Character delegation,
scoped credentials and other planes require their own compatible contract.
Fresh session writes inside each content transaction fence revocation, using
actual write conflicts rather than snapshot-only reads, consistent with
[MongoDB transaction guidance](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/). Secrets
never enter reviews, receipts or checkpoints.

Available-disk scratch indexing verifies every fresh allocation, record pin,
explicit parent and folder-before-child order before destination content writes.
Top-level records must name the selected destination; nested parents must be
reviewed allocated folders. Null/missing parents and other owned folders refuse.
The reusable strict stored-reference index checks all persisted contexts,
including optional pointers. Functional commands require exact remapped IDs, so
an existing destination alias can never shadow the reviewed program. Direct
Data `parentId` relationships must also point inside the selected graph. It
refuses unresolved/ambiguous/dynamic references
or unsupported traversal. This first writer lane supplies no attachment
identities, so media dependencies and managed families refuse before content
mutation. Browser HTTP-request bodies/query values and schema-specific/custom
relationships have no complete remapping contract in this lane; HTTP-request
programs explicitly refuse, while pure browser compute/return is supported. Executable cycles use preallocated independent IDs; schemas precede
their data and components precede pages that capture them.

The resumable primitive first accepts a protected, accounted Timeline admission
containing the small immutable review, recoverable through the owner Timeline
API. It then accepts the entire immutable command-intent chain
as accounted protected Timeline effects. A server-only scalar checkpoint on the
selected folder tracks phase, chain, planned/applied counts and a content epoch.
It contains no growing list or archived authority. Each canonical Thing write,
new immutable revision, effect receipt and counter increment commits together.
Restart revalidates the review/source records, reads accepted intents/effects,
and never repeats an accepted write or replaces later owner edits. Every retry
still checks current account/session and destination ownership; pending work and
completion require the original root revision. No receipt uses server-local
SQLite. An exact completed replay returns its recorded outcome before reading
source records or opening scratch; it still requires current owner authorization
and never rewrites later destination edits. The atomic alternative rolls back the complete selected graph when its
single Mongo transaction cannot commit; large graphs use the per-record path.

Newly created content carries a protected execution hold, excluded from ordinary
snapshots and generic write input. Server/browser Action admission checks the
new operation's exact completion effect through direct IDs, keys, shared roots
and child invocation. Renderers also suppress source loading, local/pseudo
controls, native/upload mounts and stale async callbacks while held. Content and
ordinary editing remain available. Completion streams current owned content
through containment/closure validation, preserving valid user edits. Canonical
ordinary mutation recording advances the old/new held root epochs on edits,
moves, deletion or ownership changes; the final bounded transaction requires an
unchanged epoch, complete effect set, current authorization and destination CAS.
Historical imported receipts can never satisfy a new operation's hold.

`api.things` 1.52.0 projects derived `executionHeld` and owner-only
`creationProgress:{phase,planned,applied,count}`. Component browse 1.1.0 and
Webpage resolve 1.13.0 preserve the hold; Actions run 1.43.0 enforces admission.
The checkpoint's phase is durable progress, not a process-liveness assertion.
Activating restore on a shared database requires compatible execution admission
and hold-aware clients on every active host; one origin manifest does not prove
that fleet rollout.
Folder status badges, job supervision and the restore product workflow are not
implemented by this phase. Source/managed/account/settings/security/device
coverage, file bytes/adapters, general credential modes, installed acceptance,
provider durability and measured 100 GB–100 TB restoration remain required.

Run `test:backups:ordinary-restore` for an isolated real-replica proof using real
signup/Action Request handlers and canonical Things writers. It captures eight
synthetic records, copies the sealed vault, removes source content and the first
vault, revokes the original session, and continues through the pinned private
local-vault access boundary without source-account access. It checks independent readback, hierarchy/schema provenance, Action
cycles, intent interruption, actual child-process death after a committed effect,
resume, later edits, completion races, held browser/server/shared admission and
unsupported-scope refusal. This is not Nitro HTTP or production/provider proof. An existing same-key
destination Action, unsupported HTTP-payload references and outside local
relationships must refuse before any restored content write.
`test:content-execution:browser` separately checks synthetic API projections at
desktop/mobile sizes, hold/release, nested native/local controls and delayed
callbacks. Browser fixture evidence is distinct from the real-replica proof.
The full generic Thing route's selected-origin refresh/cache behavior remains
an installed/real-app acceptance gate; the focused synthetic browser fixture
does not establish that complete route journey.

### Reviewed account-file publication — 6 November 2026

`accountFileRestore.ts` is a trusted worker primitive for a selected, complete
file-history graph. It reuses folders already created by ordinary graph restore;
it does not introduce a second folder writer, public restore endpoint or MCP.
The reviewed map binds each source folder to its exact current destination
revision and protected original creation/completion provenance. Names, parent
relationships and original folder content remain in the ordinary restored
Things. Missing historical parent folders require recovery before this phase;
an incomplete map or history graph refuses rather than inventing a path.

One immutable command hash binds the source seal, fresh file identities,
destination account/origin/root/revision, capabilities and full selected history.
The private `openIndexedSealedBackup` SQLite index verifies metadata once, pins
exact descriptors/ranges, and reauthorizes lookups and chunk reads. Normalized
Timeline events are reconstructed from verified archived links; missing parents,
foreign-file parents, unsupported snapshots and omitted archived versions or
branch heads refuse. File snapshots retain names, placement, inert symlink
metadata and exact content identity. Compact managed placement records retain
their canonical adapter and remapped folder IDs. Source receipts remain data.

`accountFileRestoreBytes.ts` exhausts full source fingerprint verification into a
private temporary file before reserving an upload. The worker pins the complete
runtime scope once and checks every stage against the reviewed destination
before source reads. It uses normal upload approval, quota, deterministic
requests, signed multipart transport, network-stall deadlines and stored-byte
verification. Staging uses private, expiring `file-import` drafts without fabricated
native-sync provenance. Only the trusted canonical transaction can consume a
ready, unexpired owned draft; public commit bodies cannot opt into consumption.
The binding and checkpoint commit together, and an interrupted stage stays hidden
from the ordinary library. Streaming parts keep RAM bounded; cancellation/close removes
normal staging. A process crash can leave private temporary files for local
cleanup, as with the existing scratch workspace; scratch never grants authority.

Each canonical file write, new audit receipt and scalar checkpoint commits with
a current Request/session fence and exact destination checks. Reviewed mapped
folders and fresh files carry execution holds; accounted hold assignment refuses
active foreign operations. Current canonical file and managed-placement writes
advance the same root epoch. Bounded final hierarchy/content checks precede one
epoch/CAS completion. User edits, moves and revocation prevent stale completion.
Completed replay reauthorizes the current owner/root and needs no source vault;
it never overwrites later edits.

Historical events receive fresh same-file parent and attachment references and
fresh archive branch IDs with preserved branch names. The newly restored live
file keeps its own Published head. Source Trash state is an explicit reviewed finalization: after byte/history work, a conditional canonical Trash commit retains that state. Completed replay never re-trashes a file the owner later untrashed or edited. Normal retention/upload audit effects and
imported source events are distinct records: restoration creates new audit
history, not additional original revisions. Product History grouping/filtering
for these audit effects is not implemented in this phase.

The existing reachable writer contracts deliberately advance to `api.files`
1.12.1, `api.things-bulk` 1.7.1 and `api.things-delete` 1.1.1 for active restore
epoch fencing. Public retained-version inputs and ordinary upload permissions
are unchanged. Restore admission negotiates those versions on the exact origin;
all writers sharing its database must deploy the fence-aware implementation.

Only moderation policy status enters attachment inventory projection. Provider
moderation diagnostics and timestamps are intentionally excluded before JSON
bounding; portable attachment metadata and byte identities remain unchanged.
Current account-file snapshots also retain inert symlink metadata. Empty byte wrappers use the existing null-fingerprint manifest representation while retaining the exact empty attachment content identity.

Run `pnpm --dir remix run test:backups:file-restore` for canonical synthetic
signup/upload/file/Timeline handlers, a private replica and the durable local
object adapter. This phase does not establish public restore/jobs/UI, complete
managed/account/security adapters, live S3/provider durability, installed/native
acceptance or measured 100 GB–100 TB operation. `wholeAccountReady` stays false.


### Bounded authenticated Workflow continuation

The server coordinator uses private `backup-job`/`backup-job-event` control Things,
home-plane storage accounting and the original full account session reference.
It does not persist a JWT. The ID-only Workflow obtains its run identity inside
the supported Vercel runtime; pause/cancel invalidate the lease, and retry/resume
fence out an older sleeping run. Cursor and hash references advance in one
session/lease-fenced transaction. An uncertain accepted reply is recovered from
its original operation and immutable receipt, never from a newly allocated job.
Generic Things, inherited reads, export and bulk operations cannot expose or
mutate those control roots. This is a server authority boundary, not a UI rule.

The source producer selects BSON `atClusterTime` before any payload pages, then
uses that exact timestamp across bounded census/dependency reads. Its immutable
reference index and contexts continue entirely from retained approved sidecars
once census finishes. A transient snapshot error retries the same timestamp;
expired history fails closed and requires a new operation. Processing batch sizes
are not account limits. The snapshot history window still bounds source census
feasibility; small synthetic cadence evidence does not prove large-account
capture can finish within a deployed provider's history window.

`backupEngine.server.ts` composes that producer, exact-version attachment range
capture, canonical multipart fingerprint verification and canonical v1 manifest
hashing. Worker instances retain fixed scalar cursors, not an in-memory complete
catalogue or a durable SQLite connection. Current object reads and exact seal
readback anchor completion. Bounded internal API transport reuses normal retained
content/upload/Files handlers and releases trusted Request bindings on deadline
or cancellation. Cancellation does not undo effects already accepted; retries
retain operation identities and receipts.

SHA-256 save/load is pinned to `hash-wasm` 4.12.0 and its SHA-256 implementation.
Saved state can contain plaintext tails. AES-256-GCM state therefore stays only in
private independent backup objects under the same encryption/access/retention
boundary as backed-up content. The protected coordinator retains opaque hashes,
offsets and fixed references. Each hash stream has its own operation UUID; a job
UUID is never reused across all streams. Per-job keys derive transiently through
the canonical user vault key, with exact origin/account/job/destination binding;
unknown rotation fails closed. No key or hasher tail is an ordinary Thing field.

The public workspace composes the selected-graph review/restore engine and
editable UI over these mechanisms. Real isolated HTTP/replica/Chrome acceptance
covers creation, review, current/historical bytes, ordinary content and Builder
save/reload; it uses an independent private local store and a fixture-owned
bounded runner. Deployed Vercel Workflow/cron scheduling and actual independent
provider recovery remain separate required gates. Destination discovery retains
`executionAvailable:false`: configured storage is not a provider durability
claim. Retained file history and ordinary current graph support do not imply
whole-account/provider completeness; original ordinary Timeline history remains
archived rather than imported.

A worker-only catalog stage prepares full source paths from retained exact-T
parent/name descriptors, with 32-edge continuation and immutable path caching.
Browsing reads prepared pages and origin/account/seal-bound continuations, never
live source folders. Very large names or paths have explicitly labelled bounded
display previews; their full original metadata stays chunked and lossless for
review/restore. The display preview is not a source-name or data-size limit.
