# PR #996 — Encrypted password manager and Apple credential providers

PR: https://github.com/lopugit/thingtime/pull/996
Branch: `codex/password-manager` (base `develop`)

## Release split

The web vault was merged into main at `998bdb83c` by [PR #997](https://github.com/lopugit/thingtime/pull/997). This branch incorporates that web base and retains the Apple providers, native packaging and signing setup. It is open for review. Historical October 2026 local evidence below recorded a signed installation; this cloud reconciliation has no Swift/Xcode or current signed-device acceptance. Actual OS fill/passkey ceremonies remain acceptance gates. The evidence below includes the shared web prerequisite.

## Password Copy controls — 26 October 2026

Added independently editable field Copy buttons and status blocks. The transient
binding carries only a field ID; values remain in the adapter closure. Concealed
passwords copy while masked, TOTP Copy returns the current code rather than its
seed/countdown, and passkey entries cannot copy signing fields. Clipboard errors
use fixed non-secret text. Entry edits, masking, entry/account/data-plane changes
and Builder mode invalidate pending work and feedback. Submitted clipboard
writes cannot be revoked; late completion cannot show stale status.

The current `npm --prefix remix run test:passwords` run passed 56 tests with zero
skips, including editable Copy bindings and passkey/TOTP display contracts.
The isolated Chromium run passed all 11 acceptance groups, including masked
copying, TOTP codes, sanitized rejection, late feedback and independent Copy-label
save/reload. Desktop (1440px) and mobile (390px) layouts were scrolled from top to
bottom and inspected. The browser and synthetic backend had no external network,
no host mounts or published ports, and retained the Chromium sandbox. The native
manager control session could not be claimed reliably, so the existing
network-none harness supplied the task-owned fallback. Real clipboard delivery,
installed/native and production acceptance of Copy remain pending. This change
is not yet deployed or installed.

## Local native verification — 25 October 2026

Rechecked cloud head `ab9d39965d8bc94a2063bfcf6ffc862a2289cb91` in an isolated
checkout. Xcode 27.0 (27A5194q) exposed a shared-test compilation failure:
`MobileFolderIgnoreRulesTests` invoked Foundation `Process`, unavailable on iOS.
Only the live Git-oracle helper/case is now macOS-gated; iOS retains the shared
fixture tests and reports an explicit skip for the unsupported live oracle.

- `swift test --package-path apple/Passwords`: seven passes, two explicit skips
  (optional HTTPS preview session and WebAuthn interoperability export).
- The four unchanged `DestinationNavigationFenceTests` pass on macOS against
  the exact production state-machine declaration compiled in a temporary Swift
  package. This is state-machine execution, not an iOS UI/Keychain ceremony.
- `swift test --package-path apple/FileSync --filter MobileFolderIgnoreRulesTests`:
  four passes, including the real Git oracle and shared corpus.
- XcodeGen regeneration followed by the full `Thingtime` scheme's iOS Simulator
  `build-for-testing` passes with signing disabled. The compiled Info.plist
  retains the explicit loopback destination. No simulator app was launched,
  no physical-device test ran, and the installed user app was not replaced.
- [CodeQL alert #140](https://github.com/lopugit/thingtime/security/code-scanning/140)
  was reviewed and dismissed as a false positive. The reported getItem/setItem
  flow copies synthetic Builder layouts; vault entries remain in a separate
  in-memory map and the harness checks exclusion of private values, source,
  history, TOTP and attachment keys/nonces. No production rule or query was
  disabled. GitHub confirmed the disposition on 25 October.

The installed Thingtime window is now available, but displays another workstream
(`codex/device-activity-library`, `4a27f52e3`). Current signed-provider, real OAuth,
actual AutoFill/passkey and screen-chooser acceptance remain open. The assigned
Chrome profile was visibly verified as the Thingtime account; tab-bound actions
timed out and native focus moved between profiles, so credential entry stopped.
The public production/preview manifests remain reachable; public discovery does
not establish authenticated Character or private task-workspace access.
Graphify semantic refresh returned empty extraction payloads and was stopped;
its prior semantic data is retained. Structural outputs are refreshed separately,
so updated documentation semantics are not claimed as re-indexed.

## Cloud reconciliation — 23 October 2026

Integrated develop `f41cf65629fe98423405de4bea4e5894f59ccb46` into the existing
PR history. Preserve its strict native capability origin/schema checks, throwing
Keychain deletion, runtime restart fencing, streamed requests and selected-API
preconditions alongside this branch's full-catalog cursor-cycle guard, iOS
provider packaging, and private password/mail capability negotiation. Both
AppleFileSync and ThingtimePasswordCore remain in the XcodeGen package map.
The iOS bridge reports a failed Keychain clear instead of claiming disconnect;
a failed clear prevents navigation to another account endpoint. Destination selection is transactional: the current authority remains selected, the drawer explains unlock/retry, and a failed target is fenced until explicit retry or a new selection. Four native XCTest scenarios were added for the fence; they have not executed on this Linux host.

Fresh cloud checks use synthetic data only. Focused Node suites ran inside an OS
loopback-only network namespace; the broader Electron run below was an earlier
Linux compatibility check:

- Password suite: 54 passed, zero skips, inside an OS loopback-only network namespace. Includes editable-layout sanitization and explicit private-display projections.
- Editable-layout/transient/settings suite: 18 passed, zero skips; changed UI lint has zero errors or warnings.
- TypeScript: 92 diagnostics, exactly matching clean develop after normalizing line numbers; no added diagnostics.
- Isolated Chromium: ten acceptance groups pass at 1440px and 390px with zero
  runtime errors. Physical typing/reveal/save, one write under rapid click/Enter,
  focus masking and live TOTP, real synthetic QR decoding, four independently
  edited/reloaded layouts, private-data exclusion, source/history reveal/hide,
  attachment removal, synthetic CSV preview/import/export and delayed read /
  capability cancellation all pass. The native bridge and screen-chooser
  cancellation are fixtures; they do not establish OS acceptance.
- Production client/server packaging and final Vercel output verification pass.
- API capability suite: 113 passed, zero skips.
- Proxy/capability files: 93 passed, zero skips, including six real Nitro HTTP
  request forwards and a delayed password-manifest/endpoint-change regression.
- Electron password and bundled-renderer tests: 15 passed, zero skips. The six
  former Darwin-only mock-helper tests now execute in an isolated VM on every
  host; the production platform gate is unchanged. This is bridge evidence,
  not macOS provider evidence.
- Full Electron suite: 322 passed, three failed, one skipped. Two unchanged
  release-cache tests require macOS `/usr/bin/ditto`; the unchanged owned-process
  cleanup test also fails alone on this Linux host. No clean full-suite pass is
  claimed. iOS release/configuration Node checks pass 12/12; four changed Swift
  files parse with the Swift tree-sitter grammar. Neither is Swift compilation
  or native execution. Swift/Xcode and signed macOS/iOS builds cannot run on this executor.

Public deployment readback on 23 October: production reports main
`83a709cfa0df49a7bbc74018f7f43f6f9066c29a`, with `api.passwords` 1.2.0.
The reachable [PR preview](https://pr-996.previews.dev.thingtime.com) advertises
1.2.1; the deployment list correlates its old head
`8ad72b435da76b9947bfcb77047e5b4f15a30715` with ready deployment
`dpl_ACpnr3wMuL4V3yqFoZxhyLB96LSH`. This does not establish deployment of the
new integration. Current Character discovery succeeds for the selected
`https://thingtime.com` origin, but private membership/authentication and task
writes have not been verified from cloud. The previous 1PUX import was not repeated.

Remaining device acceptance requires authorized access to the executing Mac and
physical iPhone, with the supported Thingtime password manager on each device:

1. Coordinate with the owner of the current installed app before replacing it.
   Build/verify the final signed host and extension, preserve the installed app
   and its data, and confirm selected origin, shared Keychain group and provider
   registration. Do not treat the historical installation below as current.
2. Select Thingtime in actual OS AutoFill settings. With disposable exact-origin
   login records, fill password and TOTP, create a passkey, reload/sign out and
   later assert that same passkey. The OS chooser and device-owner verification
   require user presence; simulator compilation does not satisfy this gate.
3. Refuse wrong origins/RPs, canceled verification, revoked sessions and stale
   account/endpoint operations. Remove one account and prove the other remains
   usable. Confirm Keychain-clear failure stays visible and recoverable after
   unlocking; a failed destination change must not misrepresent the active API.
4. Exercise the real screen-sharing chooser with a synthetic TOTP QR: accept,
   deny, cancel, close the editor, and allow a late chooser completion. Confirm
   the capture indicator/tracks stop immediately. Reject FIDO handoff images as
   TOTP/passkey-key imports. No screen or credential capture ran in cloud.

## Product and security contract

The signed-in user can own multiple independent credential Things for one
service, using ordinary editable block templates and the protected password-entry
schema. Header, list cards, fields, reveal/reorder controls, QR/native controls,
transfer dialogs, source/history and attachment panels are independently
authored blocks. Decrypted values are hydrated only into named live controls;
private values are absent from scope data, saved layouts and generic Action
history. Editing, owner/origin changes, hide and background events fence the
private controls and in-flight operations. Field definitions/values are encrypted with a per-owner data key;
password/session wrappers and the explicitly approved server recovery wrapper
preserve credentials across password recovery. See [the complete contract](../docs/password-manager.md).

The Swift provider implements password/OTP selection and ES256 passkey
registration/assertion. OS selection, secure Keychain session sharing and device
verification are required. Uploaded FIDO QR images are device-handoff requests;
they do not import private passkey keys. TOTP QR uploads and selected-screen
capture are decoded locally. Transfers support 1PUX and the three CSV dialects;
large backups split into individually restorable parts.

## Evidence — 2026-10-15

- Full unit suite passed during implementation: 4,453 tests, 9 skipped.
- Final focused password tests: 36 pass, including 2,001-account backup restore.
- Schema 265, capability 94, collections 60, Vercel 16 and desktop bridge 2 pass.
- Live HTTP-only replica fixture: 31 checks, including two owners, 52-entry
  pagination, catalog/export, deletion isolation, password recovery and logout.
- Browser: CRUD/reordered custom fields, QR upload with live TOTP, Chrome/Apple
  CSV and 1PUX imports; downloaded 1PUX restores all four synthetic entries.
- Shared Swift tests: 6 pass, including a real HTTPS preview client test that
  saves a native passkey, reads its encrypted fields back and refreshes catalog. Independent `@simplewebauthn/server` verification
  accepts native ES256 registration/assertion and rejects a wrong RP.
- Full iOS/Watch simulator and macOS provider builds pass. iOS simulator bundle
  installed on iPhone 17 Pro / iOS 26.5. Simulator Settings did not list the
  provider; physical-device signed testing is still required. See the [provider
  example device requirement](https://github.com/Dashlane/apple-credential-provider-example#requirements).
- Full web production build and emitted Vercel artifact checks pass. The native
  image package fix reduces emitted server/Workflow functions to 142.5/178.1 MiB
  on the local macOS build; Linux CI validates the deployment platform.
- Existing lint baseline: 7 import-order errors in remindersCore/kindRegistry,
  plus warnings. Typecheck ratchet reports 91 diagnostics versus stored 89;
  password additions have no new diagnostics. It is not a clean raw typecheck.
- Graphify query/update attempts hit the existing guard for five absent saved
  semantic nodes. No partial graph/manifest pair is committed.
- Web CI build/unit and HTTP API suites pass; CodeQL actions/TypeScript pass.
- GitGuardian flags Swift type declarations and public RFC TOTP test vectors.
  These are not account credentials. No deployment keys or real provider
  credentials are in this PR.

## Outstanding gates

### Current recheck — 2026-10-18

- The former Apple agreement failure did not recur. The development Mac was
  registered through Xcode's provisioning flow, and a signed development build
  succeeded. No legal agreement or privacy prompt was accepted automatically.
- Reproduced and fixed the distribution build failure caused by combining
  automatic signing with a Developer ID build identity. The canonical helper
  build now archives using Xcode development signing, then exports with the
  explicitly requested Developer ID identity. Manual host/extension profile
  overrides must be supplied together.
- Two independent Developer ID exports pass signature, timestamp, team,
  bundle-specific AutoFill profile and shared-Keychain verification. Their
  designated requirement is identical. An incorrect expected signer is rejected.
  Export verification happens before replacing the prior staged helper.
- The verified helper is installed at `~/Applications/Thingtime Passwords.app`.
  Its installed signature and executable pass; it launches, and macOS lists
  Thingtime Passwords for passkeys, passwords and codes in AutoFill settings.
  The user approved enablement, and the macOS AutoFill switch is on for
  passkeys, passwords and codes. The actual extension configuration sheet opens
  successfully. The installed multiline setup text is visually verified after
  rebuilding and relaunching; enablement survives that signed update.
  Password/code fill and passkey ceremonies remain unverified.
- Six Swift tests pass with the independent WebAuthn fixture enabled; the
  HTTPS client integration remains explicitly skipped in this fresh run.
  Independent registration/assertion verification and wrong-RP rejection pass,
  as do both desktop bridge origin/ordering tests.
- Current main is integrated, preserving native mail IPC and iOS widget signing
  alongside the password provider. The full iOS/Watch/widget/provider simulator
  build passes with the built HTTPS endpoint verified. All 109 Electron tests
  pass, including helper packaging and selected-origin isolation. The full
  desktop resources build and final signed packaging pass. The staged and
  installed app signatures verify, and its running executable is the installed
  `~/Applications/Thingtime.app` copy.
- The user explicitly approved replacing the running `codex/mobile-file-sync`
  app for acceptance. Its verified bundle was backed up before replacement;
  application data was preserved. The installed password build connected the
  provider through its supported current-session handoff.
- Installed acceptance then caught a desktop-only HTTP 500: cloning Nitro
  server requests with `new Request(event.req)` violates the native Request
  internal brand. Real Nitro GET/POST regression coverage reproduces the
  failure and passes after copying only upstream headers. Origin checks remain
  enforced; shared password/mail bridge contracts receive PATCH versions.
  The selected HTTPS server is now negotiated before private forwarding, so a
  newer bundled UI cannot silently search against an older listing contract.
  Nine proxy tests cover real Nitro requests, version rejection, wrong-origin
  manifests and no credential/body forwarding before compatibility succeeds.
  The repaired signed bundle (`1851b2e7c`) passes canonical verification and is
  installed in `~/Applications/Thingtime.app`. Installed signatures and running
  executable paths verify, the designated requirement remains stable, and real
  vault metadata now loads through the selected production server.
- Passwords was absent from sidebar and Commander navigation. Both existing
  catalogues now include the page. Installed Commander, sidebar and Security
  settings destinations pass. An isolated Chromium run verifies the Commander
  destination and the complete search regression flow at 1280px and 390px,
  including full-page scrolling, editor closure, retry and session expiry.
- The signed iOS device build also passes with the production HTTPS endpoint;
  no physical iPhone installation or OS acceptance is claimed.
- The final compiled server under Electron Node passes six real GET/POST
  bridge checks and manifest versions, inside an OS network sandbox. It rejects
  unavailable selected-server capabilities before forwarding private requests.
  All 101 focused password/capability/proxy checks pass.
- Live passkey registration on WebAuthn.io is awaiting user-controlled new
  credential creation and device verification. No private keys or real-account
  sessions were copied into test tools.

The entries below are historical evidence from October 15; their agreement and
profile failures are superseded by the current recheck above.

- Follow-up native audit fixed a macOS Keychain integration bug: all session
  operations now explicitly target the data-protection Keychain with the shared
  access group and synchronization disabled. Missing/unexpanded group settings
  fail closed. Apple's [Keychain documentation](https://developer.apple.com/documentation/security/ksecusedataprotectionkeychain)
  explains why the macOS legacy store cannot enforce these attributes.
  The updated Swift run has six passes and one explicit HTTPS-fixture skip;
  independent WebAuthn verification, the full macOS provider build and the full
  iOS/Watch simulator build pass. The rebuilt iOS app was installed and launched
  on iPhone 17 Pro with its built `ThingtimeWebURL` verified as
  `https://thingtime.com`. The optional fixture reports a skip when absent.
  A fresh signed build still fails with `PLA Update available` and missing host
  and extension provisioning profiles; no unsigned build replaces the installed app.

- Apple signing returned `PLA Update available`: account holder must review the
  latest Apple Developer Program License Agreement. No signed provider install,
  system-provider registration or live password/OTP/passkey ceremony claimed.
- HTTPS preview is verified at https://pr-996.previews.dev.thingtime.com
  (`196a9884f`): configured encryption, synthetic account save/read/catalog and
  Swift native passkey persistence pass. Responsive/capture fixes are deployed.
- 390px/1280px rendered QA passes after fixing fixed-nav clearance and centered
  width; controls do not overflow. A controlled browser canvas/video capture passes
  real TOTP QR decoding, blank-frame error cleanup, and cancellation/late-stream
  cleanup. The media picker is stubbed only inside the disposable QA page; this
  does not claim the OS screen-sharing permission picker was exercised. The
  blocked Chrome picker was closed. QR file upload is separately browser-tested.
- Editor closure now aborts capture and stops streams arriving from a late picker;
  video playback/frame waits time out together. Three regression tests pass.
- Native catalog sync refreshes after save/import/delete; the macOS companion
  opens the installed desktop app by bundle ID. The final macOS rebuild passes.
- Native identity writes now run in order, including logout after an outstanding
  catalog sync. A regression test also verifies the queue continues after failure.
  Background iOS sync does not interrupt an in-progress connection for the same
  owner; account changes cancel it and replaced requests settle promptly.
  Updated iOS/Watch and macOS builds, six Swift tests, HTTPS persistence and
  independent WebAuthn verification pass.
- Web prerequisite #997 is merged at `998bdb83c` and production-verified at
  https://thingtime.com/passwords: synthetic two-account encrypted round trips,
  catalog privacy and isolated deletion pass; test entries were removed.
  Native merge, signed release and device ceremonies remain pending.

The separate third-party OAuth implementation remains in PR #992. Real user
credentials should be added only after the password manager is delivered and
its production/native gates are verified.
