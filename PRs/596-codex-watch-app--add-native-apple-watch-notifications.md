# PR #596 — Add native Apple Watch notifications

## TestFlight build 24 — quick approval and four-digit codes

- New requests use four numeric digits, uniquely reserved for five minutes.
  `/watch/pair` accepts the visible code; `/pair/1234` prefills it through sign-in.
  Older eight-character codes/full approval links remain valid. Indexed lookup
  fails closed on collisions and returns no claim secret or account information.
- Code entry uses four evenly spaced squares over one accessible native input,
  keeping paste/autofill atomic. Legacy codes expand to eight squares, and
  leading zeroes, native selection, arrow keys, backspace and keyboard submit work.
- Three Watch choices: **Paired iPhone account** (default), **Enter a username**,
  and **Use a code / link**. Phone handoff carries an independent 256-bit proof,
  never the Watch's claim secret or credential. The phone offers the request to
  its active account; username targeting addresses that account directly.
  Signed-in sessions on the same origin display the exact Watch/account/PIN and
  a one-tap **Approve Watch** button. Delivery never approves automatically.
- `api.watch-pairing` is 1.2.0. Clients negotiate before dependent operations.
  Lookup is limited to five/account and ten/IP per five minutes; start, offer,
  approve and username targets have separate budgets. Claim polling has its own
  60/minute budget, fixing the old shared limit that stopped polling after ~90s.
- The Watch displays the exact phone/computer address and step-by-step
  instructions instead of opening an unsupported watchOS browser sheet.
  **Check approval** retains the pending code, transient network failures retry
  with bounded backoff, expired codes can be replaced, and switching domains
  cancels stale requests. Fresh preview builds default to the preview domain.
- Missing `api.watch-pairing` support is detected before code creation and
  produces an actionable domain hint. Production/development do not gain the
  feature merely because a TestFlight build is uploaded; deploy the matching
  server contracts to those origins first.
- The headless real-HTTP Watch group passes all 72 checks, including 31 pending
  polls, code-only lookup, cross-origin rejection, wrong code recovery,
  same-account approval retry, cross-account takeover rejection, idempotent
  claims, and direct notification download with the resulting device credential.
  New checks cover recipient-only inboxes, handoff forgery/takeover rejection,
  no automatic approval, numeric expiry, username delivery/typos, and PIN limits.
  Capability tests (8), device/input/client tests (57), collection/index tests (37), all native tests
  (31), scoped lint, full iPhone/embedded-Watch simulator build, and complete
  Vercel output build pass. Test fixtures use isolated accounts and redact
  pairing secrets from runner output.
- Desktop (1280×900) and phone (390×844) browser QA exercises sign-in, wrong-code
  recovery, short-link prefill, explicit approval, claim, direct notification
  sync, a second signed-in session receiving the phone offer, username targeting,
  and dismissal. Scoped box-sizing and paragraph margins keep these cards compact
  without mobile overflow; the floating card clears the existing bottom tools.
  Chrome extension control was unavailable, so QA used isolated headed Chrome.
  The installed Chrome 87 lacked modern APIs; its Settings flow passed, then
  current Chrome for Testing 153 passed the complete flow on the main feed.
  Real keyboard paste replaced all four squares (including leading zeroes),
  legacy paste expanded all eight, and selection/backspace/full-value fill passed.
  Desktop squares measured 71×71px with a centered card; phone and desktop had
  no horizontal overflow. The native iOS one-time-code suggestion still needs
  physical-device acceptance, though the field is one native autofill input.
  Typecheck ratchet reports 109 pre-existing errors against baseline 108; no new
  Watch diagnostics remain. Physical WatchConnectivity transport
  still requires paired-device acceptance; simulator/API tests are not that proof.
- Local QA uses `http://127.0.0.1:18290/watch/pair` via the unique, no-restart
  `watch-pairing.ecosystem.config.cjs` fixture. Tailscale/Funnel is unavailable
  because the installed CLI points at a missing app; use the public preview on
  real phones and Watches.

## TestFlight build 23 — direct Watch accounts and private Things

- The Watch now pairs directly to Thingtime over HTTPS with a short browser
  approval code and a device-scoped credential. Notification refresh, read
  receipts, push registration, and private attachment Thing uploads no longer
  depend on the iPhone app being reachable.
- Added multiple production/development accounts with on-Watch switching,
  username/avatar identity, live connection state, last check/reply times, and
  both toolbar and **Check & refresh** actions.
- **Add private Thing** now has configurable favourites immediately below it;
  **Record** is the default and existing Thingtime recordings remain selectable
  for direct upload.
- Paired Watches are first-class `/things` devices with sync, battery,
  low-power, and error health plus an owner-only list of recent Things created
  by that Watch.
- New versioned `api.watch-pairing`, `api.watch-sync`, and `api.watch-things`
  contracts are registered in the capability manifest. Existing attachment and
  push-registration contracts gained additive Watch device authentication.
- Focused API/device/index tests and a Watch simulator build pass. The Watch SE
  40 mm simulator renders `@lopu`, direct connected state, live check success,
  last reply/check timestamps, and the refresh control through the bottom of
  the screen without clipping.
- Exact release commit: `bd1618eefc24250628aeba227463fee382c3ca49`.
- The protected PR preview publisher completed successfully and the live
  capability manifest at <https://pr-596.previews.dev.thingtime.com> exposes
  `api.watch-pairing`, `api.watch-sync`, `api.watch-things`, and `api.devices`;
  a live anonymous Watch pairing-start smoke request also succeeds.
