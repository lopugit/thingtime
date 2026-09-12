# PR 764 — portable Thing transfer

## Real archive image bytes — 2026-09-12

The exact deployed preview source 40afdd138ce80f74676834b3f962191afcc9fb49
serves root-data and Things 1.15.0 / import 1.9.1 / export 1.10.0 capabilities.
The extended binary integration test passed both tests with zero skips using
the explicitly approved upload fixture. It uploaded four real PNG files through
the canonical storage pipeline: post image, personal emoji, historical avatar
and archive message image. ZIP export/re-import preserved bytes and attachment
annotations, generated independent roots, and exposed correctly bound archive
gallery metadata. Deleting the source archive did not prevent exporting the
copied avatar and message bytes. The concurrent emoji upload claim still passed.
Every created root and upload was cleaned up and its absence verified.

The separate archive folder/history ZIP lifecycle test also passed both tests
without skips on that source. These are HTTP/storage acceptance tests, not a
claim that all real-browser clipboard, file-picker, media playback or live-chat
source-export touchpoints are finished.

## Develop integration — 2026-09-12

Integrated develop 47576f22117ce4b31cb0598aa875d3bc9803b4c7 without
hand-merging generated graphs. Disabling rename detection preserved immutable
snapshot identities; the sole source conflict was additive changelog history,
resolved by retaining both entries. The incoming application diff only moves
the existing recording capability import to the top of its module. Transfer
and archive implementations were preserved; 201 focused tests pass after merge.

## Inline historical galleries — 2026-09-12

Chat archives now use the existing PostAttachments gallery with authenticated
media URLs, file links, pending badges, NSFW reveal controls and image lightbox.
Only metadata matching a historical message binding renders. Blocked/missing
metadata gets an unavailable notice; it is not silently advertised as downloadable.
Archived avatars require an unflagged, correctly bound image projection rather
than bypassing moderation with the raw avatar ID. Current-self identity remains
the importer and no live messaging callbacks are introduced.

The isolated Chrome smoke passed at 1280x900 and 390x844: full scrolling, gallery
and lightbox, NSFW exclusion before reveal, pending/file display, Download dialog,
retry and identity clearing with zero API mutations. Final gallery/lightbox/modal
screenshots were inspected. Media responses were synthetic PNGs: this does not
prove real storage-byte independence, video/audio playback or custom emoji images.
The existing global floating Lopu/DevKit controls remain visible over the media
overlay; this change does not claim to resolve their application-wide layering.
Targeted lint and component TypeScript diagnostics pass; full repository typecheck
is not claimed clean. The earlier server-only note below is historical.

## Archive gallery projection preparation — 2026-09-12

The owner-only archive snapshot now includes ordered canonical attachment
metadata with target IDs, using the existing batched home-plane query and
shared gallery projection. Blocked/noncanonical metadata stays hidden; pending
and NSFW flags survive for the existing gallery controls. Storage keys, upload
identifiers and moderation diagnostics are never projected. All attachment IDs
remain in the separate export binding list, so hidden files cannot silently
disappear from a supposedly complete export. Things is feature 1.15.0 /
contract 1.14.0; the archive client negotiates 1.15.0.

This prepares the server contract only: the archive view still shows attachment
counts, and inline galleries/custom emoji remain unfinished. Reader/projection,
export and capability tests cover the new field; the local Nitro manifest
advertises 1.15.0. Live stored-media acceptance remains separate.

## Archive library and initial historical view — 2026-09-12

Owner library pagination now includes exact home-plane private archive roots
only with first-party user context. Historical child records, other owners,
PAT/app/service access, namespaces and deleting roots remain excluded. Root
summaries contain only the name plus normal owner-facing listing metadata;
full historical people/messages stay on the dedicated private snapshot route.
Folder export carries the same context and includes complete archive groups.
Things advertises feature 1.14.0 / contract 1.13.0; export is 1.10.0. Clients and
both manifest tests are updated.

The archive page presents historical messages/replies/reactions, participant
snapshots and You/Archived labels, with no live Messenger callbacks or username
resolution. State is keyed by owner/root/identity generation, cleared during
identity refresh, and aborts on unmount. Retry is recoverable; same-owner prior
history can remain during a retry. Transfer uses real shared Copy/Cut/Download
controls, and deletion uses the existing timestamp-guarded archive lifecycle.
Unsupported generic share/duplicate/delete/inspect menu entries are hidden.

The local-only Playwright smoke uses a fresh Chrome context, fabricated API
history and intercepted mutations. It passes 1280x900 and 390x844 full scrolling,
long text, expanded participants, Download modal bounds, Retry, identity
clearing and signed-out denial with zero API mutations. Visual inspection caught
and fixed missing fixed-nav clearance and mobile wrapper sizing; direct history
and Back-link bounds now catch clipping that document scrollWidth alone misses.
This is rendered fixture evidence, not
real-account import/download proof. Initial archive media displays attachment
counts and custom-emoji placeholders; inline galleries/emoji images, search,
live-chat source export, remaining bulk lifecycle work and real media/clipboard
round-trips are still unfinished. The broader transfer goal remains active.

