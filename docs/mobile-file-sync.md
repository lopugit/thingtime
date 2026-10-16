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
  persistent sync daemon. The iOS shell has recordings, Watch attachment upload paths and native mobile pairing. There is no Android native application in this tree.

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
cancel the worker. This is not a background file-sync scheduler. No file or photo
permission is requested. Native Android still needs its own secure implementation.

The opt-in `iOS/scripts/test-mobile-devices.sh` uses a disposable API-created
account on localhost to verify a real pairing, online readback, Keychain reload
and repeat-pair identity. See the README for setup. Simulator builds must retain
normal simulator signing: disabling signing also prevented Keychain access in
this test environment. The runtime remains fail-closed on secure-storage errors.

## Remaining acceptance work

| Requirement | Required evidence | Current state |
| --- | --- | --- |
| Add this iPhone/iPad or Android device in Things | Native discovery, authenticated pairing, refresh/relaunch readback, correct account/origin, revoke and reconnect on actual app | iOS client, Keychain and Things/Settings control implemented; local API and simulator engine verified; signed-in app click-through, physical iOS and Android pending |
| Safe native credentials and recovery | Keychain/Keystore storage; restart during prepare/complete; exact recovery without duplicate devices | iOS uses the existing proof protocol with durable Keychain pending claims; Android Keystore adapter pending |
| Folder sync across Mac, iOS, Android and cloud | Create/edit/rename/move/delete real byte fixtures in each direction; independent hash verification and convergence | Reconciler/executor foundation only |
| Persistent offline and background sync | Kill/relaunch, reboot, network loss, sleep/wake, quota errors, paused jobs; durable retries with original IDs | Browser journal tests only; native schedulers and transfer adapters pending |
| Large resumable transfers | Chunk interruption/resume, hash mismatch, cancellation, stale upload/finalization race; streaming memory bounds | Existing multipart attachments available; sync transport pending |
| Photos backup | Explicit selection/permission, incremental discovery, original photo/video bytes and metadata, duplicates, limited library changes, background completion | Pending |
| Sync settings | Folder selection, direction, pause/resume, Wi-Fi/cellular and charging policy, exclusions, retention, selective/offline availability | Core direction/delete policy only; saved Things and settings UI pending |
| Conflict and deletion recovery | Concurrent edits and delete/edit preserve both versions; conflict resolution UI, retained versions/trash restore | Core refuses destructive conflicts; storage/UI pending |
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
  behavior. Android and all real file-transfer acceptance remain pending.
