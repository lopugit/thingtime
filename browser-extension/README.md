# Thingtime browser extension

On macOS, use the signed native Thingtime Password AutoFill provider first. Chrome
can use the system provider without this extension. This optional browser adapter
handles public WebAuthn requests through the existing Thingtime approval page; it
does not communicate with the native host. Its explicit password-form flow is
documented below.

Unpacked Manifest V3 Chromium extension. It is **off by default**. Its action popup
lets the user explicitly enable passkey interception, select their trusted Thingtime
origin, and switch a pending request to the browser's native provider. No password,
passkey private key, cookie or authentication token is stored in the extension.
Only enable a Thingtime origin you trust: it handles the authenticated vault and
signing operation. HTTPS is required, except explicit `localhost` / `127.0.0.1`
development origins. HTTP development support does not establish production safety.

Load `browser-extension/` with Chrome's **Load unpacked** in a task-owned test profile.
Use the action popup to enable it, then reload already-open relying-party tabs.
No browser install, user account access or OS provider enablement occurs as part of
building the source. The extension is not a Chrome Web Store release.

After an approval-page result, including explicit cancellation or **Use another
passkey provider**, the extension closes its owned approval page and restores the
exact requesting tab/window before delivering the response. The fallback therefore
starts native WebAuthn in a focused document. Closed, moved or newly navigating
requesters are not focused. Background opt-out, timeout, navigation and automatic
cancellation do not take focus. No callback URL is guessed or new tab opened.

## Connection diagnostics

From the website tab, open the Thingtime toolbar popup and use **Refresh connection
status**. This performs one bounded, read-only handshake with that exact document.
It reports whether the save/sign-in hooks were installed, whether they remain
current, whether the page observed the opt-in, and a closed native-fallback reason.
A replaced hook is reported; the extension never takes over another extension's
replacement. Missing bridge/hook state gives reload and site-access guidance.

These are page-reported diagnostics, not authentication or routing authority.
Only booleans and a fixed reason code cross the diagnostic boundary; no request
options, challenges, credential IDs, account/session data or responses are retained
or displayed. Nothing is persisted. Navigation invalidates a pending reply.
This does not promise a successful passkey ceremony or native provider ranking.

If hook installation fails while a competing password-manager extension is on,
turn that browser extension off and reload the website before checking again.
Its own passkey-off preference may leave its JavaScript hook locked. For example,
1Password's Chrome extension can be disabled while keeping its macOS AutoFill
provider enabled. This trades its browser UI/autofill for Thingtime-first handling
of supported explicit requests; conditional and unsupported requests stay native.

## Design and trust boundary

A `document_start` MAIN-world hook wraps `navigator.credentials.create/get`. An
isolated-world script relays public WebAuthn request options through extension
runtime messaging. The worker checks the actual Chrome sender origin, top frame,
tab URL and current `documentId`; a page cannot choose the origin sent to Thingtime.
Only one ceremony per relying-party tab is admitted. The dedicated provider tab
is owned by that ceremony and must keep its exact origin, path and document. No
remote `postMessage`, arbitrary opener handler, externally connectable runtime
entry point or `webAuthenticationProxy` permission is used.

Requests expire after the caller's timeout or a 120-second ceremony lease.
Cancellation, either tab closing, cross-origin SPA navigation, document replacement,
provider-route navigation and settings changes invalidate the ceremony. Cleanup closes only the owned provider URL/document; a tab navigated elsewhere,
including a pending user navigation, is preserved. Worker suspension/restart fails closed and cleans up
persisted tab-routing handles; request options/results are never persisted. Abort
and errors never silently replay the native operation. Native fallback happens
when disabled, for unsupported request types/options, or after an explicit provider
choice. Late responses and mismatched provider documents are ignored.

Supported basic registration/assertion options are serialized with BufferSources
as base64url. Creation supports `credProps: true`. Adapter 0.5.0 supports assertion `appid`
only when empty/default or an exact-origin, credential-free HTTPS URL without a
fragment. It uses FIDO's no-fetch facet authorization subset and preserves the
normal RP-bound credential and RP hash; `getClientExtensionResults()` and JSON
return `{appid:false}`. The hosted provider requires both modern and active
same-origin `api.passwords` 1.9.0 before AppID vault operations. Other origins or
legacy AppID-bound credentials require the native provider; no AppID URL is fetched.
This is reusable protocol support, not an AWS-specific credential exception.
Conditional mediation, other extension inputs (including PRF/largeBlob),
hints, unsupported algorithms (no ES256 offer), non-none attestation, cross-platform
authenticator attachment, unknown option fields and mixed credential requests
delegate to native WebAuthn before opening the provider. Returned credentials
are compatible objects with ArrayBuffers, `getClientExtensionResults`, `toJSON`
and registration response methods; they are not native browser internal-slot
objects and `instanceof PublicKeyCredential` is not promised. Native authenticator
hardware/UV/attestation semantics cannot be synthesized by this extension.

