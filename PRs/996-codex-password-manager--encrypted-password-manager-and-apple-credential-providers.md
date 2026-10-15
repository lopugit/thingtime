# PR #996 — Encrypted password manager and Apple credential providers

PR: https://github.com/lopugit/thingtime/pull/996
Branch: `codex/password-manager` (base `main`)

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
- Final focused password tests: 32 pass, including 2,001-account backup restore.
- Schema 265, capability 94, collections 60, Vercel 16 and desktop bridge 2 pass.
- Live HTTP-only replica fixture: 31 checks, including two owners, 52-entry
  pagination, catalog/export, deletion isolation, password recovery and logout.
- Browser: CRUD/reordered custom fields, QR upload with live TOTP, Chrome/Apple
  CSV and 1PUX imports; downloaded 1PUX restores all four synthetic entries.
- Shared Swift tests: 4 pass. Independent `@simplewebauthn/server` verification
  accepts native ES256 registration/assertion and rejects a wrong RP.
- Full iOS/Watch simulator and macOS provider builds pass. iOS simulator bundle
  installed on iPhone 17 Pro / iOS 26.5; this alone does not prove provider use.
- Full web production build and emitted Vercel artifact checks pass. The native
  image package fix reduces emitted server/Workflow functions to 142.5/178.1 MiB
  on the local macOS build; Linux CI validates the deployment platform.
- Existing lint baseline: 7 import-order errors in remindersCore/kindRegistry,
  plus warnings. Typecheck ratchet reports 91 diagnostics versus stored 89;
  password additions have no new diagnostics. It is not a clean raw typecheck.
- Graphify query/update attempts hit the existing guard for five absent saved
  semantic nodes. No partial graph/manifest pair is committed.
- GitGuardian flags Swift type declarations and public RFC TOTP test vectors.
  These are not account credentials. No deployment keys or real provider
  credentials are in this PR.

## Outstanding gates

- Apple signing returned `PLA Update available`: account holder must review the
  latest Apple Developer Program License Agreement. No signed provider install,
  system-provider registration or live password/OTP/passkey ceremony claimed.
- HTTPS preview and deployment encryption configuration need verification.
- 390px rendered QA and screen-capture completion are pending. Chrome has a
  chooser open for the synthetic `__password-qa.png`; native UI automation timed
  out. In-app browser capture stalled; upload works.
- Merge and production deployment verification remain pending.

The separate third-party OAuth implementation remains in PR #992. Real user
credentials should be added only after the password manager is delivered and
its production/native gates are verified.
