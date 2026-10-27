# Password manager

`/passwords` is an account-private credential library. Each account can own many
independent entries for the same service. Entries use the protected
`password-manager-entry` Thing schema and the reusable Thing `mods.layout=fields`
editor, with ordered fields, masked secrets and extensible custom fields. The
ordinary Thing tree is unchanged; controlled field mods do not persist values
through global Thing state, local caches, editor history or request diagnostics.

## Storage and access

`api.passwords` 1.4.0 uses the home data plane. GET returns 50 metadata records
at a time. Optional `q` searches all owned title metadata before pagination using
a case-insensitive literal substring (outer whitespace is ignored). Keep the same
query on subsequent pages; restart without a cursor when it changes. Field values
remain encrypted and are never searched. The UI cancels obsolete list requests
and keeps prior matches visible while a new search is pending. POST requires a full, live user session and `expectedOwnerId`:
`read`, `save`, `delete`, `export`, `catalog`, `verify-passkey`, and the `file-*` lifecycle operations. Export pages decrypt at most
50 entries using one bounded query and one account-key load. Scoped tokens, service accounts,
temporary accounts and internal Action identities are not vault sessions.
`catalog` returns names, usernames, exact HTTPS domains and public passkey
identifiers for native and browser-provider selection; passwords, TOTP seeds and signing keys are
excluded. Responses are private/no-store. The browser provider and optional native bridge reuse this catalog without exposing signing keys.

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
Imported password history is retained and available through the entry editor. There is no offline decrypted vault cache.
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
is implemented by the signed Apple credential provider described below. A passkey
reference can record the location of a key held elsewhere.

Import/export supports 1Password 1PUX v3 and CSV, Chrome CSV and Apple Passwords
CSV. Imports preview every entry using ranged ZIP reads and a streaming JSON/CSV
parser. There are no product caps on archive bytes, expanded bytes, entry counts,
field counts, labels, or value lengths. The first 50 preview titles are a display
window. Saving uses stable write IDs and resumes after the last acknowledged item.
The database still imposes its actual 16 MiB BSON document ceiling on individual
encrypted entry documents; ciphertext overhead counts toward that capacity.
Deployment transport ceilings and available browser memory also remain real
platform constraints, not configurable product caps.

The coverage target is every datum in a 1PUX v3 file: all known and unknown item
categories, structured field values, sections and field attributes, tags,
favourites, archived state, IDs, timestamps, URLs, linked-item references, account
and vault attributes, password history, documents, attachments, icons, and unknown
properties. Standard fields are editable through Thing mods. The original item
and its account/vault attributes remain encrypted for inspection. A separate
archive entry owns every original ZIP member, including exact export.data and
export.attributes bytes, so unknown structures and original numeric literals
are recoverable even when the editor has no specialised widget for them.
Related source files are shown from imported entries. This is data preservation
and editing, not a claim to implement every 1Password application feature.

Files use the canonical multipart attachment lifecycle and storage accounting.
Each is a relational attachment Thing with purpose=password and targetId pointing
to its saved password entry. Browser AES-256-GCM encryption uses 1 MiB frames,
unique per-file keys/nonces, and authenticated file identity, plaintext size and
frame number. File names and keys are sealed with the account vault key. Only the
full-session password API can authorise file operations; ordinary attachment
content/export/copy/mutation routes cannot access them. Ciphertext is excluded
from external content moderation. Parent deletion tombstones the entry before
retryable exact-version object cleanup. S3's platform limits still apply.

1PUX backups stream JSON and file members into one ZIP. Original source members
and relationships are carried in the Thingtime vendor extension and restore with
new owner-local IDs. Other readers can use the standard item fields; unfamiliar
extension data may require Thingtime to restore. CSV has no attachment/custom
field representation; Chrome CSV also omits TOTP. Large CSV exports use numbered
files inside a ZIP. Desktop 1Password exports omit usable passkeys; those require
its mobile Credential Exchange flow. Thingtime's native passkey fields survive
its own backups, but other managers may treat them as ordinary custom data.
All export files contain unencrypted secrets; the UI requires acknowledgement.

## Password generator and entry icons

The entry editor offers an editable password generator for each password field.
Length, uppercase, lowercase, digits, allowed symbols, ambiguous characters and
explicit exclusions are configurable. WebCrypto supplies randomness with unbiased
index selection; required classes are shuffled. The default is 20 characters.
Generated values go directly to the selected masked draft field and are persisted
only by Save entry. They do not enter Builder scope, layout data, editor history,
local storage or request diagnostics. Non-secret generator preferences are scoped
to the account and origin. Closing the entry or changing its owner/target cancels
pending generation.

