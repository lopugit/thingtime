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

## Follow-up safe-area polish

Build `4` still exposed two iOS-only safe-area bugs when testing the production
Thingtime destination:

- At the bottom scroll limit, the fixed web nav could slide into the iOS status
  area because the page-level safe-area CSS value was not stable enough inside
  the native `WKWebView`. The native shell now writes the current UIKit safe-area
  inset values into the page's CSS variables after layout and after navigation.
- The production footer could still sit behind the home indicator because the
  app may load `thingtime.com`, not only the current Vercel branch. The native
  `WKWebView` now reserves a larger bottom scroll inset, and the branch preview
  footer keeps extra CSS bottom padding too.
- Native build `5` carries this safe-area follow-up for TestFlight.

## Follow-up nav safe-area polish

Build `5` made the footer fully reachable at the bottom scroll limit, but the
fixed web nav could still disappear into the iOS status area once the page was
scrolled all the way down. The web nav now offsets the fixed layer itself with
`top: var(--thingtime-safe-area-top, 0px)` instead of padding inside a
`top: 0` layer, so iOS keeps the whole nav below the native menu/status bar.
The native `WKWebView` safe-area resolver also falls back to the host window's
safe-area values and status-bar height before pushing CSS variables into the
page.

Native build `6` carries this nav safe-area follow-up for TestFlight.

## Follow-up URL context menu

The native destination drawer now keeps tap-to-select on each URL row, and adds
a long-press context menu for URL actions:

- Copy URL writes the destination URL to the iOS pasteboard.
- Open in Browser opens the destination externally through the system URL
  handler.
- Share presents the native share sheet for the destination URL.

Native build `7` carries this context-menu follow-up for TestFlight.

## Follow-up native safe-area containment

Build `7` still let the web nav hide under the iOS status/menu area at the
bottom scroll limit because the native `WKWebView` itself was full-screened
behind both the top and bottom safe areas. The web CSS variables helped in
ordinary scroll positions, but bottom rubber-band/scroll-limit behavior inside
WKWebView could still paint the fixed web nav underneath the native status bar.

The native shell now keeps the web view below the top safe area and only ignores
the bottom safe area. The injected safe-area CSS resolver is also overlap-aware:
it reports top inset only if the web view actually overlaps the unsafe top
region, while still reporting bottom overlap so the footer remains reachable
above the home indicator.

Native build `8` carries this native safe-area containment follow-up for
TestFlight.

## Follow-up fixed chrome scroll isolation

Build `8` kept the native `WKWebView` below the status bar, but repeated
bottom-edge scrolling could still make the web nav disappear. A simulator
reproduction with repeated real swipes showed that the footer stayed visible
while the fixed web chrome was clipped away, which pointed at the fixed React
chrome living inside the scrollable `Main` layout subtree and at the native
bottom `contentInset` creating an extra scroll range that WebKit fixed/sticky
chrome could not track.

The web nav and drawer system now render as root-level siblings of the
scrollable `Main` content. In native WebView, the fixed top nav gets an in-row
drawer button while the old floating drawer trigger is hidden, rubber-band
bounce is disabled, the native bottom content inset is removed, and the footer
gets native-only CSS bottom padding so the account links sit above the home
indicator using real document height instead of a native-only inset.

Local simulator validation must pass `THINGTIME_WEB_URL` as an explicit
`xcodebuild` build setting; shell environment alone can leave the built
`Info.plist` pointed at Thingtime.com through the Debug xcconfig default.

Native build `9` carries this fixed chrome scroll-isolation follow-up for
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
