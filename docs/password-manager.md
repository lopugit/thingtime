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
excluded. Responses are private/no-store. The native picker checks the same
account again before filling and requires device-owner verification.

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
key. Importing its image does not register a passkey. Choose Thingtime in the
native system provider picker when the service requests a new passkey. A
passkey reference can also record the location of a key held elsewhere.

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

`apple/Passwords` contains the shared Swift library. `apple/PasswordProvider`
contains the AuthenticationServices extension used by iOS and the macOS
Thingtime Passwords companion embedded in Electron. The containing app needs
Apple's AutoFill entitlement and the same Keychain group as its extension.
Only the selected first-party HttpOnly session cookie is stored in the device's
unlocked-only, non-synchronizing Keychain. No vault passwords or signing keys
are persistently cached on the device. Logout/account or endpoint changes clear
the link; expired/revoked sessions fail at the server.

Open Passwords in the native app, choose **Connect Password AutoFill**, then
enable **Thingtime** in OS Settings → General → AutoFill & Passwords. System
configuration and biometric/device passcode prompts require the user. Password
and passkey providers require iOS 17/macOS 14; native OTP AutoFill requires
iOS 18/macOS 15. The provider uses exact HTTPS host matches for passwords/TOTP
and the OS-supplied relying party and allowed credential IDs for passkeys.
ES256 passkeys use random credential IDs, none attestation, a zero signature
counter for synchronized credentials and user verification. Encrypted storage
is acknowledged and read back before a new registration completes.

## Validation and setup

See the [README setup](../README.md#password-manager-setup) and
[manual QA checklist](../TESTING.md#password-manager-and-native-autofill).
`npm --prefix remix run test:passwords` covers crypto envelopes, session races,
formats, TOTP and HTTP boundaries. `node remix/scripts/verify-password-manager.mjs
http://localhost:<web-port>` exercises a disposable replica through HTTP only.
`swift test --package-path apple/Passwords` verifies real passkey signatures,
TOTP test vectors and session/domain validation. Builds alone do not establish
that signed OS registration or a third-party login ceremony works. iOS provider
ceremonies require a physical device; the simulator is a compile/UI check.
Record actual OS/device results separately in the delivery PR.

Screen-capture QA can use a synthetic canvas video stream in a disposable test page to exercise the real decoder and cleanup paths without sharing a desktop. This verifies video processing, cancellation, and stopped tracks, but does not substitute for OS picker/permission validation. Closing the editor aborts its pending scan; a stream returned by a late browser picker is immediately stopped.
