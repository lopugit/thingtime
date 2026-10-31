# Password manager

`/passwords` is an account-private credential library. Each account can own many
independent entries for the same service. Entries use the protected
`password-manager-entry` Thing schema with ordered fields, masked secrets and
extensible custom fields. The password page uses ordinary editable block
templates for its header, repeated cards/fields, transfer dialogs, QR and native
controls, attachments and source/history panels. The Settings document host
saves only layout templates. An explicit transient adapter hydrates allowlisted
named inputs/textareas from live closure values; decrypted values never enter
ComponentDataScope, saved block props, global Thing state, local caches, generic
Action history or request diagnostics. Enter submits the enclosing entry after
required-field validation. Hide/owner/origin changes revoke private controls;
backgrounding masks them without discarding unsaved drafts. Entering Builder
mode clears control values and cancels the adapter lifetime.

## Copy field values

Each ordinary field has an individually editable **Copy** button. Concealed
values stay masked while copying. TOTP fields use **Copy verification code**
to copy the current code only, without its countdown or setup seed. Passkey
entries do not expose Copy controls for signing fields.

The transient `field.copy` binding contains only the field ID; its adapter reads
the current value from component memory and writes directly to the clipboard.
Values never enter Builder scope, saved layouts or Action history. Success and
failure use fixed, non-secret status text. Editing a value, changing entries,
masking, closing, changing account/data plane or entering Builder invalidates
pending work and feedback. A clipboard write already submitted to the browser
cannot be revoked; its late completion cannot restore stale feedback.

## Optional host integration and release boundary

The web editor accepts the separately versioned `authenticatorSetupVersion`
1.0.0 bridge only when available and bound to the current origin/document/owner.
Older installed hosts do not gain this bridge from a web release. Missing or
incompatible setup support remains unavailable; codes are never persisted or
passed through a navigation URL as a fallback. Web create/edit/QR paths remain
independent of this optional host integration.

All Apple/Electron/iOS/macOS implementation, setup URL registration, native
session/indexing changes and signing/provisioning work remain in PR #1240.
Their source assertions stay with that deferred implementation. Signed installed
menu, AutoFill, Google credential and physical iOS acceptance remain pending.

## Copy field values

Each ordinary field has an individually editable **Copy** button. Concealed
values stay masked while copying. TOTP fields use **Copy verification code**
to copy the current code only, without its countdown or setup seed. Passkey
entries do not expose Copy controls for signing fields.

The transient `field.copy` binding contains only the field ID; its adapter reads
the current value from component memory and writes directly to the clipboard.
Values never enter Builder scope, saved layouts or Action history. Success and
failure use fixed, non-secret status text. Editing a value, changing entries,
masking, closing, changing account/data plane or entering Builder invalidates
pending work and feedback. A clipboard write already submitted to the browser
cannot be revoked; its late completion cannot restore stale feedback.

Verification on 26 October 2026: the focused password suite passed 56 tests with
zero skips. All 11 isolated Chromium acceptance groups passed, covering masked
copying, TOTP codes, clipboard rejection, stale feedback, independent Copy-label
editing and desktop/mobile page scrolling. The clipboard device boundary was
synthetic; real clipboard delivery, installed/native and production acceptance
remain separate gates.

## Native verification-code setup