Apple Account, GitHub and Google presets show source-linked guidance. Strong and
Microsoft (recommended) are recommendations, not assertions of platform policy.
Presets remain editable and cannot guarantee acceptance by a service's breached-
password, account-specific or future policy checks. The generator, icon controls
and passkey guide are composed from individually editable settings blocks.

An entry can use an uploaded image or an explicit HTTPS image URL. Website favicon
loading is opt-in. Remote images are fetched anonymously in the browser with no
referrer and no redirects; the image host must permit anonymous CORS. A failed or
unsupported image shows a generic icon and the upload alternative. There is no
server proxy or third-party favicon lookup. Uploads use the existing encrypted
password attachment lifecycle and require a saved entry and private-upload access.
Icons appear in the list and editor. Removing an icon clears its presentation
reference without deleting the underlying attachment.

The full icon descriptor remains in the encrypted entry. A separate authenticated
`password-icon` envelope supplies presentation metadata to a bounded, owner-scoped
list query without decrypting or projecting credential values. Missing or corrupt
legacy icon envelopes fall back safely. Account/session fences apply before the
list is returned. Backup restoration maps an icon's original attachment ID to its
new owner-local file ID and preserves retry-safe write identities.

## Browser passkeys and settings

The drawer's **Password manager** opens `/passwords`; its dedicated settings
category is `/settings/passwords`, shared by popup and full-page Settings. Both
use individually editable layouts. Thingtime account sign-in passkeys stay in
**Security**, reached through the explicitly labelled link in Password manager
settings; they are different from passkeys saved for other websites.

The web vault works on supported secure browser origins with a live account and
WebCrypto. Saving and using a passkey for another website additionally requires
an installed provider. The opt-in [Chromium extension](../browser-extension/README.md)
relays that website's registration or sign-in to `/passwords/provider` at the
user-selected trusted Thingtime origin. Each approval shows the website, RP domain
and account, requires fresh Thingtime password verification, and uses encrypted
vault storage. Registration completes only after exact saved-credential readback;
assertions revalidate the session and unchanged credential before returning.
Retries retain the same immutable request and write identity. Cancellation,
navigation, account changes and expired requests discard pending authority.

`verify-passkey` returns the request's UUID and a non-secret `sessionBinding`
after fresh password verification. Every subsequent catalog, read and save in
that ceremony sends `passkeySession: { requestId, binding: sessionBinding }`.
The API binds this comparison value to the selected Thingtime origin, account,
request and exact authenticated session, and rechecks live revocation before
returning. Replacing a session for the same account invalidates the pending
ceremony. An uncertain-write retry preserves its original binding, credential
and write identity and requires fresh password verification again. The binding
is not a bearer credential and reveals no authentication token or session ID.
Readback compares complete entries through the canonical password-entry
validator, preserving exact signing-key, user-handle, RP and credential values
while accepting the writer's normal field-property ordering.

The extension is off by default and requires explicit installation and enablement.
It is a Chromium MV3 integration, not a browser-store release or an OS provider.
Basic ES256 registration/assertion and registration `credProps` are supported;
conditional mediation, other WebAuthn extensions and unsupported options use the
browser's native path. Returned credentials are compatible objects, so sites
requiring native `PublicKeyCredential` internal slots may not interoperate.
Firefox, Safari and mobile extension interoperability are unverified. A supported
web vault does not by itself establish arbitrary-site passkey-provider support.
Native Apple provider installation, signing and device acceptance remain separate.

Forks build the distributable with `npm --prefix remix run build:password-extension`;
it writes `remix/public/downloads/thingtime-passwords-extension.zip`. Extract it and
load the resulting directory through Chromium's **Load unpacked**, choose the
fork's trusted HTTPS origin (explicit localhost/127.0.0.1 for isolated development),
enable it, and reload relying-party tabs. No extension secret or provider developer
account is required. Use a separate browser profile, account and replica database
for testing; never import personal browser sessions or production credentials.

## Native Password AutoFill

Native provider code is present in `apple/Passwords` and
`apple/PasswordProvider`; the desktop bridge negotiates the installed provider.
This checkout does not expose an iOS native-password bridge; web-only behavior
remains available there.
The provider handles a website-initiated WebAuthn registration, checks the relying
party and supported algorithm, creates an ES256 key, saves it through the encrypted
vault, verifies readback and completes the operating-system request. Registration starts at the destination website rather than in a standalone
password-entry editor. With this native provider, choose Thingtime in the
operating-system passkey flow.
After Thingtime is selected in the operating-system picker, registration begins
once the provider view is visible and starts device verification automatically;
there is no second Create button. Repeated view presentation cannot start a
second registration. Required device authentication and user presence remain
part of that flow; cancellation and explicit recovery retry remain available.

