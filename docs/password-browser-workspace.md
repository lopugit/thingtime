# Browser password workspace and autofill

The extension's native browser adapter provides cached metadata, account search,
explicit selected-account filling and local QR controls. Its owned first-party
approval view uses individually editable saved Thingtime blocks through
`SettingsDocumentHost`, the canonical renderer and transient action host. The
extension chrome remains the small browser capability adapter; it never embeds
an authenticated Thingtime session or a second vault.

`vault.js` binds a request to the browser-authenticated top-level origin, tab,
window and document. Internal workspace selection also carries the exact catalog
target tuple and a capture generation. Async lookups, provider delivery and final
commit recheck these fences. The browser-provider document must be the exact
owned popup tab/document at the configured origin and route. Page-provided
postMessage/custom events cannot initiate a credential request; isolated chips
accept trusted user clicks, while extension workspace controls are bound to the
extension document. Before verification and delivery, it rechecks the captured
modal or document, form owner and action if present, exact field nodes, and an
unpredictable local nonce. On form-less pages, a password or explicitly marked
username field is captured on its own. New-password and one-time-code tokens,
disabled controls, and fields whose owner or identity changes are excluded.
Thingtime never invokes a submit action.

For assisted sign-in, use the on-site Thingtime chooser on the exact intended
origin and select the matching saved account. The chooser and approval surface
identify the site and selected entry with metadata. The verified provider hands
the value directly to the bound browser field. Keep passwords out of clipboard,
chat, console output and screenshots. If the site changes steps, use the chooser
on the newly displayed field. Continue through the site's own sign-in control
with any required human verification.

Metadata is strictly allowlisted (`id`, title, username, domains and fill
eligibility), memory-only and tied to the live provider/owner. Server-selected
`fillEligible` excludes passkey/private-key records. Matching hosts sort first;
other records remain searchable but cannot be filled into that host. The server
separately enforces the exact stored login URL origin and selected entry.

The first-party page negotiates `api.passwords` 1.5. It asks for confirmation
status with distinct purpose `fill`, exact RP/origin and entry ID, verifies when
required, and presents the resulting per-request binding to operation `fill`.
The browser adapter does not create or persist a remembered-device grant. Shared
password confirmation preferences are editable in the approval view; changing a
preference alone grants no authority. OS confirmation is independent.

QR scanning reuses `qr.client.ts`/`totp.ts`, bundled locally into the ZIP. The
browser chooser or user-uploaded image is the only source. Capture stops after
one bitmap; canvas pixels and bitmaps are disposed on success, error, cancellation
and late acquisition. Tiled, yielding decoding bounds working memory without
file-size/megapixel rejection. A TOTP URI remains transient until an explicit
review/save through the normal vault API; it never enters URL/query/hash,
telemetry, extension storage or generic Action history. The optional saved
website is explicitly entered. A FIDO pairing code is reported as a different,
unsupported handoff, not a successful authentication.

Verification uses Node transport regressions (including both live A/B documents,
old same-site windows, changed form actions and account invalidation), actual
isolated Chrome form/component tests, positive normal/large QR images, rejected
FIDO images and microtask-order capture cancellation tests. All fixture identities
and QR secrets are synthetic/public test vectors. Real server grants, native OS
operations and external relying-party acceptance remain separate checks.

See [provider identity](password-provider-identity.md) for the stable AAGUID and
why an RP controls its own passkey row name/icon. Do not alter credentials to
force an external label, or treat an already successful native sign-in as a lost
Thingtime approval without inspecting the actual request state.