Validation: 226 combined transfer/library/menu/navigation/capability tests pass.
Targeted lint passes (the .mts smoke uses the TypeScript parser explicitly);
new/changed archive files have no targeted TypeScript diagnostics, while the
repository-wide baseline remains non-clean. Local Nitro confirms Things 1.14.0
and export 1.10.0 on its own origin. The live fixture's final screenshots are
temporary local artifacts, not production acceptance or committed account data.

## Archive root placement — 2026-09-12

The bulk move path now accepts exact private chat-archive roots only with
explicit first-party user-owner context from the same-origin HTTP route. Scoped
viewers and service accounts receive no archive-move authority. The existing
home-plane managed placement transaction re-reads the root and destination,
rejects deleting/version-mismatched/namespaced or non-root records, touches the
destination fence and CAS-updates only folderId/updatedAt. Historical children,
identities, content, ACLs, media bindings and quota remain unchanged. Root moves
to null use the same writer. Both manifests/client now require bulk 1.4.0.

The combined transfer/capability suite passes 202 tests; local Nitro advertises
origin-scoped bulk 1.4.0. Focused tests cover first-party scope, root/child/state
validation, source/folder CAS, storage-size invariance and sanitized failures.
This proves the API/transaction path under tests, not visible Cut/Paste or a
live folder round-trip. Archive listing/rendering, live-chat export and broad
browser/media acceptance remain unfinished.

## Whole-history archive re-export — 2026-09-12

Portable export planning now uses the owner snapshot reader for chat-archive
roots only when the HTTP route supplies an authenticated first-party user owner.
Shared links, scoped viewers and independent history rows cannot gain archive
export authority. The full relational group is mandatory regardless of optional
traversal flags. Avatar/gallery IDs still pass the canonical attachment reader;
custom reactions pull actual owned emoji definitions and image bytes. Missing or
excluded required media fails the entire plan. History validation and transfer
bounds run before success; external folder placement and server authority stay
out of the portable output. Both manifests and the client require export 1.9.0.

Focused regressions cover complete history, scope rejection, media/emoji reads,
exclusion failures, corrupt snapshots, limits and cancellation. This is export
planning coverage, not yet proof of a live image-byte archive round-trip or the
visible archive UI. Listing/rendering, live-chat source export and folder lifecycle
integration remain unfinished.

Validation: the combined transfer/capability command passes 198 tests, targeted
lint passes, and the running local Nitro manifest at localhost:12282 reports
origin-scoped api.things-export 1.9.0. TypeScript emits no diagnostics for the
new exporter/test/route files; the repository-wide baseline is not clean.

## Canonical custom emoji ID compatibility — 2026-09-12

The canonical stored-upload emoji writer returns emoji_ plus a full 64-character
SHA-256 hex digest. The shared reaction parser previously capped every ID at 64
characters, rejecting these 70-character IDs. It now accepts that exact long
form in addition to the unchanged legacy grammar; it does not accept arbitrary
long IDs, uppercase/non-hex digests or URL/path suffixes. Feed reactions still
reject custom tokens. Existing personal/community authorization is unchanged.

Regression coverage uses IDs from the real canonical ID generator, checks feed
rejection and invalid forms, remaps an archive reaction between old/new canonical
emoji IDs, and reads the resulting history token without losing it. Things
archive reads are feature 1.13.1 / contract 1.12.1; import is 1.9.1. Messenger
messages, edit projections and reactions are 1.0.1. Corresponding clients now
negotiate these minimum versions. Both manifest generators are tested.

All 213 transfer, 54 Messenger and 46 capability tests pass, with targeted lint
passing. These do not prove real uploaded-image rendering or full archive
export/re-export. Archive UI/listing, folder integration, media round-trips and
remaining broad transfer acceptance are still unfinished.

## Real archive lifecycle acceptance harness — 2026-09-12

Added opt-in `test:transfer-archives` using actual application HTTP APIs, a
credential-free local/dev origin fence, selected-origin capabilities and an
expected fixture username. It imports fictional history, verifies identity
mapping, replies/reactions and anonymous denial, rejects participant deletion
and generic message edits, exercises stale conditional deletion, and removes
only its returned archive root in success/failure cleanup. It never seeds a
database directly or calls live messaging/user/invitation/upload APIs.

Both tests pass against the provided dev fixture, with zero skips and verified
cleanup. During verification the preview temporarily served missing.html and
its capability endpoint returned 404; no writes were attempted then. After it
advertised Things 1.13.0, the live run imported six fictional history rows,
verified private full-history reads and protection against individual-row
changes, rejected a stale delete, then deleted the archive and confirmed 404.
The preview root-data source was verified as
`8da040730b1a4664a14a475aeeb010869c84e951`. Credentials stayed out of repository
files and test output; no existing chats were modified. This proves the metadata
API lifecycle, not byte preservation, visual behavior or complete transfer.
Archive listing/rendering, export/re-export, folder behavior and actual media
round-trips remain unfinished. Canonical hash-length custom-emoji IDs also need
compatibility correction before declaring archive emoji round-trips complete.

## Private archive history reader — 2026-09-12

