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

The TestFlight lane expects App Store Connect and signing values from the
environment. For local uploads, copy the sample env file and keep the real
values untracked:

```sh
cp .env.example .env
bundle install
./scripts/testflight-beta.sh
```

Omit `THINGTIME_WEB_URL` to build against `https://thingtime.com`. The script
loads `iOS/.env` when present and then runs `bundle exec fastlane beta`. Keep
`.p8` keys, Apple IDs, team IDs, API key contents, and real preview URLs out of
git unless they are intended public examples. App Store Connect accepts uploaded
archives; it does not compile this repository from source unless a separate
Xcode Cloud workflow is configured.
