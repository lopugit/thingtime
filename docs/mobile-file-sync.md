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
retained with the existing journal run. The mobile connection controls start explicit foreground upload/backup, approved
downloads and two-way runs, as described below. Native delete propagation remains
disabled until recoverable native trash is implemented.

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
| Add this iPhone/iPad or Android device in Things | Native discovery, authenticated pairing, refresh/relaunch readback, correct account/origin, revoke and reconnect on actual app | iOS and Android clients implemented; real local API pairing and secure storage verified on both simulators; installed Things pairing verified on both simulators; physical devices pending |
| Safe native credentials and recovery | Keychain/Keystore storage; restart during prepare/complete; exact recovery without duplicate devices | iOS Keychain and Android Keystore-encrypted pending claims preserve exact completion replay; native recovery tests pass |
| Folder sync across Mac, iOS, Android and cloud | Create/edit/rename/move/delete real byte fixtures in each direction; independent hash verification and convergence | Reconciler/executor, verified fingerprints and atomic stable-file replacement; cloud upload adapter and complete private cloud inventory verified; iOS and Android folder grants/scans/reads implemented; foreground upload/backup controls and recoverable progress implemented; bounded cloud downloads and executor staging/receipt adapter verified; iOS native staging, approval and same-volume publication implemented and tested; Android private staging, native write approval, durable offline-folder publication, explicit native creation and read-only Android Files access verified; Android foreground offline-root cloud downloads, mixed two-way creates/independent replacements and actual Files acceptance verified; shared Apple publication core and process-exit recovery verified on macOS; Mac local adapter/identity/disconnect implemented; Electron host/shared controls, synthetic browser foreground acceptance and real Mac adapter/cloud mixed-transfer acceptance implemented; iOS mixed-direction simulator acceptance verified; iOS external Files edits, Mac installed transfers, workers and full cross-device transfer acceptance pending |
| Persistent offline and background sync | Kill/relaunch, reboot, network loss, sleep/wake, quota errors, paused jobs; durable retries with original IDs | Browser journal, Desktop full-process journal/draft restart recovery and real cloud upload recovery verified; iOS publication and Android staging process-exit recovery verified; native schedulers and reboot acceptance pending |
| Large resumable transfers | Chunk interruption/resume, hash mismatch, cancellation, stale upload/finalization race; streaming memory bounds | Real executor multipart interruption and exact-identity retry verified; Mac upload/download ranges and Android binary download ranges verified; mobile upload ranges, iOS streaming and sustained throughput remain pending |
| Photos backup | Explicit selection/permission, incremental discovery, original photo/video bytes and metadata, duplicates, limited library changes, background completion | Pending |
| Sync settings | Folder selection, direction, pause/resume, Wi-Fi/cellular and charging policy, exclusions, retention, selective/offline availability | Editable file-sync Things persist device/root/destination, direction, pause, network/power and exclusions; shared configured planner verified. Mobile folder and connection editors exist with durable local drafts and guarded API saves; foreground upload/backup checks live native network/power signals; iOS scoped Keychain and Android native/OS write approvals implemented; Mac native approvals/shared controls implemented with installed acceptance pending; retention/selective settings and background workers remain pending |
| Conflict and deletion recovery | Concurrent edits and delete/edit preserve both versions; conflict resolution UI, retained versions/trash restore | API preserves versions and supports Trash/restore; iOS preserves displaced versions and uncertain conflicts in the transfer journal; file conflict review now offers guarded version choices; Android review acceptance verified; iOS/Mac review acceptance, folder conflicts, restore browsing and retention policy remain pending |
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
