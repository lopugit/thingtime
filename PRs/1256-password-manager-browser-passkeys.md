# PR #1256: Add dedicated Password Manager and Chromium passkey provider

## Scope

Adds the dedicated editable Password Manager Settings surface and an opt-in Chromium browser extension that provides WebAuthn passkey ceremonies for the web vault. The password vault remains in the web app; account passkeys remain managed in Security settings. API capability `api.passwords` is versioned at 1.4.0.

## Decisions and boundaries

- The browser provider is opt-in, Chromium-only, and mediated by the extension; no browser passkeys or credentials are extracted.
- Passkey registration and sign-in bind to the current account, origin, request and session. Registration persists through the canonical encrypted vault path and is read back for verification.
- Existing stable extension release 0.1.1 is unchanged; this PR ships a downloadable build artifact and does not publish a store release.
- No production account or fixture data was written during validation.

## Validation

Parent task recorded passing password (96), extension (24), settings (60), and capability (116) tests; TypeScript, focused lint, full Vercel build and built-handler capability smoke; isolated Chromium registration/sign-in, wrong-password/retry/cancel/navigation cleanup and desktop/mobile drawer/Builder checks; and final isolated macOS development build (331 tests), login/vault/rendering and guide ZIP checks. Detailed evidence remains in task-local paths and is not committed.

Current-head CI initially exposed a stale source assertion in
`remix/app/components/Nav/lopuDrawerEntry.test.ts`: the floating Lopu host is
now intentionally excluded from `/passwords` and `/settings/passwords` as well
as authorize popups. The test now asserts those exclusions and the existing
after-DrawerSystem ordering; the focused test passes 9/9 and targeted ESLint
passes. Full current-head CI is being rerun after this regression-test update.

## Limitations

Safari, Firefox, mobile browser-provider support and a browser-extension store release are not validated or included. Tailscale/Funnel is unavailable on this machine, so no Funnel URL is claimed. Semantic Graphify indexing of documentation was unavailable; the portable graph refresh uses structural extraction only.
