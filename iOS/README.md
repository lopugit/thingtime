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

### Receive content from the iOS share sheet

The embedded **Thingtime** Share extension accepts the payloads offered by the
system share sheet without a type allowlist or an item-count ceiling. This
includes text, links, photos, Live Photos, video, audio, documents, folders and
custom file types. The sending app still decides which representations it offers
and can exclude particular activities; Thingtime cannot override that choice or
the user's share-sheet favourites.

Sharing saves a local batch in the app's existing App Group. Open Thingtime after
saving to move completed batches into **Files → On My iPhone → Thingtime →
Shared** (or **On My iPad**). Each batch has its own folder to prevent overwrites.
Use the normal Thingtime upload picker to select those files when you want to
upload them. Sharing alone does not publish anything or choose a signed-in
account, server or audience. Thingtime does not require login or upload the batch;
the sending app may need network access to retrieve cloud-only originals.

The importer tries the representations actually supplied by the sending app,
copies temporary provider files while they are valid, and preserves both Live
Photo resources when a Live Photo is supplied. A failed item prevents the batch
from being reported as saved; cancel/retry must not expose an incomplete batch.
There is no automatic deletion of successfully saved shares.

Photos may offer only a still image for a Live Photo, depending on its sharing
options and destination support. The extension cannot recover motion that the
sending app does not supply. This differs from receiving a `PHLivePhoto`, for
which both original resources are retained.

For forks, register `<iPhone bundle ID>.share`, enable App Groups on that App ID,
and associate the same `THINGTIME_WIDGET_GROUP` as the containing iPhone app.
The extension's provisioning profile must include that group. The release lane
and archive verifier include this extension; do not reuse the widget profile for
it. A web deployment cannot add a native share target to an older installed app:
install a new native build containing `ThingtimeShare.appex`.

For initial automatic provisioning, verify the resolved App Group in both the
extension's signed entitlements and its embedded profile. On the development
machine, Xcode registered the association only after provisioning once with a
temporary entitlement file containing the resolved group ID instead of the
build-setting variable. Keep the configurable variable in the source project;
the temporary file is a local provisioning aid, not a replacement entitlement.

Run `scripts/share-acceptance.sh` with `THINGTIME_SIMULATOR_APP` pointing to the
final simulator app to exercise the actual system sheet and compare saved fixture
bytes. The harness uses disposable data and a task-owned simulator; its results
are distinct from physical-device, signed archive and TestFlight acceptance.

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

## Automatic TestFlight releases

Native pushes to `main` use the GitHub workflow, allocate a fresh build number,
verify the embedded widget and signed App Groups, then wait for internal tester
availability. See [automatic publishing and admin vault migration](../docs/ios-automatic-testflight.md)
for setup, credential rotation, forks and first-release acceptance.

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

## Photo-library backup

In Things, add this device, then choose **Choose folder → Photo library
(backup)**. The native explanation precedes the system Photos permission dialog.
Choose limited or full access; the selected scope is shown in the connection.
Granting access alone starts no upload. Create an ordinary private file-sync
connection, select a private cloud folder, unpause it and use Upload now while
the app remains open. Photo connections are backup-only and keep saved cloud
copies when device originals disappear. Downloads, deletes and device-Trash
restoration cannot target a photo-library grant.

The shared Apple PhotoKit reader preserves every resource returned for each
accessible photo/video (including original and edited resources and Live Photo
companions when supplied), rather than using display thumbnails. Resources have
separate opaque asset/index identities and original-filename suffixes. Full
access includes hidden and burst assets exposed by PhotoKit. Original bytes can
include embedded location metadata. Albums, captions, favorites and other Photos
database metadata are not yet a portable library restoration contract.

Current scans allow 10,000 resources and 4 MiB of inventory metadata. A scan
rechecks the complete accessible resource inventory before returning success.
One original is exported at a time into private temporary storage and reused for
bounded reads under the same owner/grant; the temporary copy is cleared on
suspension or failure. Available device storage must fit the largest original plus one upload part.
Originals must currently be downloaded locally in Photos: the adapter refuses
unavailable originals instead of starting iCloud traffic outside the sync network
policy. Background jobs, large-library paging and controlled iCloud downloads
remain pending. The shared reader and source selection also support Mac; installed signed-app
PhotoKit acceptance remains pending.

Forks need the existing `NSPhotoLibraryUsageDescription` entry in `project.yml`,
then `xcodegen generate`. No photo-service credentials or private configuration
are required. Opt-in installed acceptance uses only a disposable loopback account
and simulator, retaining the ordinary native Photos dialogs:

```sh
DEST='platform=iOS Simulator,id=<simulator-uuid>' \
THINGTIME_PHOTO_BACKUP_TEST=1 \
iOS/scripts/test-mobile-sync-installed.sh /path/to/disposable-account.json
```

