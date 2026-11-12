# PR 1309 — Thingtime password workspace and device verification

Source branch: `codex/password-verification-preferences`. [Pull request](https://github.com/lopugit/thingtime/pull/1309). Initial reviewed source: `5be83fac114cddbf5e7c030b9d22f51ad8d377a4`.

## Behavior

The extension opens a resizable, tabbed workspace with matching saved accounts first, username/email previews, search, explicit autofill, floating login/field selectors, and local QR screenshot upload or user-initiated screen selection. Filling never submits a form. Passkey approval opens in an owned popup and returns to the original tab/window/document. Config retains default dimensions, font size, passkey opt-in, and login-chip preferences. The 0.3.0 package has 18 files and retains the existing permission inventory.

The same editable account preference appears above the password manager list, in password-manager settings, and in Security. Reuse defaults on with five minutes when no interval is stored. The exact requested intervals extend through one year; Never persists account/origin/browser-device trust across logout after a successful password check. Each entry can inherit or override the interval. Off, Forget, policy revisions, entry epochs, expiry and password changes fence prior authority. Normal sign-in is still required; ordinary entry reads and export/admin/rotation authorization are unchanged.

Native AutoFill reads the shared boolean and requests Apple's supported reuse of a recent Touch ID device unlock for at most five minutes/platform limit. Every operation still evaluates OS authentication and rechecks the live request/session. Unavailable optional preferences disable reuse; authentication and cancellation failures abort. The native provider ships compiled tree icon assets, readable scrolling error/details content, and stable 1.0.8/build9 identities.

Canonical provider metadata uses a stable model AAGUID in browser/native registration envelopes. New own-vault titles include Thingtime Passkey; custom existing titles and keys remain intact. Thingtime's own RP recognizes its provider. Other platforms control their names/icons and mapping adoption; existing zero-AAGUID registrations cannot be retrofitted by signing in or renaming.

## Verification before release

- 132 password tests: 131 passed, one explicit native fixture opt-in skipped in this command; the separate four-test identity run includes that independent native public-envelope/signature check and passed without skips.
- 56 extension tests, five capture cleanup tests, 46 Swift tests (two existing opt-in skips), 128 capability tests and 18 passkey tests passed.
- All 351 Electron tests passed serially. A default-concurrency run hit a macOS EPERM in an unchanged owned-process cleanup test; its isolated rerun also passed. No permission guard was weakened.
- Raw TypeScript and the zero-error ratchet passed. Full lint passed with zero errors and 393 existing warnings; new warnings were repaired.
- Disposable replica/API plus isolated Chrome verified account registration, Never across sign-ins, master off/on, per-entry persistence, protected projections, stale GET versus optimistic Save, and separate Builder edits/save/reload of nested username/icon/checkbox/label blocks.
- Separate actual Chrome transport checks verified trusted versus forged clicks, selected form filling/no submit, document/form retarget refusal, two same-site windows, all tabs and narrow/large-text layouts, QR image/25MP decode, explicit TOTP save, and synthetic MediaStream cleanup. They do not prove OS screen-picker consent or live-account grants.
- Independent security review cleared cross-session revocation, commit-boundary registration, expiry/policy epochs, workspace retargeting, secret metadata projection, and late capture disposal regressions.

## Delivery boundary

The isolated development app and native provider build are separate from stable user data and services. The bundled development HTTP handlers publish passwords1.5 and account-registration1.2 as JSON, and serve the 0.3.0 ZIP. Signed stable installation, actual macOS picker artwork, physical Touch ID behavior, real-site acceptance and public metadata-registry adoption are tracked as separate release evidence. No key is removed or replaced for branding.