Added an API-layer home-plane snapshot reader for complete archive history and
ordered attachment identities. Root, participants, messages and reactions are
explicitly projected and structurally validated; server owner/user IDs, ACLs,
roles, token grants and storage fields are omitted. The self participant still
identifies the importing account, without resolving historical usernames to
real users. Foreign/namespaced/deleting roots and malformed identities are
rejected. Row, file, query-time and response-size bounds fail rather than
silently truncating history. File identities require separate canonical media
authorization; referenced emoji IDs alone confer no access.

GET /things?id=<root>&archive=true enforces a first-party user account, private
no-store responses, a rate limit and sanitized errors. The client negotiates
Things feature 1.13.0 (documentation contract 1.12.0). Structural validation is
shared with the portable import contract without fabricating file hashes.
Five new dependency tests cover snapshots/redaction, forbidden roots, identity
and topology corruption, avatar/gallery binding and bounded completeness.
The local runtime advertises the capability and signed-out reads return 401.
Owner-authenticated live reads, archive listing/rendering, folder lifecycle,
export/re-export and broad transfer acceptance remain unfinished.

## Owner archive deletion route — 2026-09-12

DELETE /things now recognizes exact private archive roots only for first-party
user accounts on the same origin and home plane. It delegates to whole-archive
cleanup instead of generic cascading. PAT/app/service/cross-origin callers and
individual history rows remain excluded. The optional preview timestamp is
checked within the claim transaction before any external object cleanup.
Provider errors are sanitized into retryable responses without storage details.
The Things feature is 1.12.0 (documentation contract 1.11.0); the client negotiates
before deleting and forwards expectedUpdatedAt.

Five new dependency-level tests cover dispatch, forbidden actors/planes,
namespace and missing records, sanitized errors and the transactional timestamp
fence. Archive read/render, folder lifecycle routing, full-history export and
live Mongo/S3/browser acceptance remain unfinished. This is not a completion
claim for the archive experience or the broader transfer goal.

## Archive import service integration — 2026-09-12

The transfer importer now validates complete archive groups before writes,
creates their folders and personal emoji dependencies first, and calls the
atomic archive writer instead of generic Thing creation. Its response uses the
writer's fresh identities for every historical row and counts the whole group.
Prepared avatar/gallery uploads remain bound by the archive transaction.
Cancellation after a final commit cleans up the returned archive rather than
reporting success. Later failures call whole-archive cleanup; uncertain cleanup
retains the archive root and all earlier recovery dependencies.

Archive kinds are protected from generic CRUD. Import contract and client
minimum are 1.9.0, with both capability generators covered. Five integration
regressions cover routing/counts/placement, fresh avatars, invalid authority,
multi-archive compensation and final-commit cancellation. These are dependency
tests, not live MongoDB/S3 acceptance. Archive export/re-export, owner deletion
surface, folder lifecycle routing, chat rendering and end-to-end acceptance
remain unfinished. Do not treat this preview as a finished archive experience.

## Develop integration and pending-identity Cut revocation — 2026-09-12

Merged develop source `ee5f9da7a1eb73e962a1960866dc3533db8c7f63` into the
transfer branch. Preserved both README/changelog additions and both root
integrations: transfer intent plus bounded sign-in recovery. Disabled rename
detection for this merge so independent immutable Graphify snapshots were not
mistaken for conflicting renames; regenerate the selected merged-source graph
rather than hand-merging generated JSON.

The combined root flow now revokes Cut intent synchronously on pending identity
changes, not only when the replacement account's root data finally arrives.
Generation matching prevents a stale snapshot from restoring authority when a
newer refresh is confirmed. Regression tests cover saved intent, late copy
tickets, stale confirmation and the new account binding. All 196 transfer,
23 root-data and 43 capability tests pass. Targeted root/intent lint passes.
Live sign-in/Cut race and complete desktop/mobile transfer acceptance remain
unverified; archive endpoint/UI integration is still unfinished.

## Preserve recovery dependencies after incomplete rollback — 2026-09-12

While connecting the archive lifecycle, the existing importer rollback was found
to continue deleting earlier folders/schemas/media definitions after cleanup of
a later copy failed. Stop the reverse cleanup at the first failed, deferred or
uncertain content deletion. Retain earlier created dependencies and remaining
linked resources, and include their IDs in the 503 recovery response. Successful
rollback still uses the existing canonical deletion paths. This preserves more
of an incomplete attempt; it is not a claim that previously successful deletions
can be undone or that the whole multi-Thing import is one transaction.

The import contract and client requirement are now `1.8.1`. Regression tests
cover returned errors, lost deletion responses, parent/schema preservation and
linked-resource retention. All 194 transfer and 43 capability tests pass, with
targeted lint passing. Built-preview manifest and live UI acceptance of this
patch remain to be verified. Archive endpoint wiring is still unfinished.

## Retryable archive deletion and compensation — 2026-09-12

Added the internal `removeTransferChatArchive` adapter and server-owned
`archiveRootId` on imported rows. Deletion is scoped to the exact owner/root/
archive version. It marks a durable deleting root, drains objects child-first
through the canonical attachment cascade, then removes/refunds all historical
rows in one home-plane accounted transaction. Object deletion failures retain
the root and rows for retry; unexpected children and inconsistent archive sets
fail closed. Concurrent completed deletion does not double-refund content.
No live chats, users, memberships, source records or shared emoji definitions
are deleted by this adapter.

