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

`api.passwords` 1.1.0 uses the home data plane. GET returns 50 metadata records
at a time. POST requires a full, live user session and `expectedOwnerId`:
`read`, `save`, `delete`, `export`, `catalog`, and the `file-*` lifecycle operations. Export pages decrypt at most
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
is a separate signed-provider release. A passkey reference can record the
location of a key held elsewhere.

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