Host access to HTTPS websites is required to install the WebAuthn hook there. The
WebAuthn path does not inspect form values, cookies or vault contents. Public
challenges, credential IDs and signatures transit memory only. The separate
explicit password-form flow below uses its owned authenticated provider page.

## Provider page contract (version 1)

The selected origin's `/passwords/provider` page owns the authenticated user
interface, account fences, confirmation, RP ID validation, user verification and
vault operation. It must not sign before explicit confirmation. It must independently
validate the trusted `origin`/RP relationship and options before touching keys.

DOM event details may be objects **or JSON strings** when received; the extension
sends JSON strings for isolated-world portability. Decode them before handling.

- Page emits `thingtime:password-provider-ready` with `{version:1}` after listeners
  mount. It must also emit ready upon `thingtime:password-provider-init`.
- Extension emits `thingtime:password-provider-request` with
  `{version:1,id,type:'create'|'get',origin,publicKey}`. `id` is worker-generated;
  `origin` is browser-derived; `publicKey` follows WebAuthn JSON base64url encoding.
- Page emits `thingtime:password-provider-response` with
  `{version:1,id,response}` (PublicKeyCredential JSON), or
  `{version:1,id,error:{name,message}}`, or `{version:1,id,fallback:true}` following
  the user's explicit **Use browser provider** choice. The extension forwards only
  the matching owned provider document's response.
- Extension emits `thingtime:password-provider-cancel` with `{version:1,id}` before
  cleanup. The page must abort and discard in-flight work; unmount/navigation must
  likewise clear it. Late completion cannot reach the relying party.

This is a bridge contract, not an authentication grant. Scripts in a provider
origin have that origin's authority; do not host the provider on an untrusted or
shared origin. Origin validation prevents a different website impersonating it.

## Passwords settings discovery

Only pages at the **configured** Thingtime origin with exact path `/passwords` or
`/settings/passwords` can query setup state or open extension settings. Their page
emits `thingtime:password-extension-query` with `{version:1}`; the isolated bridge
returns `thingtime:password-extension-status` with
`{version:1,available:true,enabled,origin}`. The status detail is a JSON string.
`thingtime:password-extension-configure` with `{version:1}` opens the extension's
own options tab using `runtime.openOptionsPage`. It does not accept settings or
origins from web content. Other websites/routes receive no available status and
cannot open settings through this interface. The extension's options UI itself
is the only place to change its origin or enable state.

## Validation and platform limits

Run `node --test browser-extension/test/*.test.mjs`. Unit tests cover sender trust,
provider-document binding, malformed origins, native fallback, reconstruction,
abort/late completion, and worker request lifecycle with a synthetic Chrome API.
They do not prove a real website accepts signatures, browser packaging/injection,
provider sign-in, Chrome's service-worker lifecycle or real vault access. Manual
acceptance must register and authenticate a disposable account on an independent
HTTPS relying party, then cover cancellation, navigation, timeout, native fallback,
multiple tabs, restart and unrelated-tab preservation in an isolated browser.

This manifest targets Chrome/Chromium 111+ MAIN-world content scripts. Firefox
supports WebExtensions but differs in MV3 background and MAIN-world support across
versions; Firefox is **not verified or packaged here**. Safari and OS-wide AutoFill
continue to use the native provider. Hook timing, pages that replace credential
methods, enterprise restrictions and sites that demand native object identity can
prevent interoperability; use the explicit native-provider choice in those cases.

## Resizable browser workspace

The toolbar opens one resizable Chrome popup **window**, rather than an action
popup. Repeated clicks focus that window and bind Overview to the website document
captured by the new click. Overview reports closed hook diagnostics; Requests
shows pending approvals and an explicit native-provider action; Config keeps
connection controls separate from appearance; Help explains setup and coexistence.
Arrow keys, Home and End navigate the tabs. The existing options page uses the
same interface, without guessing a website from its own foreground window.

Config saves default width/height (960 × 760 pixels) and text size (16 pixels)
locally. New windows fit these dimensions to their actual screen; **Apply size to
this window** applies saved dimensions immediately. Manual resizing does not
replace the defaults. Appearance edits never cancel active passkey requests or
change opt-in/origin. Window dimensions must fit Chrome's signed 32-bit integer
API; no smaller product limit is imposed. No permissions were added.

Only the captured tab/window/document and origin live in session storage. A
closed, moved or navigated target becomes unavailable until another toolbar
click. Diagnostic results are bound to that target and fenced against older
inspections; page options, credentials and completed-request history are absent.

Run unit coverage with `node --test browser-extension/test/*.test.mjs`.
Synthetic rendered acceptance uses an installed Playwright module and its Chrome
for Testing binary:

```sh
node browser-extension/test/workspace-browser.mjs --playwright /absolute/path/to/playwright/index.mjs
node browser-extension/test/workspace-browser.mjs --catalog-only --playwright /absolute/path/to/playwright/index.mjs
```

