# Portable backup storage

This is the portable storage/verification foundation for the whole-backup scope
in [mobile-file-sync.md](mobile-file-sync.md#whole-backup-snapshots-and-timeline-recovery--requested-2026-10-17).
It can independently retain a supplied frozen inventory, resume interrupted byte
capture/copy and recover exact files without the original source. It does **not**
yet create an account-wide inventory, run scheduled cloud jobs or expose a backup
button. Those integrations remain required; a fixture is not a complete account
backup or a demonstrated 100 TB transfer.

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
