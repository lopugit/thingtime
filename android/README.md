# Thingtime Android

Native Android shell for the existing Thingtime web UI. Requires Android 8.0
(API 26) or newer and an updated Android System WebView. Native capabilities include account-scoped device pairing and selected-folder
access. Photos access and background sync remain separate work in [the acceptance ledger](../docs/mobile-file-sync.md).

## Build and run

Install JDK 17, Android SDK platform/build-tools 35, platform-tools and a supported
emulator image (or connect a test phone). Set `JAVA_HOME` and `ANDROID_HOME` to
your local installations. The checked-in Gradle wrapper verifies its distribution
checksum. No account-specific credentials or signing keys belong in git.

```sh
./android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n com.thingtime.mobile.dev/com.thingtime.mobile.MainActivity
```

Production defaults to `https://thingtime.com`. To target a compatible fork or
preview, pass `-PthingtimeWebUrl=https://your-thingtime.example` at build time.
The native bridge is restricted to that exact origin and main frame. Sign into
a full account, open Things or Settings → Things, then choose **Add this device**.
Older servers without the advertised pairing capability versions fail closed.

For local development, start the checkout's PM2 stack with `npm run web-pms` and
read its port with `npm run web-ports`. Build with
`-PthingtimeWebUrl=http://127.0.0.1:<web-port>` and run
`adb reverse tcp:<web-port> tcp:<web-port>`. Only debug builds permit loopback
HTTP; release builds require HTTPS. Debug installs use `com.thingtime.mobile.dev`.
Release signing and Play Store delivery are not configured by this checkpoint.

## Native acceptance

`android/scripts/test-mobile-devices.sh` runs JVM, lint, build and emulator/device
tests, then launches the rebuilt app. Set `ANDROID_SERIAL` if more than one test
device is connected. Without a fixture, the local API test is skipped.

For real pairing acceptance, create a disposable full account through the local
`POST /api/v1/auth/register` endpoint and save `base`, `username`, `password` and
`userId` in a mode-0600 JSON file outside the repository/web root. Then run:

```sh
ANDROID_SERIAL=<test-device-id> android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

The script streams the fixture into the debug app's private storage, never adb
arguments or APK assets. Tests consume/delete it and sign the disposable session
out. The encrypted pairing record and its server device remain for retry tests.
Tests verify signature compatibility with the iOS/server fixture, exact completion
replay, account/origin isolation, cancellation, revocation, Keystore encryption,
tamper rejection, API readback and the installed Things connection control.

Software Ed25519 seeds and pending requests are encrypted with an Android
Keystore AES-GCM key and stored under `noBackupFilesDir` using atomic writes.
They never cross the JavaScript bridge. This does not claim hardware Ed25519
signing. Missing/corrupt storage fails closed. Navigation/backgrounding cancels
foreground work; no continuous background presence or file permission is claimed.

Implementation references: [Android WebView message listener](https://developer.android.com/reference/androidx/webkit/WebViewCompat.WebMessageListener),
[Android Keystore](https://developer.android.com/privacy-and-security/keystore),
[AGP 8.9 compatibility](https://developer.android.com/build/releases/agp-8-9-0-release-notes).

## Selected folders

After pairing, **Folder access → Choose folder** opens Android's system Files
picker (`ACTION_OPEN_DOCUMENT_TREE`). Only the returned read permission is
persisted; no broad storage/media permission, new secret or account-specific
environment setting is required. A fork uses the same configured HTTPS origin
and normal sign-in described above. Android 11+ restricts selectable system
locations; respect the picker rather than requesting all-files access.
See [Android's Storage Access Framework contract](https://developer.android.com/training/data-storage/shared/documents-files).

`fileAccessVersion` 1.0.0 uses the same choose/list/scan/read/remove protocol as
iOS. Tree URIs stay in an atomic, Keystore-encrypted no-backup registry; web
settings receive opaque IDs and names. There are at most 32 roots per account/
origin, 128 total, and 60 KiB of encoded registry data. Removing access saves the
new registry before releasing a URI permission; another account's reference
keeps its grant. It never deletes provider files. Failed saves cannot publish
new references or revoke another account's access.

Scans are limited to 10,000 entries and 4 MiB metadata. Unknown-size, virtual,
loading, missing, colliding and changed items fail without a successful empty
inventory. Reads return at most 64 KiB and verify the entire file fingerprint
because provider timestamps can be missing or unchanged. This currently rereads
a file for each chunk: it is suitable for bounded foreground checks, not the
final large-file/background transport. Native workers still need efficient
verified streaming/snapshot publication, resumable work and transfer policies.
Selecting a folder alone does not start uploads.

JVM tests cover multipart bytes, changed content with identical metadata,
empty files, path/collision failures and bounds. Emulator tests cover grant
reference accounting, failed saves, encrypted namespace isolation, real
ContentResolver/DocumentsProvider descriptors with synthetic data, and the
installed app's authenticated list bridge. The provider fixture is isolated to
tests and does not prove the system picker or third-party provider behavior.
For manual picker acceptance, use a test-only `Documents/ThingtimeSyncQA` folder
containing `original.bin` (8 MiB + 17 bytes, all byte value 13). The optional
`DeviceLiveTest` instrumentation argument `folderSelection=true` waits for the
operator to choose that folder, then checks its real fingerprint/read and grant
removal. It needs the same private local fixture as ordinary live acceptance;
never select personal folders for this test. This optional test is not enabled
by the normal acceptance script and remains unverified.

Run that optional operator-assisted check with
`THINGTIME_FOLDER_PICKER_TEST=1 ANDROID_SERIAL=<test-device-id> android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json`.
The standard script leaves it disabled. Prepare the named synthetic folder
before starting; when the installed app appears, use **Choose folder** to select
it within five minutes. The script's final result includes the picker assertions.


### Verified reads and foreground upload acceptance

File access 1.2.0 supports opt-in chunk-verified ranges, using a process-local
cache bounded to 512 files / 8 MiB of proof bytes. Complete scans derive the
proofs; account/origin/grant/content-version scope prevents cross-use. Missing
proofs and legacy reads keep full verification. The web transport performs a
full native source check before publishing a file. Seekable provider descriptors
avoid rereading prefixes; streaming-only providers and oversized proof sets still
need native transport work. This does not implement a background worker.

`THINGTIME_FOLDER_UPLOAD_TEST=1 ANDROID_SERIAL=<test-device-id> android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json`
adds real cloud upload acceptance to the optional picker test. Use the existing
disposable localhost account, normal upload approval and attachment storage
setup documented in the root README. Select only the named synthetic folder
containing the one documented file; additional entries fail before upload. The
test creates a private cloud folder/configuration, presses Upload now, compares
an independently downloaded SHA-256, then removes its settings/root through
normal APIs and retains the accounted file in private Trash. Remove temporary
fixture admin settings and restart the managed server afterward. This optional
path is compiled but still awaits successful picker/upload execution; the normal
pairing/folder emulator suite uses generated providers and does not prove that path.

### Private download staging and process recovery

Android advertises `fileStagingVersion` 1.1.0 when WebView supports binary
ArrayBuffer messages, otherwise 1.0.0, separately from publication. The
foreground bridge accepts the shared `stage-begin`, `stage-append` and
`stage-finish` requests only after authenticating the current owner and resolving
that owner's selected readable folder. Each call rechecks authentication before
responding. Native provider URIs and paths never cross the bridge.

Staging 1.1 also accepts `stage-range`: the shared downloader sends at most
2 MiB per range (native protocol maximum 32 MiB). Native code requests one
64 KiB frame at a time using a fresh nonce bound to the pending request,
owner and origin. Frames are raw ArrayBuffers with a 36-byte nonce header;
bytes never enter the JSON metadata. The foreground/origin gate and cancellation
checks apply throughout. A whole range has a five-minute deadline; a stalled
frame fails after 15 seconds, and cancellation wakes a waiting reader within
100 ms. Identity and the selected read grant are checked at
both range boundaries. One fsync/checkpoint follows the complete range, so an
interrupted partial range is discarded on resume; matching replay compares
every retained byte. Older WebViews and iOS retain the 64 KiB chunk path.
See [WebView binary messages](https://developer.android.com/reference/androidx/webkit/WebMessageCompat).

Bytes stay in app-private no-backup storage. An immutable operation binds owner,
origin, device, connection and native grant. Chunks are at most 64 KiB; fsynced
bytes precede an atomically replaced progress record. Interrupted extra tails
are discarded only beyond the acknowledged offset, matching retries are
idempotent, and completion verifies the entire SHA-256 or canonical multipart
fingerprint. Private symlinks, nonregular files, hard links, altered operations
and changed completed stages fail closed. Cancellable in-process serialization
plus a kernel file lock protects concurrent callers; cancellation cannot close
another thread's lock descriptor. Android 8.0 uses second-resolution stamps,
while all completed stages still require full content verification.

This does not write into the selected folder, request a write grant, or enable
Download now into generic SAF folders. Offline-root downloads are described below;
retained-conflict controls, background
transfers and staging retention cleanup remain required work. The receiver uses
the existing editable connection and transfer shapes; it adds no service or
secret configuration.

With JDK 17, Android SDK 35, `adb`, Node and the installed `remix` dependencies:

```sh
ANDROID_SERIAL=<test-emulator-id> THINGTIME_WEB_URL=http://127.0.0.1:14900 \
  android/scripts/test-mobile-staging-process.sh
