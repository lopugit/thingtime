# Thingtime iOS

Native iOS shell for Thingtime.

The project also includes a native watchOS companion. It pairs directly with a
signed-in Thingtime account through a short browser approval code and stores
only a Watch-scoped credential in the Watch Keychain. It can switch between
multiple production, development, and build-preview accounts; refresh and mark
notifications read; register its APNs token; and show live server health without
requiring the iPhone app to be reachable.

The Watch can create owner-only attachment Things directly, open Apple's native
high-quality audio recorder, keep Thingtime recordings locally for later upload
or re-upload, and retry interrupted transfers idempotently. Apple does not
expose the Voice Memos app's private recording library to third-party watchOS
apps; existing Watch Voice Memos must sync to iPhone and be uploaded in
Thingtime there.

The first version is intentionally small: a SwiftUI app that embeds Thingtime
in a native `WKWebView`. It defaults to `https://thingtime.com` and can be
pointed at a Vercel preview or branch deployment for TestFlight builds. A
left-edge swipe opens the in-app web destination drawer, where production,
the configured build URL, and deployments returned by
`/api/v1/vercel/deployments` can be selected without rebuilding the app. It
keeps the controls pinned while branch rows scroll lazily, and each branch can
expand into its ten most recent deployments. A queued newest deployment does
not block testing: the previous ready deployment is labelled as the last
successful build and remains directly selectable. Long branch and deployment
histories remain usable on every supported screen size. It
does not include any LiDAR, ARKit,
scanning, mesh, storage, or export functionality.

The deployment list tries the configured `ThingtimeWebURL` origin when present,
so preview-targeted TestFlight builds exercise the matching preview API and its
deployment-history contract. If that preview is unavailable or still serves
the legacy latest-only contract, the client falls back to
`https://thingtime.com/api/v1/vercel/deployments`; production builds use that
stable endpoint directly.

## Setup

### Connect the Watch during preview testing

1. On the Watch, choose **Build preview**, then an **Approve using** option:
   **Paired iPhone** (default), **Username**, or **Enter code**.
2. With **Paired iPhone**, open Thingtime on the phone and sign in to the same
   domain. The phone offers the request to its active account, without approving
   it. **Username** instead sends the pending request to the entered account.
   Any signed-in session for that account on that origin shows **Approve Watch**
   with the four-digit code prefilled. Check the account/device/code before tapping.
3. With **Enter code**, open the exact short address shown on the Watch, e.g.
   `https://your-thingtime-origin.example/pair/1234`, in a phone/computer browser.
   Sign in, select **Review Watch**, then **Connect**. You can also enter the PIN at
   <https://pr-596.previews.dev.thingtime.com/watch/pair> for PR #596.
4. Keep Thingtime open on the Watch until it connects. **Check approval** retries
   the same code; **Create new code** replaces an expired attempt. Codes last
   five minutes and cannot be entered at a different Thingtime domain. Leading
   zeroes are significant. Older eight-character codes remain accepted.

Watch sign-in requires the selected origin to advertise `api.watch-pairing`
1.2.0 (same major) in its capability manifest. A preview-targeted fresh install
defaults to the build preview; explicit saved choices remain respected. If
production does not advertise the contract yet, the Watch gives a preview
selection hint instead of calling a missing endpoint. Older full approval links
remain supported, but no browser opening on watchOS is required. A short address
at `thingtime.com/pair/1234` only works once that production origin has the matching
server release; this preview build displays the preview origin instead.

For independent local pairing QA, `pm2 start watch-pairing.ecosystem.config.cjs`
from the repo root uses `http://127.0.0.1:18290/watch/pair` (HMR 18291, Nitro
18292). This loopback-only fixture has a unique PM2 name and no automatic restart;
it does not replace another worktree's dev process. Run
`npm --prefix remix run test:api -- --base http://127.0.0.1:18290 --group watch`.
Tailscale/Funnel is not available on this host while its configured CLI points
to a missing Tailscale app; use the public PR preview for phone/Watch testing.

```sh
cd iOS
./scripts/bootstrap.sh
```

This installs XcodeGen if needed, generates `Thingtime.xcodeproj`, and opens Xcode.

## Build And Test

```sh
cd iOS
xcodegen generate
./scripts/build.sh
./scripts/test.sh
```

To build the watch app without signing:

```sh
xcodebuild -project Thingtime.xcodeproj \
  -scheme ThingtimeWatch \
  -destination 'generic/platform=watchOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

For device delivery, create App IDs and provisioning profiles for both
`com.thingtime.appletime` and `com.thingtime.appletime.watchkitapp`, enable Push
Notifications on both, and configure the server-side APNs values documented in
the root README. Do not put the `.p8` provider key in this Xcode project.

Set `DEVELOPMENT_TEAM` in Xcode, CI, or `config/Base.xcconfig` for local signing. Do not commit personal signing credentials or secrets.

## TestFlight Upload

The TestFlight lane expects App Store Connect and signing values from the
environment. For local uploads, copy the sample env file and keep the real
values untracked:

```sh
cp .env.example .env
bundle install
./scripts/testflight-beta.sh
```

Omit `THINGTIME_WEB_URL` to build against `https://thingtime.com`. Set it to a
public `https://*.vercel.app` preview or branch deployment when a TestFlight
build should include that deployment as a selectable iPhone drawer destination
and **Build preview** Watch account origin. The script
loads `iOS/.env` when present and then runs `bundle exec fastlane beta`. Keep
`.p8` keys, Apple IDs, team IDs, API key contents, and private preview URLs out
of git unless they are intended public examples. App Store Connect accepts
uploaded archives; it does not compile this repository from source unless a
separate Xcode Cloud workflow is configured.