This creates and removes its own profile, extension fixture and browser windows;
no real account or credential is used. Screenshots/result JSON remain in the
printed temporary evidence directory. It covers real Chrome window reuse,
settings save/reload, all tabs at desktop/narrow/landscape widths, 32px dark-mode
text, keyboard navigation and stale website targeting. The fixture imports the production window controller and calls it through actual
Chrome APIs; it does not click the OS toolbar. Installed acceptance must still
verify the real toolbar event and originating tab. This is UI acceptance, not
proof of a relying party accepting a passkey.
Use `--catalog-only` for a headless check of delayed catalogs, cached search,
pagination, retry and locking, without the native window focus checks.

Chrome's [action documentation](https://developer.chrome.com/docs/extensions/reference/api/action)
explains why `default_popup` is removed to receive toolbar clicks. Its
[windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)
provides popup-window creation/focus/resize using the existing permissions.

## Password workspace, explicit autofill and local QR (0.3)

Saved accounts appear in the workspace Overview, with the saved username/email
under each title. Matches for the selected website sort first; search covers the
full catalog and can find other saved accounts. A refresh keeps the same
account's cards searchable and shows one inline indicator while it runs.
Account changes, origin changes and locking clear the old account list.
Autofill stays unavailable for other sites. On-demand vault access opens an
owned first-party Thingtime popup; credentials are obtained only there through
the negotiated `api.passwords` 1.6.1 confirmation/fill contract. The extension
never reads a browser cookie or makes an authenticated cross-origin vault fetch.

On supported top-level login forms, the tree chip appears at the top center and
inside username/password fields. Click it, choose an account, and complete any
required Thingtime verification. Only the selected account is filled, with no
extension-triggered submit. Cross-origin frames and off-origin form actions are
refused; navigation, retargeting, changed field identities and account changes
invalidate delivery. Config can disable account chips. Passkey approvals now use
a dedicated resizable popup with the configured opening size/font; a returned
request targets its original document/window, never another tab found by URL.

The chooser remains within an active website modal's accessibility/focus scope,
including transformed or clipped dialogs. Tab stays in the chooser and Escape
closes it before the website handles its own Escape. If an already-open site
retains an invalidated extension context after an update, it offers explicit
**Reload website** guidance rather than a raw runtime error; reloading is never
automatic and can discard unsaved site edits.

The chooser refreshes the live provider catalog without moving focus if it
already has a connection. It lists and searches all saved matches for this
website. A temporary refresh failure keeps the same account's list available
with a Retry button. Selecting a row takes priority over the background refresh
and verifies the selected account through the live provider.
Saved bare Website hosts mean HTTPS. Both extension surfaces use the
server's exact saved origins, including scheme and port, when available.
Older hostname-only catalogs suggest HTTPS default-port matches only. The
server still verifies the exact saved origin with the live account/session and
required approval. Wildcard or userinfo-bearing values are refused.

The account catalog is allowlisted metadata held in memory while its owned
provider document is live. Closing/locking that connection clears it. Passwords,
private keys, account/device proofs, image bytes and decoded TOTP secrets are
never written to extension storage. Screen QR scanning opens the browser's
explicit screen/tab chooser and stops capture tracks immediately after taking
one frame. Upload processing also stays local. A decoded TOTP setup is saved
only after review in the owned Thingtime page; its optional website is explicit,
not inferred from whichever tab happened to be selected. FIDO device-pairing QR
codes are not TOTP secrets and do not perform passkey authentication here.

Build the runnable adapter with `pnpm --dir remix run build:password-extension`
and extract `remix/public/downloads/thingtime-passwords-extension.zip` before
Load unpacked. The source folder is build input: `qr.js` is generated into the
ZIP from the canonical web QR decoder, not maintained as a second decoder or
checked-in vendor bundle. The permission inventory is unchanged. Browser screen
sharing consent is requested only by Scan, not at startup.

Run `node --test browser-extension/test/*.test.mjs` for transport/race/packaging
checks. `test/workspace-browser.mjs --playwright <absolute-playwright-module>
--provider-ui-origin=http://127.0.0.1:<fixture-port>` exercises the actual adapter,
component/action path and local image decoding with disposable synthetic data.
QR PNGs under `test/fixtures/` encode a public RFC 6238 test vector, not a user
credential. Fixture API responses are not proof of real server authorization,
OS acceptance or a site's login outcome; those require separate integration and
installed-release checks.

## Thingtime accounts

Version 0.4 adds automatic discovery of already signed-in accounts on the exact
Thingtime origin in Config. With no eligible open page, **Sign in** opens an owned
Thingtime account window; **Add account** and **Switch account** reuse the existing
first-party account switcher. Switching also changes this browser's Thingtime web
tabs. **Lock** clears the extension connection without signing your account out. **Unlock** reuses its live session and preserves the configured verification policy.
No account cookies or session tokens are copied into the extension. See
[the account bridge contract](../docs/browser-extension-accounts.md).
