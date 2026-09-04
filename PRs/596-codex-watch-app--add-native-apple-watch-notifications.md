# PR #596 — Add native Apple Watch notifications

## TestFlight build 16

- Registered `com.thingtime.appletime.watchkitapp` in Apple Developer and
  enabled Push Notifications for the iPhone and Watch App IDs.
- Updated Fastlane to generate and map separate App Store provisioning profiles
  for the iPhone container and embedded Watch app.
- Bumped `CURRENT_PROJECT_VERSION` to `16` and targeted the PR #596 preview so
  the build exercises the matching notification-device API contract.
- Added a release workflow that uses macOS 26 with release Xcode 26.6 because
  Apple does not support release Xcode 26 on this machine's macOS 27 beta host.
- The local Xcode 27 simulator build succeeds with the Watch app embedded. The
  CI archive, IPA signature inspection, upload receipt, and App Store Connect
  processing state are recorded below once complete.
