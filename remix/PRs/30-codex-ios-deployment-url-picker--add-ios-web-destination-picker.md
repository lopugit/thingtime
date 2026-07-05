# PR #30 — Add iOS web destination picker (branch `codex/ios-deployment-url-picker`)

## What changed

The native iOS app now has a left-edge SwiftUI destination drawer layered over
the `WKWebView`. It lets the user switch the webview between Thingtime.com, the
configured build URL, and Vercel deployment URLs returned by Thingtime's
existing `/api/v1/vercel/deployments` endpoint.

The drawer keeps the webview stable: selecting a destination changes the root
URL, and the `WKWebView` reloads only when that selected root URL changes.
Invalid deployment API URLs are rejected, duplicate destinations collapse to a
single option, and `THINGTIME_WEB_URL` remains useful as the build-configured
preview URL.

## Follow-up polish

TestFlight screenshots exposed three mobile polish bugs:

- The invisible native left-edge swipe strip covered the first 32px of the
  webview, so taps on the far-left side of the web drawer icon were intercepted
  and never reached the web app. The edge-swipe gesture now runs as a
  simultaneous parent gesture gated by `startLocation.x`, so web taps pass
  through normally.
- The web drawer trigger's visible icon stayed in the same place, but its
  tappable area now reaches the left viewport edge.
- The native `WKWebView` and footer now reserve bottom safe-area space, and the
  webview/under-page background is white so top/bottom rubber-band overscroll
  matches the page instead of flashing black.
- Native build `4` carries the WKWebView gesture/background/inset fixes for
  TestFlight.

## TestFlight upload

Build `1.0 (3)` was uploaded to App Store Connect with Fastlane and is visible
as `VALID` for app `6783335401`.

Upload details:

- App Store Connect key: individual API key `OOXV4Y1Q9V10`, with
  `ASC_ISSUER_ID` intentionally blank.
- Bundle identifier: `com.thingtime.appletime`.
- Developer team: `6DQQ9V7C84`.
- Provisioning profile: `Thingtime App Store com.thingtime.appletime`.
- Build URL: `https://thingtime-git-codex-ios-deployment-url-picker-lopugits-projects.vercel.app`.
- Xcode: `/Applications/Xcode.app`, SDK `iphoneos26.5`.

The first upload attempt built successfully with `/Applications/Xcode-beta.app`
and SDK `iphoneos27.0`, but App Store Connect rejected it with `90534
Unsupported SDK or Xcode version`. The successful upload rebuilt with the
stable Xcode 26.5 install.

## Validation

- `git diff --check`.
- `xcodegen generate`.
- `DEST='platform=iOS Simulator,id=290A7D36-A22F-4451-A135-81E8EC9E091A' ./scripts/test.sh`
  passed 8 tests.
- `https://thingtime.com/api/v1/vercel/deployments?limit=5` returned deployment
  summaries with `configured: true`.
- Simulator launch and screenshot verified the app shell.
- Fastlane archived, exported, and uploaded build `1.0 (3)`.
- IPA metadata verified `CFBundleIdentifier=com.thingtime.appletime`,
  `CFBundleVersion=3`, `DTSDKName=iphoneos26.5`, and the configured preview URL.
- App Store Connect API showed build `3` as `VALID`.
- Vercel branch preview returned HTTP 200.

## Notes

The local `remix/.env.auto` file was dirty before this branch work and remains
unstaged. It was not included in the commits.
