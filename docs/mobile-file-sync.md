# Mobile devices and file synchronization

Status: implementation in progress. This document tracks the full requested
outcome: add iOS and Android devices in Things like the Mac app, and provide
Drive/Photos/Resilio-style file synchronization across Mac and mobile. The
contract and engine work below does **not** establish end-to-end delivery.

## Existing paths to extend

- Device pairing, revocation, state and commands: `api/utils/devices/` and
  `components/Devices/`. The same protected device Things, owner checks,
  Ed25519 prepare/complete proof and credential sessions serve every platform.
- Files: private `attachment` Things with purpose `file`, ordinary Folder
  Things, canonical upload/complete/content/delete and placement writers.
  See [remote files](remote-files.md) and the
  [attachment map](feature-map/attachments-and-media.md).
- Version history belongs in the existing Timeline. A sync journal contains
  pending transfer identities and acknowledgements, not an alternate history.
- Mac currently provides bounded manual transfers (32 MiB per file), not a
  persistent sync daemon. The iOS shell has recordings, Watch attachment upload paths and native mobile pairing. The Android shell now pairs through the same protocol.

## Implemented contracts

`app/devices/platform.ts` shares the platform vocabulary between the device
validator, API projection/type and public schema. iOS and Android descriptors
are accepted without granting desktop capabilities. Both manifests advertise
`api.devices` 1.10.0 and `api.devices-pairing-claim` 1.1.0. Mobile clients must
negotiate `MOBILE_DEVICE_REQUIREMENTS` before making dependent requests.

`app/fileSync/reconcile.ts` compares two complete, bounded inventories with a
confirmed common baseline. It produces conditional copy/trash decisions or
explicit conflicts. It supports two-way, upload, download and backup policies.
Backup retains remote files after local deletion. Two-way deletes need a
baseline and explicit opt-in. Incomplete scans, invalid digests, path traversal,
duplicate identities and case/Unicode aliases fail before mutations. Scope
includes account, origin, data plane, root and device.

`execute.ts` persists an immutable run before effects, copies before removals,
checks source/destination stamps and resumes uncertain operations by the same
ID. Pending receipts wait. Foreign or wrong-content receipts cannot complete a
job. Conflicts block execution. `journal.client.ts` supplies IndexedDB persistence,
atomic refusal of replacement of unfinished work, monotonic confirmations and
a Web Lock helper. Native workers must implement equivalent durable storage and
exclusivity. Native/cloud adapters must implement idempotent receipts, atomic
destination preconditions, verified staged publication and recoverable trash.
The executor cannot supply these guarantees for a blind-overwrite adapter.
`cloudSyncPort.client.ts` now implements real cloud file upload/replace and remote
Trash operations for explicitly pinned destinations. It also creates ordinary cloud folders before their child uploads, retaining
preallocated parent IDs and exact canonical Timeline creation receipts. Its prepared metadata is
retained with the existing journal run. The mobile connection controls now start
explicit foreground upload/backup runs, as described below.

The current scan bound is 10,000 combined paths, and directories must appear
alongside descendants. Large-root partitioning is still needed. Folder removal
must account for revision changes caused by its own completed child removals;
the current executor safely refuses a stale parent revision. Native persistent workers remain pending.

## Native iOS pairing

`iOS/Thingtime/Devices/MobileDevicePairing.swift` implements the existing prepare/
complete protocol with CryptoKit, an origin/account-scoped Keychain record and
exact persisted completion bytes. A retry after an uncertain response resumes
that claim. Missing capabilities, changed accounts, redirects and revoked
credentials fail closed. Private keys, session cookies and device credentials
never cross the JavaScript bridge. The initial capability list is empty.

`MobileDeviceBridge.swift` exposes `devicePairingVersion` 1.0.0 only on iOS.
Things and Settings use the same `MobileDeviceSetupCard` and request codec.
Foreground checks publish a bounded snapshot; app backgrounding and navigation
cancel the worker. This is not a background file-sync scheduler. Pairing itself requests no file or photo permission; the separate iOS folder control below explicitly opens Files. Android now implements the same capability with the origin-restricted AndroidX bridge and Keystore-encrypted records.

