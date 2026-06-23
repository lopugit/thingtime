# Thingtime iOS

Native iOS shell for Thingtime.

The first version is intentionally small: a SwiftUI app that embeds Thingtime in a native `WKWebView`. It defaults to `https://thingtime.com` and can be pointed at a Vercel preview or branch deployment for TestFlight builds. It does not include any LiDAR, ARKit, scanning, mesh, storage, or export functionality.

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

The TestFlight lane expects App Store Connect and signing values from the environment:

```sh
export ASC_KEY_ID="GJWC63X3DC"
export ASC_ISSUER_ID="<app-store-connect-issuer-id>"
export ASC_KEY_CONTENT="$(base64 -i /path/to/AuthKey_GJWC63X3DC.p8)"
export DEVELOPMENT_TEAM="<apple-developer-team-id>"
export PRODUCT_BUNDLE_IDENTIFIER="com.thingtime.appletime"
export THINGTIME_WEB_URL="https://<vercel-branch-preview-host>"

bundle install
bundle exec fastlane beta
```

Omit `THINGTIME_WEB_URL` to build against `https://thingtime.com`. Keep `.p8` keys, Apple IDs, team IDs, and API key contents out of git. App Store Connect accepts uploaded archives; it does not compile this repository from source unless a separate Xcode Cloud workflow is configured.
