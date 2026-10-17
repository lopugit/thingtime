# Password manager

`/passwords` provides an account-private credential library and, when anonymous,
an independently encrypted device library. Each library can hold many independent
entries for the same service. Entries use the protected
`password-manager-entry` Thing schema and the reusable Thing `mods.layout=fields`
editor, with ordered fields, masked secrets and extensible custom fields. The
ordinary Thing tree is unchanged; controlled field mods do not persist values
through global Thing state, local caches, editor history or request diagnostics.

## Anonymous device vault

Open `/passwords`, or Settings → Security → Device passwords, without signing in.
Choose a separate passphrase of at least 12 characters. The normal field editor,
local TOTP/QR helpers and acknowledged CSV/1PUX importer/exporter work through the
device adapter. This vault does not require server secrets, a database, an account
or a network connection after the offline shell has been installed. WebCrypto
requires a secure context (HTTPS or loopback).

The existing version-2 AES-256-GCM value envelope and version-1 scrypt password
wrapper are shared between browser and server. Browser/server interoperability is
tested. Device authenticated data binds the browser origin and complete workspace
scope, plus key, record and purpose. Titles, categories, field definitions and
values are encrypted together; only record IDs, revisions, timestamps and retry
metadata remain visible in device storage. Retry identities are keyed HMACs.
Values are limited to 64 KiB, passphrases to 4,096 UTF-8 bytes, listing/export to
50 entries per page and storage to the shared workspace quota. One password KDF
runs at a time per JavaScript realm.

The unwrapped key stays in tab memory. Manual lock, page teardown, workspace
invalidation or five minutes without use clear it and unmount the editor. Each
tab unlocks independently. Transaction guards reject writes after cancellation
or lock; revisions preserve stale editor input instead of overwriting another
tab's saved entry. Missing keys or damaged ciphertext fail visibly and retain the
encrypted records. There is no passphrase reset or server recovery for this vault;
normal explicit exports contain plaintext and still require acknowledgement.

Anonymous entries never create account sync commands or become account content
on login. They are excluded from ordinary Things, Timeline, transfer exports and
request diagnostics. Anonymous native AutoFill is not enabled. The account
adapter has encrypted command primitives for subsequent work, but the account
UI still uses its live-session API: account offline unlock/sync/conflict recovery,
Settings provider/environment credentials and the native bridge remain separate
unfinished acceptance items.

## Account storage and access

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
Neither library persists decrypted vault content or password history.
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

Anonymous validation: `npm --prefix remix run test:local-workspace` includes the
storage, scope, concurrency, idle-lock and cancellation tests. Build the client,
serve its production output on loopback, then enable the actual offline browser
fixture with `TT_LOCAL_PASSWORDS_URL=http://127.0.0.1:<port>` and
`TT_LOCAL_PASSWORDS_ARTIFACTS=<local-output-directory>` when running
`app/local-workspace/passwordVault.browser.test.ts` with the workspace test
runner. The fixture uses synthetic credentials and a clean browser context;
its downloaded CSV is plaintext test data and must remain untracked. It checks
1440/390/320px layout, independent tab unlock, stale edits, normal transfer,
zero account records/commands and zero password API or mutation requests.
