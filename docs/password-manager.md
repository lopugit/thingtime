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
identifiers for native and browser-provider selection; passwords, TOTP seeds and signing keys are
excluded. Responses are private/no-store. The browser provider and optional native bridge reuse this catalog without exposing signing keys.
The native picker checks the same account again before filling and requires
device-owner verification.

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

### Device connection control

Password manager and Passwords settings share one editable native AutoFill control.
The desktop bridge's `passwordsVersion` 1.1.0 adds a read-only `--status` helper:
`connected` means the saved device connection matches the selected owner and
origin; `disconnected` means no saved connection; `differentSession` means another
owner or origin is linked; `unavailable` means that protected status could not be
read. Cookie rotation alone does not change this linkage.

Desktop bridge 1.2.0 automatically establishes the initial link only when the
OS provider is enabled and its own signed-in HTTPS account passes the live
origin/capability/owner catalog checks. It renews an existing matching desktop
link. Explicit Disconnect saves an account/origin opt-out until Connect; automatic
work never replaces a foreign or independently linked companion session. A local
runtime returns `unsupportedOrigin` and directs macOS users to **Thingtime →
API Endpoint → Production** in the menu bar, then account sign-in. It leaves an
existing provider untouched. Canonical installation updates both the
nested and standalone signed companion from the same verified source.

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
a new credential store or require migration. Packaged verification checks both
the resolved **Thingtime** display/short names and matching host/provider versions.
The host deliberately keeps raw `CFBundleDisplayName` equal to its unchanged
`Thingtime Passwords.app` basename; bundled `en.lproj/InfoPlist.strings` localizes
both visible name keys to Thingtime. macOS otherwise falls back to the filesystem
name when the raw display name differs from the basename. Verification requires this localization
rather than mistaking the intentional raw fallback for visible branding. Check
`FileManager.displayName`, URL localized name and the actual native picker on the
installed copy; raw plist values alone do not establish the visible result. The optional browser adapter's manifest,
action tooltip and popup also display Thingtime.

For sign-in, an enabled provider has a site/account entry only when its catalog
contains a passkey with the requested relying-party identifier and an allowed
credential ID (when the site supplies an allowlist). A password record with the
same website URL is not a passkey. Passkey identity indexing uses the relying-party
identifier even when no password-URL field exists. Registration and assertion
requests use the native provider; registration creates that site's credential.

Another password-manager browser extension can intercept WebAuthn before the
native provider picker. For example, disable 1Password's **Offer to sign in with
passkeys** and **Offer to save passkeys** browser-extension preferences to use the
native flow while retaining its OS provider setting. Some browser extensions can
still block another provider's initial WebAuthn hooks after their own passkey
offers are off. If Thingtime's toolbar diagnostics show failed hook installation,
disable the conflicting browser extension and reload the website. For example,
1Password's Chrome extension can be off while its macOS AutoFill provider and
vault remain available; its browser UI/autofill will no longer run. This gives
Thingtime's enabled adapter first chance at supported explicit browser requests,
while conditional and unsupported requests still use the native flow.
Provider ordering belongs
to macOS and the browser; Thingtime does not programmatically set itself first.
The optional Thingtime browser adapter intercepts supported explicit `create`/`get`
requests when enabled and opens the existing `/passwords/provider` approval page.
Conditional and unsupported requests retain the browser's native flow. It does
not communicate with the native host or migrate credentials.

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

Account verification uses `app/local-workspace/passwordSync.test.ts` and
`passwordTransport.test.ts` for ordering, ambiguous receipts, claims, scope
fences, reviewed conflicts, cancellation, idle locking and atomic quota rollback.
Automatic title/list/export reads preserve the idle deadline; explicit user
activity renews it for anonymous and account vaults.
The adapter shares key lifetime through `deviceVaultSession.ts`: its password
namespace and authenticated encryption context remain compatible with saved
device records. A fixed synthetic legacy fixture verifies that compatibility.
Provider credentials have a separate key namespace; their authoring/sync surface
is still pending and is not enabled by this extraction.
Enable `accountPasswords.browser.test.ts` with `TT_ACCOUNT_PASSWORDS_URL` set to a
disposable loopback production-client server and `TT_ACCOUNT_PASSWORDS_ARTIFACTS`
set to an ignored output directory. Supply the same Playwright/Chromium paths as
the anonymous fixture. It creates disposable accounts, edits and exports offline,
reopens at 1440/390/320px, exercises real server conflicts/copies and proves a second
account cannot read the first vault. Never point this fixture at existing accounts.

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
