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
