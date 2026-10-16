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
10-test emulator suite uses generated providers and does not prove that path.