The iOS host and the separate macOS Thingtime Passwords companion register
`otpauth` for TOTP setup. AutoFill's `ProvidesOneTimeCodes` capability fills saved
codes; URL registration and an actual intake handler provide the separate
system **Set Up Codes In** path. Migration and HOTP schemes are not registered.
Apple describes scheme registration in its [default-app updates](https://developer.apple.com/documentation/updates/defaultapps).

The shared parser rejects duplicate/unknown query options, invalid Base32
padding/residual bits, unsupported parameters and non-TOTP payloads. A native
memory-only inbox retains one setup for at most ten minutes. Another incoming
setup cannot replace it, and warm delivery does not reload an existing editor.
Unbound input survives normal login navigation; navigation after owner/document
binding cancels it. No setup value enters a navigation URL, generic bridge log,
clipboard, persisted layout, Timeline or restoration state.

The companion uses `WKWebsiteDataStore.nonPersistent()` and normal sign-in.
The configured linked origin and owner constrain that sign-in, but its stored
native credential is never injected into the new browser. Missing native
metadata uses the build's explicit HTTPS origin; locked/unreadable metadata
never silently selects a different origin. Pending input remains in memory while
the destination is unavailable and is retried when the app becomes active.

The separate `window.thingtimeAuthenticatorSetup` version 1.0.0 surface supports
`ready`, `consume` and `cancel`; native events are `available`, `setup`, `status`
and `unavailable` (plus request-scoped `expired`). This narrow companion does not advertise the unrelated
connect/sync bridge. Intake requires the exact configured HTTPS origin,
main-frame `/passwords` without query/fragment, a fresh immutable document nonce,
an editor nonce, the home data plane and a server-verified current owner. The
host reads the existing paginated metadata GET using only that WK session's
HttpOnly cookie, rejects redirects and negotiates `api.passwords` >=1.2.0 in
major 1. It rechecks the cookie after verification. The setup URI is delivered
only after an explicit create/attach choice, using WebKit arguments targeted at
the captured frame. Execution-time origin/path/document/editor-scope guards
prevent delayed delivery into a new page or account.

The separate `password-authenticator-setup` settings document exposes the notice
for accounts that already customized their password layout, without replacing
those saved blocks. The existing individually editable PasswordManager notice, buttons and masked
field controls hold the resulting draft in component memory. Existing drafts
remain unchanged until explicitly selected; Save uses the existing owner and
revision guards. Account/data-plane changes, logout, cancellation, expiry and
navigation retire pending native authority. Full signed macOS/iOS menu, Safari
QR handoff, sign-in and real saved-code acceptance remain separate from unit,
JavaScript-model and unsigned build checks.

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
Password entries and encrypted file metadata use the same 16 MiB codec ceiling
as the account writer. MongoDB measures the complete encrypted BSON document,
so its actual admissible plaintext is smaller; a device save does not promise
remote admission. Device storage accommodates the base64 envelope and fixed
retry metadata using actual browser capacity. Provider
credentials and key wrappers retain their separate defaults. Passphrases remain
limited to 4,096 UTF-8 bytes and listing/export uses 50-entry pages. Native storage
quota failures roll back the workspace transaction. One password KDF runs at a
time per JavaScript realm. Remaining buffered import/preview paths and native
large-data acceptance are still open; this does not claim unlimited storage.

The unwrapped key stays in tab memory. Manual lock, page teardown, workspace
invalidation or five minutes without use clear it and unmount the editor. Each
tab unlocks independently. Transaction guards reject writes after cancellation
or lock; revisions preserve stale editor input instead of overwriting another
tab's saved entry. Missing keys or damaged ciphertext fail visibly and retain the
encrypted records. There is no passphrase reset or server recovery for this vault;
normal explicit exports contain plaintext and still require acknowledgement.

Anonymous entries never create account sync commands or become account content
on login. They are excluded from ordinary Things, Timeline, transfer exports and
request diagnostics. Anonymous native AutoFill is not enabled. Account workspaces now use the encrypted device adapter described below.
Settings provider/environment credentials and signed native offline integration
remain separate unfinished acceptance items.

## Account device access and sync

In an account workspace, the normal password editor uses a separately encrypted
device copy with its own passphrase. This phrase is not sent to the server and is
not the account password. After initial setup/unlock, existing entries are read
through the normal session-bound API and encrypted before retention. A retained
account workspace can unlock, edit, delete and export while offline with
`user: null`; its local pointer grants no network authority.

Local mutations commit their encrypted entry and encrypted account intent in one
workspace transaction. Pulls and uploads run independently of editor completion.
Each upload freezes the normal write ID, content and expected server revision
before sending; retries reuse that exact command. Per-entry claims prevent tabs
from racing later revisions past an unresolved write. Invalid receipts and lost
responses retain the encrypted retry. Definitive refusals block that entry for
review while unrelated entries continue syncing. Background work does not extend
the five-minute unlock timer; locking aborts outstanding operations and leaves
unacknowledged commands encrypted for the next unlock.

Every request requires matching confirmed account, browser/API origin and selected
data-plane leases and sends the existing expected-actor/data-plane headers. The
password API itself still stores account credentials on the home plane. It has
no generic request-history path, automatic fallback or saved bearer credential.
Requests have a 20-second timeout and bounded response parsing. Identity or
confirmation changes abort requests before response adoption. These device copies
remain separate from anonymous entries and other account/origin/plane partitions.

Refused entries offer explicit choices: keep the device version as a new entry,
or discard its pending changes and use the account version. Both read the current
account value and compare the local revision again before committing. Creating a
copy and replacing the original projection are atomic, including quota failures.
An uncertain write cannot be discarded through this conflict UI. Other unsaved
editor fields are preserved; reopen the entry to load the resolved saved version.

Refresh processes the canonical 50-entry pages until completion, without a total
page-count cutoff. Empty continuing pages, repeated cursors and duplicate entry
identities fail visibly. Cancellation, locking and identity changes stop response
adoption. Partial refreshes retain existing entries and validated pages; retry
starts from the beginning and only a complete traversal can retire missing account
entries. Concurrent local edits/pending commands are protected. A single scoped
pull token also fences older tabs, including when the newer pull confirms the
same revision or fails midway. The token contains no entry values or credentials
and is retained after completion/failure so an old pull cannot resume cleanup.
An older superseded pull returns that outcome normally; it must not start an
error-retry timer that could repeatedly interrupt the newer long traversal.
Remote or storage failures remain visible while previously saved entries stay
available. The existing account native-provider controls remain available only
with a confirmed account; signed-device/offline provider behavior is not verified
by these web fixtures.

## Account storage and access

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
identifiers for native selection; passwords, TOTP seeds and signing keys are
excluded. Responses are private/no-store. Native picker acceptance is separate
from this web/backend release.

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
Imported password history is retained encrypted and available through the entry editor. Neither library persists decrypted vault content or password history.
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
is implemented by the signed Apple credential provider described below. Choose
Thingtime in the native system provider picker when the service requests a new
passkey. A passkey reference can record the location of a key held elsewhere.

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
properties. Standard fields are editable through the password field templates.
Structured addresses, SSH keys and other recognised structured fields expose
separate string, number and boolean property controls, including nested arrays
and unknown members. Those controls preserve sibling data and original scalar
types. Null values and empty containers are labelled explicitly; use the JSON
editor to change their type or add properties. Unsupported or unsafe structures
retain the masked JSON editor. Imported property names and values are hydrated
only into the private live editor, never saved in a Builder layout or display
scope. The original item
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
an installed provider. On macOS, prefer the connected and enabled native Thingtime
Password AutoFill provider; Chrome can use it without a Thingtime browser extension.
The optional opt-in [Chromium extension](../browser-extension/README.md)
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

`apple/Passwords` contains the shared Swift library. `apple/PasswordProvider`
contains the AuthenticationServices extension used by iOS and the macOS
Thingtime Passwords companion embedded in Electron. The containing app needs
Apple's AutoFill entitlement and the same Keychain group as its extension.
Only the selected first-party HttpOnly session cookie is stored in the device's
unlocked-only, non-synchronizing data-protection Keychain. Every session operation
requires the configured shared access group; the macOS legacy Keychain is never
used. No vault passwords or signing keys are persistently cached on the device.
Logout/account or endpoint changes clear
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

### Connection and suggestion-index status

The native connection result distinguishes `index-synchronized`,
`linked-index-pending`, `disconnected` and unknown legacy status. A linked account
remains linked when OS indexing is unavailable (including disabled AutoFill),
but the UI says suggestions are not synchronized and offers the existing Connect
retry. It never substitutes generic “Connected” for an unverified index result.
The existing `passwordsVersion` 1.0.0 remains unchanged because deployed legacy
web clients require that exact value. New clients accept major-1 bridges but
require coherent explicit status fields before reporting synchronized; missing
fields remain unknown. No HTTP API operation or capability version changes.

Older installed `passwordsVersion` 1.0.0 bridges remain accepted, but generic
legacy success is unknown rather than proof that OS suggestions synchronized.
New native explicit-status reporting and its installed acceptance are deferred.

## Validation and setup

When a native passkey request has no eligible result, **Request details** shows
the actual requested site and selection counts: catalog total, exact site matches,
valid credential IDs for that site, supplied allowlist size and eligible passkeys.
A zero allowlist size means any credential is permitted. These ephemeral details
contain no account/session data, credential values or identifiers and are never
logged or persisted. They distinguish a catalog mismatch from the request's RP
or allowlist without revealing a passkey. Successful signing still needs its own
live verification.

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

QR uploads have no application-imposed byte or pixel limit. The decoder scans
progressively larger overlapping image sections using a bounded working canvas,
so small codes remain readable in large screenshots. Browser image-decoding and
device resources still determine which files can be opened. Closing the editor
aborts scanning and releases its bitmap.

Screen-capture QA can use a synthetic canvas video stream in a disposable test page to exercise the real decoder and cleanup paths without sharing a desktop. This verifies video processing, cancellation, and stopped tracks, but does not substitute for OS picker/permission validation. Sharing stops as soon as one immutable frame is captured, before decoding. Closing the editor aborts its pending scan; a stream or bitmap returned by a late browser operation is immediately released.

For file lifecycle QA, register three disposable accounts through `/api/v1/register`
in an isolated localhost deployment, then configure the first username in
`ADMIN_USERNAMES` and restart that deployment. Supply a local JSON array of their
`{ "username": "qa-user", "password": "synthetic-only" }` credentials to
`pnpm --dir remix exec tsx scripts/verify-password-files.mts <localhost-origin> <fixture-path>`.
It uses real session/admin/password/upload endpoints and creates a synthetic
`/tmp/thingtime-password-import-qa/all-data.1pux` for browser round-trip checks.
Never point this test at production or supply personal credentials.


### Local search and combined contract

The device workspace searches unlocked, encrypted-on-disk titles before paging;
matching entries beyond the first page remain discoverable without remote access.
Changing the query resets its cursor and cancels the prior refresh. Account-local
listing uses the same device adapter; background synchronization is independent.
`api.passwords` 1.3.0 combines whole-vault title search with durable encrypted-file
cancellation receipts. Search and receipt-dependent workers negotiate this version
before remote operations; anonymous device search does not negotiate or fetch.
