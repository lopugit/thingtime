# PR #996 — Encrypted password manager and Apple credential providers

PR: https://github.com/lopugit/thingtime/pull/996
Branch: `codex/password-manager` (base `main`)

## Release split

The web vault was merged into main at `998bdb83c` by [PR #997](https://github.com/lopugit/thingtime/pull/997). This branch incorporates that web base and retains the Apple providers, native packaging and signing setup. It stays a draft until provisioning and actual OS ceremonies can be validated. The evidence below includes the shared web prerequisite.

## Product and security contract

The signed-in user can own multiple independent credential Things for one
service, using the shared Thing field-mod editor and protected password-entry
schema. Field definitions/values are encrypted with a per-owner data key;
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
  The repaired bundle still needs rebuilding and installed verification.
- Passwords was absent from sidebar and Commander navigation. Both existing
  catalogues now include the page; installed navigation acceptance is pending.
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