The opt-in `iOS/scripts/test-mobile-devices.sh` uses a disposable API-created
account on localhost to verify a real pairing, online readback, Keychain reload
and repeat-pair identity. See the README for setup. Simulator builds must retain
normal simulator signing: disabling signing also prevented Keychain access in
this test environment. The runtime remains fail-closed on secure-storage errors.

## Remaining acceptance work

| Requirement | Required evidence | Current state |
| --- | --- | --- |
| Add this iPhone/iPad or Android device in Things | Native discovery, authenticated pairing, refresh/relaunch readback, correct account/origin, revoke and reconnect on actual app | iOS and Android clients implemented; real local API pairing and secure storage verified on both simulators; Android installed Things control verified; iOS click-through and physical devices pending |
| Safe native credentials and recovery | Keychain/Keystore storage; restart during prepare/complete; exact recovery without duplicate devices | iOS Keychain and Android Keystore-encrypted pending claims preserve exact completion replay; native recovery tests pass |
| Folder sync across Mac, iOS, Android and cloud | Create/edit/rename/move/delete real byte fixtures in each direction; independent hash verification and convergence | Reconciler/executor, verified fingerprints and atomic stable-file replacement; cloud upload adapter and complete private cloud inventory verified; iOS and Android folder grants/scans/reads implemented; foreground upload/backup controls and recoverable progress implemented; native writes/workers and full native transfer acceptance pending |
| Persistent offline and background sync | Kill/relaunch, reboot, network loss, sleep/wake, quota errors, paused jobs; durable retries with original IDs | Browser journal and real cloud upload recovery verified; native schedulers/adapters pending |
| Large resumable transfers | Chunk interruption/resume, hash mismatch, cancellation, stale upload/finalization race; streaming memory bounds | Real executor multipart interruption and exact-identity retry verified; native streaming transport pending |
| Photos backup | Explicit selection/permission, incremental discovery, original photo/video bytes and metadata, duplicates, limited library changes, background completion | Pending |
| Sync settings | Folder selection, direction, pause/resume, Wi-Fi/cellular and charging policy, exclusions, retention, selective/offline availability | Editable file-sync Things persist device/root/destination, direction, pause, network/power and exclusions; shared configured planner verified. Mobile folder and connection editors exist with durable local drafts and guarded API saves; foreground upload/backup checks live native network/power signals; persistent native approval store, retention/selective settings and background workers remain pending |
| Conflict and deletion recovery | Concurrent edits and delete/edit preserve both versions; conflict resolution UI, retained versions/trash restore | API preserves versions and supports Trash/restore; native conflict handling, retention and UI pending |
| Sharing and device-to-device behavior | Existing ACL/account boundaries, revocation during transfers, offline peers and selected destinations | Existing ACL paths retained; sync adapters and peer behavior pending |
| Release and app acceptance | PR checks, reachable preview, built API smoke, browser desktop/mobile, signed Mac install, iOS simulator/device, Android emulator/device | Foundation checks only; app delivery pending |

Default direction is two-way for explicitly selected folders and backup for
Photos; deletion propagation and photo-library access require explicit choices.
An unavailable folder or revoked permission must never be treated as an empty
successful scan. User-customizable configuration should be editable Things,
Components and Actions with bounded native file/OS adapters.

