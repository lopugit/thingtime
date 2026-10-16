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
Trash operations for explicitly pinned destinations. Its prepared metadata is
retained with the existing journal run; no production UI starts these jobs yet.

The current scan bound is 10,000 combined paths, and directories must appear
alongside descendants. Large-root partitioning is still needed. Folder removal
must account for revision changes caused by its own completed child removals;
the current executor safely refuses a stale parent revision. No platform worker
or production UI invokes these modules yet.

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
| Folder sync across Mac, iOS, Android and cloud | Create/edit/rename/move/delete real byte fixtures in each direction; independent hash verification and convergence | Reconciler/executor, verified fingerprints and atomic stable-file replacement; cloud upload adapter verified; iOS folder grants/scans/reads implemented; native writes/workers and production sync UI pending |
| Persistent offline and background sync | Kill/relaunch, reboot, network loss, sleep/wake, quota errors, paused jobs; durable retries with original IDs | Browser journal and real cloud upload recovery verified; native schedulers/adapters pending |
| Large resumable transfers | Chunk interruption/resume, hash mismatch, cancellation, stale upload/finalization race; streaming memory bounds | Real executor multipart interruption and exact-identity retry verified; native streaming transport pending |
| Photos backup | Explicit selection/permission, incremental discovery, original photo/video bytes and metadata, duplicates, limited library changes, background completion | Pending |
| Sync settings | Folder selection, direction, pause/resume, Wi-Fi/cellular and charging policy, exclusions, retention, selective/offline availability | Core direction/delete policy and iOS folder-access controls; editable sync Things and policy UI pending |
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