Use a small disposable Photos library. The test creates its own deterministic multipart noise PNGs,
compares downloaded cloud hashes, and moves only those test assets to Recently
Deleted. Follow the `IOS_PHOTO_*` prompts and confirm the system deletion prompts.
See [Apple's resource manager](https://developer.apple.com/documentation/photos/phassetresourcemanager)
for the original-resource API.

### File-backed native uploads

The iOS host advertises `fileUploadVersion` 1.1.0. Folder and PhotoKit sources
use the existing editable connections and cloud multipart protocol, but original
upload bytes do not pass through JavaScript. A part is copied to protected native
upload storage in at most 64 KiB chunks, hashed, and uploaded with URLSession
from that file. Only the part digest returns to the shared runner. The runner
checks the complete canonical fingerprint, server attachment fingerprint and
original journal identity before publishing the file/Timeline event.

The native host replays the exact upload reservation against the selected server
and requests a checksum-bound signed URL itself. It never accepts an upload URL
from the webpage. Account cookies remain on the configured API origin; the signed
PUT has no ambient credentials and follows no redirects. Cookie changes,
foreground loss, cancellation, changed source versions, revoked access and
oversized/error responses cannot produce a successful part receipt. The ordinary
journal retains unfinished work and reuses its operation/upload identity.

No new environment variables or service credentials are required. Forks need the
existing authenticated attachment upload/parts capabilities and storage setup.
Temporary free space must fit one canonical part (8 MiB through 5 GiB under the
existing attachment contract); Photos also needs its materialized original.
This remains a foreground upload path. Background scheduling, durable OS upload
recovery, physical-device throughput, giant-file acceptance and whole-account
snapshots remain separate requirements. The multipart photo acceptance uses the
same `THINGTIME_PHOTO_BACKUP_TEST=1` command above and asserts native part counts,
exact uploaded byte totals and zero legacy bulk bridge reads.

### Retained upload parts and interruption recovery

`FileUploadParts-v1` in Application Support retains unfinished parts across app
process exits. The shared `FileUploadPartStore` uses the native atomic journal,
private 0700/0600 permissions, iOS protection until first device unlock, and
exclusion from OS backup. It stores source identity and bytes, never cookies,
signed URLs or credentials. No new configuration is required for forks.

A retry must use the original account/origin, native grant, source version,
reservation/request IDs and canonical part bounds. The host revalidates live
permission/source state and the API reservation before reuse; the store rehashes
all retained bytes. Incomplete captures are rebuilt, while conflicting requests,
corruption, symlinks and hardlinks fail closed. Successful verified uploads release
their exact part. Removing a native grant removes only its scoped retained parts.
Suspension/logout retain private parts without granting permission to upload them.

Storage is bounded to 32 reservations and 5 GiB of retained/capturing payloads
across accounts. Allow additional space for a materialized PhotoKit original and
small journals. Capacity exhaustion stops new captures without evicting another
unfinished part. There is no automatic age-based eviction or management UI yet;
retry the original operation or remove its native grant to reclaim storage.

The current native bridge serializes the full prepare/upload/release lifecycle.
Future background workers need durable task associations and leases before they
can share these paths independently.

This is durable retry input, not a background URLSession task, native scheduler,
accepted-upload receipt store, or Timeline history. Transfers still require the
foreground app. A lost successful reply may recapture/re-PUT the same part safely;
power loss, disk exhaustion and process death during the actual PUT still need
acceptance. Run `apple/FileSync/scripts/test-upload-part-process.sh` for disposable
fresh-process checks at completed capture and before the final digest checkpoint.
The installed photo acceptance also checks successful part-cache release.

File protection is configured in iOS capture attributes but is not verified by
this simulator: it returns no protection attribute. The separate
`testDeviceFileProtectionAfterCapture` skips Simulator and requires physical iOS
hardware; device lock/reboot enforcement remains an open acceptance check. Read
protection values as strings, as specified by
[Apple's protectionKey API](https://developer.apple.com/documentation/foundation/fileattributekey/protectionkey).

### Native multipart jobs

Upload bridge 1.2.0 accepts one original attachment reservation, source descriptor
and reviewed file-sync configuration for a complete file. `NativeFileUploadJob`
streams one retained part at a time using the existing cache and redirect-refusing
upload session, computes the canonical composite SHA-256, then completes the
attachment. Original IDs survive retry. An already-ready reservation skips
resending bytes; the shared runner independently verifies the stored fingerprint
before publishing the original file operation into Timeline.

`NativeUploadAuthorization` rereads the same private owned configuration and
checks its exact revision/fields, live paired device, grant, source, network and
power before every part and completion. Account/navigation/cancellation fences
remain active. Custom shared mutation policies retain the per-part path unless
a native policy explicitly covers them. Only increasing canonical byte-progress
messages extend the bridge inactivity deadline; no payload bytes cross WebKit.

No new fork configuration or secrets are required. The opt-in installed photo
acceptance now requires whole-file handoffs, native part progress, downloaded
original hashes and released cache entries. See continued uploads below for the
iOS 26+ lifecycle extension; real background completion, OS relaunch, force-quit/
reboot recovery and physical-device throughput remain unverified. Apple's background URLSession follows redirects
unconditionally, so it cannot replace the current plaintext transport without
revisiting destination protection.

### Continued uploads on iOS 26+

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
