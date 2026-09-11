# PR 764 — portable Thing transfer

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