Dependency-level tests cover deferred/ambiguous object cleanup, retries, missing
roots, foreign/app/live records, bounded scans, root fencing, leftover children,
changed row sets and transaction rollback. This remains an internal lifecycle
checkpoint, not live S3/Mongo acceptance: import/export endpoints, protected-kind
and capability registration, full-history export/re-export and the archive chat
UI still need integration and real account/browser tests.

## Accounted archive storage writer — 2026-09-12

Added the internal `createTransferChatArchive` adapter. It validates a detached
manifest snapshot, mints fresh IDs, rewrites participant/reply/thread/reaction
references, replaces the self participant with the importing account, and stores
the other participants as archived profile snapshots. Every relational row is
private and owned by the importer; no live chat, membership, inbox preview,
account or notification writer is called.

Rows use `insertAccountedThing` on the home plane inside one transaction with
the canonical fresh post-attachment binder. File size/type/link identity is
rechecked in that transaction; folder placement advances the existing deletion
fence. Custom reactions require mapped, owned personal emoji records. Quota or
binding failures propagate out of the transaction, and retries preserve IDs
without reusing driver-mutated documents. These are dependency-level writer
tests, not live Mongo/quota/browser acceptance.

The writer remains internal and is not yet called by the HTTP import service.
Remaining: dedicated archive deletion/compensation, full-history export and
re-export, endpoint/protected-kind/capability wiring, and Messenger archive UI
with live account-boundary and desktop/mobile acceptance. No endpoint version
change is claimed for this unconnected storage adapter.

## Messenger archive decision and contract groundwork — 2026-09-12

The user clarified that imported conversations should retain their chat
appearance and history as private archives: the importer replaces the original
exporting participant; all other participants retain snapshot usernames, avatars
and messages but become archived identities, not real recipients. No live
memberships, messages or notifications should be created for those people.

Added a side-effect-free relational archive contract and author mapping tests.
Roots, participants, messages and reactions are separate portable Things; names,
topics, dates, exact message text, thread/reply references, tombstones and avatar
file references are validated before import planning. Historical usernames never
resolve to accounts. The self author maps to the importer, others to fresh
archive-local IDs; avatars require fresh file mapping. Source authority fields,
credentials, invalid/cross-archive references, identity collisions and restored
deleted text/media are rejected. Custom reaction references must exist in the
same envelope rather than resolving arbitrary live emoji IDs.

This is not yet enabled in export/import endpoints or Messenger. Remaining work:
authorized full-history extraction including attachment/avatar/custom-emoji
bytes; canonical accounted, private relational storage and rollback; folder and
re-export/copy-of-copy support; reuse chat rendering with archived-person labels
and no live profile/recipient actions; API registration/version negotiation;
real account-boundary and desktop/mobile browser acceptance. No API contract
version is bumped for these currently unconnected helpers.

## Real preview storage acceptance — 2026-09-12

The binary gate passed with no skips against PR 764 preview source
`138b429e9ee94a602065fef565ede968ac723b90`, using an explicitly approved dev
fixture. Both public/private upload approvals were verified through auth/me;
no approvals, database configuration or migrations were changed. The fixture
account was not available on the local server, so the harness now permits an
explicit dev-only opt-in and requires an expected username before remote writes.
Production, lookalike hosts, non-HTTPS remote origins and resource URLs are denied.
Credentials remain transient and are never stored in this repo.

The final run passed both tests in about 11 seconds: real PNG multipart uploads,
mixed post/custom-emoji import, ZIP export/decode/reimport, exact bytes and image
annotations, fresh copy IDs, anonymous export denial, and a concurrent shared
upload claim with exactly one winner whose bytes survive the losing import.
All created copies were readable before deletion, then returned 404; all upload
content returned 404 after cleanup.

Earlier attempts exposed two harness defects: noncanonical archive paths and
cleanup verification consuming the shared export/import rate budget. Fixtures
now validate before upload and use canonical numbered ZIP paths; cleanup uses
ordinary Thing reads, proven readable before deletion. Primary failures are
preserved alongside cleanup errors. A prior cleanup timeout was followed up by
exact-ID absence checks; the final complete run passed without these failures.

This proves the post/emoji storage round trip, not all file/gallery/recording UI
flows. Remaining broad acceptance and Messenger archive-versus-live-chat semantics
are still open. No production deployment or universal-content claim is implied.

## Executable real-storage acceptance gate — 2026-09-12

Added `test:transfer-binary`, an explicitly opted-in local API test for real PNG
uploads, mixed post/emoji import, ZIP export/decode/reimport, exact byte and image
annotation comparisons, anonymous denial, distinct copy IDs and two concurrent
emoji imports claiming one fresh upload. Cleanup uses only IDs returned during
that invocation and checks both content and exported records become unavailable.
Session credentials are origin-fenced; storage PUTs receive only a checksum and
never the session cookie. The test negotiates every API feature it uses before
mutating data, and never changes upload approvals or runs migrations.

