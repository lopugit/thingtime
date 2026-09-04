# PR #596 — Add native Apple Watch notifications

## TestFlight build 17 — private attachment Things

- Added **Add private Thing** to the authenticated Watch inbox with native
  Photos-library screenshot/image selection and an in-app `.m4a` audio recorder.
- Added a durable `WCSession.transferFile` queue: watchOS retains the original
  until the paired iPhone confirms the owner-only Thing, and the iPhone copies
  the temporary received file before its delegate callback returns.
- The signed-in iPhone checks the selected origin's semantic capability
  manifest, reserves and uploads checksum-locked multipart attachment parts,
  completes the attachment, and binds it to a stable private post Thing with
  `acl: ["tt:user"]`. Stable request and Thing ids make retries idempotent.
- The local Xcode 27 Watch simulator renders the full attachment screen and
  microphone permission flow without clipping; all 22 iOS unit tests pass on
  an iOS 27 simulator, including metadata safety and capability-version tests.
- Physical WatchConnectivity file delivery and the authenticated production
  upload remain the TestFlight acceptance checks because simulator file
  transfer is not supported by WatchConnectivity.

## TestFlight build 16

- Registered `com.thingtime.appletime.watchkitapp` in Apple Developer and
  enabled Push Notifications for the iPhone and Watch App IDs.
- Updated Fastlane to generate and map separate App Store provisioning profiles
  for the iPhone container and embedded Watch app.
- Bumped `CURRENT_PROJECT_VERSION` to `16` and targeted the PR #596 preview so
  the build exercises the matching notification-device API contract.
- Added a manually dispatched release workflow that uses GitHub's `macos-15`
  runner with Xcode 26.2 because Apple does not support release Xcode 26 on
  this machine's macOS 27 beta host. Its read-only status mode can inspect a
  requested TestFlight build without creating or uploading another build.
- The local Xcode 27 simulator build succeeds with the Watch app embedded.
- GitHub Actions run
  [33831269540](https://github.com/lopugit/thingtime/actions/runs/33831269540)
  archived and exported the signed iPhone app, embedded
  `ThingtimeWatch.app` under the App Store-required `Watch/` directory,
  verified the bundle identifier and deep signature, and completed Apple's
  native upload with `Upload succeeded` / `EXPORT SUCCEEDED`.
- Read-only status run
  [33831873108](https://github.com/lopugit/thingtime/actions/runs/33831873108)
  confirmed TestFlight build 16 is `VALID`, internally `IN_BETA_TESTING`, and
  externally `READY_FOR_BETA_SUBMISSION`.
- App Store Connect:
  <https://appstoreconnect.apple.com/apps/6783335401/testflight/ios>