```

Use a disposable emulator; the script rebuilds/installs the debug app and kills
only its instrumentation host at two deliberate boundaries. It needs no account
fixture or selected folder. One scenario dies after payload fsync before the
progress checkpoint; the other dies after a verified stage is saved. A fresh
process must resume the original operation, verify 8 MiB + 17 bytes, and pass the
production TypeScript response codec. Successful checks remove their generated
native fixtures. A failed check leaves `SyncStagingProcessAcceptance` under the
test app's no-backup storage for inspection; do not discard it before verifying
the failed operation. Logs and non-secret wire evidence are in
`android/build/staging-process/` (ignored). This is Android 15 / API 35 emulator
process-exit evidence, not reboot, low-disk, physical-device or provider-write
acceptance. The ordinary suite skips this opt-in process test.

## Native write approval acceptance

Initial folder selection still persists only read access. The native
`write-approve` handler implements the shared mobile approval contract. Generic
SAF roots do not advertise per-root publication support, so their Download now
control remains disabled. Approval alone does not modify provider files.
Thingtime offline roots use the separate native flow below.

Each approval requires the native **Allow downloads** dialog followed by Android
Files re-selection of the exact tree with write permission. The bridge verifies
the account before consent and again after the picker returns. The encrypted
registry binds approval to account/origin, remote root, device, configuration
revision/hash and a native selection generation. Re-selection clears approvals
and changes that generation even for the same URI. Changed configuration needs
new approval; identical approved requests can retry without another prompt.
Backgrounding/navigation cancels consent. Removing/re-selecting the last approved
reference releases write permission while preserving another account's read or
write references. Reacquiring revoked OS write access clears older approvals
for that tree across accounts/connections. Failed persistence releases only
newly acquired write access.

With the disposable local account and synthetic `Documents/ThingtimeSyncQA`
fixture from the picker section above, run:

```sh
THINGTIME_FOLDER_APPROVAL_TEST=1 android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

Select the fixture through **Choose folder → Existing folder**. Cancel the first native approval.
On the next dialog, choose **Continue to Files**, select the same test folder,
and accept Android's access prompt. Cancel the next native dialog, which tests
a changed configuration revision. The test verifies encrypted reload, exact
retry, actual persisted OS permissions, and re-selection invalidation, then
removes its grant references. Never select personal folders for this acceptance.
This sequence passed on Android 15 / API 35 on 2026-10-17; it does not establish
Android 8.0, physical-device, background or provider publication acceptance.