The actual local run reached the capability and account endpoints, then failed
the explicit existing-upload-approval precondition before creating any records.
This is confirmed blocked storage acceptance, not a passed binary round trip.
Focused lint passes; the new test introduces no TypeScript diagnostics (the
project still has 106 baseline diagnostics). Without explicit opt-in it skips.

## Custom emoji pipeline integration — 2026-09-12

Owner-only emoji export now handles both authorized stored images and bounded
legacy inline image bytes. Inline bytes exist only in the transient export plan;
the portable ZIP contains an ordinary checksummed file. Imports upload through
the custom-emoji purpose and call the fresh-upload writer below, with new personal
names and no restored community membership or uniqueness identity. Personal
emojis appear in the owner library and support folder placement and Cut moves;
community emojis cannot be filed through that path.

Image annotations are restored only after the dedicated writer successfully
claims the fresh upload. Annotation or placement failure compensates the new
emoji through its canonical deletion path. A rejected upload never gets
annotated, and uncertain client responses do not trigger destructive cleanup.

Export/import capabilities are 1.8.0; owner-library Things is 1.11.0 and bulk
placement is 1.3.0. Older clients/servers are covered by negotiation tests.
Desktop 1280px and mobile 390px headed Chrome file-picker checks passed and
screenshots were reviewed: upload purpose, file-map submission, bounded dialog,
and no cleanup after uncertain import. These use simulated upload responses,
not live S3. Live uploaded-byte and concurrent-transaction acceptance remain
open; the fixture account has no upload approval. Messenger archive versus live
chat representation also remains unresolved. Earlier groundwork entries below
describe historical commits, not the current enabled endpoint state.

## Fresh custom emoji writer groundwork — 2026-09-12

The server adapter now calls the canonical emoji writer with a server-generated
attempt UUID and a suffixed personal-library name. An internal-only argument
requires a fresh, ready, owner-held emoji upload of the expected MIME/byte size.
The writer rechecks that condition inside its existing insert/bind transaction;
the binding write supplies the conflict against concurrent use of the upload.
An uncertain-commit recovery may only return an emoji carrying this exact
server attempt identity, never an older emoji with the same image/name.
Normal emoji upload behavior is unchanged: the public route passes two
arguments and cannot supply the internal attempt through its body.

The pure gate and adapter tests cover foreign/bound/expired/wrong-purpose
uploads, byte/type mismatches, invalid attempts, source-scope rejection and
canonical writer failure. These are dependency-isolated tests, not a real
MongoDB transaction or S3 acceptance test. Attachment and messenger regressions
also pass. The generic transfer endpoint has not enabled this adapter, so no
external feature contract or UI changed in this step. Wire export, import,
rollback, placement and client controls together before advertising support.

## Custom emoji transfer contract groundwork — 2026-09-12

The coverage audit found that custom emoji, messenger/community records,
subspaces and app data are refused by the generic crystal writer even when
they are not in `PROTECTED_THINGTIME`. The existing transfer paths must not be
described as universal content coverage. Account, membership and credential
records are not ordinary portable content.

Added a pure custom-emoji transfer envelope and regression tests: one stored
image, a valid name, optional folder placement, no community target, membership,
uniqueness key or inline image. The preflight checks the canonical emoji MIME
and size limits; the upload service must still sniff and authorize real bytes.
Imported-name generation adds a bounded suffix instead of replacing an existing
emoji. This is groundwork only, not an enabled export/import adapter.

Remaining emoji work: authorized stored/legacy image export, integration of the
fresh-upload adapter and dedicated rollback, reference remapping, library
placement, client upload-purpose selection, controls, capability registration
and live round-trip verification. No endpoint or client contract changed in
this groundwork commit. Conversation representation still needs the user's
archive-versus-live-chat decision. The live fixture account's public and private
uploads were both disabled on recheck; no approval policy was changed.

## Excluded-byte export recovery — 2026-09-12

Export previously described every discovered attachment before applying file/link
selection, so a file whose storage was unavailable could block a links-only
download. The descriptor now applies selection after live owner/shared-root,
moderation, expiry and data-plane checks but before accessing excluded stored
objects. Missing or unauthorized metadata still fails closed. Recording roots
still require their bytes. Direct download/copy retain full object verification.
Export capability 1.7.1 advertises this correction and clients require it.

Attachment tests prove excluded bytes cause zero storage calls while unrelated
viewers, wrong shared roots and blocked sources remain denied. Export tests prove
the selected flags reach the descriptor and links remain independently included.
Suites: 185 attachment, 134 Things and 40 capability tests pass; focused lint
passes. These are simulated storage-failure tests, not live S3 acceptance.

## Theme and algorithm folders — 2026-09-12

Owned current-schema themes and algorithms now appear in the Things library.
Their export adapters read owner-only folder placement; import creates fresh
private records through dedicated creators, then places them after included
parent folders exist. Standalone imports honor the selected destination.
Placement failures compensate newly created records. Active selections are not
changed. Generic protected-kind edits/deletes remain forbidden, and legacy
records without current-schema placement fail moves explicitly.

