# Thingtime iOS

Native iOS shell for Thingtime.

The first version is intentionally small: a SwiftUI app that embeds `https://thingtime.com` in a native `WKWebView`. It does not include any LiDAR, ARKit, scanning, mesh, storage, or export functionality.

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