`THINGTIME_FOLDER_DESCRIPTOR_TEST=1` optionally probes a selected directory's
read-only descriptor. On the tested Android 15 external-storage provider,
opening the directory succeeded but opening `original.bin` relative to that
descriptor failed with `EACCES`. A descriptor does not bypass scoped storage.
The probe prints only booleans and error class/errno to Android's `System.out`
log. It performs no provider writes. Generic SAF rename is not an atomic
compare-and-swap contract: [DocumentsContract](https://developer.android.com/reference/android/provider/DocumentsContract)
allows changed document IDs, and the [AOSP filesystem provider](https://android.googlesource.com/platform/frameworks/base.git/+/master/core/java/com/android/internal/content/FileSystemProvider.java)
chooses an available destination name before rename. Publication still requires
a supported adapter with explicit destination preconditions and durable recovery.

## Offline-folder publication backend checks

The app contains `ManagedFileStore`, the native backend for Thingtime-owned
offline folders under `noBackupFilesDir/ManagedFiles-v1`. Native creation and
read-only Android Files exposure are described below. Generic selected SAF
trees are never written by this backend. Per-root capability and current native
approval now gate the foreground download adapter described below. No broad storage permission is requested.

Completed stages are copied through read-only descriptors, independently
verified and fsynced. Synchronous SQLite transactions commit conditional file
entries and immutable operation receipts together. Displaced blobs and versions
remain retained. Failed or uncertain operations keep unreferenced candidates
until a future bounded cleanup can prove they are unused. Scans cap metadata at
4 MiB / 10,000 entries; the store caps blobs at 10,000 and currently verifies
whole files even for ranged reads. Do not treat this as finished retention,
large-file performance, background sync or arbitrary-provider publication.

With the same JDK/SDK/adb/Node setup, on a disposable emulator run:

```sh
THINGTIME_WEB_URL=http://127.0.0.1:14900 android/scripts/test-mobile-managed-process.sh
```

The origin override is optional; the default is the public HTTPS origin. This
acceptance uses only generated app-private fixtures, no account credentials or
selected folders. Three scenarios kill the actual instrumentation process
inside the SQLite transaction, after commit and after replacement. A fresh
process verifies rollback/replay, independent full bytes, retained originals and
historical receipts after a later edit. It exports non-secret native receipts
into ignored `android/build/managed-process/`; the shared TypeScript codec must
accept them. Successful verification removes only this test's private fixture
and exported device file. A failed prepare leaves its proof for investigation;
do not delete it or start another prepare until that run is verified. Ordinary
`test-mobile-devices.sh` runs skip the deliberate process-kill test.

No dependency, secret, service or deployment variable is added. SQLite is the
Android platform's local storage primitive; server file entities, settings and
Timeline continue through the existing Thingtime APIs and shared contracts.


## Offline folders in Android Files

**Choose folder → New offline folder** opens native naming/consent, then the
system picker at the new root. Cancel before creation leaves no root. Cancel in
the subsequent picker leaves the created local folder in Files. Existing
folders retain their normal SAF flow. Roots are bound to account/origin for
Thingtime selection, but their explicitly consented Files visibility survives
sign-out and removal of account access. Uninstall removes this app-private
storage. Folder deletion/retention controls remain pending.

`OfflineDocumentsProvider` requires Android's `MANAGE_DOCUMENTS` permission;
other apps receive access only through the system picker's document/tree grants.
It lists explicitly exposed roots, uses stable opaque IDs and indexed ancestry,
and returns read-only verified snapshots. Replacement preserves an already-open
reader's original bytes. No create/edit/rename/delete flags or writable handles
are exposed. The v1→v2 catalog migration keeps existing private roots hidden.
Listings fail closed above 10,000 children / 4 MiB metadata. Arbitrary providers
are not treated as transactional destinations.

With the private local-account fixture described above, use a disposable API 35
emulator and run:

```sh
THINGTIME_OFFLINE_FILES_TEST=1 android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

At `OFFLINE_CREATE_QA_READY` in `adb logcat -s System.out:I`, cancel one native
creation, then create **ThingtimeOfflineQA** and select its root in Files.
The test publishes only synthetic nested data through the native backend,
verifies every byte of an 8 MiB + 17-byte file through ContentResolver, then
checks the real bridge and **Check folder** result. At `OFFLINE_FILES_QA_READY`,
inspect **ThingtimeOfflineQA/nested/original.bin** in Files and return to
Thingtime. Only after that inspection, acknowledge with:

```sh
adb shell run-as com.thingtime.mobile.dev touch files/offline-files-confirmed
```

The marker is test-only private state, not a production bridge command. Each
manual phase has a five-minute timeout. The test removes its native grant and
verifies that local files remain, then deletes only its synthetic root/blob
fixtures. Never select a personal folder for this acceptance. If a run times out
before selection, reuse its empty **ThingtimeOfflineQA** root through **Existing
folder** on the next attempt instead of creating another root.

This is Files access acceptance, not cloud Download now or OS editor support.
Run the process-recovery script above after catalog changes. Physical devices,
API 26, reboot/power loss, large files, background execution and writable Files
operations remain separate acceptance work.


## Foreground cloud downloads to offline folders

Builds advertising `filePublicationVersion` 1.1.0 require per-folder
`publicationVersion` 1.0.0. Only explicitly created Thingtime offline roots
advertise this capability; generic SAF selections remain read/upload sources.
Choose an offline root, create an ordinary Download connection with deletion
propagation off, then use **Download now**. Native **Allow downloads** approval
is bound to the account, origin, device, selected grant generation and exact
connection revision/settings. Changing settings or reselecting the root requires
renewed approval. Removing access stops future writes and keeps downloaded files.
The approval does not grant writable Files descriptors to other apps.

The adapter rechecks the current persisted OS read grant, root ownership and
approval before publication, uses the existing private stage and transactional
catalog, and publishes the shared receipts. Files listings receive a change
notification after publication. Transfers require the app to stay open; native
background scheduling, general-provider writes and restore/retention UI remain
pending. No additional secret, service or broad storage permission is needed.

For installed acceptance, use a disposable loopback account with private-upload
approval and the existing local attachment storage setup. Keep the account
fixture and state file outside the repository with mode 0600. From `remix/`:

```sh
node --import tsx scripts/mobile-sync-installed-fixture.mts /absolute/path/private-fixture.json /absolute/path/download-state.json prepare
```

From the root, with JDK 17 and Android SDK 35 configured:

```sh
THINGTIME_OFFLINE_DOWNLOAD_STATE=/absolute/path/download-state.json android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

Cancel one creation, then create/select the default **Thingtime offline** root.
Cancel the first native download approval, then allow the retry when prompted.
The test uses the real connection controls and cloud APIs, checks independent
SHA-256 hashes of the 17-byte text and nested 8 MiB + 17-byte file, and repeats the
transfer without changing native entries. At `OFFLINE_FILES_QA_READY`, inspect
**Thingtime offline/nested/sample.bin** in Files, return to Thingtime, and write
the confirmation marker using the command above. The test removes its connection,
grant and synthetic local fixtures. Then from `remix/` clean up its cloud fixtures:

```sh
node --import tsx scripts/mobile-sync-installed-fixture.mts /absolute/path/private-fixture.json /absolute/path/download-state.json cleanup
```

Cleanup retains accounted file versions in private Trash. Never use personal
folders or enable production admin access for this test.

This installed cloud/Files sequence passed on Android 15 / API 35 on 2026-10-17:
46 executed native checks plus two skipped opt-in process cases (`OK (48 tests)`),
26 JVM checks, build and lint. Initial and repeated downloads retained matching
bytes and identical native entries. This does not establish physical/API 26,
background, reboot, throughput or real cloud replacement acceptance.


### Two-way foreground acceptance

Two-way connections expose **Sync now** for approved Thingtime offline folders,
with deletion propagation off. One run uploads local additions/edits and downloads
cloud additions/edits. Native Files is still read-only: this is not yet a general
Android Files editor. Both-changed and delete/edit conflicts preserve both copies
and stop before effects; conflict resolution and background scheduling remain open.

Use the same disposable cloud fixture as the download runbook, then add
`THINGTIME_TWO_WAY_SYNC_TEST=1` to its test command. This opt-in case seeds a
synthetic native file through the production catalog, exercises the installed
**Sync now** control and native Cancel/Allow consent, independently hashes both
transfer directions and repeats the run. Once instrumentation has opened the
app, follow its prompts in a second terminal using the current test process:

```sh
test_pid="$(adb -s <test-device-id> shell pidof com.thingtime.mobile.dev | tr -d '\r')"
test -n "$test_pid" && adb -s <test-device-id> logcat --pid="$test_pid" -v brief -s System.out:I
```

The runner's final report is buffered, and these manual prompts are emitted to
logcat. Obtain a new PID after each test launch; unscoped logcat can include
messages from earlier runs. At `TWO_WAY_EDIT_READY`, run from `remix/`:

```sh
node --import tsx scripts/mobile-sync-installed-fixture.mts /absolute/path/private-fixture.json /absolute/path/download-state.json replace
adb -s <test-device-id> shell run-as com.thingtime.mobile.dev sh -c '"cat > files/two-way-cloud-updated.json"' < /absolute/path/download-state.json
```

This changes a cloud file while the test separately edits its local fixture.
The next run must replace each opposite copy, retain the uploaded file's stable
identity, and converge without further revisions on a repeated run. Complete
the settings reapproval sequence next: the test changes the connection name and
exclusions through the ordinary revision-guarded Things API, then refreshes the
installed UI. At `TWO_WAY_REAPPROVAL_CANCEL`, cancel the renewed native approval;
at `TWO_WAY_REAPPROVAL_ALLOW`, allow the retry. Both checks require identical
cloud inventory/revisions and native entries/full byte hashes. This models
settings saved elsewhere; it does not test editing those fields in the form.
Complete Files inspection and normal cleanup as above. No native grants or replies are
fabricated, and all cloud writes use canonical APIs. Test fixture creation is
not evidence of an Android Files editing UI.

The full two-way sequence, including settings reapproval, passed on the Android
15 / API 35 emulator on 2026-10-17: 46 executed native checks and two skipped
opt-in process cases (`OK (48 tests)`), 26 JVM checks, debug build and lint.
This confirms foreground behavior with synthetic fixtures; physical devices,
throughput, background work and interrupted two-way restart remain open.

### Installed conflict review acceptance

Set `THINGTIME_CONFLICT_SYNC_TEST=1` alongside `THINGTIME_TWO_WAY_SYNC_TEST=1`
and the existing offline-download state. The test uses the real shared controls
and native selected folder. At each process-scoped `CONFLICT_CLOUD_EDIT_READY_N`
prompt, run the existing fixture script with action `conflict`, then copy that
same state to `files/conflict-cloud-updated.json` in the debug app. This replaces
only the synthetic `hello.txt` through the normal upload/file APIs. Follow
`CONFLICT_REVIEW_CANCEL`, `CONFLICT_REVIEW_CLOUD` and `CONFLICT_REVIEW_DEVICE` in
the app, choosing the requested version and Apply choices and sync. The runner
checks full native/cloud hashes and repeated convergence before continuing the
saved-settings consent and Android Files checks. Keep all fixture state private;
use the existing cleanup action afterward.

### Installed file History acceptance

With the same disposable local account fixture, run
`THINGTIME_FILE_HISTORY_TEST=1 android/scripts/test-mobile-devices.sh /private/path/fixture.json`.
The runner requires Java 17 (`JAVA_HOME`) and the Android SDK (`ANDROID_HOME`),
builds and installs both debug APKs, and uses the real shared History page. It
creates two private file versions, filters by filename and Files, cancels a
restore without changing its revision, restores the earlier bytes, and hashes
both retained attachments. The synthetic file is left in private Trash with
its accounted versions. `files/file-history-qa.png` in the debug app contains
the restore-review screenshot. This verifies authorized byte reads; saving a
History download into Android Files is a separate native export acceptance.

### Save historical versions to Android Files

History negotiates native `fileExportVersion` 1.0.0 and shows **Save this version**.
Android checks the signed-in account and exact attachment identity, streams
existing authorized 2 MiB ranges into private cache, verifies the multipart
content ID, and opens the system Save As picker. The user chooses the name and
location. It reads back the provider document before reporting success. The
adapter never receives arbitrary URLs, follows redirects, or retains a folder
permission. Cancellation, navigation, session changes and activity destruction
stop the request; picker return reauthorizes before writing. Interrupted provider
writes may leave a partial document, so the UI asks the user to check Files.
Exports are foreground operations, without background restart/resume.

For installed acceptance, add `THINGTIME_FILE_EXPORT_TEST=1` to the History
command above. Cancel the first system Save As dialog, then save both versions
into Downloads. The second name receives Android's collision suffix. Check the
logged unique fixture filename independently in Downloads: the first file must
contain 128 bytes of value 11 and the second 257 bytes of value 22. The test
retains only those synthetic exported files for inspection; cloud cleanup still
uses private Trash. Never remove unrelated Downloads files.

Export pins the exact `tt_auth` credential, not the whole cookie header. Unrelated
cookie refreshes do not cancel a save; changed/missing/ambiguous auth still stops
it. The native adapter rechecks the current owner and exact attachment after the
picker before copying. API 35 installed acceptance and independent Downloads
byte checks passed; physical devices and other document providers remain open.

### Native whole-file uploads (upload capability 1.2)

Android runs whole-file and per-part multipart uploads in the native host. The
shared sync journal keeps the original upload/operation identities and publishes
verified results into Timeline. Native code rechecks the current pairing, exact
private connection revision, folder/photo grant, network and charging policy.

The host verifies each source with 64 KiB reads and bounded part digests, then
stages one verified part in private `noBackupFilesDir/NativeUploadParts-v1`.
Only progress and receipts cross the WebView. OkHttp uses explicit account API
authentication and an isolated storage client without cookies, authenticators or
redirects. No new secrets or environment variables are required. A normal job
reads the source three times; provider seek efficiency and large-file throughput
remain to be measured. Disk space must accommodate one canonical multipart part
plus 16 MiB, in addition to retained recovery parts. The private cache reserves
at most 32 parts / 5 GiB across accounts. Uncertain upload replies retain verified
parts under their original IDs; success releases them. There is no silent eviction.

API 35 installed folder acceptance verifies an 8,388,625-byte, two-part upload
and matching cloud download hash with zero bulk WebView frames. Installed photo
acceptance verifies two native jobs, added-photo discovery and retained cloud
bytes after local deletion. Small synthetic photo fixtures do not establish
large-library throughput.

This capability is foreground-only: leaving the app cancels its request. Retry
reuses the original server IDs and hash-verified cached parts; an incomplete
capture is recaptured, and an already-ready upload needs no source read.
The native cache binds owner/origin, root, grant generation, source, upload,
operation and part. Every retry still verifies the current full source, account,
permissions and connection policy. Removing the folder selection revokes access
and removes only that account/root's cached parts. It saves no cookies, signed
URLs or connection authority and is excluded from Android system backups.
WorkManager/service scheduling, autonomous relaunch, real interrupted network
acceptance and physical-device background behavior remain separate work.

The opt-in `NativeUploadRecoveryTest` uses an 8 MiB + 17 byte synthetic source and
transport to prove private-filesystem recovery across two Android processes. With
the debug and androidTest APKs installed on a disposable test device:

```sh
adb -s <test-device-id> shell am instrument -w \
  -e class com.thingtime.mobile.NativeUploadRecoveryTest \
  -e nativeUploadRecovery capture \
  com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner
adb -s <test-device-id> shell am force-stop com.thingtime.mobile.dev
adb -s <test-device-id> shell am instrument -w \
  -e class com.thingtime.mobile.NativeUploadRecoveryTest \
  -e nativeUploadRecovery recover \
  com.thingtime.mobile.dev.test/androidx.test.runner.AndroidJUnitRunner
```

Both phases must report `OK (1 test)`. Capture refuses to overwrite an existing
fixture. Recovery requires a different PID, checks original IDs and every byte,
proves the retained part was not reread from the source, and removes its fixture.
This is deterministic disk recovery after a simulated lost reply, not a claim of
OS-managed background transfer or real network interruption.

### Binary upload fallback (native access 1.4)

Updated WebViews negotiate acknowledged binary upload ranges. This uses the
existing selected-folder grant, account, upload APIs and cloud quota flow; no
new permissions, private settings or credentials are needed. Older WebViews
keep access 1.3 and bounded chunk messages. Downloads keep staging 1.1.

Run the existing real SAF upload acceptance with the disposable account and
`Documents/ThingtimeSyncQA/original.bin` described above:

```sh
THINGTIME_FOLDER_UPLOAD_TEST=1 ANDROID_SERIAL=<test-device-id> \
  android/scripts/test-mobile-devices.sh /absolute/path/private-fixture.json
```

Choose only that synthetic folder in the system picker. The test checks the
cloud file's complete SHA-256 and requires one native whole-file job with zero
binary upload frames or legacy multi-byte reads on current hosts. Older hosts
without upload capability retain the binary-range fallback. The native range limit is 32 MiB;
frames are 64 KiB with one outstanding acknowledgement. Managed offline reads
verify the full immutable blob for each range; background workers and iOS binary
transport remain separate work in the acceptance ledger.


### Retained replacement versions (native versions 1.0)

Offline-folder schema 4 exposes previously preserved replacement versions through
20-item pages and native-reviewed independent copy restore. The original grant,
account and origin remain required; a copy receives a new document identity and
an atomic operation receipt. Current and retained bytes stay intact. Existing
schema 3 history is migrated without inventing capture timestamps.

Run `THINGTIME_OFFLINE_FILES_TEST=1 THINGTIME_NATIVE_VERSIONS_TEST=1
android/scripts/test-mobile-devices.sh /path/to/private-fixture.json` from the
repo root, with the SDK/JDK setup above. Follow streamed synthetic-folder prompts,
then inspect both copies in Files and acknowledge as in the root README. The
installed API 35 suite passed 67 tests, including cancellation, WebView reload,
exact operation replay and full restored hash. This storage is local and excluded
from OS backup; independent snapshot inclusion and physical-device acceptance
remain open. See [the acceptance ledger](../docs/mobile-file-sync.md).


### Photo library backup (Android 11+)

Choose **Photo library (backup)** in the native folder menu, approve access to
photos/videos and original embedded location metadata, then select the library
or a storage volume in Files. Android 14+ can grant selected media only; the
connection shows limited access explicitly. This read-only source uses the same
editable file-sync Thing and foreground cloud/Timeline pipeline as folders.
Photo connections require backup mode and keep cloud copies after device deletion.
There are no new server secrets or private dashboard settings.

The adapter requests original bytes without media transcoding, excludes pending
and trashed media, and fences inventories with MediaStore volume version and
generation. Permission loss fails the scan; it cannot become a successful empty
inventory. Original names are prefixed with MediaStore IDs to distinguish duplicate
names. The existing 10,000-entry selected-tree bound remains; background completion,
large-library paging and other platforms' photo-library adapters remain open.

Use `THINGTIME_PHOTO_BACKUP_TEST=1 ANDROID_SERIAL=<test-device-id>
android/scripts/test-mobile-devices.sh /path/to/private-fixture.json` with the
SDK/JDK setup above on a disposable emulator. Follow the native photo permission
and Files selection prompts. The opt-in test creates its own image and excludes
all other existing media from uploads. It verifies the cloud download hash,
additional media discovery, retained cloud copies after local deletion and a
repeat run. The ordinary installed suite also checks the read-only provider,
duplicate names, permission/cancellation fencing, and pending/trashed media.

Android contracts: [partial access](https://developer.android.com/about/versions/14/changes/partial-photo-video-access)
and [original formats and media generations](https://developer.android.com/reference/android/provider/MediaStore).


### Current-file background upload continuation

Upload capability 1.3 admits one foreground-started file to Android 14+ UIDT
(`JobScheduler`) or an Android 8–13 data-sync foreground service. A generic
notification shows progress and Pause without filenames/account details. The
legacy service holds a bounded wake lock; it is not sticky. OS stop, notification
Pause, account/navigation changes, revoked grants, network/power policy changes
and activity destruction cancel native work. Completed parts release their cache;
uncertain parts keep the existing scoped recovery contract.

The Android connection control performs `prepare-upload` before reservation or
transfer work. Android 13+ asks for POST_NOTIFICATIONS once, then reauthenticates
on returning to the foreground. Declining or disabling notifications/channel,
unsupported admission or OS refusal keeps foreground-only behavior. Preparation
carries no file or upload authority. Other clients never send this Android-only
action. Only an exact, correlated OS-start acknowledgement permits the current
native upload to survive visibility changes; page exit still cancels.

After the native file completes, the result waits for a foreground owner check.
The existing shared journal verifies the stored result and publishes the canonical
file/Timeline write. It then advances the folder. No credentials or job authority
are persisted, and process death does not restart an authenticated job. This is
current-file continuation, not autonomous whole-folder background sync.

For installed acceptance, use `THINGTIME_BACKGROUND_UPLOAD_TEST=1` with
`android/scripts/test-mobile-devices.sh /path/to/private-fixture.json`. In the
same disposable `Documents/ThingtimeSyncQA` folder, temporarily replace only the
synthetic `original.bin` with 32 MiB + 17 bytes, all value 13; restore the ordinary
8 MiB + 17 byte fixture afterward. Select that folder through the real picker.
Allow the observed Thingtime notification prompt on the first run. The account
needs normal upload permission and enough available storage for new versions:
old acceptance files remain accounted for in private Trash and Timeline. Restore
any temporary local test-account quota override afterward; never erase history
to make acceptance pass.

The test observes a pending reservation, backgrounds the actual activity, then
checks its exact stored fingerprint through read-only API calls until ready. It
returns to the WebView, downloads pinned ranges to verify the full SHA-256, and
checks one native job with zero bulk WebView upload bytes. OS tests exercise the
notification Pause action, stale Pause, scheduler cancellation and normal cleanup.
Without enabled notifications, ordinary service tests are explicitly skipped;
the background acceptance mode requires them. Physical devices, Android 8–13
installed service behavior, process relaunch and sustained large-data throughput
still require acceptance.

Android contracts: [user-initiated transfers](https://developer.android.com/develop/background-work/background-tasks/uidt)
and [foreground service launch](https://developer.android.com/develop/background-work/services/fgs/launch).
