# Thingtime iOS

Native iOS shell for Thingtime.

The first version is intentionally small: a SwiftUI app that embeds Thingtime
in a native `WKWebView`. It defaults to `https://thingtime.com` and can be
pointed at a Vercel preview or branch deployment for TestFlight builds. A
left-edge swipe opens the in-app web destination drawer, where production,
the configured build URL, and deployments returned by
`/api/v1/vercel/deployments` can be selected without rebuilding the app. It
does not include any LiDAR, ARKit,
scanning, mesh, storage, or export functionality.

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

If automatic App Store export reports that no profile was found, set
`PROVISIONING_PROFILE_SPECIFIER` to the installed App Store provisioning profile
name for `PRODUCT_BUNDLE_IDENTIFIER`. The Fastlane lane will keep automatic
signing as the default and switch only the export step to manual profile
mapping when that variable is present.

The lane syncs an Apple Distribution certificate and App Store provisioning
profile with the App Store Connect API key before building. Set
`SKIP_CERT_SYNC=1` or `SKIP_PROFILE_SYNC=1` only when the correct signing asset
is already installed and you intentionally want to skip that step.
