# Thingtime iOS

Native iOS shell for Thingtime.

The project also includes a native watchOS companion. It pairs with the signed-in
iPhone app, mirrors the newest Thingtime notifications, shows the unread count,
marks individual rows read, and registers its own APNs token for watch alerts.
Authentication remains on the iPhone WebView session so passwords and reusable
session credentials are not copied to the watch.

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
build should include that deployment as a selectable drawer option. The script
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
