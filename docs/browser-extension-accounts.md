# Browser extension accounts

The Thingtime extension discovers the account roster from an already open page
on the exact Thingtime origin selected in Config. It does not inspect Chrome
profiles, cookies, session identifiers, tokens, or another browser's state. No
popup opens for automatic discovery. If no eligible signed-in page is available,
choose **Sign in** to open a dedicated Thingtime account window.

That window reuses the canonical account switcher and inline sign-in. It remains
on `/passwords/provider?view=accounts` with a nonsecret operation identifier;
there is no arbitrary return URL. **Add account** and **Switch account** open
that same first-party account surface. Switching uses the existing browser
session roster and therefore also switches this browser's Thingtime web tabs.
The extension does not create a separate authenticated session or export one.

Only account ID, username, display name and active status cross the discovery
bridge. Redacted saved-account metadata is loaded by the first-party page using
the canonical password API, checking the active owner before and after the read.
Passwords remain behind the existing selected-entry verification and exact
requesting document/form/action transport. Catalogs and profiles remain in
background/workspace memory; extension storage retains only preferences,
nonsecret routing/epoch values and a connection-lock boolean.

Account changes, detected sign-out/revocation, selected-origin changes and Lock
invalidate pending requests and the previous catalog. Async discovery replies
must still match the account generation, selected origin and live source document
after their final await. Remote revocation is detected on the next live roster or
protected API check; cached metadata is not proof of a live session. Lock survives
extension service-worker suspension; explicit Unlock reconnects through the existing live session. Locking the
extension connection does not revoke the browser's Thingtime account sessions.

Existing workspace appearance preferences and extension permissions remain
unchanged. Account selection never submits the website's login form. Existing
website tabs may still need the normal extension Reload/update handoff; this
feature does not bypass browser-controlled installation or device presence.

## Verification

`browser-extension/test/accounts.test.mjs` covers allowlisted/popup-free discovery,
forged/stale senders, switch/logout and origin fencing, late replies, and Lock
while final live-document validation is pending. The disposable real-API runner
can additionally run the actual extension and first-party account UI:

```sh
THINGTIME_EXTENSION_ACCOUNTS_UI=1 \
THINGTIME_TEST_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
PLAYWRIGHT_BROWSERS_PATH=/path/to/owned/browser/cache \
corepack pnpm --dir remix run test:passwords:verification-ui
```

It uses its own browser process/profile, ephemeral replica/API and synthetic
accounts. Screenshots are written under `/tmp/password-extension-accounts-evidence`.
This is isolated acceptance, separate from production or installed-user evidence.

The account window has an explicit **Return to Thingtime workspace** control. It
focuses only the recorded extension workspace, never a guessed website tab. An
account window may remain available behind the workspace when it is the only
live first-party connection; otherwise the exact owned popup can close. Existing
pending website approvals end when identity changes; restart them at the original
website after signing in. Heading, tree, session notice and return controls use
the normal editable Settings documents; authentication reuses AccountSwitcher.
