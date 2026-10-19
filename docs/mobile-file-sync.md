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
- Mac now uses the shared foreground folder runner with bounded upload/download
  streams and durable recovery; a persistent native sync daemon remains open.
  iOS and Android pair through the same protected device protocol. See the dated
  acceptance checkpoints below for platform coverage and remaining work.

## Implemented contracts

`app/devices/platform.ts` shares the platform vocabulary between the device
validator, API projection/type and public schema. iOS and Android descriptors
are accepted without granting desktop capabilities. Both manifests advertise
`api.devices` 1.13.0 and `api.devices-pairing-claim` 1.2.0. Mobile clients must
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
retained with the existing journal run. The mobile connection controls start explicit foreground upload/backup, approved
downloads and two-way runs, as described below. Native deletion propagation is connected through explicit native consent,
fresh cloud absence checks and recoverable Trash on Mac/iOS and Android
Thingtime offline folders. Installed Android planner-driven deletion acceptance
is tracked separately from direct native recovery below.

The fully paged Mac/iOS path now supports more than 10,000 combined paths;
legacy or incomplete adapter combinations keep that limit. Directories must
appear alongside descendants, and only complete inventories can advance the
baseline. Real Swift/API acceptance covers 10,003 paths; million-file and
installed-provider acceptance remain open. Folder removal
uses retained child/sibling receipts to advance only the pinned direct parent
revision; unrelated changes still refuse removal. Native persistent workers remain pending.

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
| Add this iPhone/iPad or Android device in Things | Native discovery, authenticated pairing, refresh/relaunch readback, correct account/origin, revoke and reconnect on actual app | iOS and Android clients implemented; real local API pairing and secure storage verified on both simulators; installed Things pairing verified on both simulators; physical devices pending |
| Safe native credentials and recovery | Keychain/Keystore storage; restart during prepare/complete; exact recovery without duplicate devices | iOS Keychain and Android Keystore-encrypted pending claims preserve exact completion replay; native recovery tests pass |
| Folder sync across Mac, iOS, Android and cloud | Create/edit/rename/move/delete real byte fixtures in each direction; independent hash verification and convergence | Reconciler/executor, verified fingerprints and atomic stable-file replacement; cloud upload adapter and complete private cloud inventory verified; iOS and Android folder grants/scans/reads implemented; foreground upload/backup controls and recoverable progress implemented; bounded cloud downloads and executor staging/receipt adapter verified; iOS native staging, approval and same-volume publication implemented and tested; Android private staging, native write approval, durable offline-folder publication, explicit native creation and read-only Android Files access verified; Android foreground offline-root cloud downloads, mixed two-way creates/independent replacements and actual Files acceptance verified; shared Apple publication core and process-exit recovery verified on macOS; Mac local adapter/identity/disconnect implemented; Electron host/shared controls, synthetic browser foreground acceptance and real Mac adapter/cloud mixed-transfer acceptance implemented; iOS mixed-direction simulator acceptance verified; iOS external Files edits, Mac installed transfers, workers and full cross-device transfer acceptance pending |
| Persistent offline and background sync | Kill/relaunch, reboot, network loss, sleep/wake, quota errors, paused jobs; durable retries with original IDs | Browser journal, Desktop full-process journal/draft restart recovery and real cloud upload recovery verified; iOS publication and Android staging process-exit recovery verified; iOS durable upload-part cache and fresh-process capture recovery verified; iOS user-started continued-task lifecycle implemented with simulator refusal and physical-device acceptance pending; actual interrupted PUT, passive schedulers and reboot acceptance pending |
| Large resumable transfers | Chunk interruption/resume, hash mismatch, cancellation, stale upload/finalization race; streaming memory bounds | Real executor multipart interruption and exact-identity retry verified; Mac upload/download ranges and Android binary download ranges verified; Android foreground file-backed native multipart uploads and iOS file-backed native multipart uploads are implemented and installed multipart photo acceptance verifies byte hashes without bulk WebView reads; background transfer, physical-device acceptance and sustained throughput remain pending |
| Photos backup | Explicit selection/permission, incremental discovery, original photo/video bytes and metadata, duplicates, limited library changes, background completion | Android 11+ MediaStore and iOS PhotoKit read-only sources use the shared backup-only connection. Installed API 35 and iOS 26.5 simulator acceptance verified original PNG bytes, new-photo discovery and cloud retention after device deletion. Mac 1.3.0 adds a native PhotoKit source adapter; real API acceptance uses synthetic photo resources. Shared Apple reader passes 57 tests; actual Mac installed PhotoKit acceptance, real limited-selection changes, Live Photo/video/EXIF formats, physical devices, large-library paging and background completion remain open |
| Sync settings | Folder selection, direction, pause/resume, Wi-Fi/cellular and charging policy, exclusions, retention, selective/offline availability | Editable file-sync Things persist device/root/destination, direction, pause, network/power and exclusions; shared configured planner verified. Mobile folder and connection editors exist with durable local drafts and guarded API saves; foreground upload/backup checks live native network/power signals; iOS scoped Keychain and Android native/OS write approvals implemented; Mac native approvals/shared controls implemented with installed acceptance pending; retention/selective settings and background workers remain pending |
| Conflict and deletion recovery | Concurrent edits and delete/edit preserve both versions; conflict resolution UI, retained versions/trash restore | API preserves versions and supports Trash/restore; iOS preserves displaced versions and uncertain conflicts in the transfer journal; file conflict review now offers guarded version choices; Android file-conflict review and native recovery acceptance verified; shared native recovery browsing and reviewed restore implemented on Mac/iOS/Android offline folders; broader installed conflict review, folder conflicts, recovery after grant replacement and retention policy remain pending |
| Sharing and device-to-device behavior | Existing ACL/account boundaries, revocation during transfers, offline peers and selected destinations | Existing ACL paths retained; sync adapters and peer behavior pending |
| Release and app acceptance | PR checks, reachable preview, built API smoke, browser desktop/mobile, signed Mac install, iOS simulator/device, Android emulator/device | Foundation checks only; app delivery pending |

Default direction is two-way for explicitly selected folders and backup for
Photos; deletion propagation and photo-library access require explicit choices.
An unavailable folder or revoked permission must never be treated as an empty
successful scan. User-customizable configuration should be editable Things,
Components and Actions with bounded native file/OS adapters.