Saved-theme and algorithm Transfer menus expose Cut. Same-account paste uses
the dedicated managed-content placement writer, retaining token/source fences;
clipboard content alone never grants move authority. Contracts are export and
import 1.7.0, bulk 1.2.0 and owner Things reads 1.10.0.

Validation: 133 Things tests and 40 capability tests pass, including included
folder remapping, selected destinations, placement compensation and owner-only
library reads. Focused lint passes. Headed Chrome at 1280 and 390 pixels proves
the import selector remains available, fits the viewport and submits the
chosen folder for mixed theme/algorithm files. Import requests were intercepted
and synthetic: this is UI wiring evidence, not a live database round trip.
Real approved-upload byte acceptance and remaining dedicated content adapters
remain open; this section does not claim broad transfer completion.

## Navigation-safe Cut intent — 2026-09-11

Move authority now resides only in tab memory, outside the ThingsPage mount.
The root account lifecycle revokes intent on logout/account changes or root
unmount, and epoch tickets reject stale copy completions even after A→B→A.
Paste requires exact owner and clipboard digest; partial moves retain failed IDs
and cannot settle a newer intent. Copy from shared Transfer controls and the
clipboard dismiss button revoke prior move intent. Reloads still discard it.
Unit tests cover continuity, immutable source IDs, account/clipboard mismatch,
revocation, partial success and stale completion. A headed Chrome desktop check
uses the real OS clipboard and SPA navigation with synthetic list/export/move
responses: Cut → leave → return → Paste dispatches one move, not an import.
No original data is mutated by this simulation. The local live health endpoint
currently reports storage migration required; no migration was performed.

## Durable recording reads — 2026-09-11

The real attachment reader treated every unbound object as an expiring draft,
so a durable recording could pass export planning mocks but fail the live
descriptor/download path. Exact owners can now read ready, standalone recording
Things without expiry; import drafts, linked/profile records, expired or invalid
expiry values and unrelated viewers receive no exemption. Moderation, authorized
shared-root checks, home storage and exact object-version validation still run.
Attachment content is 1.6.4 and export is 1.6.1; file-export clients negotiate
both before proceeding. Service tests exercise description and signed download,
including denial paths. Real S3-byte round-trip acceptance remains outstanding.

## Recording placement integration — 2026-09-11

Bulk move 1.1.0 routes owned standalone recordings through the dedicated
home-plane placement writer, retaining source/token checks and reporting
per-item failures. Generic attachment edits remain forbidden. Themes and
algorithms are not yet wired for managed moves.

Export/import 1.6.0 preserves recording placement inside included folders.
Imports create parent folders before filing fresh private recordings; lone
recordings use the selected destination. Placement failure compensates only
newly created copies. Move clients require bulk 1.1.0 before dispatch.

Validation: 124 Things tests and 40 capability tests pass, as do targeted lint,
the production build and Vercel output verification. Chrome dialog simulations
passed at 1280/390px; screenshots were reviewed for clipping and overflow.
Full TypeScript checking still reports existing project errors, with none in
the changed placement/transfer paths.
Real approved-byte Cut and folder round-trip acceptance remain unverified.

## Recording adapter checkpoint — 2026-09-11

Export/import 1.5.0 adds owned standalone recording roots. The portable attachment
Thing contains only recordingFileId; one distinct file entry carries its bytes
and owner annotations. Plan-only sourceId authorizes the original download and
is discarded before archiving. No-files recording exports fail explicitly.
The importer accepts only fresh owned recording-import drafts, preserves immutable
purpose and moderation, commits annotations/durability together, remaps embedded
references, and compensates failures through the attachment deletion lifecycle.
The import dialog selects recording-import per recording file in mixed ZIPs,
keeps other media on post purpose, and forces dedicated content to top level.
Upload retries receiving a ready receipt finalize metadata without PUTting again.
Once an import is dispatched, dialog cleanup no longer deletes supplied uploads:
a lost response may hide a successful recording commit. Server compensation and
draft expiry own cleanup from that point. Simulated Chrome runs check mixed
purposes, ready receipts, lost responses and close-without-delete at 1280/390px.
Real approved-upload/byte round-trip acceptance remains outstanding; unit/mocked
coverage and upload-denial browser checks are not substitutes for that gate.

## Recording lifecycle foundation — 2026-09-11

At the initial lifecycle checkpoint recording transfer was not exposed. Purpose
is immutable: converting an ordinary post draft into a recording is not allowed.
The server-only reservation option now supports a recording import draft. Its
purpose is recording from birth; completion retains expiry until import commits.
The import commit helper atomically checks owner, ready state, draft marker,
expiry, absence of gallery/profile binding and expected bytes, applies canonical
annotations, preserves object/moderation state, accounts the metadata delta and
clears the draft marker/expiry under the home transaction and CAS fence. Reusing
a durable recording is rejected. Drafts are excluded from My Things and enter
normal expired-draft cleanup. The next checkpoint adds the `recording-import`
upload intent behind the normal private-upload permission. The server stamps the
draft marker only on a new recording reservation, includes the distinct intent in
the request fingerprint, and refuses expired or committed ready-upload replay.
Upload start and completion advertise 1.3.0; the browser upload API negotiates both
before requesting this intent. Ordinary recording callers remain compatible.
The adapter checkpoint above wires portable recording support; next exercise approved-upload round trips and
transaction/cleanup failure paths through real APIs.