Set `ASC_ISSUER_ID` to the issuer ID for team App Store Connect API keys, or
leave it blank when using an individual App Store Connect API key.

Use a supported release or RC Xcode for uploads. If App Store Connect rejects
the upload with `90534 Unsupported SDK or Xcode version`, rebuild with a
supported `DEVELOPER_DIR`, such as `/Applications/Xcode.app/Contents/Developer`.

Set `WATCH_BUNDLE_IDENTIFIER` to the Watch App ID paired with
`PRODUCT_BUNDLE_IDENTIFIER`. If automatic App Store export reports that no
profile was found, set `PROVISIONING_PROFILE_SPECIFIER` and
`WATCH_PROVISIONING_PROFILE_SPECIFIER` to the installed App Store profile names
for the iPhone and Watch targets. The Fastlane lane keeps automatic signing as
the fallback and switches the archive and export to target-specific manual
profile mapping when either profile variable is present.

The lane syncs an Apple Distribution certificate and separate iPhone and Watch
App Store provisioning profiles with the App Store Connect API key before
building. Set
`SKIP_CERT_SYNC=1` or `SKIP_PROFILE_SYNC=1` only when the correct signing asset
is already installed and you intentionally want to skip that step.

## Lopu voice recovery

Use build 29 for recording uploads together with the current Watch updates.

Build 25's release source (`9a6f04d4e`) did not include the native voice
controller or Live Activity extension. Build 27 advertises `lopuVoiceVersion`
so the web controls can distinguish a capable app from the older general
native bridge. Older apps receive an update instruction instead of a false
listening indicator.

Start voice while Thingtime is in the foreground. Device transcription needs
both Microphone and Speech Recognition permission; Live Activities have a
separate iOS setting. A pause submits speech, and Stop preserves the current
partial utterance. Ordinary voice uses the saved chat endpoint and its model,
provider, reasoning and speed settings. Transcribe mode creates private pages.

Captured audio segments are saved as CAF files on the iPhone, with TXT sidecars
when recognition produced text. Find them in Files → On My iPhone → Thingtime →
Lopu Recordings. They remain available when the network or recognition fails;
the Files app can play/share/delete them. Starting with build 28, each finished
segment also exports a playable M4A and uploads it as an owner-private audio
Thing under `/things`. The original CAF and TXT remain on the iPhone. Uploads
use the existing private-upload approval and storage quota. A saved notice
links to the recording; a pending notice means the local copy is retained.

The disk outbox stores only file references, request IDs and the recording
account/origin, never cookies. Reopening Lopu, returning to the foreground or
regaining connectivity retries pending work for the same signed-in account.
Changing account or destination stops that account's worker. An interrupted
completion retries the same attachment instead of uploading a second copy.
The selected server must advertise attachment upload/complete features 1.2.0
in its canonical capability manifest before receiving audio. Starting with build 30,
older recovery files automatically import when Lopu opens with a signed-in
account (Voice settings → Import older recordings, enabled by default). Local
receipts bind each file to that account and origin, and completed build 29
uploads are reconciled against existing Things before any new upload. Completed recording Things have no draft
expiry and remain owner-private. Direct voice also retains captured audio; provider
transcript/reply rows on that path retain their existing session-only behavior.

Validate with `xcodegen generate` then `DEST='platform=iOS Simulator,id=<id>'
./scripts/test.sh`. `LopuVoiceRecoveryTests` covers permission cancellation,
separate denial messages, origin-scoped feature negotiation and readable local
audio/text. Physical-device recognition and lock-screen acceptance remain
required; a simulator build does not prove them.

### Aggregate Lopu chat Live Activity

Lopu chat work started in the iOS shell appears in one shared chat Live Activity,
including when multiple chats run. It displays counts and generic progress only;
chat titles, messages, account IDs and tool output are never put on the lock screen.
The existing microphone/voice activity remains independent.

Live Activities **do not prevent iOS from suspending the app**. Server-managed
chats run independently of the phone. Locally managed chats still need Thingtime
open. The native bridge advertises `lopuChatActivityVersion: 1.0.0`, consumes full
`lopu-chat-activity-sync` snapshots, and negotiates `api.lopu-live-activity: 1.0.0`
before registering ActivityKit update tokens. It ends the activity when no chats
remain and clears it at account/destination changes. An old status expires to
“Open Thingtime for the latest status” after two minutes without an update.

