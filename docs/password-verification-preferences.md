# Password confirmation preferences

Updated 3 November 2026.

The same editable **Password confirmation** control appears at the top of
`/passwords`, in Password manager settings, and in Security's account-passkey
creation flow. **Reuse recent device verification** starts on with five minutes
when no explicit duration exists. Turning it off requires a fresh Thingtime
password approval and preserves the chosen duration and entry overrides.

Choose Ask every time, 5 minutes, 1/6/12 hours, 1/2/3/14/30/60/90 days, 1 year,
or Never on this device. Each saved entry can use the global setting or its own
interval. A stricter entry choice wins. A setting by itself never enrolls a
device: the next successful current-password approval establishes trust.

Never is durable trust for this account and Thingtime origin on this device,
including normal sign-out and future sign-ins. It stores no password. The server
requires an authenticated live account session on every use. A different account,
origin or device cannot borrow the proof. Each new website request still needs
explicit approval, a matching site, its selected credential and the original
challenge/allowlist/exclusion checks. Global trust applies across ordinary
website passkey creation/use, account-passkey creation, and explicit password
fill; each resulting ceremony has its own purpose and request binding.

**Forget this device / require password again** revokes this account's device
trust. Clearing current approvals ends pending ceremonies and finite-session
reuse, and clears displayed values; it preserves Never. Password changes/reset,
revoked sessions and policy changes are rechecked before protected delivery.
Policy changes invalidate earlier grants, including an off→on toggle or an entry
override changed back in the same millisecond. Changing one entry's confirmation
policy conservatively invalidates the account's prior remembered approvals.

Browser storage can be cleared or evicted. The server's Never record has no
expiry; its HttpOnly, host-only, SameSite cookie is renewed on use. Chrome limits
persistent cookie expiry to 400 days, so losing that browser proof requires
current verification again. See [Chrome's cookie lifetime rule](https://developer.chrome.com/blog/cookie-max-age-expires/).

## Coverage and boundaries

| Flow | Confirmation behavior |
| --- | --- |
| Browser passkey create/get | Global interval; exact entry override for get; consent for each request |
| Explicit extension password fill | Same policy, exact saved login and HTTPS origin; username/password only; no automatic submission |
| Security → add Thingtime sign-in passkey | Global policy, separate account-create ceremony; WebAuthn user verification remains required |
| Open an existing Password manager entry | Existing authenticated-session access remains unchanged; no new password prompt is introduced |
| Export, credential deletion/revocation, rotation, administrator/CI/deployment reveals | Existing authorization and fresh-verification rules remain unchanged; remembered approval grants no new authority |
| Native AutoFill | Reads only the shared reuse boolean; always performs OS evaluation and clamps supported OS reuse to 300 seconds/platform maximum. Long intervals/Never do not bypass macOS verification |

## API and storage

`api.passwords` **1.5.0** adds `verification-settings`, `verification-status`,
`verification-lock`, `verification-forget`, and protected `fill` operations.
`verification-settings` returns `{settings:{window,revision,changedAt,
reuseRecentDeviceVerification,epoch}}`. A mutation includes the expected
`revision` and optional `window`/`reuseRecentDeviceVerification`; omitted values
are preserved. An entry mutation includes `id` and `window` (`global` allowed).

`verify-passkey` optionally takes `context:{purpose,rp,entryId?,origin?,requestHash?}`
and a request UUID. Its dependent requests carry the same context in
`passkeySession:{requestId,binding,context}`. The public session binding is only a
comparison hash; server-held ceremony state and device proof determine reuse.
New browser clients negotiate 1.5. Older/native entry reads keep their existing
contract; device proof is not interchangeable with a bearer/native credential.
Security register-options/register negotiate their additive **1.2.0** contracts.

Defaults stay in private account metadata; overrides remain in encrypted entry
values. Independent protected `password-verification-device` Things store opaque
hashed device/scope bindings and Binary approval metadata, using existing shared
indexes and accounted home-plane transactions. Generic Things/Actions/sharing
cannot read or mint them. Ephemeral ceremony records use existing `authOtps` TTL.
The final account-passkey insert shares a transaction with session, policy and
device write fences. No new secret, environment variable, collection or index is
required.

Optional `GET /api/v1/passwords?previews=1` returns a private username/email
subtitle for existing records without edit/resave. Only unconcealed plain
text/email fields with canonical `username`/`email` IDs qualify; passwords, TOTP,
keys and concealed custom fields never become preview metadata. Saved-card title,
subtitle, type, icon and button are individually editable blocks.