## Scope and current checkpoint — 2026-09-11

The requested outcome is broad export/import, actual browser/OS clipboard
Copy/Cut, and downloadable files/ZIPs that can be imported again. This PR is
still in progress; the Things clipboard/download checkpoint is not completion
of that scope.

- Versioned portable JSON carries content, kinds, extended data, folder and
  target relationships, but never account ownership or authorization envelopes.
- ZIP archives contain a manifest plus numbered, size- and SHA-256-checked
  file entries. Traversal paths, missing/unexpected entries and inflated size
  violations fail before any import. Collection drains folder pagination and
  deduplicates bounded dependency graphs.
- `api.things-export` 1.0.0 performs fresh authorized reads, canonicalizes app
  aliases, preserves gallery placement and returns a bounded plan. File bytes
  are separately reauthorized, size-checked and hashed before delivery.
- `api.things-import` 1.0.0 creates new private caller-owned Things through
  ordinary schema, permission and quota checks. IDs and executable references
  are remapped server-side; partial failures clean only newly created records.
  Managed account/control kinds require their dedicated workflows.
- Things now has an Import dialog with JSON/ZIP validation, destination choice,
  explicit file-upload and private-copy confirmation, normal upload retries,
  and account-keyed teardown. Import POSTs are never automatically retried.
  A lost response requires checking Things before another attempt.
- Things Copy/Cut write portable content to the OS clipboard. Paste imports
  private copies unless matching in-memory cut intent belongs to the same
  account/session; clipboard text can never request a destructive move.
  Download offers ZIP/JSON and folder/dependency/file inclusion choices.

## Evidence

- Algorithm coverage (2026-09-11): owner-only full snapshots preserve exact
  weights and training statistics, including legacy records. Public preview
  access alone never exports weights. The dedicated algorithm writer validates
  bounded plain data, creates fresh quota-accounted private/unshared records,
  and does not activate or train them. Its import return avoids fallible author
  label lookup after commit so mixed-import cleanup always receives the minted
  ID. AlgorithmManager exposes the common transfer controls and privacy warning.
  Transfer contracts are 1.4.0. Validator and transfer-service tests cover exact
  data, private projection, rejected authority and dedicated rollback.

- Theme coverage (2026-09-11): dedicated owned/public theme reads (including
  legacy records), content-only name/tokens export, fresh private imports via
  saveTheme, and dedicated rollback. Active theme selection is never changed.
  Generic protected-kind policy remains intact. Invalid theme structure and
  extra fields are refused rather than silently discarded. Theme Studio now
  exposes the shared transfer controls and refreshes My themes after import.
  Transfer contracts/client minimums are 1.3.0. Desktop JSON and mobile ZIP
  download/file-picker round trips preserved resolved tokens and private read
  denial. The first test cleanup used the wrong route; its three exact temporary
  fixtures were removed through `/themes/delete` before rerunning.
  Feed algorithms and stored-file upload-approved-account acceptance remain
  outstanding; this is not a claim of completion of the broad request.

- Stored-file annotation correction (2026-09-11): export plans and portable
  bundles now retain optional title, multiline description and filenamePreview
  for uploaded files as well as links. Import/export clients negotiate 1.2.0.
  After ready-upload ownership checks, normal annotation accounting writes run
  with a server-only fresh-unbound-post fence inside their transaction. A
  concurrent bind therefore cannot annotate an existing gallery. Imported
  content does not set detected types, moderation, file bytes or ownership.
  Actual stored-file upload acceptance still needs an upload-approved account.
  Validation: 97 Things tests, 178 attachment tests (plus six media-cache
  tests) and 39 capability tests pass. Full build and Vercel output verification
  pass; the built manifest advertises import/export 1.2.0 without requiring
  database access. Targeted lint has no errors and one intentional unsafe-URL
  test warning. Full typecheck retains baseline diagnostics, none in changed
  transfer/attachment implementations. The real desktop JSON/mobile ZIP linked
  gallery regression also passes through the stricter annotation transaction.

- Linked-gallery extension (2026-09-11): import/export 1.1.0 adds optional
  `links` and complete `attachmentOrder` to the version-1 portable envelope.
  URLs and bounded owner annotations remain metadata, never fetched bytes.
  Imports call the same link/annotation writers as ordinary gallery creation,
  bind fresh records in source order and retain quota/private ownership checks.
  That existing link path deliberately requires no stored-upload approval.
  Stored files still use normal uploads; flagged linked exports fail closed.
  Failure cleans only new unbound drafts (bound records use Thing cascade).
  JSON can include links independently of stored files; the download dialog
  exposes a separate link-inclusion choice. Actual Chrome desktop JSON and mobile
  ZIP downloads were imported through the file picker: both copies retained two
  links, multiline annotations, filename previews and order after source deletion.
  Anonymous reads returned 404. Dialog bounds and button hit-tests passed; all
  disposable fixture Things were removed through normal API cascade deletion.
  This is linked-record proof, not offline external bytes or stored-upload proof.
