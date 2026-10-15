# Password manager

`/passwords` is an account-private credential library. Each account can own many
independent entries for the same service. Entries use the protected
`password-manager-entry` Thing schema and the reusable Thing `mods.layout=fields`
editor, with ordered fields, masked secrets and extensible custom fields. The
ordinary Thing tree is unchanged; controlled field mods do not persist values
through global Thing state, local caches, editor history or request diagnostics.

## Storage and access

`api.passwords` 1.0.0 uses the home data plane. GET returns 50 metadata records
at a time. POST requires a full, live user session and `expectedOwnerId`:
`read`, `save`, `delete`, `export`, or `catalog`. Export pages decrypt at most
50 entries using one bounded query and one account-key load. Scoped tokens, service accounts,
temporary accounts and internal Action identities are not vault sessions.
`catalog` returns names, usernames, exact HTTPS domains and public passkey
identifiers for native selection; passwords, TOTP seeds and signing keys are
excluded. Responses are private/no-store. The catalog and optional native bridge
prepare for the separately delivered system provider.

Field contents are AES-256-GCM encrypted with a random account data key, using
owner, key ID, record ID and purpose as authenticated data. The key is wrapped
with the user's password (scrypt) after successful password sign-in, and with
each live session (HKDF). Existing or SSO-only sessions can establish the
recovery/session wrappers before a password wrapper exists. A separate
server recovery wrapper is deliberately retained for the requested background
access and account recovery. This is **server-assisted encryption**, not a
zero-knowledge vault. A deployment administrator with both the recovery key and
database access can decrypt it. Password reset atomically replaces the password
wrapper while preserving the data key and revoking old sessions.

The title and credential category are private plaintext metadata; all field
labels, field values and ordered field definitions are inside the encrypted
payload. Password entries use canonical accounted Thing transactions. Revision
checks prevent stale writes; stable write IDs make retries idempotent; minimal
value-free deletion tombstones prevent delayed resurrection. General Thing
read/write/search/export and Timeline do not expose these protected records.
There is no password history or offline decrypted vault cache in this release.
Draft edits stay in component memory, are masked when the tab loses focus, and
clear on account change, navigation, page teardown or Hide values.

The standard web API refuses implicit production fallback. The installed
Electron shell has an explicit exception: its loopback UI uses its selected
HTTPS account endpoint, with main-frame, origin and account checks. No alternate
endpoint is tried when a password request fails.

## QR codes and transfer

Upload PNG/JPEG/WebP or choose a screen/tab using the browser capture picker.
Images are decoded locally and discarded; streams stop after the capture.
`otpauth://totp` imports generate SHA-1/256/512 codes with 6 or 8 digits. The
screen-capture permission/picker is controlled by the browser/OS. On devices
without screen capture, upload a screenshot instead.

A `FIDO:` passkey QR is a live cross-device ceremony, not a transferable signing
key. Importing its image does not register a passkey. Native passkey creation
is a separate signed-provider release. A passkey reference can record the
location of a key held elsewhere.

Import/export supports 1Password 1PUX v3 and CSV, Chrome CSV and Apple Passwords
CSV. Imports preview titles before saving. Files are parsed locally, bounded to
20 MiB and 2,000 entries per import, with bounded ZIP expansion. Password
whitespace, CSV quotes and multiline content are preserved. CSV cannot represent
custom fields or passkeys; Chrome CSV also omits TOTP. Attachments, icons and
password history are not imported. 1Password desktop exports do not carry
usable passkeys. Thingtime adds a vendor extension to its own 1PUX exports to
preserve complete ordered entries, including its passkey fields, on re-import
to Thingtime. Other managers may treat those fields as ordinary data rather
than usable passkeys. Standard 1PUX login/custom fields are also emitted.
Large exports split into independently importable numbered files inside one ZIP; extract it and import every part once.
All export files contain unencrypted secrets; the UI requires acknowledgement.

## Native Password AutoFill

Native iOS/macOS password, passkey and OTP providers are prepared separately in
[PR #996](https://github.com/lopugit/thingtime/pull/996). Their release requires
Apple provisioning and signed-device validation. This web release includes the
private catalog API and optional bridge negotiation, but does not change native
packaging or make Thingtime selectable in OS AutoFill settings by itself.

## Validation and setup

See the [README setup](../README.md#password-manager-setup) and
[manual QA checklist](../TESTING.md#password-manager-and-native-autofill).
`npm --prefix remix run test:passwords` covers crypto envelopes, session races,
formats, TOTP and HTTP boundaries. `node remix/scripts/verify-password-manager.mjs
http://localhost:<web-port>` exercises a disposable replica through HTTP only.

Screen-capture QA can use a synthetic canvas video stream in a disposable test page to exercise the real decoder and cleanup paths without sharing a desktop. This verifies video processing, cancellation, and stopped tracks, but does not substitute for OS picker/permission validation. Closing the editor aborts its pending scan; a stream returned by a late browser picker is immediately stopped.