- Web CI run
  [33949863567](https://github.com/lopugit/thingtime/actions/runs/33949863567)
  passed its build, typecheck ratchet, unit tests, and headless API suite.
- TestFlight upload run
  [33949960283](https://github.com/lopugit/thingtime/actions/runs/33949960283)
  built, signed, verified, and uploaded the iPhone app plus embedded Watch app.
  Read-only status run
  [33950223684](https://github.com/lopugit/thingtime/actions/runs/33950223684)
  confirmed build 23 is `VALID`, internally `IN_BETA_TESTING`, and externally
  `READY_FOR_BETA_SUBMISSION`.

## TestFlight build 22 — visible account and live status checks

- The Watch connection section now names the authenticated account as
  `@username`, keeps its live connection state visible, shows last-check and
  last-reply times, and provides an always-visible **Check & refresh** button
  with an in-progress state.
- The authenticated notifications response now carries only the viewer's
  public username for native account confirmation. Its semantic capability is
  bumped additively to `api.notifications-list` 1.2.0, with contract and
  backwards-compatible Watch payload coverage.
- All 30 native tests pass; focused notification/capability tests, focused
  lint, and the complete Vercel output build pass. The Series 10 simulator
  renders the waiting state through its bottom content with the button and
  build 22 visible, and the button is accessibility-discoverable and tappable.

## TestFlight build 21 — correct origin migration and visible diagnostics

- Fixed the persisted-destination upgrade path that could leave an updated
  TestFlight iPhone app on `thingtime.com` even though that build was configured
  for the PR preview containing notification-history API 1.1. Legacy implicit
  production selections now follow the build configuration; explicit user
  destination choices remain respected.
- Watch snapshots now include the active iPhone origin and iPhone build number.
  Connection screens show both companion build numbers and the origin, and
  explicitly warn when the iPhone and Watch installations do not match.
- Notification-history compatibility failures now name the selected host, its
  actual capability version, and the required version instead of showing a
  generic missing-API message.
- Added focused migration and backward-compatible payload tests. All 30 native
  tests pass, and the Watch companion builds and renders on a Series 10
  simulator with its build number visible while disconnected.

## TestFlight build 20 — resilient iPhone connection and recording chooser

- Watch-to-iPhone authentication refreshes now wait for an authenticated
  snapshot or explicit failure instead of treating message delivery as success.
  The Watch shows activating, checking, connected, waiting, signed-out, and
  failed states with the last successful reply and a manual retry action.
- Unreachable refreshes are durably queued and retried after 2, 5, and 10
  seconds. Interactive refresh and notification-history requests have bounded
  response timeouts instead of leaving the Watch in an indefinite loading state.
- Added a dedicated **Choose saved recording** screen that lists every
  Thingtime-owned `.m4a` retained on the Watch, supports tap-to-upload and
  swipe-to-delete, and remains browseable while another transfer finishes.
- Apple's recorder callback now waits briefly for the saved file to become
  non-empty before queueing it. If finalization takes longer, the recording is
  retained and can be selected later rather than being reported as lost.
- Apple Voice Memos remain private to Apple's app. Those recordings sync to
  Voice Memos on iPhone and can be exported to Files for upload through the
  iPhone Thingtime app.

## TestFlight build 19 — Apple-native recorder and saved recordings

- Replaced the in-app recording controls with Apple's native Watch audio
  recorder using its high-quality `.m4a` preset and ten-minute safety limit.
- Saved recordings now remain in Thingtime's Application Support container on
  the Watch, survive relaunches, and appear under **Saved on this Watch** for
  manual upload or re-upload. Swipe-to-delete removes only the selected local
  copy.
- Added a persistent **Upload after saving** toggle, enabled by default, so the
  user can choose immediate queueing or save-first/manual-upload behavior.
- watchOS does not expose Apple Voice Memos' private app container or a document
  importer to third-party Watch apps. The screen states that limitation and
  directs existing Watch Voice Memos to sync to iPhone for upload in Thingtime.
- The Watch target builds and renders on a Series 10 simulator. All 24 iOS and
  shared contract tests pass on a matching Xcode 27 / iOS 27 simulator. Native
  recorder presentation and microphone capture remain physical-Watch
  acceptance checks because the Watch simulator does not present that system
  recording controller.

## TestFlight build 18 — notification history and offline downloads

- The Watch inbox now requests the newest 10 notifications and can append
  previous pages 10 at a time with an opaque timestamp-plus-id cursor that does
  not skip notifications sharing the same timestamp.
- Added a native **Notification history** screen with one-date and date-range
  selection. **Fetch first 10** / **Fetch 10 more** page through that window;
  **Download whole period** asks the signed-in iPhone to fetch all available
  pages and transfer one bounded archive back to the Watch.
- The Watch persists the latest archive for offline viewing, reveals it 10 rows
  at a time, and preserves locally marked-read state across relaunches. Archive
  metadata is checked against the payload before it is accepted.
- The server's `api.notifications-list` contract is now version 1.1 with
  optional inclusive `from`, exclusive `to`, and stable `cursor` parameters;
  legacy `before` pagination remains available.
- Focused notification tests, API capability-manifest tests, lint, native unit
  tests, and a Watch simulator build/UI inspection cover the release. The full
  repository typecheck still reports the branch's pre-existing unrelated
  errors; none originate in the notification-history implementation.
- Physical paired-device WatchConnectivity archive delivery remains the final
  acceptance check because `WCSession.transferFile` is unavailable in the
  Watch simulator.

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
