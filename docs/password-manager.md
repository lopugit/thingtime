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

## Storage and access

`api.passwords` 1.3.0 uses the home data plane. GET returns 50 metadata records
at a time. Optional `q` searches all owned title metadata before pagination using
a case-insensitive literal substring (outer whitespace is ignored). Keep the same
query on subsequent pages; restart without a cursor when it changes. Field values
remain encrypted and are never searched. The UI cancels obsolete list requests
and keeps prior matches visible while a new search is pending. POST requires a full, live user session and `expectedOwnerId`:
`read`, `save`, `delete`, `export`, `catalog`, and the `file-*` lifecycle operations. Export pages decrypt at most
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

## Native Password AutoFill

Native provider code is present in `apple/Passwords` and
`apple/PasswordProvider`; desktop/iOS bridges negotiate the installed provider.
The provider handles a website-initiated WebAuthn registration, checks the relying
party and supported algorithm, creates an ES256 key, saves it through the encrypted
vault, verifies readback and completes the operating-system request. The web
password editor cannot manufacture a passkey for an arbitrary website: open that
site's security settings and choose Thingtime in the operating-system passkey flow.
Required device authentication and user presence remain part of that flow.

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

The synthetic UI fixture at `scripts/password-tools.browser.html` mounts the real
password components with a fail-closed synthetic transport. Its Run regression
control exercises generator presets, target selection, masked values, save/reload,
icons and draft preservation. Use a task-owned browser and enforced network
isolation, inspect desktop and 390px layouts, and edit/save representative nested
Builder blocks. This fixture is UI regression evidence, not live vault or native
passkey acceptance. Run the real HTTP verifier separately.