Server checkpoints send ActivityKit updates and completion using the existing APNs
credentials (`APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, optional
`APNS_IOS_BUNDLE_ID`) and topic `<bundle-id>.push-type.liveactivity`. Configure these
through the deployment's existing private notification setup; never commit key
material. ActivityKit tokens are distinct from notification device tokens, stored
in protected binary records, and bound to a live session, origin and data source.
APNs remains best effort and requires the app's signed push entitlement and
Live Activities enabled in iOS Settings. Foreground snapshots reconcile delivery
misses. Server activity delivery does not depend on ordinary notification settings.

Physical-device acceptance: start two server-managed chats and lock the phone;
verify one chat activity with count 2, updates when one completes, and dismissal
when both finish. Repeat across account/destination changes, manual stop, an
automatic retry, a disabled Live Activities setting, and a user-dismissed activity.
Verify a concurrent voice session retains its existing behavior. Simulator build
and unit tests do not prove APNs delivery or physical lock-screen behavior.


### Resumable private file staging

`fileStagingVersion` 1.0.0 adds begin/append/finish calls to the existing native
folder bridge. Requests require the current origin/account and an owned folder
grant. They write only to private application support storage, excluded from
backup, and preserve immutable operation identity, acknowledged progress and
verified content across reopen. `filePublicationVersion` 1.0.0 adds native consent,
publication and receipt lookup. Selecting a read-only grant does not grant writes.
Approvals bind reviewed configuration revision/hash, device and connection and
are cleared by removing/reselecting the folder. Publication uses coordinated,
same-volume exclusive rename/swap, retains displaced inodes privately and refuses
unsupported providers. A racing uncoordinated edit is retained as a pending
conflict, not an automatic rollback. Existing transfer records carry receipts;
background transfers, conflict/restore controls and retention remain pending.

`MobileSyncStagingTests` verifies multipart bytes, replay, interrupted checkpoint
recovery, checksum and symlink refusal, plus the real WebKit/native handler with
synthetic authentication and a local test grant. Run it with `MobileFolderTests`
and `MobileDevicePairingTests` after `xcodegen generate`. See the root README for
the concrete simulator command and `docs/mobile-file-sync.md` for remaining
cloud, provider, permission and physical-device acceptance.


### Real installed download and process-exit checks

`./scripts/test-mobile-publication-process.sh` runs opt-in
`MobilePublicationProcessTests` across separate test-host processes. It exits
after exclusive create/swap but before receipt persistence and checks original
operation recovery, retained replacement bytes and edit-before-recovery refusal.
The script requires a concrete simulator `DEST`; it touches only its private
fixture directory.

`./scripts/test-mobile-sync-installed.sh /private/account.json` prepares the
actual installed Things UI with a disposable loopback account and empty Documents
folder. Use the visible Files picker, connection editor and native consent
controls, then independently verify the cloud file hashes before recording test
completion. This is opt-in and never enables itself in ordinary test runs. See
the root README for fixture preparation, replacement and cleanup. The native
consent cancellation message is distinct from missing folder access; shared
pairing requests serialize foreground checks with periodic status refresh.


### Shared file-sync core

`project.yml` links the local `../apple/FileSync` package. Regenerate with
`xcodegen generate` after updating the checkout. Folder grants, reads and staged
publication use this shared source; existing v1 storage, scope keys and bridge
contracts are preserved. The test target includes the shared folder/publication
cases plus iOS-only WebKit bridge cases. See the [package runbook](../apple/FileSync/README.md)
for Mac filesystem tests and the existing `scripts/test-mobile-publication-process.sh`
for iOS fresh-process recovery. This extraction does not enable Mac host sync.

### Native cloud download ranges

iOS staging capability `1.2.0` downloads pinned cloud ranges through the native
`NativeFileSession` on iOS 17+. The shared planner, durable journal, folder consent,
staging fingerprint verification and publication receipts remain canonical. A
`stage-download` request carries an exact file descriptor and at most a 2 MiB
range, never a URL, credential or file bytes. The native host negotiates the
selected origin, checks the current file before/after reading, pins its WebView
session and refuses redirects, wrong ETags/ranges, oversized/truncated responses,
changed accounts, removed grants and inactive/navigation-changed hosts.

Explicit History exports share this transport. Cookie notifications plus a
250 ms identity check cancel active transport/picker waits when native cookie
changes do not produce a WebKit observer notification. Older hosts and sources
without a cloud descriptor retain their existing staged byte path. Uploads still
use the existing iOS bridge; background transfer workers remain separate work.

For installed acceptance, run `MobileSyncInstalledTests` with the existing
loopback account fixture and `THINGTIME_NATIVE_CLOUD_STAGING_TEST=1` in addition
to `THINGTIME_SYNC_INSTALLED_ACCEPTANCE=1`. Use the visible folder picker and
sync controls, independently compare the resulting files with the cloud fixture,
then complete the acceptance marker. The test requires native range requests,
over 8 MiB transferred and zero legacy appends. Keep all fixture credentials and
`.xctestrun` environment files private and untracked.

Use a dedicated simulator for interactive acceptance when other tasks are
installing the same bundle ID. A reinstall terminates the test host and can
remove its test bundle; it is not evidence of a transfer failure. Finish or stop
this test's runner before rebuilding, and never interrupt another task's runner.