- Linked checkpoint validation: 96 Things tests and 39 capability tests pass;
  attachment suite passes including admin/owner flagged-link export denial and
  unchanged no-redirect content behavior. Full Vite/embed/Nitro build plus
  Vercel output verification pass. The built server manifest returns import and
  export 1.1.0; this isolated manifest smoke has no database configuration and
  does not claim database health. Targeted lint has zero errors (one intentional
  unsafe-URL test warning); full typecheck retains baseline diagnostics, with
  none in the changed transfer or attachment implementation files.

- Nested value menus now offer typed portable clipboard Copy/Cut, JSON/ZIP
  Download and reviewed Import file. Their one-data-Thing envelope can also
  enter the normal private Things importer; local import unwraps only explicit
  value envelopes and directs saved app/file imports to My Things. Ordinary
  JSON is accepted with the same value validation. Non-JSON values, unsafe
  keys, cycles, accessors, hidden properties and lossy arrays fail explicitly.
  Delayed Cut checks the copied value/context again before invoking deletion.
- Top-level deletion uses the provider's explicit root boundary instead of
  its ignored empty path; direct nested paths delete their leaf key rather
  than the entire dotted label. Transfer confirmations use one layer above
  stacked Lopu notifications, keeping mobile controls unobstructed.
- Value helper and read-only menu regressions bring the focused Things suite
  to 91 passing tests. Chrome has verified real nested-value JSON/ZIP downloads
  and file-picker reimports, type-preserving Copy/Cut/Paste and desktop/mobile
  bounds plus notification-obstruction hit-tests. Full-project typecheck has
  baseline failures; no diagnostics remain in the new value helper/dialog or
  modified context-menu entry point. Existing Thingtime hook warnings remain.
- Direct nested-property and array-element Cut were checked through their own
  editor URLs; siblings and array shape remained intact. The downloaded value
  ZIP was imported through My Things into a fresh private data Thing, read back
  through the normal API, then deleted through that same API. Other value
  fixtures existed only in the isolated browser's local tree.
- Shared Transfer controls now cover Thing details, component-family pages,
  public webpages and the Builder inspector. An isolated Chrome fixture checked
  real ZIP downloads and OS clipboard envelopes plus Import dialog bounds and
  hit-testing on all four surfaces at 1280px and 390px. Dialogs and portaled
  menus explicitly layer above the Builder inspector. Fixtures were deleted
  through the ordinary Things API after each run; no source user data changed.
- Current focused Things suite: 87 passing tests. All seven changed frontend
  files pass targeted lint. These results do not prove stored-file acceptance.
- Follow-up: import 1.0.1 reconstructs persisted component instance contexts
  from canonical transfer content and reuses the fork media bindings. Saved
  defaults, distinct page instances, CSS media and a second re-import retain
  fresh attachment references without rewriting labels or template arguments.
  Seven import tests pass, including service-level ready-upload checks.
- Real file-bearing browser acceptance was attempted with a generated PNG ZIP.
  The disposable fixture account was refused by the normal upload approval
  gate before any Thing import. The UI displayed the refusal and kept Import
  disabled. This is not stored-file round-trip proof; no gate was bypassed.
- 85 Things tests and 38 API capability tests passed, covering content, ZIP bytes,
  malformed/oversized envelopes, authorization, rollback and cancellation.
- Real local API integration imported six disposable folder/schema/data/action/
  component/page Things, exported and re-imported them, verified private
  ownership and remapped references, ran both copied actions, denied anonymous
  export, then deleted all twelve copies.
- An isolated Chrome session using a disposable local fixture account checked
  invalid input, JSON file selection, desktop/mobile dialog bounds, a real
  two-Thing import and the refreshed folder listing. Real clipboard Copy/Paste,
  downloaded JSON and ZIP file-picker re-imports, and same-session Cut/Paste
  moving the original folder all passed. Eight disposable Things were cleaned
  after the complete browser run. Desktop/mobile export screenshots and bounds
  were inspected; existing mobile global-nav crowding remains outside these dialogs.
- Full Vite/embed/Nitro build and Vercel-output verification passed. The built
  well-known capability response advertises export/import 1.0.0. A separate
  attempted `/api/v1/capabilities` probe was not a valid manifest endpoint;
  it is not counted as a passing smoke.
- Targeted new-file lint passed. ThingsPage retains five existing hook warnings.
  Full typecheck still has unrelated baseline errors; the focused output has
  no errors in changed transfer/import/upload files after corrections.

## Remaining acceptance

Complete all file/gallery forms: linked galleries currently fail explicitly
rather than silently disappearing. Split-template imported media now has its
rebinding adapter, but real stored-file UI proof needs an upload-enabled test
account. Builder/component/detail and generic nested-value controls are wired.
Verify remaining stored file bytes through
the real import UI, account transitions, partial failures and desktop/mobile
dynamic states. Verify current-head CI and preview independently of local tests.

Local stack: http://127.0.0.1:12280 (Nitro 12282, HMR 12281).
No verified Tailscale/Funnel URL is available for this worktree.