iOS user-started uploads use continued-processing tasks when accepted by iOS 26+.
Relaunch-capable transfer remains separate work: background URLSession follows
redirects unconditionally, so plaintext uploads cannot switch to that transport
without revisiting destination protection. See [Apple background transfers](https://developer.apple.com/documentation/foundation/downloading-files-in-the-background).
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
convergence, Photos backup, peer behavior and Mac integration. The runner still rescans per operation; large-root and streaming/background
performance need further work. Android verified ranges are described below; iOS
already uses bounded descriptor-relative reads with before/after stat checks.


## Verified Android ranges — 2026-10-17

Android file access 1.2.0 adds opt-in `verifiedChunks` reads. A complete native
file scan records SHA-256 proofs for 64 KiB chunks alongside the existing canonical
multipart fingerprint. A process-local LRU caches at most 512 files / 8 MiB of
proof bytes, keyed by account, origin, selected-root grant, complete document
metadata and content-derived version. No native paths or proofs cross the bridge.
Backgrounding/removing access clears the cache. Missing/evicted/oversized proofs
fall back to full verification; grants and owner identity are still checked for
every bridge request. Old clients retain the original full-file read behavior.

Ranges verify every touched chunk before returning bytes, including unaligned
reads spanning two chunks. Same-stamp provider mutations cannot substitute bytes.
A mutation elsewhere can be discovered later; `FingerprintSource.verify` supplies
a full native check immediately before cloud file publication, also on retry of
an already-completed attachment. Failed verification preserves the operation and
never commits a stable file. Final byte fingerprints remain checked independently
by the canonical upload/commit pipeline. iOS retains its descriptor/stat checks.

Validation: Android JVM byte-count regression reads an 8 MiB + 17 byte source
once for the scan and once for all aligned ranges, instead of once per chunk.
Tests cover cross-chunk reads, same-stamp edits, scope isolation, eviction and
cancellation. Ten emulator tests pass, including real ContentResolver file
descriptors, multipart range hashing, full source revalidation and installed
bridge 1.2.0. The provider is a generated test fixture, not system-picker or
third-party provider acceptance. All 82 sync tests, targeted lint, Android
build/JVM/lint and full web/Vercel build pass; TypeScript keeps its prior baseline.

The optional `THINGTIME_FOLDER_UPLOAD_TEST=1` Android acceptance now prepares a
private cloud connection and drives the installed Upload now control after the
operator chooses the documented synthetic folder. It independently hashes the
download and cleans up via normal APIs, retaining accounted bytes in private
Trash. This optional picker/upload test has been added but has **not passed**:
the current computer-control surface cannot address the running emulator window.
Other implementation work remains available; this is not a full-goal blocker.

The optimization is for seekable provider descriptors. Providers whose `skip`
streams bytes may still reread prefixes, and files whose proofs exceed the cache
fall back safely. Native streaming/background transports and avoiding repeated
whole-root scans remain required for broad large-file/root performance.


## Bounded cloud downloads and staged executor — 2026-10-17

Attachment-content 1.14.0 adds an exact-version range selector on the existing
content route: `range=1&version=<opaque-version>&offset=<byte-offset>&length=<bytes>`.
The 2 MiB bound leaves room for binary transport encoding beneath
[hosted function payload limits](https://vercel.com/docs/functions/limitations).
Each request reads at most 2 MiB, rechecks attachment authorization after reading,
and returns private/no-store HTTP 206 only for the exact Content-Range and byte
count. Wrong versions return 409, out-of-file ranges 416, and truncated, oversized,
redirected or malformed storage responses fail without returning partial bytes.
The fingerprint/version comes from the canonical attachment service; no signed
storage URL, object key or new collection is exposed.

`cloudDownloadSource.ts` splits bounded source reads into these ranges, checks
account/origin/data plane, current file revision/name/parent, exact response ETag
and byte framing, and supplies a final source check before publication. Complete
staged bytes still require the planned multipart fingerprint. Downloads reuse
`CloudSyncRun`, the existing browser journal and executor's immutable operations;
they do not create another queue or history. Folder copies precede child copies.

`LocalSyncTarget` is the required native boundary: private staging, scoped write
approval, complete fingerprint verification, atomic destination preconditions,
recoverable displaced versions and durable publication receipts. A missing native
publisher refuses port creation. The shared port verifies the stage and source
before invoking publication, then the executor validates the returned receipt.
Tests reopen IndexedDB after an accepted publication loses its reply and recover
using the same receipt without staging or reading bytes again. Concurrent local
edits, changed cloud sources and invalid stage proofs refuse file publication.

Real loopback API/storage acceptance with `--large-download` reads a 17 MiB + 17
byte fixture through bounded ranges, independently matches its whole SHA-256 and
multipart fingerprint, rejects anonymous/wrong-version reads, and refuses the
old source after replacement. The legacy 16 MiB cache limit remains unchanged.
Normal cleanup removes the synthetic configuration/root and retains accounted
versions in private Trash; temporary admin env is removed and PM2 restarted.

The publisher in executor tests is an adapter fixture. No iOS, Android or Mac
native destination writer is enabled by this checkpoint, and mobile controls
remain foreground upload/backup only. Native publication, native interrupted
staging recovery and background transfers remain required acceptance work.

Validation for this checkpoint: 86 sync tests, 289 attachment-suite tests and
89 capability tests pass. Targeted lint and full web/Vercel build pass. Raw
TypeScript remains at 91 diagnostics / 47 normalized messages, with no new
diagnostics against the preceding checkpoint. Structural graph refresh is
included; semantic freshness is not claimed.


## Native iOS download staging — 2026-10-17

The iOS bridge now advertises a separate `fileStagingVersion` 1.0.0. File access
1.1.1 aligns the ready event and injected feature versions through shared constants
(the ready event previously still reported 1.0.0). The existing
origin/main-frame/foreground and owner checks gate `stage-begin`, `stage-append`
and `stage-finish`; every request also resolves an owned native folder grant and
checks its bookmark access. These calls receive into private application support
storage only. They do not grant write access or publish into the selected folder.

`MobileSyncStaging.swift` retains the exact shared scope, root grant and immutable
copy operation. It serializes disk effects with a file lock, writes at most 64 KiB
per call, flushes bytes before an atomic checkpoint and rejects gaps, conflicting
replays, changed operations and foreign contexts. Reopening resumes the last
acknowledged offset. A tail written before a failed checkpoint is truncated to
that offset; acknowledged bytes are retained. Finalization checks the complete
canonical multipart fingerprint (or whole-file hash), including empty files, and
returns the existing `LocalStagedCopy` shape. Completed stages are reverified on
reopen. Traversal, symlinks, hard-linked files, malformed records and corrupted
completed payloads fail closed. Cached transfer data is excluded from backup;
there is no alternate file history. Root records and metadata are bounded.

`stageMobileCopy` reads cloud data in at most 2 MiB buffers and feeds bounded
native messages through the existing mobile request codec. Lost chunk replies
resume from native durable progress; completed stages reuse their token. Capability
negotiation, response identity, byte counts, cancellation and final stage proofs
are checked before the caller can hand a stage to a publisher.

Validation: 88 shared sync tests, targeted lint and the full web/Vercel build
pass. TypeScript retains 91 existing diagnostics / 47 normalized messages with
no additions. Twenty-four selected iOS simulator tests pass, including an
8 MiB + 17 byte staged file, reopen/replay, failure between byte flush and
checkpoint, checksum/symlink refusal and a real WebKit bridge dispatch that
verifies capability negotiation, owner checks and encoded stage replies. That
bridge test supplies a synthetic owner verifier and local bookmark fixture;
it does not establish authenticated cloud-to-native transfer or picker acceptance.
Build 31 was rebuilt, installed and launched on iPhone 17 Pro / iOS 26.5; the
installed executable matches the build and the app renders its local web origin.

Still required: explicit native write approval bound to the connection/grant,
OS-coordinated destination publication, preservation of displaced versions,
durable publication receipts, native staging cleanup/retention, process-kill
acceptance, Android/Mac receivers and integration with download/two-way controls.
The shared cloud executor still refuses downloads without a complete native
publisher; mobile controls remain foreground upload/backup. No end-to-end
Drive/Photos/Resilio completion is claimed.


## iOS approved foreground downloads — 2026-10-17

The existing connection control offers Download now on `filePublicationVersion`
1.0.0 with deletion propagation disabled. `approveMobileSyncTarget` hashes the
canonical reviewed configuration and obtains native consent for the selected
folder. `MobileFolderStore` keeps bounded, account/origin-scoped approvals in
Keychain, bound to device, connection, settings revision/hash and native grant.
Choosing the folder again or removing it clears consent. A persisted Thing or
read grant alone cannot publish. Native prompts use the stored folder name and
origin; main-frame/foreground/owner checks still surround bridge requests.

`MobileSyncStaging` adds publication intent and the unchanged shared SyncReceipt
to its existing transfer record. It re-verifies private staged bytes, copies in
64 KiB buffers to a separate private candidate, checks the observed destination
stamp/content under NSFileCoordinator and durably saves intent before rename.
Same-volume `RENAME_EXCL` creates absent files/folders; `RENAME_SWAP` replaces
files while retaining the displaced inode privately. Both require no-follow
and beneath-root resolution. Case/Unicode aliases, symlinks, changed destinations,
cross-volume targets and unsupported providers fail rather than fall back to
in-place writes. No new cloud collection, history or Timeline format is added.

A swap is not an OS compare-inode-and-swap primitive. A non-cooperating writer
racing the final check can be displaced; its actual inode/bytes are retained and
the operation remains pending for conflict review. It is never reported as a
successful overwrite or blindly rolled back. Recovery after rename proves the
new destination inode/content and retained original before saving a receipt.
An edit before that receipt is durable remains pending. A durable receipt is
returned unchanged after later edits/deletion without republishing. Retained
versions have no restore UI or automated retention/cleanup yet.

The foreground runner uses native lookup for download receipts and advances the
same common baseline with native receipt/local and pinned source/remote entries.
Network, device and reviewed configuration are rechecked before native stage and
publication. Interrupted operations retain their original IDs. Two-way mode and
local deletion propagation remain disabled.

Verified: 31 selected iOS simulator tests (including real file creation/swap,
post-rename interruption/reopen, retained racing edits, symlink refusal, scope/
settings consent invalidation and the actual WK bridge refusing a read-only grant
then publishing with synthetic consent); 91 shared sync tests; targeted lint and
full web/Vercel packaging. The native tests use disposable files and synthetic
owner/consent verification. They do not establish authenticated cloud-to-native,
OS prompt click-through, physical-device/provider or actual process-kill/reboot
acceptance. Those manual checks remain open, as do Android/Mac publication,
background scheduling, Photos, peer sync, retention and conflict resolution.


## Installed iOS download and process-exit acceptance — 2026-10-17

The real iPhone 17 Pro / iOS 26.5 app was authenticated through normal login with
a disposable loopback account. CUA operated production Things pairing, the Files
folder picker, connection editor and native Cancel/Allow downloads controls. No
native grant, approval, pairing response or transfer receipt was injected.
Cancellation left the empty selected folder unchanged. The download completed
for `hello.txt` (17 bytes) and `nested/sample.bin` (8 MiB + 17 bytes), independently
matching cloud fixture SHA-256 values. A repeat finished; a new cloud revision
(8 MiB + 31 bytes) replaced the binary. Its new hash matched, the displaced
original retained its hash/inode privately, and the unchanged file retained its
inode/mtime. Completed progress survived app relaunch. The opt-in installed
XCTest finished with zero failures after external byte verification.

A separate opt-in XCTest deliberately `_exit(77)`s after native rename and before
receipt persistence. Fresh-process verification passed create, replacement and
local-edit-before-recovery scenarios, preserving operation identity and both
versions where required. This closes actual process-exit acceptance for the
simulator's same-volume local provider, not reboot/power-loss acceptance.

The real UI exposed overlapping periodic/foreground pairing checks and a
misleading cancellation message. The shared bridge now serializes independent
requests, permits queued cancellation without cancelling another caller, and
refuses queued dispatch after origin/bridge changes. Native cancellation has a
distinct readable error. Regression coverage exercises those queue boundaries.

Physical devices, additional Files providers, wide-layout acceptance, Android/Mac
publishers, background workers, Photos, peers, conflict/restore controls and
retention remain open. Existing history/Timeline and editable connection formats
remain unchanged.

Build 33 follow-up: changing the saved connection required fresh native consent;
Cancel displayed the corrected message, and approved retry completed without a
polling collision. Installed executable, debug dylib and Info.plist hashes match
the build; codesign verification and the running app path were checked. The
updated process-exit runner passes all three scenarios, 31 selected native tests
pass, 91 shared sync tests plus four pairing/queue tests pass, targeted lint and
full web/Vercel build pass. TypeScript remains at 91 existing diagnostics / 47
normalized messages, with no additions.


### Android private staging and real process-exit recovery (2026-10-17)

`SyncStaging` implements the shared mobile request/progress/stage shapes with
owner/origin/device/connection/native-grant bindings. Each authenticated bridge
call resolves the current account's readable grant; staging never writes to its
provider. App-private no-backup storage uses bounded 64 KiB chunks, fsync before
atomic progress acknowledgement, exact replay checks and full SHA-256/canonical
multipart verification before returning a stage. Empty folders and multipart
files retain the required explicit null digest field. Symlinks, nonregular
payloads, changed operations and corrupted stages fail closed. A cancellable
in-process lock prevents a waiting caller from opening/closing another lock
descriptor; the kernel lock also excludes other processes.

Two opt-in Android 15 / API 35 scenarios kill the real instrumentation process:
after byte fsync before its checkpoint, and after a finished-stage checkpoint.
Fresh processes preserve the operation, resume only acknowledged bytes, verify
8 MiB + 17 bytes and pass the production TypeScript response codec. Proofs are
bound to a fresh runner ID so stale crash evidence cannot satisfy another run.
The normal JVM suite passes 24 tests. The normal emulator suite executes 23
tests, including live API pairing/installed bridge checks and 13 staging tests;
the opt-in process test is skipped there and runs separately. Debug build and
lint pass; 91 shared sync tests pass; TypeScript diagnostics are exactly the
previous 91 existing diagnostics, with none added.

The installed bridge advertises staging separately from publication and accepts
a full 64 KiB chunk envelope before rejecting a missing grant. This verifies
transport/authorization dispatch, not a successful system-picker staging run.
Android 8.0 runtime compatibility, real picker staging, low disk/reboot/physical
acceptance, native write consent, safe provider publication and retained conflicts
remain open. Android Download now stays disabled. No new secret, collection or
parallel history/settings format was introduced. Reproducible commands and
cleanup are in the Android and root READMEs. The full goal remains in progress.

### Android native write approval and actual picker acceptance (2026-10-17)

Android now implements the shared `write-approve` contract with a native dialog,
exact-tree OS write selection and fresh account verification. Keystore-encrypted
approvals bind account/origin, remote root/device, configuration revision/hash
and the native selection generation. Choosing the same URI again invalidates
old consent; another account's references remain intact. Failed saves cannot
leave a new persisted write grant or revoke an existing shared grant. Reacquiring revoked OS write access clears every older approval for that tree,
including other accounts and connections. Native checks reject malformed fields and unavailable/revoked OS access.

The installed Android 15 / API 35 app passed actual picker selection, native
Cancel, same-folder write Allow, encrypted reload, identical approval retry,
changed-configuration Cancel and native re-selection invalidation. The test
removed all its folder references and verified OS read/write grant release.
The suite reports `OK (28 tests)` with one opt-in process scenario skipped:
27 tests executed, including the live account/bridge test, seven registry tests,
three Keystore tests, three provider tests and thirteen staging tests. All 26
JVM tests, debug build and Android lint passed.

A separate read-only local-provider descriptor probe opened the directory but
relative child access returned `EACCES`. Generic SAF does not promise exclusive
atomic rename or conditional replacement, so Android still advertises private
staging only; Download now remains disabled. This checkpoint is consent, not
publication acceptance. Android/Mac receivers, retained conflict recovery,
background scheduling, Photos, peer sync, rename/delete convergence, scalable
roots, physical/reboot acceptance and release delivery remain open. The full
goal remains active. Fork-safe commands are in the Android and root READMEs.

### Android offline-folder publication backend (2026-10-17)

`ManagedFileStore` adds the native storage backend for Thingtime-owned offline
folders. It does not yet expose those folders in Android Files or enable the
Download now control. Existing arbitrary SAF selections remain read/staging
only; their providers are not assumed to support atomic replacement.

The backend copies a completed stage through a read-only descriptor while the
staging lock is held, verifies both the copied content and unchanged source,
fsyncs the immutable candidate and its directory, then atomically commits the
visible entry and immutable receipt in a synchronous SQLite transaction. It
uses the existing shared request/entry/receipt formats. Editable connection
Things and Timeline remain authoritative; this is a bounded native filesystem
adapter, not a new cloud data plane or settings/history model.

Conditional replacement checks the exact previous entry and its actual bytes,
retains the old blob/version, and changes ancestor stamps. A repeated operation
returns its historical receipt without rewriting a later edit. Owner/origin,
managed root, selected grant, connection/device scope and immutable request
remain bound. Case/Unicode aliases, missing parents, forged stages, changed
source/target bytes and symlinked blobs fail closed. Two concurrent creates
produce one visible file and one successful receipt. Uncertain commits never
trigger blob deletion; unreferenced candidates are retained pending a bounded
cleanup implementation.

Validation on Android 15 / API 35: seven native backend tests plus the new
stage-copy mutation test pass; the full fixture-backed run executes 35 tests
(`OK (37 tests)` includes two skipped opt-in process tests). All 26 JVM tests,
debug build and Android lint pass. Three actual process kills before commit,
after commit and after replacement verify rollback/replay in a fresh process,
all 8 MiB + 17 bytes, retained old content, and receipt replay after a later edit.
The actual native receipts pass the production TypeScript mobile codec. Helper
lint passes; full TypeScript still reports the same 91 baseline diagnostics,
with none added.

Remaining integration: Android DocumentsProvider exposure, explicit native root
creation/removal, per-folder publication capability, current native approval
checks and foreground download controls, followed by installed-app cloud-byte
acceptance. OS Files edits, restore/retention, background workers, large-root
partitioning, provider/physical-device/reboot tests and the rest of the full
Drive/Photos/Resilio goal remain open. The current backend has a 10,000-blob
safety bound and fully verifies reads; it is not the final large-file transport.


### Android offline folders in Files (2026-10-17)

Native **Choose folder → New offline folder** now creates a named local root
with explicit disclosure of Android Files visibility, sign-out behavior,
selected-document access by other apps, access removal and uninstall. Existing
SAF selections keep their own flow. The new root opens at its canonical path
in the system picker and is bound to its creating account/origin for Thingtime
selection. Selection does not start a transfer.

`OfflineDocumentsProvider` exposes only explicitly consented roots behind
Android's `MANAGE_DOCUMENTS` permission and URI grants. Indexed, opaque document
IDs remain stable across replacement; ancestry checks prevent cross-root or
sibling access. Read-only verified snapshots preserve old open readers. Write,
rename, delete and external editor operations remain unsupported. Catalog v2
adds native document/parent indexes and Files visibility in an atomic migration;
existing v1 roots stay private. Listings reject more than 10,000 children or
4 MiB of metadata. Native paths and owner identifiers are not projected.

Installed Android 15 / API 35 acceptance verified creation cancellation, native
creation, actual Files selection, complete 8 MiB + 17-byte nested content through
ContentResolver, bridge scan and **1 file checked**, visual Files navigation,
and non-destructive access removal. The first manual attempt timed out before
selection; the successful retry reused that empty root. Test cleanup now proves
the selected root is empty before taking ownership, and deletes only its
synthetic root/blob fixtures. An ungranted shell UID was denied root discovery.

The successful manual suite reported `OK (43 tests)` (41 executed, two opt-in
process tests skipped). Final production source, including the listing budget,
passed `OK (44 tests)` (42 executed, two skipped), with seven provider tests,
26 JVM tests, debug build and lint. All three actual process-exit publication
scenarios passed again after migration, with native receipts accepted by the
production TypeScript codec. No TypeScript source changed in this checkpoint.

Android Download now remains disabled until per-root publication negotiation,
current native approval checks and managed scan/read/publication dispatch are
connected. No cloud-download claim is made from synthetic native publication.
Root deletion/retention, writable Files edits, large-root performance, physical
and API 26 devices, reboot/power loss, background scheduling, Photos, peer sync,
Mac receivers and complete convergence/release acceptance remain open. The full
goal remains active. Fork-safe setup and manual confirmation steps are in both
READMEs; no new secret, service or broad storage permission is required.


### Android foreground offline-root download integration (2026-10-17)

Android publication bridge 1.1.0 now connects the existing configured foreground
runner to explicitly created offline roots. `ManagedFolderAccess` validates the
saved grant generation, canonical native root, account/origin ownership and OS
read permission. Native consent is bound to the saved connection revision/hash
and device scope, persisted separately from generic-provider OS write approval,
and checked again before publication. Native catalog scan/read versions and
receipts share the existing TypeScript contract. Generic SAF folders never gain
the per-root publication capability. The client negotiates it again before
approval; legacy iOS publication 1.0 remains compatible.

An installed Android 15 / API 35 run downloaded the real private cloud fixture
through **Download now**, after cancellation and native reapproval. Independent
ContentResolver SHA-256 checks matched the 17-byte text and nested 8 MiB + 17-byte
file. A second transfer completed and passed the byte checks; the initial harness
then hit an object-only canonical serializer when comparing arrays. The test now
compares canonical entries individually. The final rerun passed native entry equality, visual Files navigation and
non-destructive grant removal. The Android suite reported `OK (48 tests)`
(46 executed, two opt-in process cases skipped); 26 JVM tests, debug build and
lint also passed. Cloud fixture cleanup retained accounted versions in private
Trash; the temporary local upload-seeding configuration was restored byte for
byte before download acceptance. This is emulator evidence, not a throughput
benchmark or physical-device acceptance.

The first run stopped at the cloud ETag check. Direct same-origin API reads
returned the expected headers. Version-pinned range, fingerprint and actor-scoped
requests were eligible for media-worker interception; they now bypass it,
including no-store requests. The subsequent installed transfer succeeded. The
regression exercises the real worker's refusal to intercept these requests;
normal media caching remains covered. HTTP download failures now report their
status rather than being mislabeled as version changes. No version/byte checks
were relaxed.

Four new native adapter tests cover scope isolation, approval reload/revision,
reselection/removal/OS revocation, failed persistence and revocation during copy.
Shared sync tests pass 93/93; media-cache tests pass 7/7. Targeted ESLint passes
(the Node media test needs its Node/ES2021 environment); full TypeScript still
reports 91 diagnostics outside changed files, not a clean project typecheck.
No new server API, collection, secret or broad storage permission is introduced.
Connections remain ordinary editable Things and receipts use the shared journal.

This establishes a foreground adapter checkpoint. Real cloud replacement and
settings reapproval acceptance, generic providers, Mac receivers, background
workers, Photos, peer sync, deletion/rename convergence, restore/retention UI,
physical/API 26 devices, reboot/low-storage and release acceptance remain open.
The full requested goal remains active.


## Two-way foreground connections — 2026-10-17

The shared foreground runner now accepts two-way settings. The same immutable
run contains both local-to-cloud and cloud-to-native operations, preserving
preallocated identities, exact version checks, native staging, scoped consent,
canonical file versions and Timeline history. Completion recovers each side's
receipt into the common baseline. A mixed run resumes after lost replies without
repeating uploads or native publication. Native write approval and per-folder
capability are required even when the first observed plan contains only uploads;
configuration changes cannot silently grant future downloads. Deletion propagation
must remain off. Concurrent edits and delete/edit cases stop before new mutations.

The mobile connection surface exposes Sync now for eligible two-way roots. iOS
uses its existing selected-folder publication adapter; Android uses Thingtime
offline folders. Generic Android SAF roots are not writable destinations. Android
Files still exposes read-only snapshots; local fixture edits in acceptance are
made through the production native catalog and are not proof of external editing.
Mac receivers, background scheduling, native trash, conflict/restore controls,
Photos, peer transport and full cross-device acceptance remain required.


Installed Android 15 / API 35 acceptance passed the actual Sync now flow with
native approval cancellation/retry. Initial cloud text (17 bytes), nested cloud
content (8 MiB + 17 bytes) and a native upload (257 bytes) converged. Independent
edits then replaced the cloud content with 8 MiB + 31 bytes and the native upload
with 513 bytes. Full ContentResolver/download SHA-256 checks matched both sides;
the uploaded cloud file kept its identity and advanced its revision. Repeated
sync preserved cloud revision and canonical native entries. Android Files showed
the final root/nested entries; removing access preserved the four catalog entries.
Native edits used the production catalog fixture, not an external Files editor.

The suite reported `OK (48 tests)` (46 executed, two opt-in process cases skipped).
Debug build, Android lint and the 26-test JVM task passed (cached where unchanged).
Shared sync tests pass 96/96 and targeted ESLint passes. Full TypeScript has the
same 91 diagnostics as the preceding checkpoint, with byte-identical output and
no changed-file errors. Temporary local admin configuration was restored before
acceptance; cloud fixture cleanup retained accounted versions in private Trash.
Native fixture cleanup removes its active records/blobs; retained replacement
bytes and staging are not claimed to be fully erased. No production deployment,
iOS mixed-direction acceptance or full-goal completion is implied.


## Shared Apple receiver and Mac filesystem recovery — 2026-10-17

The native reader, grant store and publication implementation have moved from
the iOS target into `apple/FileSync`, a local Swift package used by iOS and
executable on macOS 13+. There is one byte verifier, conditional publication
algorithm and recovery record format. Existing iOS v1 storage paths, Keychain
service/account keys and serialized owner/grant/operation shapes are preserved.
`MobileDevicePairing.Scope` aliases the extracted owner scope. macOS bookmarks
carry security scope; iOS retains its existing bookmark/data-protection behavior.
Mac callers must supply an isolated staging path. Publication still requires a
same-filesystem destination; native hosts retain responsibility for account and
connection verification, current grant checks and explicit write consent.

Mac tests passed 22/22 against real temporary files, including the existing
folder and publication cases plus a persisted-scope compatibility regression.
The shared process fixture also passed create, replacement and post-exit-edit
recovery on macOS: each publishing child actually exited after rename and before
its receipt; a new process recovered or preserved the conflict without a second
swap. Originals and verified 8 MiB + 17-byte staged payloads were retained.
The same three scenarios passed again in separate iOS simulator processes after
the module move. The iOS focused suite passed 50 checks covering pairing, folder
access, native bridge staging/publication and origin handling; the new scope
compatibility check also passed in a separate simulator run (51 focused checks
in total). The macOS library release build passed without warnings. Existing
iOS widget/recording warnings remain outside this change; no TypeScript source
changed and its prior 91-diagnostic baseline was not rerun.

This is native core evidence, not an installed Mac transfer. The Mac app's
picker/consent, pairing-bound dispatch, real Keychain/sandbox/TCC access, cloud
transfer UI and signed acceptance remain required. No Mac helper, installed app,
LaunchAgent or user folder was changed. No server/API/storage-model change or
new credential is introduced. Background workers, Photos, peer transport,
rename/delete/conflict/restore controls, retention/selective availability and the
remaining full-goal acceptance are still open.


## Mac local host and live identity boundary — 2026-10-17

`MacFolderSync` now adapts the shared Apple core to an exact local XPC method,
with native picker/download consent, endpoint-isolated staging, owner-scoped
bookmarks, bounded scan/read/staging/publication, matched cancellation and exact
configuration approval. Generic and remotely leased commands reject this entry
point. The helper verifies the selected credential's owner/device with the live
server before and after work, and rejects local unpairing while a read is pending.

The new optional identity endpoint is device-token-only and privately uncached.
The full-user disconnect endpoint revokes only that owner's matching device
sessions in the home transaction, retaining device history/configurations/files.
An old pairing claim cannot restore a revoked credential. An already-authorized
file mutation may finish before the final identity check; revocation is not rollback.

Validation: 29 focused native tests (7 adapter, 11 API client, 11 wire codec),
Node release build, 84 device tests plus 10 route/storage-mock tests, 95 capability
tests and targeted ESLint passed. Full TypeScript has the same 91 diagnostics,
byte-identical to the prior checkpoint. Real loopback acceptance passed signed
pairing, private identity/projection, browser-cookie refusal, ignored caller IDs,
owner-only disconnect, repeated disconnect, old-token 401 and old-claim 409,
retained device history and unaffected browser account. Acceptance credentials,
including the first fixture from the failed generic-delete attempt, were revoked;
protected fixture device history remains intentionally retained. No real user
folder or installed Mac app/helper/LaunchAgent was altered.

Broader existing NodeController tests abort with TCC's missing
`NSBluetoothAlwaysUsageDescription` in the XCTest host; those tests are not counted
as passing. An initial Nitro runner readiness timeout recovered after the source
rebuild; final live acceptance used the managed worktree stack. Actual AppKit
interaction and signed Keychain/TCC are still unverified. Electron does not expose
this service yet: active browser account verification, API-origin mapping, feature
negotiation, timeouts and current run conditions remain required. Per-request live
identity and 64 KiB chunks also need native streaming/throughput work before UI
enablement. The complete original goal, including background work, Photos, peers,
rename/delete convergence, conflict/restore and release acceptance, remains active.

## Desktop folder host and shared controls — 2026-10-17

Electron now exposes a narrow main-frame-only folder request. The host verifies
its own Chromium cookie-session account before and after native work, and the
native helper independently verifies the paired device credential. The selected
API origin is host-derived; public capability negotiation is anonymous, bounded
and projected. Account cookies, navigation, renderer loss, endpoint switches and
matching cancellation invalidate pending work without retargeting its scope.

`desktopFolders.client.ts` supplies the existing folder editor/foreground runner
with the canonical server origin and host-verified capabilities. Authenticated
API requests stay on the bundled cookie proxy with expected owner, home storage
and API-origin headers. The proxy permits only the explicit desktop sync route
family; it rejects destination changes before reading or forwarding mutations.
Redirects and wrong/missing proxy response headers fail closed. Signed upload
URLs remain unchanged with credentials omitted. Generic Browser Actions remain
blocked from fallback. Mac native conditions expose only network class and
charging/unknown; complete scans and read replies now match the shared contract.

`DesktopFolderAccess` appears beside the local connection card in Things and
Settings, including when onboarding is dismissed. Candidate IDs are intersected
with the current account's device list, then freshly verified by both hosts.
Multiple candidates require an explicit choice. No second configuration schema,
cloud writer, journal format, history store or copied transfer editor was added.

Evidence: isolated Electron with real IPC sender frames and Chromium cookie
sessions passed account/proxy/subframe/cancellation checks; native dispatch was
synthetic. Browser StrictMode fixture passed folder scan, ordinary configuration
save, foreground completion and local draft reload at desktop/390px, with no
horizontal overflow. Both Mac and mobile controls were exercised. Native release
build and 251 focused checks (109 shared-sync/proxy, one module-mock transport,
111 Electron and 30 native) pass. Full TypeScript remains the identical 91-diagnostic
baseline; targeted lint has zero errors and five existing ThingsPage hook warnings.
Full web/Vercel build and packaged-output verification passed. These are separate layers,
not an installed signed Mac transfer acceptance.

At the host-controls checkpoint, release acceptance remained open: installed AppKit/Keychain/TCC and real cloud
mixed-direction transfer, current-account revocation during native operations,
large-file throughput/rate-limit work, and durable desktop restart storage. The
bundled app at that checkpoint chose a new loopback port on launch, so its IndexedDB and
local drafts cannot yet be claimed to recover across full app restarts even
though record keys contain the canonical server origin. Keep this integration
unreleased until that persistence boundary and the real-native acceptance lane
are resolved. Background workers, Photos, peers, rename/delete convergence,
conflict/restore UI, retention/selective availability and physical-device tests
remain required by the original goal.


## Desktop stable origin and restart recovery — 2026-10-17

The restart-storage gap above is now addressed in source. Electron binds its own
loopback socket and loads Nitro's `node_middleware` build. It durably publishes
one private `renderer-origin.json` per profile, then reuses that address. Startup
refuses occupied ports and malformed/non-file records without opening a window,
contacting the other server, rotating the origin or clearing stored user data.
The existing HTTP-cache clear remains; shared IndexedDB journal and draft formats
are unchanged, with canonical server/account/device/root scope isolation.

Verification uses the actual staged Nitro bundle and production shared modules
in four separate Electron processes with one disposable profile. It preserves a
partially confirmed run and pending configuration draft, recovers an uncertain
operation by its original receipt without reapplying it, and reads back the full
completion baseline on a later launch. An intervening port collision refuses
startup without a request to the other server; release of the port permits exact
recovery. Receipts are synthetic and no native transfer occurs. Unit coverage
also checks corrupt/oversized/symlink/non-file records, competing first starts,
bundle failure cleanup and independent profiles. The installed profile is untouched.

This does not migrate older random-port origin storage or establish power-loss,
signed installed transfer, streaming/rate-limit or background-worker acceptance.
All other remaining work in the ledger above is still required.


## Real Mac adapter/cloud transfers and cooldown recovery — 2026-10-17

The test-only `MacFolderSyncFixture` now connects production Swift folder access,
verified staging/publication and live native identity to the shared TypeScript
foreground engine and real loopback cloud APIs. It is excluded from the packaged
app; its picker/consent, conditions and credential store are fixtures, while file
bytes, server authorization, pairing proofs and operation receipts are real.

Acceptance passed mixed upload/download creates, independent replacements,
full native/cloud byte hashes, stable file IDs/revisions on repeated convergence,
retained cloud versions, lost accepted cloud/native replies, native process
restart with original IDs and no reapplication, and refusal after owner disconnect.
The browser journal in this script is fake-indexeddb; separate real Chromium
restart acceptance above covers the browser storage boundary. Cleanup signed out
the session, disconnected the fixture device, removed its config/folder Things
and private temporary directory, and retained accounted versions in private Trash
plus protected device history. No admin environment change or installed state was
needed.

The first extended run reproduced HTTP 429 from the 240/minute identity gate.
`ThingtimeAPIClient` now honors one valid integer Retry-After of 1–60 seconds,
checks task cancellation and the exact original local credential again, then
repeats the uncached identity request. It does not retry authentication failures,
invalid/long delays or repeated throttling. The final real run passed with 129
native calls, 259 verifier invocations and one server-directed 47-second cooldown;
there were exactly four upload PUTs and two native publications across create and
replacement tests. All 23 focused Mac adapter/API tests pass, including actual
Task cancellation and unpair/replacement during cooldown; targeted script lint
passes, as does the production ThingtimeNode release build. This fixes a
demonstrated recovery failure, not the throughput gap.

Signed installed Electron/XPC/AppKit/Keychain/TCC acceptance, native streaming,
background workers, Photos, peers and the other full-delivery requirements remain
open. The counts above explicitly prevent treating small-file acceptance as scale.


## Authorization waits and network deadlines — 2026-10-17

A clock-controlled regression proved that foreground native authorization was
inside the API request's 30-second timeout. A valid longer cooldown could therefore
expire an unsent mutation. Shared transports now await `authorizeMutation` before
starting the HTTP timer, then recheck scope/cancellation and upload source identity.
JSON bodies are captured before the wait; each POST/PUT still authorizes, and
caller cancellation spans the whole operation. JSON and signed-part deadlines
remain 30 and 120 seconds respectively. Shared journal/receipt contracts are unchanged.

All 105 shared checks pass; targeted lint passes and TypeScript output matches
the existing 91 diagnostics byte-for-byte. The real Mac/API acceptance's opt-in
`--cooldown-before-upload` mode deliberately consumed its disposable device budget:
preflight lasted 61,971 ms including one 50-second cooldown, then the request had
a fresh signal and completed. Mixed creates/replacements, lost cloud/native replies,
native process restart, original-ID/no-replay recovery, byte hashes, retained
versions, convergence and revocation passed (four PUTs, two publications). Its
238 native calls / 477 verifier invocations include deliberate rate pressure;
this is not a performance measurement. Signed installed acceptance, streaming,
background workers and the other full-goal work remain open.

## Mac bounded range streaming — 2026-10-17

Mac file access 1.2 connects the shared upload source to `read-range`. One
coordinated native file descriptor supplies up to 32 MiB through acknowledged
64 KiB XPC frames. Source stamps are checked between frames and the current path
is checked again at completion. The native verifier runs before/after the range,
not for each frame; no identity cache, rate-limit increase or network authority
is introduced. The existing request timeout/cancellation and exact owner,
origin, device, root, path and version binding remain. A stalled consumer has a
15-second acknowledgement limit; its disconnected helper cannot keep reading.

The signed bridge writes framed stdout with backpressure. Electron's bounded
parser rejects missing/reordered/duplicate/oversized frames and invalid final
metadata, and holds provisional bytes until the final native and browser account
checks succeed. Renderer IPC carries binary bytes rather than a giant base64
JSON message. Ordinary XPC request/reply limits stay at 1 MiB. The generic and
remotely leased node dispatchers still cannot read folders. Older Mac/mobile
bridges keep the existing chunked path; the journal and canonical file/Timeline
contracts are unchanged.

Validation: 106 shared tests, 132 Electron tests, 23 AppleFileSync tests and 11
Mac/XPC tests pass. A real anonymous XPC connection transferred 129 frames and
stopped on a refused acknowledgement. Native tests verify two live checks for an
8 MiB-plus range, late revocation, changed/replaced files, consumer refusal and
midstream cancellation. Isolated real Electron verifies binary range IPC and
refusal after account change; native dispatch there is synthetic. Native release
and production web/Vercel builds pass; targeted lint passes. TypeScript output
is byte-identical to the existing 91 diagnostics.

Real native/API acceptance with `--large-upload` passed upload/download,
independent replacement, lost replies, process restart, original-ID recovery,
full byte hashes, retained versions and revocation. It used 141 native calls,
283 verifier invocations, three streamed ranges totaling 8,388,882 bytes, five
PUTs and two publications, with one 46-second cooldown. These totals include
seeding, scans and other checks; they are not a sustained-throughput benchmark.
The fixture uses synthetic picker/consent/conditions and private credential
storage, not installed XPC/Keychain/TCC. Download staging, mobile streaming,
background execution, Photos, peers and the remaining delivery ledger stay open.

## Mac download range staging — 2026-10-17

Mac file staging 1.1 adds `stage-range` to the shared download target. The runner
passes one 2 MiB cloud range as binary Electron IPC; the signed helper receives
bounded metadata followed by raw stdin bytes, and the native staging worker pulls
64 KiB XPC frames sequentially. Metadata is capped at 128 KiB, individual ranges
at 32 MiB, and source callbacks have a cancellable 15-second monotonic timeout.
The existing signed-parent/peer checks and before/after live device and browser
account checks remain. No identity cache, new network permission or endpoint.

`MobileSyncStaging.appendStream` holds the existing record lock for one range,
validates its immutable operation, writes bounded frames, flushes payload bytes,
then saves the received offset. Old 64 KiB append calls use that same primitive.
A partial or flush-before-checkpoint failure leaves only an uncheckpointed private
tail, truncated on resume. A replay must match retained bytes. Late authorization
refusal may leave durable private progress but cannot publish into the selected
folder. Final content hashing, destination-version checks and native publication
approval remain unchanged; the journal and Timeline formats are unchanged.

All 107 shared tests, 134 Electron tests, 25 AppleFileSync tests and 14 Mac/XPC
tests pass. Tests cover partial/oversized input, sequential pull offsets, aborted
ranges, flush-before-checkpoint recovery, byte-matching replay, two live checks
for a 33-frame range and late identity refusal. Real anonymous XPC verifies the
pull protocol; isolated real Electron verifies binary staging IPC with synthetic
native dispatch. Native release and production web/Vercel builds and targeted
lint pass. TypeScript is byte-identical to the existing 91 diagnostics.

Real API acceptance with `--large-upload --large-download` passed both directions,
independent replacements, lost cloud/staging/publication replies, native restart,
original operation IDs, no byte-range replay, full hashes, retained versions and
revocation. Three staged ranges totaled 2,097,432 bytes; three upload-source
ranges totaled 8,388,882 bytes, with five PUTs and two publications. The run made
150 native calls / 301 verifier invocations and honored one 44-second cooldown.
These totals include setup/recovery and are not a throughput benchmark. The
fixture uses synthetic picker/consent/conditions and private credential storage;
signed installed XPC/Keychain/TCC, mobile streaming, persistent workers, Photos,
peers and the rest of the requested product remain open.


## Installed iOS two-way acceptance and WebKit fetch binding — 2026-10-17

A real iPhone 17 Pro / iOS 26.5 simulator run exposed a mobile regression after
Mac host routing was added: the mobile fallback copied `fetch` into the transport
object, so WebKit rejected inventory reads with “Can only call Window.fetch on
instances of Window.” `MobileSyncConnections` now calls through `window.fetch`;
the desktop host's scoped fetch remains unchanged. The editor browser fixture
uses a receiver-sensitive function so an unrelated transport receiver fails.

Build 33 was rebuilt with the explicit loopback origin and installed. CUA used
the actual Things connection editor, native folder picker and Cancel/Allow
writes dialogs with a disposable account. Cancellation preserved the local
source and published no downloads. The two-way run then uploaded 257 bytes and
downloaded a 17-byte text file plus an 8 MiB + 17-byte nested binary. Independent
edits replaced the upload with 513 bytes and the cloud binary with 8 MiB + 31
bytes. Full local and authenticated cloud-download SHA-256 hashes matched each
expected version. Cloud file IDs stayed stable, the changed revisions advanced,
and the unchanged text file kept its inode/mtime. A completed repeat retained
all cloud revisions and local inodes/mtimes. Local edits were disposable
container-file writes, not an external Files editor acceptance.

The opt-in installed XCTest passed after external byte verification (one test,
zero failures). All 107 shared sync tests and targeted ESLint passed; full
TypeScript output is byte-identical to the existing 91 diagnostics. No native
permission or pairing response was injected. This verifies foreground two-way
transfers on the simulator's local provider; external Files editing, interrupted
two-way restart recovery, settings reapproval, physical devices, mobile streaming,
background workers, Photos, peers and the remaining product scope stay open.


## Android saved-settings reapproval acceptance — 2026-10-17

The installed two-way test now revises a saved connection's name and exclusion
list through the normal revision-guarded Things API after both sides converge.
It refreshes the actual connection controls and starts Sync now, requiring a new
native approval. Cancelling must leave the complete cloud inventory and native
entries unchanged, including full local byte hashes. Allowing the retry must
converge without changing cloud revisions or native identities. Inventory
comparison canonicalizes each node and sorts the signatures, retaining all
metadata while ignoring response order. Production operation serialization is
unchanged.

This covers settings saved elsewhere and consumed by the installed Android app.
It does not establish connection-form editing, iOS reapproval, concurrent edits,
interrupted two-way restarts, background execution, or physical-device coverage.
The test still uses synthetic local edits rather than an Android Files editor.

The Android 15 / API 35 emulator run passed all 46 executed native checks, with
both opt-in process-restart cases skipped (`OK (48 tests)`), plus the 26 JVM
checks, debug build and lint. The new consent check passed after independent
257-to-513-byte uploads and 8 MiB-plus cloud replacements, repeated convergence,
and real Files inspection. No consent or grant reply was fabricated. A first
attempt exposed a test-only array serialization mistake before the reapproval
step; node-wise canonical comparison fixed it, and the full sequence was rerun.
Fixtures use normal cleanup and retain accounted cloud versions in private Trash.

## Android binary download ranges — 2026-10-17

Android staging 1.1 negotiates WebView ArrayBuffer support, using the existing
origin/main-frame restricted bridge. A native range pulls at most 64 KiB per
nonce-bound frame; the shared downloader supplies 2 MiB ranges. Account identity
and native read grants are checked before/after a range, foreground/cancellation
checks run throughout, and the staging lock spans frames plus the single durable
checkpoint. Retained replay compares all bytes; an interrupted tail is truncated
back to the acknowledged offset on resume. Final hashing and native publication
approval remain separate. No shared storage/schema or permission is broadened.
Old Android WebViews retain staging 1.0, and iOS retains its existing chunk path.

The installed API 35 app downloaded 8,388,642 payload bytes using six ranges
and 130 bounded binary frames, with zero legacy append messages and independently
verified final hashes. JVM frame tests and real Android staging tests cover
stale/duplicate frames, incorrect lengths, cancellation, timeout, multi-frame
replay and interruption before durable acknowledgement.

The complete installed two-way sequence passed independent 257-to-513-byte local
uploads and an 8 MiB-plus cloud replacement, repeated convergence, changed-settings
consent cancellation/retry and real Android Files inspection. Across both cloud
versions it used 11 ranges, 259 frames and 16,777,281 payload bytes with no legacy
appends. Cloud identities/revisions, local identities and full hashes passed the
existing assertions. Native consent and grant replies were not fabricated.
The runner reported `OK (50 tests)` (48 executed, two opt-in process-restart cases
skipped), including 16 real-filesystem staging checks; all 29 JVM checks, debug
build and Android lint passed. Shared sync tests passed 110 checks; 13 focused
transport/staging checks were rerun after the deadline change. Targeted ESLint
passed. Full TypeScript retains the same 91 baseline diagnostics with no new ones.

This establishes bounded foreground download transport on the API 35 emulator,
not a throughput benchmark. Physical devices, older WebView runtime fallback,
Android upload ranges, iOS streaming, installed binary interruption/restart,
background workers and the remaining sync product scope stay open. Fixtures use
normal cleanup, retaining accounted cloud versions in private Trash.

Installed validation exposed that the former 30-second per-chunk request deadline
was too short for a multi-frame range: a diagnostic run transferred 124 binary
frames (8,060,945 payload bytes), checkpointed earlier ranges, then stopped a
later range while still receiving frames. Range requests now use the existing
five-minute long-transfer deadline on both sides; an individual stalled frame
still fails after 15 seconds, and foreground cancellation remains immediate
between frames (at most 100 ms while waiting). No timeout or identity check is
removed. The first run also caught an outdated test capability assertion,
which now follows actual WebView binary support.

## File conflict review and guarded choices — 2026-10-17

Foreground sync now pauses at an explicit paginated conflict review. File choices
copy the selected device/cloud version through the existing conditional writer;
one-way connections retain their configured direction. A surviving file can be
restored to an absent counterpart, but the review cannot authorize deletion,
replace folders or bypass excluded descendants. Those conflicts remain visible
for repair in the source folders. Existing native approval and cloud retained
versions remain in force; restoration browsing and keep-both renaming are separate
remaining work.

Before applying choices, the runner reauthorizes the current account, device,
settings and conditions, rescans both folders and requires every reviewed conflict
to retain its exact identities, versions, content and reason. A changed or missing
conflict refuses the entire selection before journal writes or effects. Accepted
choices become ordinary immutable copy operations in the existing durable run;
retry uses those same operations without asking for a different choice. No new
schema, permission, storage collection or parallel history is introduced.

All 116 shared checks pass, including stale-review races and durable choice
recovery. The real local API test verifies cancellation/stale review without
writes, an accepted choice with lost commit/reopen, no duplicate prompt/upload,
stable file identity, exact hashes of both retained versions and repeat convergence.
Its native adapter is synthetic. Browser checks exercise the production connection
control with synthetic APIs: 22-conflict pagination, incomplete-choice gating,
stale cloud revision refusal, Cancel review and Stop transfer. Measured 390px and
1280px layouts have no horizontal overflow; the long filename wraps on the phone.
Targeted TS/TSX ESLint passes; the existing ESLint parser does not support the
`.mts` integration script (it fails on its pre-existing typed fetch declaration).
Full TypeScript retains exactly the prior 91 diagnostics.

Installed Android 15 / API 35 acceptance passed cancellation with unchanged cloud
inventory and native entries, then separate cloud-winner and device-winner rounds
through the real review controls. Both rounds independently hash native and cloud
bytes and repeat sync without changing native entries. Settings reapproval,
initial/replacement downloads and Android Files inspection also pass. The runner
reports `OK (50 tests)` (48 executed, two opt-in restart cases skipped); 29 JVM
checks, debug build and lint pass. The complete sequence transferred 12 binary
ranges, 260 frames and 16,777,314 bytes with zero legacy appends. Edits are synthetic
fixture setup in a real selected native folder, not external Files editor coverage.
Fixture cleanup succeeded; accounted cloud versions remain in private Trash.
Signed Mac, iOS and physical-device review acceptance remain pending.

The review includes muted grey reassurance that ignoring the conflict preserves
existing data in its current folders. It deliberately does not promise retrieval
by a content ID before retained-version browsing exists. When one copy is missing,
it refers to existing data rather than claiming two copies exist. The final copy
was checked in the browser at 390px and 1280px, with no horizontal overflow.

## Retained cloud file History — 2026-10-17

The shared Timeline now renders before/after retained file versions. It exposes
canonical multipart content IDs and the existing authorized attachment download
route. File Things open home history. Restore reviews the current file, keeps its
current name and folder, takes it out of Trash if needed, and uses the existing
revision-guarded file commit API. A small account/origin/file-version-scoped local
command is persisted before POST; reopening that version retries the same operation.
Canonical file history and bytes remain in Timeline and accounted attachments.
Completion validates the owner/file/operation-derived receipt ID, exact attachment,
size, fingerprint and reviewed placement before retiring the pending command.

Browser fixture acceptance covers Cancel, a concurrent edit refusal, fresh review,
an accepted-write/lost-reply/reopen retry with one write, and an account change
during a delayed read. Layout was measured at 390px and 1280px without overflow.
The fixture is `remix/scripts/file-history.browser.html`; it uses the actual shared
version card and API client with synthetic responses. This does not establish
installed native downloads or restore, cross-folder content-ID lookup, or durable
retention of ignored native conflict copies. Those remain in the full goal.

Real HTTP acceptance passed after the managed worktree stack was restarted and
Nitro finished warming: same stable file ID, current name/folder preserved on
restore, exact serialized retry, both retained byte hashes, independent content
IDs, Timeline projections, stale/concurrent writer refusal, and anonymous denial.
The synthetic file was moved to private Trash with accounted versions retained.
The direct API-port diagnostic correctly refused a signed upload URL belonging
to the configured web origin; no origin guard was relaxed. Early runs hit Nitro
runner readiness errors, so only the final successful run establishes acceptance.
121 shared file-sync tests and nine focused file-history/scope tests pass;
targeted lint passes. Full TypeScript matches the same 91 baseline diagnostics.
The conflict review now links each cloud file to its home History, with measured
390px layout and cancellation preserving both folders. Installed native restore
and downloads are still unverified.

## Installed file History follow-up — 2026-10-17

The real app uses React StrictMode; its effect replay exposed a dormant restore
control because cleanup marked the card inactive without setup restoring it.
The card now reinstalls its current enabled state and identity subscription
together. Abort and account fences remain in place. The browser fixture now
uses StrictMode too, with verified Cancel, lost-reply/reopen/exact-retry and
delayed-read/account-change checks.

Shared History cards also recognize validated canonical file snapshots, retain
the historical filename and participate in Files and filename filters. A
regression failed with the generic “Thing” title before the fix. The 239 Timeline
tests and 19 focused history/scope tests pass; targeted lint passes. The full
TypeScript output matches the same 91 baseline diagnostics.

Android's opt-in `THINGTIME_FILE_HISTORY_TEST=1` seeds two private file versions
and exercises the real History screen through the existing installed-app
runner. It distinguishes full authorized byte reads from native export; the
WebView has no download handler yet. At that checkpoint, native export and universal
content-ID retrieval remained unfinished work.

Installed API 35 Android acceptance passed against the real local API: two
retained versions appeared in Files/filename History filters, Review and Cancel
left the revision unchanged, Restore committed the earlier attachment, and both
complete byte hashes still matched. The debug runner finished `OK (50 tests)`
(48 executed, two opt-in process-restart checks skipped), with build, JVM tests
and lint passing. Both APKs were reinstalled and the app relaunched. One earlier
login attempt returned a transient 503; the successful run followed without a
server restart or weaker authorization. Native export was outside that checkpoint; the subsequent Android export acceptance is below.

## Android historical file exports — 2026-10-17

`fileExportVersion` 1.0.0 connects the shared History **Save this version**
action to Android's system Save As picker. `AttachmentExport` reuses the native
sync-entry validator, checks the exact attachment identity and fingerprint, and
streams authenticated 2 MiB ranges into private cache. HTTP redirects and
unexpected range framing are rejected. `FileExportBridge` rechecks identity
before provider writes and verifies the saved document's complete multipart
fingerprint before replying. No sync connection, broad storage access, raw URL
or persistent folder grant is introduced. Picker responses have distinct request
codes; cancellations remain accepted while the picker pauses the activity.

The user chooses the destination and filename. Cancel, navigation, account or
session changes abort the request. A provider interruption can leave a partial
new document; the UI says to check Files and never silently retries a save.
Private staging is removed after completion/cancellation and stale staging is
cleared on activity recreation. This is foreground export; resumable background
export, iOS/Mac native export, physical-device/provider coverage, and universal
content-ID retrieval remain open.

Focused client tests cover support negotiation, account/origin/request matching,
exact version receipts, cancellation and late callbacks. Native JVM checks cover
multi-range/multipart streaming, saved-byte readback, truncation, corruption,
extra bytes, cancellation, unsafe names, changed identity, redirects and headers.
Installed acceptance uses the existing History fixture with the additional
`THINGTIME_FILE_EXPORT_TEST=1` flag; instructions are in `android/README.md`.

Installed API 35 acceptance passes Cancel, sequential Save As of both versions
under the same suggested name, provider readback, reviewed restore, and retained
cloud-byte verification. Independent ADB pulls confirm 128 bytes of value 11
(SHA256 `b7b51001618538e6d5f1737784b97e278b90e56bcfae909b92c631d930fb0552`)
and 257 bytes of value 22 (`48b5c09d2ff719f6df7e93734e1beda6ef2fc119b238a0950bdeb38a9b5b8af1`).
The system picker preserved the first file and added `(1)` to the second name.
The installed runner reports `OK (50 tests)` (48 executed; two opt-in restart
cases skipped). Native JVM coverage is now 35 passing checks; targeted lint
passes and TypeScript still matches the same 91 pre-existing diagnostics.

The first installed runs exposed an overbroad session fence: comparing the full
Cookie header could stop export when unrelated browser cookies changed. The
adapter now pins only the exact `tt_auth` credential used by the server, rejects
missing/duplicate credentials, and still checks the live owner after the picker.
Unit coverage distinguishes cookie reordering/preferences from changed auth.
Native error guidance now reaches the shared History error display. Earlier
readiness failures during web rebuilds and the failed zero-byte exports were
not accepted as success; the successful run used a stable managed server.

## iOS historical file exports — 2026-10-17

The iOS shell now negotiates `fileExportVersion` 1.0.0 for the shared History
**Save this version** control. `FileExportBridge` accepts only main-frame,
current-origin requests, pins the exact authentication cookie, negotiates
`api.auth-me` and `api.attachment-content` 1.14.0, and rechecks the live owner
before and after the Files destination picker and after the save. Unrelated
cookie changes do not cancel work; account/session, navigation, background,
explicit cancel and deadline boundaries cancel pending work.

`FileVersionExport` in the shared Apple package validates the existing sync
fingerprint contract, reads bounded 2 MiB exact-version ranges into request-owned
private cache, and verifies bytes before exposing the destination picker. The
picker grants access to one chosen folder for this save, with no bookmark or
persistent sync grant. A coordinated 64 KiB copy is flushed and verified before
exclusive publication; existing names and symlinks receive a collision suffix
instead of replacement. The saved file is read back before success. Failure
after publication preserves the file and tells the user to check Files before
retrying. Normal completion/cancellation removes private staging; process-crash
cache reclamation and resumable background export remain separate work.

Validation: 30 AppleFileSync tests and 29 selected iOS bridge/device/destination
regressions pass. A rebuilt, installed iOS 26.5 simulator app passes real API and
manual/CUA History acceptance: cancel without writes; save both versions into
the same selected folder; preserve the first filename and create `(1)` for the
second; cancel restore without changing the current revision; restore the
earlier version and independently read back both retained cloud versions.
Independent destination reads confirm 128 bytes of value 11 and 257 bytes of
value 22. Initial fixture setup used uppercase Swift UUIDs, which the existing
file-commit contract correctly rejected; the fixture now generates canonical
lowercase IDs. The successful test uses normal APIs throughout and moves its
synthetic cloud file to private Trash; local exports remain available for inspection.

This proves the installed simulator's local Files provider, not physical iCloud
or third-party provider behavior. Installed account-switch/revocation while
saving, low-storage/process-kill scenarios, Mac native History export/restore,
native retained-version browsing, cross-folder content-ID lookup and durable
ignored-conflict retention remain open with the broader sync ledger.

## Android binary upload ranges — 2026-10-17

Android now advertises `fileAccessVersion` 1.4.0 when its installed WebView
supports binary messages; older WebViews keep 1.3.0. The shared upload source
negotiates `read-range` and keeps the existing base64 path for older hosts.
A range is bounded to 32 MiB (the upload executor normally reads smaller
ranges), verified natively, then delivered as at most 64 KiB binary frames.
Frames bind a request UUID, a fresh acknowledgement nonce and relative byte
offset. Only one frame is outstanding; stale acknowledgements are ignored,
malformed acknowledgements fail, and a missing acknowledgement times out.
JavaScript returns bytes only after every frame and the exact final metadata
match. Cancellation removes the listener and suspends the exact native request.

SAF range reads reuse the account/root/version-scoped chunk proofs from a full
scan and read one provider stream per range; cache misses revalidate the whole
file. Managed offline ranges verify their immutable blob and current catalog
entry before returning bytes. Both paths retain the full source verification
before cloud publication. The native owner is rechecked before disclosure;
every frame checks the selected grant, foreground generation and pinned auth
cookie. No provider URI, filesystem path or credential enters a frame.

This is foreground bounded-range transport. It does not establish background
sync, iOS binary transfer, restart-resumable native upload sessions, generic
provider publication or physical-device performance. The managed adapter still
hashes the full blob for each range, and one verified range is buffered natively.


Installed Android 15 / API 35 acceptance passed the real SAF picker and shared
Upload now control for an 8,388,625-byte file. It used two binary ranges and
129 frames with zero legacy multi-byte reads. An independent cloud download
matched the original full SHA-256. The complete runner passed 49 executed checks
with two opt-in process-restart cases skipped (`OK (51 tests)`). Both installed
APKs match the final build hashes and the development app was relaunched.
The first run timed out on an obsolete “Last upload finished” test predicate;
the corrected assertion uses the current shared “Last transfer finished” status
and the uniquely named new connection, so another completed card cannot pass it.
Process-scoped counters now identify transfer-stage progress without logging bytes
or credentials. The synthetic cloud file is retained in private Trash after cleanup.

Final verification: 127 shared file-sync checks and 39 JVM tests pass, with Android
build/lint and targeted ESLint passing. TypeScript remains at exactly the same
91 normalized baseline diagnostics. The screenshot captures the installed control
showing completion; this run is functional emulator acceptance, not a sustained
throughput benchmark or a physical-provider test.


## iOS native cloud download ranges — 2026-10-17

iOS staging capability `1.2.0` receives cloud file ranges directly with
`URLSession` on the supported iOS 17+ deployment target. JavaScript sends the
pinned file descriptor and range; file bytes stay native. The shared planner,
journal, source validation, final fingerprint, consent and atomic publication
remain the same. Each native request bounds its body to 2 MiB and stages in
64 KiB slices. The bridge uses the existing five-minute operation deadline
while each HTTP request retains its 30-second timeout and cancellation.

`NativeFileSession` is shared by sync and explicit History exports. It pins the
exact selected-origin WebView session, sends expected-owner/home headers,
disables cookie/credential/cache persistence, refuses redirects and checks the
current cloud file before and after each range. Account, origin, foreground and
folder-grant changes cancel work. Native WebKit cookie changes did not reliably
notify observers in the simulator; a 250 ms identity check now also cancels
network/picker waits, with immediate identity checks at every read boundary.

Installed iOS 26.5 simulator acceptance exercised the real folder picker, native
write consent and shared Download now control. An initial 8,388,625-byte file
matched the fixture SHA-256; the replacement 8,388,639-byte file and the unchanged
17-byte sibling matched independent downloads through the real cloud API. A
repeat sync preserved both file inodes, modification times and full hashes. The
installed test passed with 11 native ranges, 16,777,281 bytes and zero legacy
base64 appends. This is foreground functional acceptance, not a physical-device
or sustained-throughput benchmark.

The shared suite passes 128 checks; Apple package checks pass 30 and focused iOS
transport/export/folder/staging checks pass 30. Targeted ESLint passes. Full
TypeScript still has the identical 91 normalized baseline diagnostics. Older
hosts and non-cloud sources retain the existing byte transport. iOS uploads,
background workers, Photos backup, native retained-version browsing and durable
ignored-conflict snapshots/content-ID lookup remain unfinished.


## Whole-backup snapshots and Timeline recovery — requested 2026-10-17

The active goal now also includes Time Machine-style file history/restore in
Thingtime's Timeline and a complete independent backup of the selected data at
a saved point in time. A snapshot must support restoring one item, a folder or
the whole dataset, including 100 GB and 100 TB scale, with a future path to
physical USB/hard-drive delivery. This is required scope, not delivered behavior.

Default scope pending user preference: all owned Thingtime content and stored
files, plus only device folders explicitly selected for backup. Do not silently
scan device storage, export service credentials or copy other owners' content
merely because the account can view it. Show coverage and omissions before
starting, and make shared references, external links and offline devices explicit.

Current foundations are the canonical local/remote Timeline event/link/snapshot
contracts, `fileVersions.ts`, the conditional file writer and retained attachment
versions. The shared Timeline History control already reviews/restores a file
version and exports its exact bytes. However, per-Thing snapshots and attachment
retention are not a whole-account backup. The existing attachment ZIP is limited
to 500 files / 2 GiB, and a single Timeline version export has a 4 MiB ceiling.
Neither path may be relabelled as a 100 TB restore or enlarged without a new
streaming/resume design and evidence.

Required implementation and acceptance:

- Keep snapshot lifecycle events in the existing private Timeline folder and
  reuse canonical local/remote record formats. Use relational manifest entries
  and bounded pages/parts, never an accumulating array on the snapshot Thing.
  Link each item to its exact Timeline revision, content ID, original placement,
  metadata and byte fingerprint. Preserve portable metadata and safe path mapping.
- Establish a server-authoritative point-in-time boundary and a complete
  inventory for that boundary. A long live scan is not an atomic snapshot.
  Historical reconstruction requires a verified baseline and writer coverage;
  sources lacking it must be captured explicitly and report their actual capture
  interval. Offline/unreadable/changing device sources stay incomplete, never
  silently omitted from a successful total backup.
- Seal only after every manifest entry and byte range is durably retained and
  verified. Backup content must survive source edits/deletion, sync disconnect,
  live-storage cleanup and original-object loss. Use an independently managed
  backup destination/copy with explicit retention and recovery, not just pointers
  to current attachments. Deduplication is allowed only with durable references
  and lifecycle fencing; snapshot deletion must not remove another backup's data.
- Support on-demand snapshots and user-configured schedules/retention, quota
  admission, progress, pause, interruption and idempotent recovery. Keep partial
  captures distinguishable from sealed snapshots and retain the original job
  identity after uncertain acknowledgements. No fixed schedule is selected yet.
- Restore through reviewed, non-destructive plans and conditional native/API
  writers, recording the new changes in Timeline. Offer a separate destination
  and preserve newer files/conflicts; a restore never erases later history.
  Test complete recovery after deleting/replacing the original live dataset.
- Provide resumable large exports with bounded memory, paged manifests and
  independently verified chunks/volumes. Do not make one browser blob, one huge
  in-memory ZIP or one serverless request. Persist range/checksum progress across
  crashes, expired credentials/URLs, network loss, disk-full and device restarts.
  Prove counters and manifests at 100 TB scale separately from actual transfer
  throughput; small fixtures cannot substantiate a 100 TB transfer claim.
- The portable sealed export format should also drive future physical-media
  preparation: integrity report, encrypted media, recipient/key handoff and
  verified completion. Shipping, payments and fulfillment are future services;
  do not expose an order action before they actually exist.

Next implementation boundary: canonical sealed snapshot/manifest and durable
job contract plus owner-scoped API, followed by independently retained bytes,
Timeline UI and resumable native export. Validate source-loss recovery before
calling this a backup. Existing file history and the iOS transfer checkpoint do
not complete any whole-backup acceptance item above.

## Retained alternate file versions — 2026-10-17

`api.files` 1.3.0 adds `kind=retained-version` to the existing file write contract.
It requires the exact reviewed live revision/name/folder, an owned ready upload,
`trashed=false` and a durable operation ID. The ordinary attachment admission,
quota, object-version, ownership and moderation checks apply. A transaction binds
alternate bytes to the existing file and appends a canonical Timeline **effect**
with both snapshots. The live file and Published branch head remain unchanged.
A bounded root token serializes retention with live publication/deletion without
advancing the visible modification date. No new history collection is introduced.

Read the immutable receipt using `id`, `operationId` and
`kind=retained-version`; retry the exact original payload after an uncertain reply.
Normal commit and retention receipts have separate identities. An accepted replay
survives later edits and does not repeat byte verification or accounting. The
existing History file cards expose content IDs, download and reviewed restore for
these server-authored retention effects. Restore still creates an ordinary new
live revision using the current placement and expected revision.

Real local HTTP/object-storage acceptance verifies no live change, concurrent
retention/publication, retained replay after later edits, restore and independent
hashes of every retained attachment. Unit checks cover privacy, stale placement,
rollback and forged receipt refusal. The conflict-review UI now calls this operation through the shared native-source
upload transport and durable journal, as described below. Installed capture
acceptance and cross-folder content-ID lookup remain required.
No independent backup or source-loss recovery of an uncaptured device file is
claimed. Whole-data snapshots remain the scope defined above.


## Save conflict versions and ignore — 2026-10-17

For conflicts between two existing files, the shared conflict review now offers
**Save versions and ignore**. It uploads the device version to the existing
file's private Timeline and retains the cloud version without replacing either
live file. The muted message explains content-derived IDs and later download or
restore. Only a fully acknowledged capture shows the saved confirmation and a
link to Timeline's Files view. Cancel does not upload anything. Folder/type and
missing-file conflicts cannot use this action.

Capture persists a version-2 run with explicit `retain-conflicts` intent in the
existing scoped sync journal before any upload. Version-1 clients reject this
format, and normal sync execution/checkpoint completion rejects retention runs.
Capture never advances the common sync baseline. Repeating capture for the same
reviewed pair reuses its original receipts; a later sync still reviews the
unresolved conflict. Existing native source adapters, multipart fingerprints,
account/configuration checks and `api.files` 1.3 negotiation are reused.

Real local API/object-storage acceptance verifies a lost accepted response,
journal reopen, recovery after the captured source becomes unavailable, unchanged
live bytes and baseline, both independent byte hashes, and repeat receipt reuse.
Five focused regressions additionally cover cancellation, changed account/settings,
changed review, journal failure and separation from normal sync execution.
The browser renders the production popup at 390px and 1280px without horizontal
overflow, with muted text and wrapped 40px action controls. Browser input delivery
failed for both existing Edit and Upload controls during this run, so the rendered
review fixture proves layout only; full interactive and installed capture
acceptance remains open.

Uncaptured changed/missing sources retain their pending run and fail closed;
explicit abandonment/re-review of such a run remains future work. Capturing one
pair does not provide a complete backup, cross-folder content-ID search or a
100 TB export. The whole-backup requirements above remain active.

## Portable backup foundation — 2026-10-17

The [portable vault engine](portable-backups.md) now freezes a supplied ordered
inventory into bounded hash-linked pages, independently retains verified byte
chunks, resumes capture/export from durable receipts and seals only after full
retained-byte verification. Canonical Timeline snapshots remain the metadata
contract; a small completion descriptor is ready for the existing Timeline
writer, which is not wired yet. The offline CLI verifies/copies a vault and
restores one file to an explicit non-overwriting destination.

Real filesystem tests delete the original and then the first vault, recovering
byte-identical output from the second copy. The real API fixture captures one
explicit file through existing authenticated ranges, then recovers after source
Trash and loss of its first vault. Metadata tests cover exact 100 TB/10 PB totals;
no actual transfer at those sizes is claimed. Full account/device inventory,
independent cloud storage, jobs/quota/retention, Timeline lifecycle, product UI,
remote export and physical-media encryption remain unfinished. The whole-backup
requirements above remain active.

## Cloud folder backup worker — 2026-10-17

The portable engine now has an authenticated real cloud source and explicit
`backup:cloud create/resume` entry point. It freezes the complete selected Files
tree, including empty folders, and captures exact retained versions after live
edits/Trash without re-enumerating on resume. Session/account/origin checks and
full byte verification precede the completion marker; credentials stay out of
snapshot data. Scope is clearly one filesystem tree, with the existing inventory
bounds, not all account Things or an account-wide point-in-time promise.

Eleven backup tests, targeted lint, focused CLI TypeScript and real API/CLI acceptance
pass. The 17,825,809-byte fixture first captures saved bytes after live Trash,
compares their full hash and repeats CLI resume with zero new captured bytes.
The full TypeScript check matches the 91 existing normalized diagnostics. An
initial real-API run exposed `/auth/me`'s `{ user }` envelope; the worker and its
regression fixture now follow that actual contract.

Whole-account inventory, protected cloud jobs/quotas, independent cloud replicas,
scheduling/retention, Timeline backup lifecycle, native consent/UI, multi-item
restore and physical-media preparation remain unfinished. Session configuration
is an explicit worker setup, not a completed user login or native backup flow.
See [setup and recovery](portable-backups.md#cloud-folder-capture).

## Reviewed backup tree restore — 2026-10-17

The portable vault now restores a reviewed selected filesystem tree, including
empty folders, into a fresh private recovery container. Its CLI exposes
`plan-tree`, `restore-tree` and `resume-tree`; the review binds snapshot metadata
and the destination. Bounded lazy manifest/range iteration avoids rescanning the
entire backup for each file. Durable 8 MiB staging receipts survive process exit;
resume validates saved ranges and completed output without rereading source
chunks. Exclusive file publication preserves user edits and existing paths.
Completion checks require every planned folder/file and unchanged verified bytes.

Seventeen backup tests, targeted lint and focused CLI TypeScript pass. Real
API/CLI acceptance restores the 17,825,809-byte retained file and empty folder
after live Trash, verifies full output hashes and repeats resume without a
rewrite. A real child process exits after a synced range and the next process
recovers its dead candidate. The full TypeScript check remains at the same 91
normalized baseline diagnostics. The first new test run exposed only a fixture's
wrong empty-directory cleanup call; the corrected test passes.

This uses an explicit private single-host POSIX recovery directory with per-file
publication; a partial tree can exist before overall success. It is not a
cross-host/shared-filesystem lock, native restore UI, whole-account snapshot,
generic Thing restore, permission/timestamp restore or demonstrated 100 TB
transfer. All broader sync/Photos/background/peer and cloud backup requirements
remain active. [Restore contract and setup](portable-backups.md#reviewed-tree-restore).

## Mac History export and renderer assets — 2026-10-17

Mac now implements the negotiated History Save As bridge through the production
Electron preload and host. A native Save panel selects a fresh destination;
owner/origin-bound session requests read the exact retained attachment version
in 2 MiB ranges. Full disk fingerprint readback precedes exclusive publication;
existing names/symlinks and concurrent destination creation refuse without
overwrite. Account, endpoint and lifecycle changes cancel. Later failures keep
the published file and give bounded recovery guidance. No paths, credentials or
bytes enter the renderer. This is foreground single-file export, not resumable
whole-backup delivery; unsupported hardlink/fsync destinations refuse, and process
termination can leave a hidden partial file. Adversarial ancestor renames are not
a promised filesystem boundary.

The isolated native-panel acceptance saved 17,825,809 generated bytes over nine
ranges with 23 account checks, verified exact bytes and removed its temporary
profile/output on close. 141 Electron tests and six shared export-client checks
pass. Targeted lint passes; TypeScript remains at the same 91 normalized baseline
diagnostics. Authenticated signed installed-app History export/restore remains
a separate acceptance item, as do physical devices and whole-data backups.

The rebuilt dev app exposed a separate blank-renderer bug: Nitro's middleware
preset did not serve packaged public assets. Static serving is now enabled only
for that preset. The restart fixture compares startup JavaScript/CSS responses
to packaged bytes; the rebuilt isolated app visually renders the normal home UI.

Installed validation exposed and reproduced a second runtime issue: cloning
Nitro/srvx requests with Node's `Request` constructor failed the private Undici
state check on the account-bound proxy path. Sync and Desktop password proxying
now strip forwarded-origin headers in the forwarding helper without cloning
the framework request. Nine proxy regression tests pass, including GET/POST
wrappers, byte preservation and unchanged account/origin admission checks.
The native export fixture now traverses the actual bundled Nitro proxy; its
headless run saved and verified 17,825,809 bytes over nine ranges and 23 account
checks (destination selection is synthetic in this mode). A separate disposable
account diagnostic completed normal login and the host account check through
the bundled proxy against the real local API. Full TypeScript diagnostics remain
at the same 91 baseline entries. The actual Save panel was verified separately
with the unchanged production export host. Authenticated signed History
export/restore remains an explicit acceptance item.

## Installed Mac server compatibility — 2026-10-17

The installed helper uses `https://thingtime.com/`. Its public manifest currently
omits `api.devices-node-identity` and `api.files` and advertises attachment-content
1.12.0. PR #1002's preview advertises identity 1.0.0, Files 1.3.0 and content 1.14.0.
This explains the installed folder-context refusal before any local file access;
it is not evidence of broken pairing or lost folder consent. The desktop host now
checks the public identity capability before native dispatch and displays clear
server-version guidance. Account checks run again after negotiation; native
identity verification remains required on compatible servers. Renderer rejection
handling recognizes only the fixed compatibility message and hides other native
transport details. Production promotion and authenticated installed sync acceptance
remain pending; no pairing, consent or selected endpoint was changed.

## Account inventory boundary — 2026-10-17

The internal account producer now freezes bounded owner pages at one MongoDB
snapshot timestamp and emits canonical Timeline snapshots into the durable backup
plan. It supports ordinary Thing metadata and immutable file references. A missing
managed-family adapter refuses the entire plan, so this is **not yet a complete
account exporter**. The original whole-account, independent byte copy, Timeline
lifecycle, scheduled jobs, native UI and large-data delivery requirements remain.

The disposable replica proof retained 300 owned records across three pages while
majority writes edited, deleted and inserted source records between reads. Saved
metadata was sealed/read after source removal; empty inventories and missing-index
refusal also passed. An owner/ID index reduced a 128-result page from 2,560 keys
examined to 128 in this fixture. The central index registry adds it only to the
modern plan (52/64); the full legacy-compatible plan stays at 64 and cannot use
this producer until migration. Ninety-four backup/Mongo regression tests pass;
targeted lint passes and full TypeScript retains the same 91 baseline diagnostics.
There is no new public route, installed-app surface or native binary change.
See [coverage and setup](portable-backups.md#account-inventory-producer).

## Recoverable Apple native Trash foundation — 2026-10-17

`MobileSyncTrash.swift` shares the existing Apple descriptor access and durable
operation-journal helpers with publication. Mac/iOS advertise `fileTrashVersion`
1.0.0. `trash`, `trash-lookup`, `trash-inspect` and `trash-restore` bind the original
operation to account, origin, device, connection, native grant/bookmark and root
inode. Deletion requires a separate native consent dialog and exact saved
`allowTrash: true` approval; download permission alone is insufficient. The
shared client rejects missing/downgraded approval flags. Restore remains possible
with ordinary download approval after deletion propagation has been disabled.

Files and initially empty directories move by exclusive same-volume rename into
private native storage. No unlink, cross-volume copy fallback or automatic purge
exists. Durable intent precedes the move; process recovery confirms the original
null-entry receipt without removing a later recreated/restored file. A racing
replacement remains retained and pending. If another writer populates an empty
folder during the move, explicit restoration moves that retained directory intact
without traversing its children; this is not a recursive content snapshot.
Restore is restricted to the same grant and an absent destination, validates the
reviewed retained entry, and cannot move the adapter's own journal/lock/data.

Verified: 41 shared Apple tests, 42 focused Mac adapter/identity/XPC tests,
27 iOS simulator staging/trash/bridge tests, 139 shared client tests and 17
Electron folder/stream tests. Four fresh-process Trash scenarios plus three
existing publication recovery scenarios pass. The real loopback Mac/API fixture
also covers native consent, receipt recovery after restart, exclusive alternate
restore, full-byte hashes and revoked device refusal; its picker/consent and
credential store are synthetic and isolated from the installed app. Full Mac
suite execution aborts in an unrelated DesktopChatRuntime test because its test
host lacks NSBluetoothAlwaysUsageDescription. TypeScript remains at the prior
91 diagnostics (ratchet baseline 89), with none added by this change.

This is native recovery support, not enabled automatic deletion propagation or
Timeline history. The foreground runner still refuses local delete propagation:
fresh remote-path absence checks, child-removal parent revisions, Android parity,
retained-item browsing/restore UI and signed installed permission acceptance
remain required. Native journals are private local recovery state, excluded from
OS backup and not yet included by the whole-account snapshot producer. No claim
of device-loss recovery, continuous background sync or complete account backup
follows from these checks.


### Fresh cloud paths before native publication — 2026-10-17

`api.files` 1.4.0 adds `GET rootId&path`: a fresh, private snapshot observation
of an exact path, including explicit absence. It shares the inventory reader's
root authorization, ancestry, case/Unicode checks and bounds. It scans siblings
along the requested path and skips unrelated subtrees. Across those siblings,
the limit remains 10,000 entries, 8 MiB, 64 levels and 20 seconds. Very wide
folders still need a scalable indexed path contract; this is not a 100 TB
throughput acceptance result.

New download runs retain the selected cloud root in the durable queue and
check the full path before staging and again before native publication. Moving
or renaming an ancestor while bytes are staged now stops publication even when
the old file id still reads successfully. Existing native receipts remain
recoverable; older configured runs use the original root already saved in their
immutable configuration. Unconfigured runs without any pinned root refuse
publication and need reconciliation. An unavailable root, permission failure, malformed path,
case/Unicode alias or failed request never means a deleted file.

This closes one prerequisite for deletion propagation. The foreground deletion
gate remains: parent folder stamps after child removals, end-to-end local Trash
routing, Android Trash and product recovery controls still require work. No
cross-device atomicity, automatic background sync, Photos import, independent
account backup completion or physical-drive delivery is claimed here.


### Foreground Apple deletion and recovery browser — 2026-10-17

This supersedes the prior automatic-deletion gate for capable Mac/iOS hosts.
Native Trash 1.2 exposes owned retained-item browsing and reviewed restoration.
The UI requires that capability before permitting download/two-way deletion
propagation, plus the existing explicit per-configuration native deletion consent.
Android remains gated. Cloud paths are rechecked before the native call; the
native adapter revalidates source stamps. This is not an atomic transaction
across cloud and device filesystems.

Children move before empty parents. Each immutable operation derives at most
one previous sibling and one last-child receipt link. Native receipts bind the
original expected parent to its observed stamp after a successful child move;
changed identity, unexpected edits or missing saved transitions refuse. A crash
before saving the parent transition cannot manufacture one during recovery.

Recovery lists up to 20 native journal records per page across prior connections
and pairing IDs for the same owner/origin and surviving picker grant. Listing
reads metadata; reviewing hashes the retained bytes. Restore asks for separate
native confirmation, never overwrites a destination and persists its exact
intent before movement. An interrupted restore remains discoverable, including
when its bytes already moved, and can resume after restart with the same intent.

Limits: removing/rechoosing a grant still blocks recovery through these controls;
no arbitrary new-grant destination, Android Trash, background deletion, scalable
journal index, native recovery backup or device-loss guarantee is provided.
A retained directory can preserve racing children but is not a recursive snapshot.
Canonical Timeline file version history remains separate from native operation
recovery. Independent whole-account snapshot copies, full account export/restore,
100 GB/100 TB throughput acceptance and physical-media fulfillment remain open.


Validation for this checkpoint: Apple 47, focused Mac 43, iOS simulator 27,
shared sync 146 plus one fingerprint mock, and four fresh-process Trash cases.
Real Mac/API acceptance verifies planner child/parent removal and exact restored
bytes across lost replies/restart with 280 native calls and 562 fresh identity
checks. Fixture picker/consent remains synthetic. Desktop/phone browser layout
checks passed; raw TypeScript remains at 91 baseline diagnostics, none introduced.

### Android transactional recovery — 2026-10-17

Thingtime-owned Android offline folders now implement native Trash 1.2 and use
the existing shared deletion planner and recovery controls. Generic SAF folders
are excluded from both publication and the recovery picker. Distinct deletion
consent is bound to the owner/origin, native grant generation, sync connection,
paired device, configuration revision and hash. Every mutation checks permission
again at commit; reviewed restore resumes through fresh identity authentication.

Schema 3 extends the canonical offline catalog. Immutable blobs stay in place;
entry removal, the direct parent's new revision, retained blob reference and
receipt commit atomically with FULL synchronous SQLite. Nested removal uses the
same bounded previous-sibling/last-child receipt links as Apple. Unrelated edits,
nonempty directories and mismatched scope refuse. Restores require exact reviewed
retained metadata and an absent case-normalized destination. Destination and
receipt commit together; an interrupted uncommitted restore requires confirmation
again, while a committed exact retry returns its receipt without rewriting later
edits. Pages use an indexed owner-root/grant/key query, at most 20 items plus one
lookahead. Prior connection/pairing IDs remain discoverable under the same grant.

Rechoosing the same saved Android grant revokes old consent; a new review can
restore its retained data. Removing the grant does not transfer receipts to a new
grant. Native records remain local recovery material, not canonical Timeline or
independent device-loss backup. Automatic purge, arbitrary external providers,
background execution, restored-tree automation and full large-volume backup/export
acceptance remain open. No production promotion is implied by this checkpoint.


### Android planner-driven deletion acceptance — 2026-10-18

`THINGTIME_DELETE_SYNC_TEST=1` adds an opt-in installed two-way scenario for
separate deletion consent, cloud child/parent removal, a lost real native reply,
WebView reload, original IndexedDB operation IDs, repeat convergence and reviewed
parent-before-child restoration. It uses only synthetic local/cloud fixtures.
Installed API 35 emulator acceptance now passes the full scenario, including
the new document, original operation IDs, resumed parent deletion, repeated
convergence and reviewed tree restoration with independent original-byte hashes.
Android Files visibly shows the restored 8.39 MB child. The completed run took
236.765 seconds with one test and no failures. Earlier intermittent startup and
reload timeouts remain unexplained; this pass does not establish physical-device
or sustained large-volume coverage. See the PR #1002 delivery ledger.

Operator prompts now use the instrumentation status stream as well as logcat,
and the shell runner streams output while preserving JUnit and adb failures.
Wait for `OFFLINE_CREATE_QA_READY` before selecting the test folder. Selecting
early can race the harness's initial bridge requests and fail with a busy error.

The subsequent canonical runner rebuilt and installed both APKs, passed build,
JVM tests and lint, then passed all 61 instrumentation tests in 331.348 seconds
with this live recovery scenario enabled. Its readiness prompts appeared while
waiting, and the restored file was inspected in Android Files. A focused shell
check confirms both JUnit and adb failures still produce unsuccessful exits.


### Android retained replacement versions — 2026-10-18

Android advertises `fileVersionsVersion` 1.0.0. The existing offline-folder
catalog now exposes publication-retained versions through bounded 20-item pages,
verified review, separate native restore consent and exact operation receipts.
Schema 4 preserves existing blobs/IDs and derives the original grant from the
publication receipt; unknown historical capture times remain unknown. Restoring
creates an independent file at an unused path, preserving the current file and
retained version. Account/origin/root/grant checks apply before reads and commit.

The shared Recover device files screen can show replaced versions. Its scoped
pending request and Web Lock preserve the same operation and destination through
cancellation/reload; changing an uncertain destination first queries the native
receipt. No response or invalid receipt can claim successful restoration.

The installed API 35 emulator run passed all 67 instrumentation tests in 174.246
seconds, plus build, JVM tests and lint. It exercised real replacement, review,
cancel, reload, native restore confirmation, independent full restored-byte hash,
current-file preservation, exact replay and Android Files inspection of both
8.39 MB copies. Six native cases cover migration, pagination, corruption,
permission revocation, rollback/lost reply and destination/identity conflicts.
The shared suite passed 148 tests; targeted lint passed. Raw TypeScript retains
91 diagnostics outside changed files. Live synthetic layout checks passed at
390px and 1280px without horizontal overflow. An initial run lost a folder reply
during source editing; a second exposed a test click before refreshed controls
were enabled. The final harness waits for enabled controls after reload.

This is local recovery from existing immutable blobs. It does not capture a new
canonical Timeline event for native restore or create an independent backup.
Apple retained-version browsing, recovery after replacing a grant, native history
in device-loss snapshots, background workers and whole-account large-volume
backup/export remain open. Existing cloud history still uses canonical Timeline.


### Android foreground photo backup — 2026-10-18

Android 11+ can select a read-only photo library through native permission and
Files dialogs. Original photos/videos enter the existing file-sync pipeline and
canonical cloud file history. Editable connection Things carry optional source
intent; fresh native access remains authoritative. Photo connections require
backup mode with deletion propagation disabled, so deleting a device original
keeps its saved cloud copy. Full, selected-only and unavailable access are shown
explicitly. No upload starts from granting access alone.

The canonical runner rebuilt and installed both APKs, passed JVM tests and lint,
and passed 71 instrumentation tests in 158.118 seconds. The live API 35 emulator
scenario checked real permission/tree selection, the backup-only editor, an
independent original PNG SHA-256 after download, discovery of another photo,
retention after deleting the first device original and repeat convergence without
another publication. Four native cases cover read-only enforcement, distinct
identities, generation changes, pending/trashed/missing media, cancellation and
permission loss. The focused shared suite passed 53 tests. Raw TypeScript retains
91 diagnostics outside changed files. Live synthetic editor checks at 390px and
1280px showed selected-only messaging and no horizontal overflow. The first live
harness incorrectly waited for an Upload again label; the corrected runner uses
the actual Upload now control.

Actual limited-selection changes, video/EXIF format coverage and physical devices
still need acceptance. Scans remain bounded to 10,000 entries and run while the
app is open; large-library paging, background workers and Apple Photos adapters
remain open. This does not complete independent whole-account snapshots, native
history inclusion in device-loss backups, 100 GB–100 TB export acceptance or
physical-drive delivery. Setup and permission details are in android/README.md.

### iOS original photo backup — 2026-10-18

The iOS native source picker now offers a read-only Photo library backup with an
explicit explanation and full/selected Photos access. Shared Apple PhotoKit
resources use stable opaque paths and content-derived versions, retain embedded
metadata and include paired resources when PhotoKit supplies them. One protected
temporary original is cached per owner/grant for bounded reads. Permissions and
resource revisions are checked again on reads; inaccessible originals and changed
inventories fail rather than producing a false empty scan. Photo roots cannot
receive writes or appear as recovery destinations, including legacy iOS hosts.

The installed iOS 26.5 simulator scenario passed in 427.359 seconds: independent
original-PNG download hashes, discovery of a second photo, and unchanged saved
cloud revision after the first device photo moved to Recently Deleted. Native
selection/permission prompts were exercised in the initial run; the successful
repeat resumed only the explicitly identified disposable grant. Cleanup removed
the test grant and cloud configuration and moved owned originals into recoverable
Trash/Recently Deleted. The XCTest result is successful; the surrounding shell
reported an EOF after completion because its source was edited while running.
The final runner passes `bash -n`. No cancellation-prompt acceptance is claimed.

Shared Apple tests pass 52/52, including resource identity, chunking, permission
loss, missing/cloud-only originals, changed inventory, cancellation and scope/write
fencing. Focused shared UI policy tests pass 14/14 and targeted lint passes. Raw
TypeScript still reports 91 existing diagnostics outside changed files. The live
simulator completion view was visually checked without clipped controls.

This remains foreground, bounded (10,000 resources / 4 MiB inventory) backup of
locally downloaded originals. It needs temporary disk space for the largest
original. Real limited-library changes, Live Photo/video/EXIF fixtures, physical
hardware, scan/transfer performance, iCloud download policy, album/favorite/caption
restoration, Mac UI and background workers remain open. It does not complete
independent whole-account snapshots, native-history inclusion in device-loss
backups, 100 GB–100 TB acceptance or physical-drive delivery.

### iOS file-backed upload parts — 2026-10-18

The iOS host now advertises a separate native upload capability. Selected-folder
and PhotoKit sources capture one canonical part into protected temporary storage,
using at most 64 KiB chunks. The native adapter replays the exact upload reservation
and obtains a checksum-bound signed URL from the configured authenticated API;
URLSession uploads from the file with no account credentials or redirects. The
shared runner retains original journal IDs and checks every part digest, composite
fingerprint and server attachment fingerprint before publishing file/Timeline
history. Older hosts retain the existing supported byte path.

The final installed multipart photo acceptance passed in 353.120 seconds (the
first run passed in 336.368 seconds): four native
parts, 18,897,576 uploaded bytes, zero legacy bulk bridge reads, independent original
download hashes and unchanged retained cloud revision after local deletion. This
wall time includes native/manual dialogs and is not a throughput benchmark.
Shared Apple tests pass 57/57; focused shared transport tests pass 27/27, and the
final selected installed-host unit suite passes 17/17. The test
suite includes 33 MiB file-backed capture, actual selected-file mutation, source
revocation, interrupted native replies with identical upload IDs, invalid digests,
response limits and credential/redirect restrictions. TypeScript retains 91
baseline diagnostics outside changed files; targeted lint passes.

OS dialogs also exposed a pending identity-request cancellation bug: native iOS
suspension cancelled the task without settling the web promise, holding the
serialized device queue until a 120-second timeout. Cancellation now settles once
only for the original destination. A focused installed-host lifecycle test checks
that no old account context is delivered after changing destinations.

One canonical part needs temporary disk space (8 MiB–5 GiB under the existing
attachment contract); Photos also retains its materialized original. These remain
foreground uploads with server quota/capability checks. Physical-device throughput,
process-kill/background upload recovery, giant-file acceptance and independent
whole-account/device snapshots remain unfinished. A 33 MiB fixture is not proof
of a 100 GB–100 TB transfer. Setup is in iOS/README.md.

## Mac photo backup adapter — 2026-10-18

Mac folder access 1.3.0 adds native source selection and a separate photo
explanation/permission step. Photo grants use the shared Apple reader, remain
account/origin scoped and read-only, and expose live permission status without
prompting during status/list/scan. Existing binary XPC ranges carry original
bytes; shared backup configuration and cloud/Timeline writers retain versions.
Both helper and outer Electron app declare the Photos usage string.

Focused native tests pass 21/21, including four new photo cases for source
selection cancellation/identity change, binary originals, mutation/revocation
and rejected write/Trash operations. Shared photo policy passes 4/4 including
Mac publication refusal; 17 Electron folder/stream tests pass. Targeted lint passes with the TypeScript parser (the
default script parser does not understand pre-existing TypeScript syntax).
The native executable and fixture compile; helper Info.plist validates.

The real loopback API fixture passes six binary ranges / 25,165,877 bytes,
148 native calls and 297 identity checks. Independently downloaded original and
replacement hashes match; the previous original remains readable, source deletion
retains the cloud revision, a new photo is discovered after native-process restart,
and a repeated run performs no additional upload. No native publication/staging
occurred. The photo provider, picker and credential store are synthetic; this is
not real PhotoKit or installed signed-app acceptance. Test data was cleaned up.

Actual Mac source/permission UI, protected library reads, photo/video/metadata
formats and revocation in the installed signed app remain to be verified in an
explicit live session. Large-library paging, iCloud policy, background sync,
independent whole-account/device snapshots and massive exports remain unfinished.

## Durable iOS upload-part recovery — 2026-10-18

The iOS upload capability 1.1.0 keeps interrupted canonical parts in private
Application Support, bound to the original account/origin, native grant hash,
source version, upload/request IDs and part bounds. Native journal writes reserve
identity before capture and commit the digest after payload fsync. A fresh process
rehashes completed bytes before reuse; an incomplete capture is rebuilt. The host
checks live source permission/version and replays the API reservation before
obtaining a fresh signed URL. Successful verification releases the exact part;
removing a native grant removes only that scope's retained parts. No cookies,
signed URLs or credentials are stored with payloads.

The cache is capped at 32 reservations and 5 GiB across accounts, with explicit
capacity feedback instead of evicting unfinished parts. iOS file protection and
OS-backup exclusion are configured. Photos needs additional disk for its materialized
original. The current bridge serializes the complete prepare/upload/release
lifecycle; independently scheduled OS tasks still need durable associations and
leases. This operational cache does not replace canonical Timeline history.

Fresh-process tests exit the disposable child after payload fsync before digest
commit and after completed capture. A distinct process respectively recaptures or
reuses exact bytes without source recapture, checks the digest, rejects a changed
live source and explicitly releases the part. Cache tests also cover conflicting
source/grant identities, owner/origin/root isolation, corruption, truncation,
symlinks/hardlinks, cancellation, orphan reservations and storage limits.

Transfers still require the foreground app. Accepted-upload receipt persistence,
actual process death during PUT, reboot/power-loss behavior, disk exhaustion,
physical-device throughput, native background scheduling, whole-account/device
snapshots and 100 GB–100 TB acceptance remain open. This checkpoint does not
complete Drive/Photos/Resilio-style sync or physical-drive fulfillment.

Installed iOS 26.5 acceptance passed in 192.846 seconds with four native parts,
18,897,576 bytes, zero legacy bulk bridge reads, independent original download
hashes, unchanged retained cloud revision after local deletion and no new cache
entries after success. The completion screen was inspected; fixture originals
moved to Recently Deleted and cloud/grant cleanup completed. An earlier interrupted
run reached all upload assertions but stopped at cleanup; it is not counted as a
complete suite pass. The repeat used only the exact identified disposable grant.
All 63 shared Apple tests passed; the six cache tests were rerun after adding the
explicit storage-capacity error and pass. Both fresh-process scenarios pass.

File protection is configured in iOS capture attributes but is not verified by
this simulator: it returns no protection attribute. The separate
`testDeviceFileProtectionAfterCapture` skips Simulator and requires physical iOS
hardware; device lock/reboot enforcement remains an open acceptance check. Read
protection values as strings, as specified by
[Apple's protectionKey API](https://developer.apple.com/documentation/foundation/fileattributekey/protectionkey).

Final iOS simulator checks: 17 tests selected, 16 passed and the one physical-device
protection test explicitly skipped; no failures. Shell syntax and diff checks pass.

## Native iOS multipart orchestration — 2026-10-18

Upload bridge 1.2.0 moves a full file's part loop and attachment completion into
the native host. The shared sync journal keeps original reservation/operation
identity; the host retains one bounded part at a time and verifies the composite
SHA-256 before finalization. The shared runner independently checks stored bytes
and alone publishes the original file/Timeline operation. Ready attachment replay
skips native byte uploads. Legacy hosts and custom shared mutation policies keep
their existing per-part transport.

Native authority now includes rereading the same private owned configuration,
matching revision and all parsed fields, verifying live device pairing, native
grant/source access and current network/power policy between parts and before
completion. Progress is correlated and monotonic. This removes the WebView-owned
loop, but the app intentionally remains foreground-only until OS task lifecycle
and cancellation/relaunch acceptance are implemented. Whole-account snapshots,
100 GB–100 TB acceptance and physical-media fulfillment remain open.

Verification: 160 shared file-sync tests and ten selected iOS upload/session tests
pass. Installed iOS 26.5 photo acceptance passes in 184.429 seconds: two whole-file
jobs, four native parts, 18,897,576 bytes, zero legacy bulk reads, matching original
download hashes, new-photo discovery, cloud retention and successful cache cleanup.
Native unit tests cover changed configuration/account/audience/network/power,
revoked authorization, changed reservation and wrong multipart digest. Targeted
lint passes. Raw TypeScript still reports 91 diagnostics outside changed files;
this is not a clean whole-project typecheck. Background execution and hardware
lock/reboot/large-volume acceptance remain open.

## iOS continued uploads — 2026-10-18

Upload capability 1.3.0 requests `BGContinuedProcessingTask` on iOS 26+ for the
current user-started whole-file job. One static identifier is registered once;
submission uses the fail strategy. The native job retains its redirect-refusing
file-backed transport, live owner/configuration/pairing/grant checks and bounded
part cache. This does not persist cookies or create another history store.
Older systems, refused submissions and launch timeouts retain foreground behavior.
A timed-out request keeps its identifier slot until a late system launch is
rejected, preventing that launch from acquiring another job's authorization.

Only an exact, capability-negotiated native start acknowledgement allows the web
runner to survive visibility changes. Its inactivity deadline pauses while the
accepted job is hidden; navigation, account changes and explicit cancellation
still abort. System progress reports verified part bytes and reserves one unit
for attachment completion. System/user expiry cancels the job. Successful native
completion waits for the app to become active, rechecks the owner, then hands
back to the shared stored-fingerprint check and canonical Timeline publication.

The simulator declined continued processing in the opt-in installed background
acceptance; the subsequent diagnostic run reported `BGTaskSchedulerErrorDomain`
code 1 (`unavailable`). That run failed its explicit background assertion and is not counted
as background proof. Physical-iPhone acceptance remains required. This is not
passive folder discovery, a new-file scheduler, background downloads, OS relaunch,
force-quit/reboot recovery, whole-account snapshots or 100 GB–100 TB acceptance.

Fork setup: regenerate the Xcode project from `iOS/project.yml`; preserve
`UIBackgroundModes`'s `processing` entry and the static
`$(PRODUCT_BUNDLE_IDENTIFIER).file-upload` permitted identifier. There are no new
secrets or dashboard services. `THINGTIME_PHOTO_BACKGROUND_TEST=1` alongside the
existing disposable photo acceptance explicitly requires real scheduler acceptance;
use Simulator Home after its readiness marker, verify the attachment changes from
pending to ready using the local fixture account while the app is backgrounded,
then return to Thingtime and verify Timeline publication. Never infer background
completion from an upload that was already finished before leaving the app.

Verification: all 163 shared file-sync tests and 15 selected native lifecycle,
whole-file, upload and session tests pass. Targeted lint and shell/diff checks
pass. Raw TypeScript retains 91 diagnostics outside the changed files.
Installed iOS 26.5 foreground fallback acceptance passes in 205.359 seconds:
two whole-file requests, four parts, 18,897,576 bytes, no legacy bulk reads,
matching original download hashes, new-photo discovery, unchanged retained cloud
revision after local deletion and successful private-cache cleanup. The completion
screen was inspected. Generated originals were moved to Recently Deleted and
cloud/configuration/grant cleanup completed. Both jobs reported the scheduler
unavailable; this is foreground fallback evidence only. The earlier opt-in
background assertion failed, and its Xcode harness was terminated after stalling
in result finalization; that run is not a successful acceptance result.


## Timeline records retained in account snapshots — 2026-10-18

The account inventory now captures canonical events, links, branches, heads,
snapshot parts, notes and version names. Large records use existing verified
chunk/range storage while the database snapshot is open; bounded eight-record
queries avoid an unbounded history payload. Cleared names retain their revision
tombstones. The offline reader verifies canonical content and identity without
replaying server receipts.

Validation: 42 backup tests and 239 Timeline tests pass; the 25 inventory tests
were rerun after compatibility fixes. Targeted lint and diff checks pass. Raw
TypeScript reports the identical 91 existing diagnostics outside changed files;
the project-wide typecheck is not clean. The disposable real
replica retained 334 records, including 34 Timeline records / 3,208,814 history
bytes, despite concurrent edits and deletions. All history read identically from
a second vault after the database and first vault were deleted. Failures in
writes, scope, access, payload integrity or later family coverage leave no
complete partial snapshot. [Contract and setup](portable-backups.md#canonical-timeline-history-in-the-vault).

Remaining protected families, historical attachment bytes, complete graph
coverage, account restore, scheduled independent cloud copies and the native
backup/export UI remain open. This checkpoint does not demonstrate 100 GB–100 TB
transfer, physical-media fulfillment or a production deployment.


## Historical attachment bytes in account snapshots — 2026-10-18

Ready owned attachments now enter the frozen account inventory with canonical
content/placement and exact immutable storage fingerprints. Current files and
both sides of file-content Timeline events must resolve to owned attachment
records at the same Mongo timestamp. Checks use bounded batches, eight concurrent immutable HEAD requests and a
bounded cache; a failed batch is drained before returning. Missing, foreign, blocked, unfinished or changed data refuses the
plan. No storage keys, provider versions, upload IDs or credentials enter it.
Linked media preserves its external reference without fetching third-party bytes.

Account file descriptors reference separately captured attachment ranges, so the
current file and historical references do not download the same attachment again.
`resumeAccountBackup` uses existing authenticated exact-version APIs;
`openAccountBackupFile` and `openAccountBackupFileVersion` recover verified offline
current/before/after bytes without replaying server receipts. Selected-folder
capture and restore retain their existing format.

Validation: 57 backup and 18 attachment-core tests pass; targeted lint and diff
checks pass. Raw TypeScript retains the identical 91 baseline diagnostics outside
changed files. The disposable replica preserved 351 records / 47 Timeline records
and 11,603,089 payload bytes despite concurrent source changes, including deletion
of a referenced attachment. Current, earlier and retained-conflict versions were
read from a second vault after deleting the database, original files and first
vault. The authenticated foreground fixture also captured current/conflict bytes
after live Trash and verified both hashes after independent copy/first-vault loss.
That API test uses explicit fixture descriptors, not full-account admission or
permanent cloud-object deletion. [Contract/setup](portable-backups.md#attachment-bytes-and-offline-file-version-recovery).

Remaining managed families, non-file relationship closure, retention/pinning,
account restore/jobs/UI, independent cloud replication, encryption, physical-media
preparation and measured 100 GB–100 TB transfers remain open. No production
promotion or new public endpoint is included.


### Draft and large-content snapshot coverage — 2026-10-18

Saved working drafts, reusable templates and deletion tombstones now have a
dedicated account-backup exporter. It preserves the existing AccountDraft/editor
format, revisions, dates and provenance, without exporting private roots. Media
references are checked in bounded owner-indexed batches at the same database
timestamp and must remain bound to the exact draft and purpose. A tombstone is
never returned as active content.

Large ordinary Thing snapshots retain their canonical `thing-content` shape in
verified 8 MiB chunks (128 MiB record bound); small snapshots remain inline. The
producer processes large ordinary rows individually and drafts in batches of
eight. Retained payloads own their input buffers and check access/readback between
chunks. Offline readers verify canonical content; they do not import server state.

Validation: 69 backup tests and 26 existing draft tests pass. The real disposable
replica preserved 357 records, 47 Timeline records and 22,064,370 payload bytes,
including a 10,080,000-byte ordinary text value. Concurrent draft/media deletion
and a large-content edit did not change the frozen result. Exact drafts, templates,
tombstones, media, historical files and large content recovered from an independent
vault after removing the source database/files and first vault. Targeted lint and
diff checks pass; raw TypeScript retains the same 91 baseline diagnostics outside
changed files. [Contract and worker bounds](portable-backups.md#drafts-templates-and-large-ordinary-things).

This extends the internal inventory, not a complete account-backup feature.
Remaining managed data/settings/device coverage, retention leases, restore
writers, backup jobs/UI, independent cloud replication, encryption, physical-media
preparation and measured 100 GB–100 TB transfers remain open. No production
promotion is included.

## Android native whole-file transport — 2026-10-18

Upload capability 1.2 runs the shared whole-file job in Android native code for
selected SAF folders, managed offline files and original photo sources. It binds
the original operation/upload IDs, source fingerprint and reviewed editable
connection. Fresh owner, pairing, grant, private connection revision, network and
power checks surround each part and completion. The existing shared runner
verifies cloud bytes and publishes canonical Timeline history afterward.

Source proof and part staging use 64 KiB reads and at most 10,000 part digests.
Each private part is hash-verified before signed PUT; changed content, path
replacement and changed metadata refuse completion. API requests pin only the
selected `tt_auth`; storage has no ambient cookies/authentication or redirects.
The app serializes native jobs and takes a native file lock before deleting
orphan temporary parts. No credentials or signed URLs persist.

This is foreground transport, not a background scheduler. The original transport checkpoint removed private temporary parts on cancellation;
this is superseded by the durable cache checkpoint below. An
already-completed reservation skips rereading/uploading bytes. The normal native
job reads the source three times; provider skipping can add work, and physical
100 GB–100 TB throughput has not been established. OS scheduling/relaunch and large-root paging remain open. Durable caching is
covered by the following checkpoint.

Validation: 48 JVM tests, 164 shared sync tests, debug/release builds and Android
lint pass. The installed API 35 SAF acceptance and 72-test runner pass: 8,388,625
bytes span two parts, one native whole-file request, zero bulk WebView reads or
frames, and an independent downloaded SHA-256 match. Managed offline capture
also checks real private files, exact tail bytes and refusal after replacement.
The installed check caught Android's `Files.getFileStore` SecurityException; the
space guard now uses its supported File free-space query. The initial emulator
stalled and was restarted; the picker harness now waits on the native grant
while the WebView is paused. These failed attempts are not counted as passes.
Raw TypeScript retains the identical 91 pre-existing diagnostics.

Installed Android photo acceptance also passes: two native whole-file jobs, zero
bulk WebView reads, exact downloaded original-image hashes, newly added photo
discovery, unchanged cloud revision after device deletion and repeat convergence.
These small synthetic originals do not establish large-library/media throughput.


## Android upload cache recovery — 2026-10-18

The native multipart adapter now retains uncertain parts in the existing private
upload directory under a native file lock. Reservation identity commits before
capture; payload fsync precedes its ready digest. Retries verify both cached bytes
and the current complete source before upload. Owner/origin, root, grant generation,
original upload/operation, part and source are immutable cache bindings. A cache
entry carries no auth credentials, signed URL or saved permission to upload.
Current account, device, connection, network and power checks still apply.

The cache reserves at most 32 parts / 5 GiB, refuses capacity rather than evicting
uncertain data, and removes confirmed parts through an atomic discard. Incomplete
captures may be retried; unknown state, links, corruption and changed identities
fail closed. Removing a folder selection revokes it first, then removes only its
account/root's cache. This is transport recovery, never a second Timeline/history
store: canonical publication remains in the existing shared sync journal.

Validation: 55 JVM tests, debug/minified release builds and Android lint pass.
The installed API 35 two-phase recovery test passed before and after force-stop,
requiring different process IDs. It retained an 8 MiB part after a simulated lost
PUT reply, reused it with the same IDs, verified the full 8 MiB + 17 byte source,
completed both parts and removed its private fixture. This test uses a synthetic
transport; real interrupted networking, power loss and OS scheduling are unproven.
Background acknowledgement stays unavailable (upload capability remains 1.2).
Full-account backup coverage, large-root paging and physical 100 GB–100 TB
throughput remain incomplete in the broader requirement audit.

The normal installed SAF upload acceptance also passes with the cache enabled:
73-test runner, real picker/API, 8,388,625-byte multipart file, one native job,
zero bulk WebView reads, independent downloaded SHA-256 and scoped cleanup.
Other opt-in process tests in that runner were not enabled; the two explicit
recovery phases above supply the fresh-process cache evidence.


## Resumable paged inventory journal — 2026-10-18

The existing browser sync journal upgrades from version 2 to 3 without replacing
runs or checkpoints. Its inventory namespace stores observations under the same
account/origin/data-plane/connection/device scope, plus immutable capture, source
and generation identities. Pages contain at most 128 entries / 1 MiB; exact page
receipts make uncertain retries idempotent. Cross-page duplicate identities and
case/Unicode aliases abort the entire incoming page.

A terminal entry count marks a capture ready for validation, not ready for sync.
Ancestry validation commits at most 128 entries per transaction and saves its
cursor, so cancellation/reopening resumes without exposing a valid prefix.
Missing, differently cased or non-folder parents refuse completion. Only a sealed
capture can be read in bounded sorted pages. New or failed captures do not replace
the last complete observations. This is operation storage, not Timeline history
or permission to write; canonical histories and live mutation guards are unchanged.

Validation: the 100,000-path fake-IndexedDB regression passed ingestion, mid-scan
reopen, seal, full ordered readback and exact-scope discard. Other regressions
cover altered retries, missing pages, scope/generation changes, cross-page
collisions, cancellation/reopen during validation, late invalid ancestors and
version-2 migration. Focused lint passes. Full TypeScript reports 91 diagnostics,
none in the changed files. This is synthetic storage evidence, not browser/native
acceptance or a measured production throughput claim.

Remaining: connect consistent native/cloud paged sources, bounded reconciliation,
operation runs and baseline checkpoints; then test real browser/installed Mac/iOS
and million-path workloads. Foreground sync still uses the 10,000 combined-path
limit. No API contract or Android code changed; Android remains deferred.


## Resumable paged reconciliation — 2026-10-18

The sync journal now upgrades to version 4, preserving existing runs, checkpoints
and version-3 captures. `plans(access)` takes four sealed capture identities
(current local/remote and confirmed baseline local/remote), a fixed policy and
bounded exclusions. It pins those captures atomically so they cannot be discarded
and recreated while an incomplete plan is reading them.

The first bounded pass validates case/Unicode aliases and matching baseline
content across the entire union, including excluded paths. It records changed
ancestors in relational journal rows. The second pass uses the same per-path
policy as the existing foreground planner; late descendant edits still protect
an earlier folder deletion. Exclusions protect parent deletion without allowing
invalid observations to disappear. Each pass saves its positions and results in
one transaction and resumes after cancellation or a process restart. Concurrent
attempts compare durable progress before committing. Reads expose decisions only
after the complete second pass; completing/discarding a plan releases only its
own capture pins. Decisions are paged by canonical path key, at most 128 entries
or 1 MiB; working memory holds at most four input pages plus one bounded batch.

This is operation planning, not a parallel file-history store, native permission,
mutation receipt or baseline advancement. Timeline and guarded canonical file
writers remain the source of history and publication. The live 10,000-path limit
remains until consistent native/cloud sources, paged execution and checkpoint
advancement are connected and accepted together. Android remains deferred.

Validation covers parity with the existing planner in all four modes with both
deletion policies, restart in both passes, late aliases/baseline failures,
excluded descendants, concurrent attempts, input pins, scope/settings changes,
long-path byte bounds and version-3 migration. A reproduced Unicode cursor bug
is fixed: lowercasing a valid filesystem segment can expand its index key, so
cursor validation must not apply filesystem-segment limits to that folded key.

The real Chrome for Testing proof planned and independently checked 20,000
copy decisions across two browser-process restarts (indexing at 128, planning at
128), rejected partial reads, proved input pinning, then released and discarded
its generated data. OS-level network isolation restricted both the static
fixture server and browser to loopback port 28162; hostname, direct-IP and
redirect denials were checked before running. No account credentials or real
user files were used. Screenshots, three traces and the exact fixture source are
retained with the HTML tracker. This is browser storage/planner acceptance,
not native transfer or production throughput evidence.


## Durable paged operation recovery — 2026-10-18

Journal version 5 adds `pagedRuns(access)` beside existing inventories, plans,
runs and checkpoints. It prepares bounded pages from a complete plan and stores
immutable operation IDs before effects. A late conflict keeps the entire queue
non-executable. Operations use the same ordering key and execution/receipt
validators as the foreground runner: every copy before deletion, copied parents
before children, deleted children before parents. Pending reads are bounded to
128 operations or 1 MiB; preparation retains one bounded decision page.

Preparation progress, operation rows and the active-root guard commit atomically.
Competing preparations compare revisions and instance IDs; unique operation/path
indexes reject duplicate identities. Complete plans stay pinned while a run owns
them. `active()` discovers the original specification after restart, and indexed
path lookup supplies stable parent operation IDs without a whole-run array.
`executePagedSyncRun` holds the existing root Web Lock, records running state
before the first effect, and recovers uncertain writes through their original
receipt IDs. Confirmations advance only the next ordered operation and store a
bounded, allowlisted receipt. Scope changes, pending receipts, changed source or
destination stamps and altered receipt retries refuse continuation.

Legacy run writes and checkpoint advancement are atomically excluded while a
paged run owns the root. Preparation can be discarded before execution; a
started run cannot be discarded even when zero receipts are confirmed. Completed
runs retain the root/plan until the forthcoming paged checkpoint handoff. The
previous baseline remains unchanged. This is recovery metadata, not a parallel
Timeline history store or native authorization.

Regression coverage includes migration from version 4, interrupted preparation,
global ordering across pages, late conflicts, duplicate IDs, concurrent builders
and executors, lost replies, failed confirmation storage, cancellation, changed
scope/settings, empty plans and preservation of the prior checkpoint.

Real Chrome for Testing verified 10,001 operations across two complete browser
process restarts. Preparation stopped at 128; execution then stopped after 257
independently stored destination receipts but only 256 journal confirmations.
Resume recovered the uncertain receipt and applied exactly the remaining 9,744
operations. Every destination path, ID and digest was compared with generated
source metadata. The fixture and browser both ran under an OS network boundary
allowing only loopback 28166; hostname, direct-IP and redirect refusal was
preflighted. Screenshot, three traces and fixture source are retained beside the
HTML tracker. The temporary profile/downloads and server were removed.

Remaining before live rollout: consistent paged native/cloud scans, indexed
cloud destination preparation and native trash receipt chains, paged baseline
publication, and installed Mac/iOS transfer acceptance. The foreground path
continues to enforce its 10,000-path bound. This proof transfers no real file
bytes and makes no production throughput claim. Android remains deferred with
its unfinished implementation preserved in PR #1002.


## Resumable paged checkpoint handoff — 2026-10-18

The version-6 sync journal now includes `pagedCheckpointJournal.ts`. A completed
run pins the exact internal instances of all four original inventories; callers
cannot discard and recreate the same public ID/generation to change its recovery
inputs. Older plans remain readable, but a new run requires rebuilding a plan
that predates internal capture identities. Existing run recovery is retained.

Checkpoint capture identities are created atomically only after every operation
is confirmed. After fresh local and remote scans are sealed, a five-stream merge
reads their observations, the old baseline pair and path-ordered confirmed
receipts in bounded pages. It applies confirmed copies/deletions before the
shared baseline agreement rule, preserving edits made after a successful copy.
Each step consumes at most 128 union paths and stays within its byte budget.
Paired output pages use exact ordinal/digest retries; their cursor advances only
after both copies are durable. Interrupted validation and publication resume.

Both complete outputs must seal before one transaction publishes the new head,
releases only that run's root/plan/input pins and retains the new baseline pins.
Old publication retries neither overwrite a later head nor release a newer run.
New runs must use the current paged baseline. Legacy journal writes and legacy
checkpoint reads refuse to replace or return stale state after paged publication.
The output is reconciliation metadata, not another Timeline history store.

Validation: seven new checkpoint regressions cover pre-run capture refusal,
post-copy edits, bounded merge/reopen/deletions, interruption between output
replicas, old publication retries, path aliases and account changes. Four input
binding regressions and the migration check cover retained original generations.
The shared suite passes 207 TypeScript tests; its separate module-mock test passes
with the package script's experimental mock flag. Focused lint passes. Whole-project
TypeScript retains the identical 91-diagnostic baseline, with no new diagnostics.

Chrome for Testing also used the actual current journal/executor in an isolated
fixture with 400 generated operations and three full browser process restarts.
An independent receipt store had 257 effects at interruption and 256 confirmations;
resume applied exactly 143 more. Checkpoint building stopped after 128 paths with
no published head, then resumed and verified all 400 baseline pairs against the
independent receipt store. A post-copy local edit remained a single-sided update;
an old retry preserved the next active run. Browser and fixture server were
OS-restricted to loopback 28174; hostname, direct-IP and redirect denials were
checked. Screenshot, four traces and the fixture script are retained with the
HTML tracker. Temporary browser profile/downloads and listeners were removed.

Still open: connect this lifecycle to consistent native/cloud paged scans,
indexed destination preparation and native Trash receipt chains, then verify
real file transfers in installed Mac/iOS apps. The foreground 10,000-path limit
remains. This is a storage/recovery proof using generated metadata, not native
transfer or 100 GB–100 TB throughput acceptance. Android stays deferred.


## Paged cloud operation bindings — 2026-10-18

Journal version 7 retains canonical cloud nodes alongside reconciliation entries
in the existing inventory pages. Both payloads share the 128-entry/1 MiB bound
and exact retry digest. Sealing checks physical parent IDs across pages before
exposing metadata. A generic capture cannot later acquire cloud metadata, and
original capture instances stay pinned by the plan and run.

The paged operation journal now prepares cloud bindings before execution. Each
binding retains the original attachment, destination revision and parent ID;
new folder parents use already allocated operation IDs. The exact parsed
configuration and cloud root are immutable across retries. Local Trash keeps at
most two receipt links per operation, with durable per-parent progress across
pages. Binding rows, receipt links and their cursor commit together. Partial,
invalid or quota-refused preparation cannot start any operation. A started run
cannot acquire fresh bindings from a later scan.

`createPagedCloudSyncPort` joins those indexed rows to the same cloud upload,
range-download, native staged-publication, recoverable Trash and capability
checks used by the existing foreground adapter. Preparation metadata does not
authorize effects. The whole-run compatibility adapter delegates to this shared
transport; Timeline history and remote API contracts remain unchanged.

Fourteen new regressions cover retained cloud metadata, ancestry, migration,
immutable settings, deep/wide native Trash receipt chains, page byte bounds,
transaction rollback and recovery after an accepted download loses its reply.
An OS-isolated Chrome for Testing proof prepared 270 bindings, restarted after
128, then restarted after 129 accepted downloads and 128 confirmations. Resume
performed exactly 141 new downloads. All 270 independent target receipts and
original attachment bindings matched; no accepted effect repeated. The fixture
used generated three-byte content and simulated cloud/native adapters around
the real shared transport and IndexedDB, not an account or installed device.
Browser and fixture server were restricted to loopback 28174; hostname,
direct-IP and redirect refusal were verified. Screenshot, three traces and
fixture source are retained beside the HTML plan. The installed Thingtime
agent-browser CLI was absent, so the explicitly isolated runner was used.
Temporary profile/downloads and listeners were removed after the proof.

Still open: stable paged native/cloud scan producers, foreground/worker lifecycle
integration including conflict review and checkpoint publication, and installed
Mac/iOS acceptance. The live 10,000-path bound remains. This increment does not
establish large-volume throughput, persistent background sync or independent
backups. Android remains deferred with its unfinished code preserved in PR #1002.

Validation for this increment: 221 shared `.test.ts` checks plus the separate
module-mock `.test.mts` check pass (222 total). The unchanged 100,000-entry
inventory and 20,000-path planner benchmarks were not repeated. Focused lint
passes. Whole-project TypeScript output is byte-identical to the prior
91-diagnostic baseline.


## Mac/iOS foreground paged recovery — 2026-10-18

Mac and iOS connection controls now use the paged inventory, plan, operation,
cloud binding and checkpoint journals for foreground sync. The existing complete
native/cloud scans are imported in bounded pages; this does not remove their
10,000-path limit or establish stable paged producers. Android keeps its existing
runner while its unfinished work remains deferred in this PR.

Journal version 8 persists conflict choices before preparing any operation. The
same conflict policy validates exact reviewed versions, rejects missing/extra
choices and prevents effects until every review page has committed. Fully saved
reviews resume without reopening the popup; interrupted review import requires
fresh choices. Settings are pinned before cloud preparation. Live account,
device, root, network and native write approvals still run through the shared
`foregroundSyncContext.ts` policy before effects.

“Save versions and ignore” retains only conflicting versions, releases the
active root after confirmation and never advances the common baseline. Repeating
the same reviewed versions/configuration reuses the retained receipts without
another upload. A later selected winner still synchronizes normally. Legacy
uncertain operations and lost checkpoints finish with their original IDs before
the connection migrates to a paged baseline.

An interrupted post-run observation import restarts with two fresh generations
atomically; it cannot mix a new scan with old partial rows or replace observations
held by another active reader. Once checkpoint building starts, it resumes the
sealed observations. Changing approved roots clears only the old baseline head,
and refuses while a transfer is active. The executor uses the foreground root
lock without recursively acquiring it.

Validation: all 238 shared checks pass (237 TypeScript tests and the separate
module-mock transport test), including the inventory/planner scale cases.
Focused lint passes; whole-project TypeScript diagnostics are identical to the
existing 91-diagnostic baseline. New regressions exercise
135-file transfer recovery across a page boundary, interrupted checkpoint import,
legacy migration, review import/restart, pinned settings, retention without a
remaining source and a later winner after Ignore. The pin regression keeps a
second plan active; completed plans correctly release their input pins.

The actual connection component ran in isolated Chromium at 1440×1000 (Mac
adapter) and 390×844 (iOS adapter), with real IndexedDB and generated three-byte
content. Opening two conflicts, choosing/resetting a winner, saving both versions,
reloading and repeating Ignore produced two retained receipts with zero repeat
upload parts, no live-file revision change and no remaining active run. Rendered
completion text was compared with the fixture's independent cloud counters and
journal readback. Top-to-bottom scrolling and opened-popup inspection passed;
phone status text now occupies the full row above the controls. Evidence lives
in `paged-foreground-evidence-2026-10-18` beside the HTML tracker.

Browser and fixture backend were OS-restricted to loopback 28174; hostname,
direct-IP, alternate-port and redirect denial checks passed. The installed
agent-browser CLI is now present, but native app-control timeouts prevented
verifying/registering its task policy; the explicitly isolated fallback runner
was used. Trace/screenshots/source are retained; temporary browser resources and
listeners were removed. No installed app or real-account acceptance is claimed.

Still open: installed Mac/iOS transfers and provider/permission acceptance,
stable paged native/cloud producers, persistent workers, scoped journal retention
and orphan cleanup, full cross-device convergence, and measured large-volume
sync/backups. Existing source captures and journals remain retained. Independent
snapshot coverage and whole-account restore have their separate open gates.


## Bounded foreground journal cleanup — 2026-10-18

Version 9 registers foreground-owned scans, plans, runs and checkpoint drafts in
`sync-managed-metadata`. At the next foreground start, while holding the existing
root lock, cleanup retires obsolete records in transactions of at most 128 child
rows and 1 MiB of keys, plus fixed header/pin updates. A retired header prevents
new readers or ID reuse until all children and its catalogue row are removed.
Cancellation, account changes and process exits can interrupt between pages.

Active root ownership, input pins, the published baseline and the most recent
retained-conflict run protect recovery data. Plans release only their own pins.
A completed ordinary run requires a published checkpoint before retirement;
retired cleanup no longer depends on keeping that old checkpoint around. The
active root independently protects its original and checkpoint inputs if a pin
index is damaged. Fresh post-run capture replacement queues the old generation
for bounded cleanup instead of deleting an entire scan in one transaction.

Only registered foreground metadata and explicitly replaced checkpoint captures
are eligible. Unmanaged/older captures remain available; this does not infer
that every unpinned observation is abandoned. File bytes, native receipts and
canonical Timeline history use their existing stores and retention contracts.
Stable scan producers, worker integration and installed acceptance remain open.

All 246 shared checks pass (245 TypeScript tests plus one module-mock check).
Eight cleanup regressions cover bounds, restart/ID reuse, other readers/scopes,
transaction rollback, account changes, steady storage use, retained receipts,
checkpoint retirement and damaged pins. Focused lint passes; TypeScript retains
the same 91-diagnostic baseline. Isolated Chromium confirmed steady counts over
five repeated Ignore actions at desktop/phone sizes and cleanup recovery after
a full browser-process restart. This uses generated adapters and metadata, not
installed-device or large-volume acceptance. Evidence:
`journal-maintenance-evidence-2026-10-18` beside the HTML tracker.


## Native single-path verification — 2026-10-18

Mac folder access 1.4.0 and iOS folder access 1.2.0 add `inspect`, an exact
relative-path observation returning either a canonical entry or explicit absence.
The shared foreground context uses it for per-operation checks; both runners
retain complete scans for planning and checkpoint publication. Older clients and
Photos keep their existing scan path. Android implementation remains deferred.

The Apple reader hashes only the selected file and retains O(path depth)
metadata. It enumerates ancestor directory names to reject case/Unicode aliases,
opens relative to authorized descriptors without following links, and rechecks
ancestor/object identity after reading. Missing paths are distinct from provider,
permission, cancellation and changed-file failures. Native bridges verify account,
device/origin and the selected grant again before replying. A failed inspection
never falls back to a scan or becomes a deletion. Inspection gets the same
five-minute native read deadline as a complete scan.

Verification: all 249 shared checks, 66 Apple library tests, 16 Mac adapter tests
and 13 Electron folder bridge tests passed. Twenty-operation tests use exactly
two full scans in each runner. A real 10,001-file directory supports targeted
inspection while the existing full scan correctly refuses its size. Native tests
reject revocation during final identity verification, including grant removal.
Focused lint passes; TypeScript retains the exact same 91 diagnostics.

Desktop (1440px) and iOS-sized (390px) isolated Chromium checks exercised the
production controls, conflict choices, Save versions and ignore, and reload/retry.
Each two-file retention run used two required review scans and two targeted
inspections; retry reused retained versions without another upload. Full-page
scroll checks found no horizontal overflow. Native/cloud adapters here are
synthetic; actual filesystem semantics are covered separately by Swift tests.
The fixture now implements the binary reads implied by Mac's negotiated version.
Evidence: `native-path-inspection-evidence-2026-10-18` beside the HTML tracker.

The unsigned iOS simulator build passed after removing a command-line iPhone SDK
override that incorrectly compiled the Watch dependency for iOS. This is compile
evidence only. Signed installed Mac and iOS action-path acceptance remain open.
Stable paged native/cloud inventories are still unfinished; live synchronization
retains its 10,000-path cap. This change does not establish large-root, background,
physical-device or 100 GB–100 TB acceptance.

## Native paged folder captures — 2026-10-18

Mac file-access **1.5.0** and iOS file-access **1.3.0** add `scan-capture`,
`scan-page` and `scan-discard`. The shared foreground controls negotiate these
versions for folder roots and import one sealed native generation for planning,
conflict rechecks and checkpoint publication. Older clients and Photos keep the
existing bounded scan path. Android implementation and acceptance remain deferred.

`MobileFolderInventory` streams descriptor-relative traversal into a private
SQLite metadata cache, validates path/identity uniqueness and rechecks every
observed entry before sealing. Replies contain at most 128 entries and 512 KiB;
clients pin capture identity, generation, offsets and the terminal count. The
source is reauthorized on each call and the bridge checks device/grant identity
again before replying. These immutable observations are not retained file bytes
or Timeline history. Source edits after capture are checked before each effect.
Eight captures per owner/origin/device/grant are retained at most; each database
has a 1 GiB page quota. Cancellation, eviction, corruption or omitted rows refuse
instead of appearing as an empty complete scan. A reused evicted ID gets a new
generation. Explicit discard removes metadata only.

The shared checkpoint importer preserves its existing plain observation contract;
planning captures alone hold canonical cloud destination metadata. Partial native
imports cannot launch effects or replace the prior published checkpoint.

Verification: 255 shared file-sync checks; targeted lint; 73 Apple filesystem tests; full Mac suite 162 passed plus one
opt-in display-hardware skip; 146 Electron checks; iOS simulator compilation.
Native tests use 10,001 real files and verify all 79 pages against independently
constructed names/digests, reopen, later edits, scope/generation refusal, cache
eviction, truncated/corrupt metadata and cancellation. Shared tests cover page
protocol validation, 135-entry execution/checkpoint publication without a legacy
root scan, and malformed/missing pages preserving the last good checkpoint.
Isolated Chromium at 1440px/390px exercised the real controls, two native capture
generations, four pages, cleanup and retained conflict receipts after reload;
layout was checked through the page bottom and open review controls. Raw TypeScript retains 91 diagnostics outside the changed files. Native/cloud
adapters in that browser check were generated fixtures, not installed-device
acceptance. Both browser and fixture backend were OS restricted to loopback.

Remaining: stable paged cloud producers, conflict-review scaling, capture workers
and installed Mac/iOS/provider acceptance. The live combined 10,000-path cap is
still enforced. Capture hashes file contents in the foreground and retains the
existing request deadline; this is not a sustained large-data benchmark or a
persistent background scanner. The installed Mac app is another task's branch
and sign-in environment; it has not been overwritten for this check.


### Cloud inventory pages (2026-10-19)

`api.files` 1.5.0 adds `GET rootId&pages=1`: bounded NDJSON pages from one
read-only Mongo snapshot. The private disk queue holds wide folder frontiers;
backpressure limits retained rows to one page and one parent batch. Pages carry
one generation, root revision, ordinal and an exact terminal count. The client
withholds completion until clean EOF, then the existing journal verifies unique
identities, paths and physical ancestry. Checkpoint observations undergo the same
cloud-tree validation before copying content stamps into their plain captures.

Mac/iOS foreground controls use this transport. Legacy JSON inventory/path
reads and deferred Android remain unchanged. Limits are 128 entries / 384 KiB
per page, 128 MiB scratch per capture, two concurrent captures per server process,
64 levels and 240 seconds. Snapshot expiry, cancellation and process loss require
a fresh scan. The scratch queue is request-owned, not a persistent recovery job.

Validation: 261 shared sync checks (260 TS + one module-mock check), 40 Files
checks and 35 capability checks pass. The 10,001-file producer test returns
79 pages; 4,096 folders use 33 bounded parent queries. The disposable production
handler test creates 135 folders through real signup/Things writers, preserves
one snapshot during a concurrent rename, seals two pages and rejects reads after
logout. Its OS network boundary denies other ports, hostnames, redirects and
external direct IPs. It does not inject authentication or seed database documents.
The built Nitro manifest advertises 1.5.0 and anonymous Files access returns 401.
Desktop and 390px iOS Chromium fixtures pass conflict retention, reload recovery,
full-page scrolling and overflow checks with generated native/cloud adapters.
Full TypeScript still reports 91 diagnostics outside this increment's files.

Installed Mac/iOS acceptance and deployed streaming remain open. The combined
foreground planner/review cap is still 10,000 paths; this increment does not
claim unrestricted root sizes, durable workers, byte backups or 100 GB–100 TB
throughput. Android stays deferred. Next: exercise installed/HTTP proxy streaming,
then remove the remaining bounded review/path-observation bottlenecks.

### Bounded cloud path observations (2026-10-19)

`api.files` 1.6.0 streams the siblings at each requested path segment instead of
retaining their metadata in a whole-tree inventory. The requested result is not
returned early: every sibling is validated and duplicate identities, NFC/case
aliases, invalid metadata and private-access failures still invalidate the whole
observation. JSON inventories, streamed inventories and path checks share one
row validator. The legacy whole-tree inventory and foreground combined-plan cap
remain 10,000 paths; this change removes that separate cap from path observation.

A request-owned anonymous POSIX scratch index stores SHA-256 keys, with a fixed
128 MiB address space, at most 2,097,152 keys, a 256-probe bound, and two concurrent
path scans per service. Names and IDs are not stored in scratch files. The file
is unlinked before any keys are written, so process death releases its allocation.
The existing 20-second total deadline and 64-level path bound remain. Cursor and
index closure, transaction completion and a final authorization-context/deadline
check precede success. Transaction retries receive a fresh index and share the
original deadline. Capacity, cancellation, I/O and cleanup failures never become
an absent-file result. This requires an anonymous-file-capable POSIX temporary
filesystem, as on the supported Linux server/macOS development hosts.

Coverage includes 10,001 siblings exceeding 8 MiB, late unrelated aliases,
duplicate IDs across levels, normalized Unicode names, disk/probe collisions,
capacity/admission, cancellation, plane changes, transaction retries, failed close
and abrupt child-process exit. The isolated production-handler fixture creates
135 real folders through authenticated Things writers, then checks found/absent/
alias responses and logout refusal using the real disk index. It does not prove
installed-device behavior or a large production-folder benchmark. Paged conflict
review, lifting the combined foreground cap, workers and full backups remain open.


### Durable bounded conflict-review drafts (2026-10-19)

The version-10 sync journal adds `pagedReviewDraft.ts`. It indexes conflict rows
from a complete immutable plan in bounded pages, saves each selection with a
row revision, and exposes 20-row review pages (at most 128 rows / 512 KiB for
import). Draft settings, scope, plan instance and capture instances are bound
before indexing. An active draft pins the reviewed plan and inputs; the root
head independently protects them during maintenance if pin indexes are damaged.
Released drafts are collected in bounded transactions. Legacy journal mutations
refuse an active review instead of replacing its recovery state.

Sealing checks the complete count and current revision. Unsupported folder
conflicts stay visible and prevent Apply/retention; a selected winner cannot
authorize deletion or another sync direction. Sealed rows feed the existing
`pagedRunJournal.appendReview` contract. Complete preparation against a fresh plan
rejects changed versions before any operation can start. Review data is not a
native grant, transfer receipt, Timeline event or common baseline.

Validation covers 12 focused regressions: process-style reopen, partial indexing,
stale concurrent choices, clearing selections, fresh-plan mismatch, folder
conflicts, byte limits, cancellation/account changes, quota rollback, v9 migration,
recreated capture IDs and cleanup with missing pins. A real OS-isolated Chromium
process was closed and relaunched with 270 generated conflicts; the saved choice
survived, review reads held 20 rows, imports held at most 128, and all 270 operations
prepared with zero executed effects. Evidence is in the HTML plan's
`review-draft-evidence-2026-10-19/` directory.

**Still open:** connect these draft pages to the foreground runner and individually
editable Builder conflict controls; preserve the existing repeat-Ignore content
identity without whole-list hashing; complete installed Mac/iOS acceptance. The
current popup still uses its existing arrays. The combined 10,000-path cap remains.
No Android work or native installation is included in this checkpoint.

Checkpoint checks: all 274 file-sync tests and focused lint pass. The full
TypeScript check still reports 91 diagnostics, all outside changed files; this
is not a clean whole-project typecheck.


## Paged review handoff and recovery — 2026-10-19

The Mac/iOS paged foreground runner now uses the version-10 conflict draft
through review, fresh capture and run import. A sealed approval survives a
failed fresh scan or interrupted import; retry reuses the same run identity
and page receipts. A bounded merge compares every reviewed conflict against
the fresh complete plan before any operation is created, including conflicts
added, removed or edited on its last page. Explicit cancellation releases only
the draft; interrupted editing preserves choices. Closed UI handles, stale
approval revisions and changed account/settings cannot authorize execution.

`pagedForegroundReview.ts` supplies a paged local adapter (`read` / revisioned
`choose`) for the editable Builder surface. Its streaming SHA-256 reproduces
the previous JSON retention identity exactly, using the pinned `@noble/hashes`
dependency. This preserves repeat Ignore receipt lookup without retaining the
whole choice list. The existing popup still uses the explicit legacy array
adapter; individually editable Builder controls and their installed acceptance
are the next required integration. The combined 10,000-path cap remains.

All 281 shared file-sync checks pass. Validation covers interrupted drafts and imports, old draftless migration,
settings/cancellation fences, final-page changes, exact hash parity through
10,001 rows, and bounded 128-row imports. Real isolated Chromium restart checks
recover the saved choice across 270 conflicts, verify the hash independently
with Web Crypto, and prepare 270 operations with zero file effects. These prove
engine/storage behavior, not installed-device transfers or editable UI delivery.
Full-project TypeScript still reports 91 diagnostics outside changed files.
Android remains deferred and its code is preserved.

## Bounded conflict review controls — 2026-10-19

`conflictReviewController.ts` is the shared data/action adapter for the upcoming
editable Builder review. It retains one 20-row journal page, persists each choice
with its row revision, serializes interactions, fences disposed sessions and
rechecks the reviewed header revision before resolving the foreground callback.
Failed reads preserve the current page; an error requires a fresh read before
Apply. Explicit cancellation differs from interruption, which retains choices.

`pagedReviewDraft.ts` provides ascending, bidirectional keyset pages without a
growing cursor-history array. Previous-page reads obey the same byte bound and
account/plan/generation checks; run import only accepts forward cursors. The
Chromium restart fixture uses this controller to reopen 270 conflicts, recover
the selected version, navigate backward and forward, then prepare the existing
run without executing file effects. This is engine/controller evidence, not
installed or visible Builder acceptance. The existing native popup still uses
the legacy callback, and the combined 10,000-path cap remains in place.

Next integration reuses Finch's merged editable block framework (PR 1042;
`api.things` 1.35.0 and `api.webpages-resolve` 1.6.0) and Aster's transient
action host. This branch predates those dependencies; do not introduce a
parallel opaque Component or persist runtime session handles in saved Things.

Validation: 288 shared file-sync checks pass, including 19 focused draft/controller
tests. Focused lint passes. Full TypeScript has 91 diagnostics outside changed
files. The isolated Chromium process-restart proof retains a 20-row view and
imports at most 128 rows per page; all 270 operations remain unexecuted.

## Editable paged conflict review — 2026-10-19

Mac and iOS now supply `reviewPagedConflicts` directly from `MobileSyncConnections`.
The active view holds one journal page; every choice is revisioned immediately.
Explicit Cancel returns the draft-release decision. Stopping the transfer or
changing account/origin disposes the view and preserves the draft for retry.
The legacy array review remains for the deferred Android compatibility path.

The view reuses the merged element/collection/condition Builder framework,
`TransientBlockHost`, and `SettingsDocumentHost`. Heading, muted retention copy,
repeated path/details, select/options, history and action buttons are individual
editable blocks. The account stores only a private authored layout, never live
file metadata, cursors or choices. Desktop uses its selected authenticated API
transport rather than the renderer origin. Layout editing suspends live actions.

The combined API advertises Things 1.36.0 (file-sync preferences plus editable
blocks) and webpage resolve/install 1.6.0. File-sync and editable-write clients
require the combined minor: the earlier 1.35.0 was independently used by these
two branches and cannot prove both features. Existing endpoint route coverage
and the isolated built-server manifest smoke pass.

The production review/Builder over a real IndexedDB journal passed isolated
Chromium checks: 22 conflicts across 20-row pages, immediate choices, Previous/
Next, failed reads preserving rows, process-restart recovery, separate retention
text/repeated-path/select-option/button edits saved and reloaded, desktop/mobile
full-page scrolling, and explicit Cancel, Resolve and Retain results. The fixture
layout API uses synthetic private Things; this is not installed native transfer,
real account layout or Timeline restore acceptance. A numeric revision binding
was corrected and regression-tested. Broader schema checks also updated the
existing photo `sourceKind` projection expectation.

Reproduce on macOS with `node remix/scripts/check-editable-sync-review.mjs`.
Set `TT_PLAYWRIGHT_MODULE` to an installed Playwright package path when it is
outside this checkout, and `TT_REVIEW_EVIDENCE` for saved screenshots/results.
The harness verifies OS network isolation, owns port 28188 and temporary browser
profiles, and refuses a permissive fallback. The built API smoke separately uses
28247 with no live database. Neither test server is a user-facing dev server.

The combined 10,000-path cap, installed Mac/iOS acceptance, background workers,
complete account backups and large exports remain open. Android stays deferred.


## Real Mac paged-runner acceptance — 2026-10-19

`test:files:mac-paged` now owns a disposable loopback Nitro server, Mongo replica,
local attachment store and synthetic API-created account. Its temporary Swift
fixture uses a stable Apple Development signature with the app-scope bookmark
entitlement; OS network isolation is enforced for the runner and descendants.
The installed app, user Keychain and personal files are untouched.

The production paged foreground runner passed 15 native and 15 cloud inventory
pages, 365 native calls and 732 live identity checks. Three real identity
cooldowns totalled 159 seconds. Transfers included an 8 MiB + 17-byte upload
and 2 MiB + 17-byte download; independent complete local/cloud hashes matched.
Accepted cloud, native staging and publication replies were deliberately lost,
then native processes and the journal were reopened. Original confirmed operation
IDs and the published baseline matched, with no accepted byte work replayed.
A conflicting local choice survived interruption and native/journal reopen, then
resolved through the real Files API. Child-before-parent Trash, native restore,
lost restore replies, occupied destinations and revoked-device refusal passed.

The harness now verifies completed runs through their published checkpoint and
confirmed receipt IDs, because successful publication releases the active root.
It also bounds shutdown of its own built server and signs only its temporary
fixture copy. The normal private-upload approval and API authorization paths
remain active; no direct document writes or production credentials are used.

Coverage boundaries: native picker/consent/credential storage are fixture adapters;
IndexedDB uses the existing in-process test implementation. Separate Chromium
proofs cover browser-process persistence and editable review UI. This does not
prove installed Mac/iOS UI, physical providers, million-path throughput or full
account backups. The 10,000 combined-path cap remains; Android stays deferred.


## Wide native destination checks — 2026-10-19

A combined native/API run above 10,000 paths reached the download publication
step and exposed an older limit in `NativeFileDestination`: alias validation
materialized every sibling name through the legacy reader. The shared Mac/iOS
destination now streams names, rejects alternate case or Unicode spellings,
and verifies the parent directory stamp before and after enumeration. It keeps
coordinated access, descriptor-relative no-follow traversal, exact destination
preconditions, retained displaced bytes and original publication receipts.

Mac access 1.5.1 / publication 1.1.1 and iOS access 1.3.1 / publication 1.0.1
advertise this correction; recoverable Trash is 1.2.1. Clients require the patched
access versions before using paged native inventories. Older builds keep the
bounded path. Fully paged native/cloud observations, individual path checks and
paged conflict review are required to cross the shared 10,000-path ceiling.
Missing any adapter preserves the limit and the previous complete checkpoint.

`pnpm --dir remix run test:files:mac-paged -- --wide` creates 10,001 cloud
folders through the normal Things import API and matching real Mac directories.
The acceptance exercises two real byte transfers, lost accepted replies, native
restart, complete 10,003-path baselines and unchanged reruns. It owns the same
OS-isolated disposable HTTP/Mongo environment as the smaller fixture. Its
20-minute deadline and cleanup are bounded; it never seeds database documents
directly. The regular command retains the broader conflict/Trash/revocation
matrix. See the HTML tracker's evidence for the current result of each run.

Regression coverage includes publication/lookup beneath wide ancestors, alias
refusal, and Trash/restore preserving 10,001 siblings. Shared runner coverage
checks a complete 10,001-path checkpoint and refusal of whole-array review.
The iOS simulator build and rendered desktop/phone controls are checked separately.
These are not installed-app, physical-provider, million-file or 100 GB–100 TB
acceptance. Persistent native workers, transfer-receipt retention and complete
backup/restore delivery remain open. Android remains deferred.

Large-root reruns also exercise retired journal cleanup. Cleanup now collects
at most 128 keys within the existing scoped cursor and deletes one contiguous
range per store/page in the same transaction. It retains the byte bound, pin
checks, active-run and current-baseline protection, and atomic rollback after
a queued range deletion. This avoids a separate delete request per obsolete
row; it does not prune native recovery bytes or account versions.

Cleanup now seeks the first remaining key before opening each page cursor.
This keeps deleted prefixes outside subsequent cursor ranges and avoids repeated
tombstone traversal during large reruns. Nine cleanup regressions pass, including
advancing range starts, restart, pin protection and atomic rollback. The slow
pre-seek wide runs were stopped after this diagnosed correction; only final-source
reruns count as acceptance.

Final-source acceptance (code `be360940b`, 19 October 2026) passed the wide
command: 10,001 real folders plus two files, 316 native pages and 316 cloud
pages, complete local/remote checkpoints, original operation IDs after lost
cloud/staging/publication replies and native restart, and an unchanged repeat
without replayed transfers. Independent local/remote hashes covered an
8,388,625-byte upload and a 2,097,169-byte download. The fixture used an
OS-enforced disposable API/Mongo environment and synthetic picker/credential
stores; it did not test an installed app or a real external provider.

The full shared suite passed 291 checks, including the 10,001-path checkpoint
and legacy-limit refusal; all nine cleanup regressions passed. Apple library
75 tests, Mac adapter 18 tests and the iOS simulator build passed. Desktop and
390px phone controls passed isolated Chromium review/Ignore/reload checks with
generated adapters. Project TypeScript still reports 91 diagnostics outside
changed files. The earlier HTTP timeout remains recorded as a failed attempt;
the diagnostic rerun passed without increasing the request timeout, reducing
the path count or changing the workload.


## Non-interactive native consent checkpoint — 2026-10-19

Mac publication 1.2.0 adds `write-check` through the existing local-only signed
host adapter. It validates the exact stored write approval and folder access,
rechecks account/device identity, grant and approval before returning, and never
opens a native dialog or persists consent. The final check also closes an
existing `write-approve` race when its saved approval is replaced during the
last identity verification.

The shared native target accepts explicit `existing` consent mode. Unsupported
versions fail before dispatch; there is no fallback to prompting. Capable
foreground targets also recheck saved approval immediately before staging,
publication and Trash. Read-only receipt lookup remains available through the
existing account/root gates. No history, operation IDs, grant format or remote
HTTP endpoint changed. iOS/Android native contracts are unchanged.

This checkpoint is a worker prerequisite, not persistent sync delivery. The
runner still belongs to the connection screen. Next work is an app-owned
executor with durable explicit job admission, exact configuration reauthorization,
serialized native access, conflict handoff and relaunch recovery. Installed
acceptance remains coordinated separately; Android remains deferred.


## App-owned Mac transfer lifecycle — 2026-10-19

The Mac connection controls now start a live app-owned task through
`desktopSyncTasks.client.ts`, retaining the existing paged runner, IndexedDB
operation journal, native approvals and editable conflict review. Detaching the
Files screen only detaches its observer; reopening attaches to the task's
verified host without waiting behind a long scan. Stop, account changes,
page navigation/reload and Quit cancel execution while preserving its journal.
The renderer lease (`folderSyncTaskVersion` 1.0.0) hides an active Mac window on
Close and disables background timer throttling until the run ends. Only the
bundled main frame may acquire that lease; it grants no file access.

This is an explicit user-started run, not the completed persistent scheduler.
Durable job admission, automatic restart/login scheduling, iOS scheduling and
installed/reboot acceptance remain open. Android stays deferred.

Validation commands: `npm --prefix remix run test:file-sync`,
`npm --prefix remix run test:files:desktop-lifecycle -- <evidence-directory>`,
`node --test electron/test/sync-window.test.cjs electron/test/folder-sync.test.cjs`,
and `npm --prefix electron run verify:folder-sync-host`. Browser fixtures use
production UI/runner/IndexedDB with synthetic native/HTTP data and an OS network
boundary. The Electron fixture now fails closed under that boundary: this
machine's nested Chromium sandbox cannot initialize (`Operation not permitted`).
No sandbox was disabled, and native window-close acceptance is not claimed.
The installed app's CLI is present, but native UI reports no available window
and no running Thingtime Unix socket was found; its browser allocator could not
be negotiated. The independently isolated Chromium fixture remains available.

Current checkpoint: 299 shared sync tests pass (298 TypeScript and one module-mock
test); 18 focused Electron host/window-lease tests pass. Isolated Chromium
production-UI checks pass view detachment during scanning, completion without a
view, reattachment, unchanged no-replay, Stop after reattachment, retained review
choices and saving both conflicting versions. Desktop 1440×1000 and phone
390×844 were scrolled end to end without horizontal overflow or page errors.
TypeScript reports 91 baseline diagnostics, none in changed files. Two actual
UI defects found during acceptance were fixed: native context re-negotiation
blocking the returning screen behind a scan, and cancelled host metadata
throwing during the view's final render. Initial failed attempts remain evidence.

## Durable Mac job resume — 2026-10-19

Explicit Mac starts now admit a bounded, revision-guarded job into version 11
of the existing sync journal. The root app discovers only these admissions,
including while Files is unmounted, and resumes them using saved native write
approval (`existing` / `write-check`) only. Saved connection Things alone do
not schedule transfers. Account, selected origin, paired device, root grant,
private configuration/revision and live conditions are rechecked by the shared
runner. Discovery is serialized, paginated at 32 jobs and capped at 256 records
per account, with a bounded 60-second retry cadence for eligible work.

Stop saves a paused job before aborting; stale discoveries and late completion
cannot revive it. Identity changes and page exit cancel live work without
turning an interrupted job into a user pause. Explicit retry keeps the original
unfinished job ID and existing operation journal. Completed admissions are not
automatically scheduled. Configuration changes require explicit review; no
native approval dialog is opened by automatic resume.

Verification: eight new journal regressions cover reopen, Stop/attention,
completion, settings, account/device/origin/root boundaries, bounded pagination,
concurrent limits and version-10 migration. Two runtime regressions cover
persist-before-stop, identity cancellation and failed pause persistence.
The isolated production-UI fixture terminates a real persistent Chromium process
after a synthetic cloud write is accepted but before its reply arrives, then
restarts it with Files unmounted. The same job and destination recover without
a duplicate. Wrong account/origin and revoked root refuse scans; Stop survives
restart; conflict choices and retained versions still work. Desktop and phone
full scrolling have no overflow. Native and HTTP grants in this UI fixture are
synthetic; installed Mac Quit/relaunch, OS reboot and physical providers remain
unverified. iOS persistent workers, continuous change scheduling and complete
independent account snapshots/restore remain open. Android is deferred.


## Automatic Mac sync cycles — 2026-10-19

Each Mac connection now offers individually editable Builder blocks for its
interval, status, Start and Stop controls. Start explicitly admits recurring
work at one minute, five minutes, fifteen minutes or one hour. Existing one-shot
jobs stay one-shot. The interval belongs to the device-local admission in the
existing journal; changing an editable connection Thing cannot silently start
work or grant native permission. SettingsDocumentHost persists layout edits.

The root app discovers due work every 30 seconds and on online/job-change events.
It keeps at most 256 job records, with 32-record reads, and serializes execution.
Each completed cycle schedules its next check from completion time; a new cycle
gets a new admission ID, while an interrupted cycle retains its original ID and
operation receipts. A selected-server mismatch neither runs an automatic job nor
retains the window for it. Every actual run still checks the live account,
paired device, private configuration, folder grants and network/power policy.
Failures requiring review park the job; condition waits remain eligible.

Reference-counted window leases compose active transfers with idle schedules.
Stop persists a pause during a run or between runs. Its bounded compare-and-swap
retry covers a completion racing Stop, without stopping a different cycle.
Quitting exits execution; reopening discovers eligible admitted jobs. There is
no login daemon and no work while the application is fully quit.

Validation covers automatic-cycle timing and ID rotation, restart, invalid
intervals, one-shot compatibility, stale Stop/completion and overlapping window
holders. The isolated production-UI regression edits separate heading, help,
option and button blocks in the actual Builder, saves and reloads, then starts
recurring sync. A newly added synthetic native folder is copied only when due;
a real persistent Chromium restart recovers scheduling without replay. A wrong
selected server causes no scan or window retention. Idle Stop survives another
restart. Desktop and phone views, conflict choices and retained versions remain
covered. The fixture now installs its clock before application timers, and polls
exact IndexedDB snapshots rather than assuming an async handle contains a job.
Earlier failed harness attempts remain in the evidence record.

These are production renderer/IndexedDB paths with synthetic native/HTTP grants
under OS network isolation. Installed signed-Mac Close/Quit/reboot, physical
providers, sleep/wake and sustained real-byte acceptance remain open. iOS passive
workers, full independent account backups/restore, large exports and physical
media delivery remain in the full ledger. Android is deferred, with code kept
in this PR. No remote API or native permission contract changed here.


## iOS saved folder approval — 2026-10-19

The iOS publication adapter now advertises `1.2.0`, including explicit publication
capability on each writable folder and a non-interactive `write-check` operation.
Photo sources remain read-only. A resumed target uses the same canonical approval
record as an explicit foreground transfer: owner, origin, paired device, connection,
configuration revision/hash and separate Trash consent must all match. Checking
saved approval never opens a consent dialog or saves a new approval.

Both approval actions verify the paired device and bookmark access. Before replying,
the bridge rechecks the owner, device, unchanged native grant and exact approval;
revocation or replacement during those asynchronous checks fails closed. Initial
approval still requires the native consent dialog when no matching record exists.
Older installed iOS publication adapters retain their explicit foreground flow but
cannot negotiate saved-consent resume. No remote HTTP contract changes here.

Native WebKit regressions cover bridge recreation without additional persistence,
missing consent/verifier, unpaired devices, changed configuration/Trash scope,
owner or grant changes during authorization, unavailable bookmarks, and read-only
photo roots. Shared target regressions exercise the same pre-effect approval checks
on Mac and iOS, including no fallback to a prompt. The native tests use disposable
local folders and synthetic owner/device authorization; they do not establish real
provider access or physical-device background execution.

This closes an authorization prerequisite. The iOS Files screen still owns its
sync runner. App-owned durable execution, native background scheduling, physical
suspend/relaunch acceptance and full independent backup/restore remain open.
Android remains deferred with its code retained in PR 1002.

## iOS app-owned recovery — 2026-10-19

`nativeSyncTasks.client.ts` and `NativeSyncBootstrap.tsx` now own both Mac
and capable iOS runs. They reuse the existing admitted-job journal, paged runner,
receipts and conflict-review handoff. Leaving Files detaches its views without
cancelling a transfer. Reopening the app discovers only previously admitted jobs,
verifies the current account/device/origin and existing folder consent, then
recovers the same job and operation identities. A saved connection alone does not
start work. Android remains deferred; older iOS builds keep their foreground path.

The iOS adapter requires native publication 1.2.0 and paired-device capability.
Its authenticated transport is pinned to the WebView origin and expected actor;
Mac retains its selected-origin proxy contract through the same fetch guard.
Identity, bridge replacement, cancellation and server changes fence asynchronous
work. Native progress and background-acceptance callbacks reach the shared runner.
Folder access controls avoid a competing native request while a transfer owns it.

Visibility suspension preserves runnable admission without recording a user Stop.
Only an explicitly acknowledged native current-file lease may continue while
hidden; ending that lease immediately prevents the next effect. Foreground,
pageshow and online events wake bounded job discovery. Stop persists a pause and
survives restart. Mac periodic automation remains Mac-only in the UI; this change
does not claim an iOS OS scheduler or indefinite WebView background execution.

Run `npm --prefix remix run test:files:ios-lifecycle` for the isolated production-UI
regression: view detachment, real Chromium process restart after an accepted
synthetic write loses its reply, unchanged job/destination identities, account and
revocation refusal, hidden/foreground recovery, and reattached durable Stop.
`test:files:desktop-lifecycle` protects the existing Mac lifecycle and automation.
Unit coverage exercises native host identity/transport and background lease expiry.
Browser account/native/HTTP/visibility fixtures are synthetic; physical iPhone
suspension, installed relaunch, background task expiry and large real-file recovery
remain required acceptance. Full independent backup/restore is still incomplete.


## 2026-10-19 — Scene-backed iOS bridge test host

The iOS 27 simulator reproduced all 13 previously failing bridge tests. New
preflight diagnostics showed a loaded same-origin WebView while UIApplication
remained inactive; the fixtures had created unattached WebViews. The shared
fixture now waits for the actual UIWindowScene, retains a visible window for
each WebView and releases it during teardown. It requires the real foreground
state and exact page origin before dispatch, reporting absent prerequisites as
failures rather than callback timeouts or skips. Product lifecycle, origin,
account, grant and device checks are unchanged.

The same task-owned iOS 27 simulator now passes all 66 selected pairing,
inventory, staging, Trash, saved-approval and background-lease tests, with zero
failures or skips. This includes all 13 previously failing bridge tests and the
10,001-file inventory cases. The host uses a separate bundle identity, loopback
web origin, disposable files and synthetic authorization; this is not real
provider, OS scheduling or cross-device acceptance. Physical-device rerun remains
open: CoreDevice currently refuses the trusted-connectivity/power assertion.
The original iPhone app and Aster's reserved Mac installation are preserved.

## Independent S3 replica and resumable download worker — 2026-10-19

The portable v1 vault now has an explicit S3 destination and
`backup:replica upload|download` worker. Canonical Timeline scope binds the
provider prefix; bounded chunks/pages and immutable conditional writes preserve
resume identities. Exact readback precedes completion. Vault-supplied credentials
arrive through a bounded private pipe, never ambient AWS configuration. The AWS
SDK receives detached copies and authorization is checked again after credential
resolution. No external API route or native visible interface was added.

Real SDK/loopback transport and actual child-process tests cover an upload killed
after an accepted 8 MiB chunk, safe retry without reuploading it, removal of the
primary vault and exact download recovery. Wrong scope, expiry, missing access,
corruption, redirection and incomplete streams fail. This is protocol-fixture
evidence only. Full managed-family coverage, retention/pinning, live provider
acceptance, vault/UI wiring, native scheduling and large-volume acceptance remain
open; Android is still deferred. See the [provider contract and setup](portable-backups.md#independent-s3-replica-worker).

Validation: all 92 backup tests passed before the final credential-await race
regression; all five final S3 transport/CLI tests then passed. Targeted lint and
targeted worker/adapter TypeScript checks passed. Full project typecheck retains
91 diagnostics outside changed files.

## Source retention checkpoint — 2026-10-19

Cloud snapshot capture now acquires and renews bounded exact-version owner holds.
Deletion stays pending/billed while retained ranges remain available only to the
owner; expiry is fenced against renewal before exact-version purge/refund.
See [retention contract and open gates](portable-backups.md#source-version-retention--2026-10-19).
Android and installed Mac/iOS acceptance remain unchanged and open where recorded.


## Home-folder upload and two-step progress — 2026-10-19

The Mac connection editor now offers a home-backup preset. It preserves the
selected local/cloud roots and custom exclusions, adds `Library`, `Applications`
and `.Trash`, chooses backup mode, disables delete propagation and keeps the
connection paused for review. It neither chooses a filesystem grant nor starts
an upload. Choose the home folder through the native picker, review the cloud
destination/exclusions, uncheck Paused, save, then use Upload now.

Native Mac file access 1.6.0 and iOS file access 1.4.0 prune excluded relative
paths before opening, traversing or hashing them. Both bounded scans and paged
captures use the same case-folded/NFC exact-path-or-descendant policy. Captures
pin that policy even after failure; reusing a capture with different exclusions
fails. Clients refuse excluded scans on older hosts and validate the returned
policy/pages. Android remains deferred and retains its existing planner behavior.

The editable progress document has two stages: indexed file structure, then
file/folder transfer progress. Index totals stay indeterminate until known.
Expandable folders aggregate child bytes, files, confirmations and status from
the existing durable journal. The viewer keeps at most 32 siblings per page and
eight expanded branches, with focused-folder/parent/root navigation for deeper
paths. It batches readonly operation lookups and refreshes durable
totals at most every 30 seconds plus completion, and displays current-file byte
feedback immediately. Optimistic bytes never become confirmations or 100 percent
before the durable receipt. Completed-run display survives uploader shutdown
until normal journal collection; missing old metadata is reported explicitly.
Account/origin/root guards remain active, and no write authority is revived.

Labels, controls, progress bars and repeated row fields are individual Builder
blocks. The bars use ordinary editable blocks with accessible progress semantics.
This is a source/UI checkpoint: real home-folder upload, the matching
production Files capability, signed installed Mac acceptance and measured large
volume throughput remain open. Aster's combined Mac install ownership remains
preserved. The standalone Electron backup-copy worker passes seven real bundled
worker tests but is not yet wired to installed job/vault controls.


Validation checkpoint: the isolated home UI passed11 checks and desktop lifecycle
passed16, including independent3-folder receipts and actual Builder save/reload.
Native exclusions passed10 Swift inventory tests,21 Mac bridge tests and25
focused shared checks;37 larger paging/recovery checks also passed. The full iOS
app, Watch, widget and test bundle built, and26 selected simulator tests passed
with zero failures/skips. Full project TypeScript reports91 diagnostics outside
changed files. These fixtures use synthetic native/API grants; real home upload
and signed installed acceptance are still required.

### Live transfer speed trackers — 2026-10-19

The editable progress viewer now includes saved, individually editable speed
trackers. Add up to 16, each with an independent 1-second to 24-hour averaging
window and Kbps, Mbps, Gbps, Files/ps, Folders/ps or INodes/ps units. Each tracker
shows upload and download separately. Preferences use the existing account
settings document and revision fence; live counters remain in memory and are
cleared across account changes. INodes/ps means logical files plus folders.

A single bounded per-run history uses monotonic time and decimal bit rates.
Unknown byte capabilities remain unavailable; idle measures zero, while pause
and resume rebase the window. Mac/browser uploads count acknowledged payload
parts; downloads exclude retained staging offsets. Receipt recovery and repeated
completion do not count new traffic. File/folder counts advance only after the
newly executed copy is durably confirmed. Native whole-file/part upload adapters
without distinct new-byte telemetry report unavailable byte rates rather than
counting recovered bytes. These are payload rates, not network header or retry
traffic measurements.

Validation: 47 focused telemetry/transport/lifecycle checks and 14 targeted
settings/template/hierarchy checks pass. Isolated Chromium covers all six units,
independent windows, add/remove/save/reload, invalid values, save-in-flight
controls, actual nested Builder edits, and 1440/390 full-page layout. Existing
13-level hierarchy acceptance also passes. Client build and changed-file lint
pass. Installed-app/deployed acceptance and the real home upload remain open.

The user authorized merging this task into main and starting the selected home
upload afterward. Publication still requires reconciling current main and stale
PR-head metadata; a feature-branch push is not evidence of a main merge.


## Home indexing diagnostics — 2026-10-19

The merged release was installed and its production Files 1.6 contract verified.
The first real home-folder run stopped during indexing, before transferring files.
The native capture is deliberately all-or-nothing: links and special entries,
unreadable or changing files, duplicate inode identities and normalized-path
collisions cannot silently disappear from a complete inventory. Hashing and the
final replay also remain bounded by the native request timeout; a large live home
folder is not yet proven to fit that bound.

Mac file access 1.7.0 adds a bounded `scanFailure` response for `scan` and
`scan-capture`: a fixed reason and validated relative path, or an `invalid-path`
reason with a null path. These responses carry `complete: false` and no usable
entries or capture. Owner, request, selected origin, root and grant are rechecked.
The renderer rejects foreign, malformed or contradictory diagnostics and displays
the specific indexing problem instead of describing it as a pairing failure.
Unsupported entries are not skipped by this change. Exclusion changes require a
fresh capture and retain the existing no-follow and deletion protections.

## Resumable partial home backups — 2026-10-19

Mac file access **1.8.0** adds `capturePolicy: "backup-supported"` for backup
connections with deletion propagation disabled. Strict upload, download and
two-way scans keep their complete-inventory requirements. The local signed-host
adapter provides short `scan-capture`, `scan-status`, `scan-cancel` and
`scan-skips` requests. A capture ticket is bound to the account, selected origin,
device, root grant and exact exclusions. Transport interruption does not cancel
the native scan. Explicit Stop saves the paused admission before cancelling it;
authority loss prevents sealing and reading its result.

The sealed descriptor includes `coverage`, `consistency: "per-entry"`, and
`totalSkipped`. Supported files are hashed and checked separately without a
full-tree replay. This is a file-by-file observation, not a filesystem snapshot
at one instant. Links are not followed, sockets/pipes/devices are not opened,
and unsupported or unreadable entries appear in a durable ordered ledger.
Root/subtree gaps preserve prior baseline facts and never authorize deletions.
Pages contain at most 128 entries and 512 KiB. Native execution uses one active
scan, 64 KiB read buffers and existing cache limits; very large-volume
throughput and those capacity boundaries still require acceptance testing.

The device journal keeps the capture ticket through reconnects and renderer
restarts. One changed native generation can restart automatically; repeated
interruptions require attention instead of looping indefinitely. Normal
network/power waits remain eligible for the scheduler and display as waiting.
An explicit retry renews that recovery allowance. Confirmed cloud operations
retain their existing receipt identity. Files changing after indexing can still
stop a transfer for review; this work does not silently skip upload failures.

Progress is at **`/settings/things` → Sync connections** in the installed app.
The two-step progress viewer and editable Backup coverage blocks read this
device's journal. Skip pages are exposed after the complete local inventory is
durable and remain available until the next retained capture replaces them.
Another browser/device cannot yet inspect this local progress journal remotely.
Enable **Sync this device's files automatically** to admit recurring work.
Closing the Mac window preserves the app-owned runner; quitting the app stops
execution until it reopens. No always-running OS service is claimed.

Symbolic-link content/restore, hard-link relationships, faithful special-entry
metadata and full-home installed acceptance remain separate unfinished work.
Android remains deferred. Existing grants, private destination selection and
the home exclusions must be reviewed before real account transfer.

## Sync ignore rules — 2026-10-19

The connection editor at `/settings/things` exposes a separate root-relative
Gitignore rule list. Exact excluded paths continue to take precedence. The
common-exclusions action fills editable dependency/cache directory rules such
as `node_modules/`, Python environments, Gradle/Maven caches, CocoaPods, Dart,
Rust and Go module caches. It does not erase exact exclusions or start a run.

Patterns follow [Git's ignore syntax](https://git-scm.com/docs/gitignore): one
rule per line, comments with `#`, ordered `!` exceptions, root anchoring with
`/`, directory-only trailing `/`, wildcards and escaped literals. An ignored
parent must itself be included before a child exception can take effect. A
path checker lets the user review the result. Repository `.gitignore` files
are not automatically read; this list belongs to the selected sync connection.
Matching is case-sensitive. Native traversal prunes ignored entries before
opening or hashing their content. Intentionally excluded entries do not count
as incomplete backup coverage, and previously saved copies are retained.

Nonempty rules use saved `configurationVersion: 2`, negotiated through
`api.things` 1.38.0 and Mac `fileAccess` 1.9.0. Older clients refuse version2
instead of dropping the policy. Empty-rule configurations retain version1
compatibility. Changing a policy requires stopping the current admission,
saving the edited connection and explicitly starting it with new local
approval; pending operation receipts remain separately protected. Rules and
exact exclusions are part of capture identity and must survive retries with
the same spelling. Installed home-upload acceptance is tracked in
[PR1049](../PRs/1049-home-backup-indexing-resumable-partial-captures.md).
