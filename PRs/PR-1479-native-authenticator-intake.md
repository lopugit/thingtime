# PR 1479: transient native authenticator setup review

[Pull request](https://github.com/lopugit/thingtime/pull/1479)

## Result and scope

Reconciles the previously authored native-6 implementation from f7e9d9d46 with
main at 284f73d. It adds strict memory-only TOTP URI intake, normal destination
sign-in in a separate companion browser, account/origin/document-bound one-use
handoff, editable review controls and an explicit existing vault Save operation.
The current companion connection/revocation lifecycle, passkeys/AppID, iOS LiDAR
and sharing paths are retained. API 1.9.1 remains unchanged; native bridge 1.0.0
requires compatible api.passwords 1.2+. QR image changes and other old PR 996
features are excluded.

## Companion release metadata

The macOS XcodeGen spec is the canonical version source. Both the host and
extension inherit MARKETING_VERSION 1.0.9 and CURRENT_PROJECT_VERSION 10;
the verifier requires their versions to agree. This advances the installed
1.0.8/build 9 companion without changing bundle identifiers, Keychain groups,
entitlements or signing settings. iOS release metadata remains unchanged.

## Verification

- Swift core: 56 tests, no failures; two existing skips.
- Password suite: 180 tests, 179 pass; one existing skip. Ten intake client/native
  security checks are included. Capability suite: 180 pass.
- TypeScript, zero-error ratchet and full lint error gate pass. Full lint retains
  453 warnings; no warning-free claim.
- Canonical web build, unsigned macOS companion/provider build and complete
  iOS Simulator/Watch build pass. The Simulator build uses destination selection
  without forcing the iPhone SDK onto the Watch dependency.
- Isolated Chromium at 1440 and 390 pixels verifies cold intake, masked seed,
  no automatic save, explicit synthetic saved-code write, warm cancellation
  preserving draft, independent Builder selection of nested text and button
  labels, and page overflow at the top and bottom. Synthetic transport and build
  checks do not establish installed or provider acceptance.
- Independent read-only review found no actionable issues in the native/client
  security boundaries or explicit draft/save path.

## Remaining acceptance and limits

Keep merge with the task owner until source review and required acceptance.
Use a distinct signed development companion and its isolated Keychain identity;
never replace the stable app with an unmerged branch build. Verify installed
Set Up Codes In selection, normal intended-account sign-in, native cold/warm
intake, explicit review/Save, exact saved-entry readback and an independent code
comparison. Check cancellation, destination/account switches, expiry/replay and
reload. Native passkey registration/assertion are separate ceremonies.

The existing build tool accepts isolated host/provider IDs, matching Keychain
identity and separate build/staging paths. No stable installation or real-account
action was performed by this implementation worker. Temporary unsigned macOS
build registration was removed after compilation.

The local semantic Graphify attempt timed out after 240 seconds while indexing
five changed documentation files; a bounded attempt on this small review note
also timed out. A verified structural snapshot and portable
HTML were produced; that documentation is not claimed as semantically refreshed.
A bounded four-snapshot retention preserves the previously tracked snapshots
and the checked source snapshot. Parser
warnings in unrelated source and four existing nodes lacking source metadata
remain graph coverage limitations, rather than compiler failures.