The inline Passkeys guide explains setup, preserves an unfinished entry, and offers
the existing native connection action only when that bridge is available. It does
not alter native signing, provisioning or OS AutoFill settings. A signed provider,
OS enablement and a real registration followed by sign-in are separate acceptance
requirements; build or package verification alone does not prove them. Thingtime's
own account-login passkeys are a separate feature from this credential provider.

### Device connection control

Password manager and Passwords settings share one editable native AutoFill control.
The desktop bridge's `passwordsVersion` 1.1.0 adds a read-only `--status` helper:
`connected` means the saved device connection matches the selected owner and
origin; `disconnected` means no saved connection; `differentSession` means another
owner or origin is linked; `unavailable` means that protected status could not be
read. Cookie rotation alone does not change this linkage.

Only a matching connection shows Disconnect; disconnected or different-session
states show Connect. Unavailable status shows Retry, and older app bridges show
an update instruction. Refresh after actions, focus and native bridge changes;
fence late results when account or origin changes. Do not persist connection
status or credentials in editable layouts. This check neither probes the remote
service nor proves the operating system has enabled the provider: OS AutoFill
settings, vault access and an actual relying-party ceremony remain separate checks.
The updated Electron bridge/helper must be installed before claiming this control
works on the user's device; upgrading only the provider extension is insufficient.

### Native progress, recovery and naming

The macOS provider and host display **Thingtime** in the operating-system flow.
The existing bundle identifiers, shared Keychain group and packaged
`Thingtime Passwords.app` path remain stable so this label change does not create
a new credential store or require migration.

The provider shows the current connection, device verification, vault, save,
readback, AutoFill indexing or browser-return step. Failures use closed error
categories with actionable recovery text; diagnostics contain only the phase and
category, never server bodies, underlying error descriptions, account identifiers
or credential material. A missing/expired connection calls for reconnecting from
Thingtime; a protected-store access failure calls for unlocking the device.

Retry within the same registration request retains the original key, credential,
record and write identity, including uncertain save/readback outcomes. Cancellation,
a replacement OS request, or account/session changes fence late work. A changed
session after registration begins requires Cancel and a new request from the
website; the old ceremony cannot retry against a different connection. Saved-entry
pagination follows cursors without an arbitrary entry cap and rejects a repeated
cursor rather than looping forever. These guards do not establish that the active
installed provider completed a relying-party registration: verify a signed build,
the active extension and a real create-and-sign-in flow independently.

## Validation and setup

See the [README setup](../README.md#password-manager-setup) and
[manual QA checklist](../TESTING.md#password-manager-and-native-autofill).
`npm --prefix remix run test:passwords` covers crypto envelopes, session races,
formats, TOTP and HTTP boundaries. `node remix/scripts/verify-password-manager.mjs
http://localhost:<web-port>` exercises a disposable replica through HTTP only.

Screen-capture QA can use a synthetic canvas video stream in a disposable test page to exercise the real decoder and cleanup paths without sharing a desktop. This verifies video processing, cancellation, and stopped tracks, but does not substitute for OS picker/permission validation. Closing the editor aborts its pending scan; a stream returned by a late browser picker is immediately stopped.

For file lifecycle QA, register three disposable accounts through `/api/v1/auth/register`
in an isolated localhost deployment, then configure the first username in
`ADMIN_USERNAMES` and restart that deployment. Supply a local JSON array of their
`{ "username": "qa-user", "password": "synthetic-only" }` credentials to
`pnpm --dir remix exec tsx scripts/verify-password-files.mts <localhost-origin> <fixture-path>`.
It uses real session/admin/password/upload endpoints and creates a synthetic
`/tmp/thingtime-password-import-qa/all-data.1pux` for browser round-trip checks.
Never point this test at production or supply personal credentials.

The synthetic UI fixture at `scripts/password-tools.browser.html` mounts the real
password components with a fail-closed synthetic transport. Its Run regression
control exercises generator presets, target selection, masked values, save/reload,
icons and draft preservation. Use a task-owned isolated browser/profile with normal networking, inspect desktop and 390px layouts, and edit/save representative nested
Builder blocks. This fixture is UI regression evidence, not live vault or native
passkey acceptance. Run the real HTTP verifier separately.