iOS background uploads must use file-backed URLSession tasks and restore the
session after relaunch; see [Apple background transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background).
For photo backup evaluate [PhotoKit background asset uploads](https://developer.apple.com/documentation/photokit/uploading-asset-resources-in-the-background)
against the app's minimum OS, with an explicit older-OS path. Android persistent
work should use [WorkManager](https://developer.android.com/develop/background-work/background-tasks/persistent)
and the [current long-running transfer limits](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running).
Do not promise continuously running mobile daemons.

## Verification so far — 2026-10-17

- `test:file-sync`: reconciliation, simulated accepted-write/lost-response and
  journal failure recovery, identity changes, IndexedDB close/reopen and
  competing writers. This uses fake IndexedDB and an in-memory transfer adapter;
  it does not prove native disk or cloud byte transport.
- `test:devices`, `test:api-capabilities`, `test:schemas`: mobile descriptors,
  proof tampering, safe projections and both capability registries.
- Full web/Vercel build and compiled handler discovery smoke passed. The smoke
  pins `THINGTIME_API_FALLBACK_ORIGIN` to its synthetic request origin so the
  legacy discovery path cannot proxy to the production API. Database-backed
  pairing is not covered by that no-database smoke.
- Raw TypeScript still reports errors outside the changed files; this is not a
  clean project typecheck. Native and browser acceptance remain in the table.

- Native checkpoint: 28 selected simulator tests passed (8 protocol/recovery,
  19 destination regression tests, 1 explicit live local API/Keychain test).
  The simulator app was installed and launched with the selected local origin.
  Browser component QA covered synthetic unpaired/pending/paired/revoked states
  at desktop and 390px widths without horizontal overflow. This does not yet
  prove a signed-in user clicking through the installed app or physical-device
  behavior. All real file-transfer acceptance remains pending.

## Android checkpoint — 2026-10-17

`android/` provides a Java 17 / SDK 35 native shell (minimum API 26) with a
main-frame, exact-origin AndroidX WebView bridge. Device credentials and signing
seeds remain native; AES-GCM records in no-backup storage use a non-exportable
Android Keystore wrapping key. This is software Ed25519 signing, not a claim of
hardware signing. Pending completions are saved atomically before transmission.
Only the selected origin receives account cookies; node credentials use explicit
Bearer requests, redirects are rejected and responses are size bounded.

Nine JVM protocol tests pass, including the shared iOS/server signing vector,
exact replay after a lost completion response, cancellation, account isolation,
revocation and version negotiation. Debug build and Android lint pass. Three
Android 35 emulator tests pass: encrypted reload/tampering, cross-account
ciphertext rejection, and real local API pairing/readback plus the installed
Things connection control. The latter verifies the native bridge, paired card,
Check connection publication, retained device ID and no horizontal overflow.
Android status/navigation bar insets were visually checked on the installed app.
Physical devices, app-store signing/distribution and real file/Photos transfers
remain pending. See [Android setup and acceptance](../android/README.md).

- Final Android checks also passed the minified unsigned release build and
  release lint. The installed connection-control test passed at both foldable
  and phone widths. Screenshots show duplicated device-card painting beneath
  the existing Things filters; the new connection card and native insets are
  verified, but broader Things rendering remains an open acceptance item.

## Verified content checkpoint — 2026-10-17

The existing attachment content endpoint now supports `fingerprint=1` under
`api.attachment-content` 1.13.0. It reuses content authorization, verifies the
exact stored object version, size and attachment ID, then rechecks attachment
access/lifecycle. The private, uncached response contains an opaque version and
`sha256-parts-v1`: SHA-256 of concatenated part SHA-256 digests, with the canonical
part size and count. It is not a whole-file SHA-256. See [S3 composite checksum
semantics](https://docs.aws.amazon.com/AmazonS3/latest/userguide/checking-object-integrity-upload.html).
No bucket, object key, internal VersionId or signed download URL is exposed.
Missing/noncanonical checksums return 409; they never mean an absent file.

`contentFingerprint.ts` shares attachment part planning with bounded local
hashing. `attachmentFingerprint.client.ts` negotiates the feature and refuses
scope changes, failed reads and oversized responses. Reconciliation and durable
operations accept compatible composite fingerprints as well as existing whole
file hashes; the two formats never compare equal accidentally. The current
browser implementation caps each part at 32 MiB. Larger parts need a native
streaming adapter. Empty files remain unsupported by attachment upload and are
an explicit remaining full-sync requirement.

The real HTTP acceptance script uploaded 8 MiB + 17 bytes in two parts through
the local storage implementation, replayed start and completion, matched the
local/cloud fingerprints, independently verified the downloaded whole-file
SHA-256, denied anonymous reads, and deleted the fixture. This verifies the
canonical API/local storage integration; it is not a production S3 acceptance
run or a native background sync run. Stable logical file identity, conditional
version replacement, Timeline versions/trash and native workers are next.

## Stable cloud files checkpoint — 2026-10-17

`api.files` 1.0.0 provides the canonical stable file identity. POST commits an
owned durable file upload or a previously retained version under one UUID file
ID, one immutable UUID operation ID and an expected revision. A single home
Mongo transaction binds the attachment, publishes current metadata, updates the
existing account ledger and appends a `file-content` Timeline revision. Old
attachments remain readable by their owner and charged. No new collection,
index, version array or parallel history is introduced.

The expected revision is the Timeline head, so canonical folder moves also
invalidate stale file writes. Things 1.34.0 lists live file roots once, hiding
retained attachments and trashed roots. Bulk 1.6.0 uses the existing managed
placement writer. Folder deletion reparents the file and records its move.
The byte fingerprint remains separate from the file revision: a rename or move
changes revision without pretending the bytes changed.

GET by file ID reads the current state; adding the original operation ID reads
its exact committed receipt. Replaying a successful POST returns that original
snapshot even after later changes. A different payload under the same operation,
a stale revision, wrong bytes, a foreign/bound/blocked upload or a custom data
plane is refused. Client-authored Timeline drafts cannot impersonate committed
receipts. Retrying an absent receipt never means deleting a file.

Trash and restore are new guarded commits. Prior bytes can be restored by
selecting their retained attachment with the current expected revision. All
retained versions currently remain charged indefinitely; purge/retention policy,
version-selection UI, sharing, root inventories/path collisions, upload adapter
integration and native workers remain required. The existing UI still uses the
legacy manual transfer path; this API checkpoint is not end-to-end sync.

The opt-in `file-versions.integration.mts` verifies real uploaded bytes,
replacement, exactly one winner among concurrent commits, exact replay/lookup,
private Timeline history, live library listing, guarded folder moves, folder
deletion, Trash/restore and independent hashes of both retained versions.
Generic hard deletion and anonymous reads are denied. Its tiny synthetic file
stays in the disposable account's Trash because no purge bypass is permitted.

## Cloud execution checkpoint — 2026-10-17

`prepareCloudSyncRun` pins each destination folder and prior file snapshot before
execution. `createCloudSyncPort` persists that complete record through the existing
journal and connects the executor to the canonical uploads and file-commit API.
Uploads preserve original bytes, use the operation UUID as the upload request ID,
verify every part checksum and the full composite fingerprint, then condition
publication on the pinned file revision. No response failure deletes uploaded
bytes or discards the run. Retrying an incomplete multipart transfer currently
resends its parts with the same identity; a completed upload is reused.

Operation lookup validates content/path/destination, then checks the server's
immutable request hash by replaying the exact original metadata with the retained
byte identity. An accepted write with a lost reply therefore recovers without
source access or another upload, including after a restart. Account/origin/root
changes stop work; expected-actor and expected-data-plane headers bind each API
request on the server. Signed part PUTs omit account credentials and referrers.

Acceptance covers six new transport regressions (42 sync tests total), real
8 MiB + 17 byte multipart interruption, disk-restored runs, a lost accepted
commit, stable replacement, independent hashes of both retained versions, and
remote Trash through the executor. The real test uses local MongoDB and the
documented storage stand-in, and leaves its synthetic versions privately in
Trash. It does not prove native disk publication, OS background execution or S3.

The adapter accepts explicitly resolved file destinations. Directory discovery,
atomic path collision handling across concurrent creates, folder creation and
removal, local download publication, empty files and native streaming for parts
above 32 MiB remain required. Production UI/Builder integration, selected roots,
sharing, Photos and release acceptance remain on the original goal.

## iOS folder access checkpoint — 2026-10-17

The paired-device card can explicitly choose, check and forget native Files
folders through `fileAccessVersion` 1.0.0. Bookmarks remain private device-only
Keychain records scoped to the authenticated owner and origin; only opaque IDs,
names and bounded requested observations cross the bridge. These are OS access
grants, not a separate sync configuration or history store. Future editable sync
Things reference those IDs. Selection alone does not start uploads.

Scans use coordinated, descriptor-relative reads, refuse symlinks and incomplete
inventories, hash incrementally using the shared multipart contract and recheck
observed file/directory versions. Reads are capped at 64 KiB and pinned to the
scanned version. Native grants, scan entries and metadata are bounded. Empty
files remain visible but cloud empty-file publication is still pending. Every
operation verifies the full account before work and before returning private
results; navigation/background cancellation fences late tasks and picker
callbacks. Cancellation also releases the waiting web controls.

Native reader/store/bridge and existing pairing/destination tests cover real
multipart bytes, empty files, traversal/symlinks, changed versions, missing
folders, Keychain reload/isolation, failed storage and matching cancellation.
The web suite covers response identity, invalid/incomplete inventories, bounded
chunk assembly and cancellation. Browser fixture QA covers StrictMode, long
names, preserved state on errors and desktop/mobile bounds. The rebuilt app is
installed and launches on iOS Simulator. Signed-in system-picker click-through,
third-party Files providers and physical-device behavior remain unverified.
Android folder access, cloud-to-native publication, persistent workers, Photos,
editable sync controls, retention/sharing and release remain on the full goal.

## Android folder access checkpoint — 2026-10-17

Android now implements `fileAccessVersion` 1.0.0 behind the shared paired-device
folder controls. `ACTION_OPEN_DOCUMENT_TREE` supplies a read-only persisted tree
grant; URI references remain in the existing Keystore-encrypted storage format
under a distinct authenticated namespace. One bounded atomic registry maintains
account/origin ownership and shared URI references. Failed persistence rolls
back only a newly acquired permission; removing one reference cannot revoke
another account's grant. No file deletion or broad storage permission is added.

The provider adapter uses tree-relative document URIs, named cursor columns,
cancellation signals and streaming descriptors. It refuses unknown-size,
virtual, loading/incomplete, missing, colliding and oversized observations.
Whole-file multipart fingerprints are part of source versions, so unchanged
provider timestamps cannot authorize different bytes. Foreground bridge reads
are bounded to 64 KiB but currently hash the entire file each time. Efficient
native streaming/snapshots remain required for the final large-file worker.

Verification includes 16 JVM tests (7 reader, 9 pairing), grant and storage
emulator tests, two real ContentResolver/DocumentsProvider fixture tests, and
the installed app's authenticated list bridge and folder controls. Browser
fixture checks cover phone/desktop widths and retained state after errors.
The actual system-picker flow, third-party providers, physical devices and
background work remain unverified. The desktop control tool could not address
the running emulator window; no system-picker success is inferred from mocks.
The optional live picker test is retained for operator-assisted acceptance.
Native writes, persistent workers, Photos, editable sync policy Things,
conflict/retention/sharing UI and release remain on the original full goal.


## Editable sync configuration — 2026-10-17

`fileSync/configuration.ts` defines an ordinary, independently copyable
`file-sync` schema. The existing Things API stores one bounded connection per
Thing, defaults it to private, and keeps its changes in the canonical Timeline.
The crystal contains a device ID, opaque native root ID, cloud folder ID, name,
direction, pause, deletion opt-in, Wi-Fi/any-network choice, charging choice and
up to 100 exact relative exclusion paths (16 KiB total). No OS path, bookmark,
tree URI, credential or transfer history is stored in this configuration.
The new configuration factory defaults to paused/two-way/Wi-Fi/no deletions.
Both API manifests advertise Things 1.35.0; `useApi` negotiates it for new
configuration writes. Public schema definitions remain independently copyable.

`configuredPlan.ts` reads the real public Thing projection (`author.id`, not
an invented `ownerId` field), requires a private owned record, and compares its
canonical configuration and revision with a separately supplied device-local
approval. Approval scope includes account, origin, data plane, device and the
configuration Thing ID. Separate configurations therefore have separate sync
journals even if they select the same native root. These helpers do not create
or persist native approvals: that remains worker integration work.

Before producing mutations, the configured planner gates paused/offline/unknown
network and charging state. It validates the full scans, then excludes matching
paths and descendants equally from both replicas and their common baseline.
Excluded descendants also prevent ancestor-folder deletion. Runtime adapters
must still reauthorize both roots, recheck current policy/conditions before new
effects, reconcile any in-flight receipts, and enforce source/destination CAS.
An editable Thing alone is never native execution authority.

Verification: eight focused configuration tests plus the existing sync suite;
public-schema copy/validation, both capability manifests, Things regressions;
real local API create/list/read/update, anonymous refusal, invalid paths,
stale-write 409, changed-approval refusal and charging gate. The integration
script removes its synthetic configuration/folder through the normal API and
logs out. The File sync reference and all eleven fields render in the local
browser. This is storage and planning acceptance, not production sync UI or
native scheduling/transport acceptance. The connection editor is covered below; native approval
persistence, efficient streaming, destination writes, Photos and the remaining
full-goal acceptance ledger above are still open.


## Mobile connection editor — 2026-10-17

`MobileSyncConnections.tsx` attaches to the actual paired device identity in
Things/Settings. It lists owned private connections with pagination, offers
private cloud folders, and edits name, native root, destination, direction,
pause, network, charging, deletion and exact-path exclusions. Defaults remain
paused. Removing a native grant preserves the connection and displays missing
access. Backup disables deletion propagation. No transfer-running state is
claimed: native workers are not connected yet.

`configurationEditor.ts` shares the save/recovery contract. Complete local
drafts are isolated by origin/account/data plane/device and restored before
first paint. Storage writes are checked before HTTP dispatch. A pending write
keeps its ID/payload and expected revision across reloads. Retrying reads that
ID first; exact current configuration confirms success without another write.
This is current-state confirmation, not an immutable operation receipt.
Divergent revisions preserve the draft and offer saved-settings review before
explicit replacement. Missing grants before the first mutation leave the draft
editable; a previously uncertain save remains fixed until confirmed or found
in conflict. Requests carry expected actor/data-plane headers and abort on
identity retirement; old StrictMode requests cannot update a new mount.

Verification: 66 sync tests, 20 request/payload/error tests and 88 device tests
pass. The disposable loopback integration verifies fixed-ID create and CAS edit
with simulated accepted-reply loss, serialization/reload and exactly one write,
then stale-edit rejection and normal API cleanup/logout. The browser fixture
uses the production component/useApi with synthetic Things/native responses:
complete draft reload, lost-response readback, offline retry after reload,
stale draft review/replacement and removed-grant recovery passed. Desktop
1280px and mobile 390px/320px show no horizontal overflow or out-of-bounds
controls. Actual signed-in native picker/worker acceptance remains open.


## Complete cloud folder inventory — 2026-10-17

`api.files` 1.1.0 adds `GET /api/v1/files?rootId=<folder-id>` to the existing
Files route. `api/utils/files/inventory.ts` reads one owned private folder tree
in a Mongo snapshot transaction, using one indexed descendant query per breadth
level. The inventory includes ordinary folders (including legacy folder Things)
and live stable files with their exact revisions and immutable fingerprints.
Non-filesystem Things and trashed files are excluded. This API is read-only and
adds no collections, history store or write authority.

The shared `cloudInventory.ts` parser checks explicit completeness, the root,
all identities and parent relationships, paths, duplicate names and case/Unicode
aliases. Inaccessible or malformed descendants, missing ancestors, cycles,
custom data planes and storage errors refuse the entire observation. Scans are
bounded to 10,000 descendants, 64 breadth levels, 8 MiB and a 20-second total
server budget (including transaction retries). Larger trees need partitioning;
a failed scan must retain the last complete baseline, never imply deletion.
Folder revisions are observation stamps, not a folder mutation contract.

`cloudInventory.client.ts` negotiates 1.1.0 and pins the expected actor, home
storage, origin and complete sync scope through request and bounded body reads.
Redirects, identity changes, aborts, timeouts and oversized replies fail without
substituting a cached or empty inventory. Every eventual write still needs
fresh source/destination authorization and conditional revision checks.

Verification: focused parser/client/service/route tests cover nested and empty
trees, snapshot consistency under a concurrent edit, privacy/namespace fences,
legacy folders, collisions, limits and cancellation. The disposable loopback
`file-versions.integration.mts` acceptance reads real Mongo-backed nested folders
and exact stable-file fingerprints, excludes an ordinary note, refuses anonymous
and mixed-selector requests and rejects colliding names without partial data.
It removes its temporary folders/notes through the normal API; its two tiny,
accounted file versions remain in private Trash as before. Native persistent
workers, directory mutations, local writes and the full acceptance ledger remain
unfinished; this inventory is not a claim that automatic sync is running.
The 73 shared sync, 18 Files and 95 capability tests pass, as do targeted lint
and the full web/Vercel build. TypeScript retains the existing 91 diagnostics.


## Recoverable nested cloud uploads — 2026-10-17

Files 1.2.0 adds ordinary folder creation through `POST /api/v1/files` with
`kind: "folder"`, UUID `id`/`operationId`, `name` and an explicit `folderId`.
`api/utils/files/folders.ts` composes the existing `createThing` writer with a
single home transaction and deterministic `thing-content` Timeline capture.
Quota, canonical folder validation, parent placement fencing and post-commit
effects stay with that writer. There is no parallel folder/history collection.
Private account/namespace/ancestry checks precede creation; occupied IDs and
observed case/Unicode path aliases fail without adopting another folder.
Concurrent creates fence the same parent and retry against the winning name.

`GET folderId` reads current folder metadata; adding `operationId` reads the
immutable creation receipt. Exact replay returns the original snapshot after
later edits or deletion without recreating a deleted directory or charging twice.
An operation with changed parent/name is rejected. Only server-authored canonical
creation events qualify; client drafts cannot impersonate a receipt. The shared
folder revision helper also supplies inventory stamps, so the two views agree.

`prepareCloudInventoryRun` binds a run to its complete cloud observation and
allocates new parent identities from existing operation IDs before effects.
The cloud port creates parent directories before child files and never opens a
byte source for a directory. These destinations remain in the same durable run
across reloads. The folder adapter currently creates absent folders only;
folder deletion, local directory publication, automatic native workers and the
remaining full-goal ledger are still open. Ordinary folder schema limits still
apply (120-character names); normalization that would alter a filename fails
and rolls back rather than silently changing the path.

Verification: unit service/route tests, journal reopen and nested executor tests;
real loopback Mongo/storage acceptance recovered a lost parent-creation reply,
interrupted multipart transfer and lost file-commit reply, then verified one
nested tree and independent hashes of both retained byte versions. Normal API
cleanup removes created folders, reparents the retained private Trash file and
keeps original creation receipts readable. No native background or production
object-store acceptance is inferred from this local run.

The 195 focused sync/Files/capability tests and full web/Vercel build pass.
Real Mongo concurrency checks also verified identical-operation replay and one
winner for case-equivalent paths. Raw TypeScript retains 91 baseline diagnostics.


## Foreground mobile uploads — 2026-10-17

`MobileSyncConnections` now offers **Upload now**, **Stop upload** and **Retry
upload** for unpaused upload/backup connections with an available native grant.
Each click reviews the saved configuration revision, paired device, account,
origin and home data plane. Saving a Thing alone never starts work. iOS and
Android advertise `fileAccessVersion` 1.1.0 and return bounded network/charging
signals; older apps retain folder access but cannot start this runner.

`foregroundSync.ts` owns planning, complete scans, cloud execution and progress
under the existing per-root Web Lock. Network, charging, pairing and configuration
are rechecked before mutations. Unknown policy signals fail closed when required.
Stop, backgrounding or identity changes cancel the active work. Progress remains
visible on reload, and retry uses the journal's original operations and receipts.
Network/power checks occur between requests: an already-started byte part is not
bound to an OS network or automatically cancelled by a policy change.

The version-2 IndexedDB journal preserves version-1 runs and atomically writes a
completion checkpoint only for the current fully confirmed run. The checkpoint
uses the same scoped common-baseline contract, with explicit native/cloud roots.
Fresh matching observations advance it; divergent copies retain prior common
observations. If checkpoint storage fails after accepted writes, the next run
recovers that baseline from immutable operation receipts before planning local
edits. No second history, upload namespace or physical collection is introduced.

Verification: 81 sync tests, targeted lint, full web/Vercel packaging, Android
debug/JVM/lint and 9 emulator tests, iOS test build and 17 selected simulator
tests pass. TypeScript retains the same 91 baseline diagnostics (47 normalized
messages), with no additions. Browser synthetic controls verify network refusal,
lost folder reply/reload/retry, Stop/reload/retry and responsive layout. The real
loopback HTTP/storage acceptance `file-sync-foreground.integration.mts` verifies
lost accepted upload recovery without byte reupload, a failed completion
checkpoint followed by a local edit, replacement of the same cloud file,
independent downloaded-byte hashes and a repeat scan without upload. Its native
grants/conditions/source are test adapters; this is not native end-to-end upload
acceptance. Temporary fixture configuration is removed and the managed server
restarted after the test; tiny accounted byte versions remain in private Trash.

Remaining: actual native byte-upload acceptance, persistent OS background
transports/approvals, local download publication, folder deletion/rename
convergence, Photos backup, peer behavior and Mac integration. The current native
chunk reader rehashes the source per chunk and the runner rescans per operation;
large-file and large-root performance still needs work before broad release.
