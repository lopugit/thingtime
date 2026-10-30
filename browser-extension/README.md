# Thingtime browser extension

On macOS, use the signed native Thingtime Password AutoFill provider first. Chrome
can use the system provider without this extension. This optional browser adapter
handles public WebAuthn requests through the existing Thingtime approval page; it
does not communicate with the native host or fill password forms.

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
as base64url. Creation supports `credProps: true`. Conditional mediation, other extension inputs (including PRF/largeBlob),
hints, unsupported algorithms (no ES256 offer), non-none attestation, cross-platform
authenticator attachment, unknown option fields and mixed credential requests
delegate to native WebAuthn before opening the provider. Returned credentials
are compatible objects with ArrayBuffers, `getClientExtensionResults`, `toJSON`
and registration response methods; they are not native browser internal-slot
objects and `instanceof PublicKeyCredential` is not promised. Native authenticator
hardware/UV/attestation semantics cannot be synthesized by this extension.

Host access to HTTPS websites is required to install the WebAuthn hook there. The
extension does not scrape forms, autofill passwords, inspect cookies or read vault
contents. Public challenges, credential IDs and signatures transit memory only.

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
