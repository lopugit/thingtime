# Local workspaces

Implementation in progress on `codex/anonymous-local-first`. This is the normal
Thingtime application, separate from the stateless agent export sandbox in
[no-login-draft-preview.md](no-login-draft-preview.md). The full local-first
rollout is **not ready to merge** until the outstanding rows below are verified.

## Audit of existing support

- `ThingtimeProvider` already persists the legacy editable tree with localforage,
  serialized autosave and cross-tab updates. Account keys remain isolated. The automatic legacy anonymous workspace
  claim is removed; existing account keys are preserved and anonymous data stays
  in its original namespace until an explicit transfer.
- Timeline already has canonical event/link records, IndexedDB recovery, branch
  and note queues. Its provider currently discovers an authenticated remote
  scope before connecting those facilities to editors.
- Account drafts already have bounded snapshots, immutable write IDs, revision
  conflicts, discard tombstones and independent template copies.
- `/things` previously created a server temporary account automatically. That
  was a remote account, not a browser-only workspace. This branch removes that
  implicit request; explicit authentication endpoints retain their checks.
- Modern Things, Builder, components, schemas, Actions, themes and algorithms
  mostly use `useApi`, with additional direct clients for drafts, webpage
  resolution, suite installation, attachments and Actions.
- The existing media service worker reauthorizes private media on every use,
  including cache hits. It cannot be used as an offline private-media bypass.
  It did not previously cache the static app shell or route chunks.

## Storage and authority

`app/local-workspace` is a browser adapter behind the existing application API.
UI components do not open IndexedDB themselves. Local records use the shared
Thing crystal validator, composition reference rewriter and portable transfer
collector/validator. Local bookkeeping is excluded from exported content.

The anonymous namespace belongs to this browser origin. It is distinct from
every signed-in account, API origin and remote data plane. `useWorkspaceUser`
supplies content ownership to local-capable editors; `useCurrentUser` remains
the authentication hook. Local identity is not accepted by server endpoints.
Identity changes invalidate outstanding local operations and abort transactions.
Anonymous work is never implicitly adopted by or uploaded to a later login.

Writes and quota accounting are transactional across tabs. Current bounds are
10,000 records, 1 MiB per JSON record, 16 MiB per file and 64 MiB per workspace (metadata and bytes together). Failed saves report an
error; failed imports roll back. Optimistic concurrency checks retain an editor's
base timestamp. Files require the dedicated local attachment adapter rather than
reusing account attachment IDs.

Anonymous public catalog reads omit credentials. Public catalog cache entries
grant no ownership or write permission. Local writes and cloud operations have
explicitly different implementations; a missing local implementation fails
rather than falling through to an account mutation.

The offline app shell contains only build-produced static files. The build
manifest pins sizes and SHA-256 checksums, caps assets at 2,500 / 96 MiB and uses
four download workers with a 90-second overall deadline. A partial or mixed
deployment cannot become a ready offline shell. Account API responses, bearer
URLs and private media are excluded. The existing media authorization checks
remain in place. The local root fallback stores a confirmed anonymous marker or a minimal account
workspace pointer (origin, account ID and data plane). It never stores a profile
or credential, and an offline root has `user: null`. Local content identity
cannot authorize remote requests. Only the latest accepted root response may
change this pointer; logout/account changes revoke it.

## Coverage and remaining acceptance work

| Area | Current evidence / required completion |
| --- | --- |
| Local storage and account boundaries | Unit-tested persistence, atomic rollback, concurrent edits, scope isolation and identity invalidation. Add browser multi-tab and account-switch regressions. |
| Builder pages | Live logged-out create, text edit, save and reload verified. Component reference maps now reuse canonical selection, with export/render agreement tested for versioned aliases. Finish responsive, component UI, global/site block and interaction checks. |
| Things and folders | Core CRUD, folder placement, cycle checks, copy/move/delete and portable text/component transfer implemented. Finish all normal UI flows and search. |
| Drafts and templates | Shared snapshot/retry/conflict/tombstone semantics implemented locally and unit-tested. Post template creation, independent media copies and reuse pass offline browser checks. Finish definition/schema recovery, other media kinds and account sync. |
| Components and schemas | Local storage and public discovery adapter started. Finish bundled catalog availability, copies, argument editing, schema forms and offline creation. |
| Actions and app suites | Reuse existing bounded executors and suite definitions. Local data/pure/browser operations still need local host integration; remote services must remain explicitly remote. |
| Timeline | Reuse existing records, history UI, drafts, branches, notes, version names, restore and merge. Local authority/transport integration remains outstanding. |
| Attachments and media | Anonymous canonical ZIP import/export/copy/delete now stores metadata and bytes atomically with shared quota accounting; normal UI offline round-trip verified. Normal file-picker save, download, copy/move and native image preview now pass offline browser checks. Native composer file selection and draft/template copies now pass offline browser checks. Finish linked galleries, media annotation/audio/video acceptance and account sync. Never treat a cached cloud attachment as locally authorized bytes. |
| Posts, comments and saved items | Native local post create/edit, image attachments, comment/reply reads and writes pass offline browser checks. Saved items, reactions, polls, linked Things and complete account sync remain. Public posting, remote reactions and recipient delivery remain authenticated operations. |
| Themes, visual settings and algorithms | Anonymous saved-theme CRUD, active selection, quota and canonical transfer now work through Theme Studio and have offline browser evidence. Anonymous algorithms now support local CRUD/branching, active selection, bounded public-feed training, per-page ranking and canonical JSON round-trip. Account theme/algorithm sync, local Timeline history and cross-tab acceptance remain outstanding. |
| Passwords | Audit and implement local encrypted storage/unlock using the existing vault contract. No plaintext substitution or server-password bypass. |
| Apps, integrations and native/browser tools | Separate locally available adapters from paired remote devices, external services and their consent requirements. Verify each applicable local surface. |
| Lopu and automation | Local documents, authored definitions and drafts should remain editable. Provider inference, external delivery and hosted scheduled execution still need their real services. |
| Auth, social, remote devices, billing and admin | Remote authority is retained. Do not substitute a local actor for a signed-in account. |
| Offline startup | Verified static-shell cache implementation and policy tests added. Production-build offline reload, editing, save and second reload passed in a clean local origin. A rebuilt shell also passed account cold reload/edit/reload with no networking. Continue route navigation, update recovery and cross-account browser coverage. |
| Signed-in local-first operation | Owned data/folder/page/component/schema/Action creates and updates now have an atomic account-scoped queue, immutable ambiguous retries, conditional updates and reviewed conflict choices. Native Builder resolves pending pages locally. Local fixture create/edit/reload/reconnect and conflict review passed. Account offline cold startup, native page editing and reconnect verification now pass locally. Complete deletion/moves/imports, attachments, all dedicated adapters, online cached-list membership/pagination and multi-tab UI refresh before merge. No anonymous sync queue may be replayed as account content. |

## Development verification

Run `npm --prefix remix run test:local-workspace` for the storage, draft,
transport and offline-shell tests. Run the existing media-cache suite as well:
`node --test remix/scripts/media-cache.test.mjs`.

`npm --prefix remix run build:client` now prepares the static offline manifest.
Development HMR modules are deliberately not cached. Test offline startup
against a production client build, using an isolated test origin and clean
browser profile. Keep Mongo/account fixtures disposable and use the real APIs
for any authenticated test setup.

The browser evidence in this document is local. Consult PR #1000 checks for the
exact pushed revision; the full rollout has not been merged.


Posting independence is delivered separately in [PR #999](https://github.com/lopugit/thingtime/pull/999).
Posts, edits, rich comments and plain comments/replies no longer await draft
sync or cleanup. Local browser acceptance blocked the draft endpoint while a
private post and mobile comment/reply still completed. This does not imply the
full anonymous/offline feature matrix above is complete.

## Account sync checkpoint — 2026-10-16

`accountSync.ts` commits canonical Thing content and its queue entry in the same
IndexedDB transaction. Scopes include origin, account ID and data plane. Every
remote read and write carries the existing expected-actor and expected-data-plane
headers. Session mismatch invalidates the worker and refreshes root identity;
temporary/anonymous sessions do not start account workers. No anonymous-to-account
migration occurs.

Ambiguous outcomes retain the exact frozen create/update body. Create IDs are
stable UUIDs; updates use the acknowledged server timestamp. A lost response is
acknowledged only after an owned, matching readback. Account timestamps and local
editor tokens are separate, so acknowledging sync does not invalidate the next
save. Definitive validation failures allow corrected content to be retried.
Unsupported fields retain their dedicated adapter; pending local writes refuse
an incompatible online mutation rather than dropping attachments or controls.

Conflicts stop automatic replay. The review UI compares both versions and lets
the user keep either one. Applying a choice rechecks the reviewed server timestamp
and local revision. Typing, another tab or another device invalidates stale review.
Keeping the local version sends a fresh conditional write; keeping the account
version invalidates old editor tokens. This is explicit replacement, not an
automatic semantic merge.

Native Builder reads the same local page/component data, reusing the canonical
component selector. Previously authorized component dependencies are cached under
the account/page scope without ownership or bearer credentials. Missing dependencies
fail explicitly. The account queue does not execute authored Actions.

Local browser evidence used a disposable private fixture on Vite `22460`, Nitro
`22462` and an isolated Mongo replica on `22463`. Blocking the Things and webpage
resolver endpoints still allowed create, edit, save, native render and reload.
Unblocking and retrying produced the same private Thing on the fixture server.
A concurrent server edit produced a conflict; explicit keep-local then synced the
reviewed content. The sync panel was measured at 320/390 CSS pixels with no
horizontal overflow and at 1440×1000. Test network/viewport overrides were removed
and the fixture was logged out. This is endpoint-outage recovery with an available
root session, **not proof of signed-in cold startup completely offline**.

Retained local evidence (ignored, not deployed):
`tmp/draft-qa/account-conflict-desktop.png`,
`tmp/draft-qa/account-conflict-320.png`,
`tmp/account-sync/remote-verification.json`.

## Offline account startup checkpoint — 2026-10-16

The browser can reopen its last confirmed account workspace after a retryable
root/network failure. That fallback contains no authenticated user, profile,
permissions, session or deployment environment. The ordinary authentication hook
continues to return null. A separate content-ownership hook keeps the editor and
local tree in the same origin/account/data-plane namespace, avoiding a switch to
anonymous storage or loss of unsaved editing when connectivity changes.

Account transport rechecks current remote confirmation before capabilities,
before the request and after its response. Losing confirmation aborts the remote
lease permanently, even if the same account later reconnects. Unsupported remote
API fallthrough and account drafts refuse an unconfirmed workspace. A real root
response must confirm the account before queued sync resumes. Anonymous work
never starts that worker. The legacy tree no longer implicitly copies anonymous
content into a first account; previously saved account keys remain intact.

Root binding and persistent pointer changes now occur only after the root
loader's latest-request/generation fence. An older successful or failed request
cannot overwrite or revoke a newer accepted identity. Stale offline pointers,
wrong origins, malformed account IDs, invalid database names, pending identity
changes and authoritative root refusals fail closed.

An offline Builder list can use saved local records even when its exact server
page was never loaded. It uses distinct `device:` cursors, batch projections and
an explicit incomplete-library notice. It does not claim the entire remote
account library is present. Remote pagination cursors cannot be reused offline.
Reconnection and renewed account confirmation restart the list at its first
page without clearing the visible rows. Background refresh does not replace
cached content with a loading spinner.

Production-build local acceptance on `http://127.0.0.1:22470` verified account
page cold reload while fully offline, editable native text, local save and a
second offline reload. Network observations showed no mutation requests while
offline, or after networking resumed with `/api/root-data` deliberately blocked.
A separate authenticated fixture API read confirmed the server copy was unchanged.
After root verification was restored, the queued edit reached the same private
Thing. A separate unsaved page-name edit survived offline-to-authenticated root
reconnection and then saved successfully. Only disposable local fixture data was
changed; this is not deployed or CI verification.

The offline library was also checked at 1440×1000 and 390×844; the phone
document had no horizontal overflow. Reconnecting cleared the device-only
notice without a reload. Evidence: `tmp/draft-qa/account-offline-library-desktop.png`
and `tmp/draft-qa/account-offline-library-390.png`.

The checkpoint suites passed 297 tests with four opt-in skips across local
workspace/offline shell, root data, webpages, autosave and drafts. The client
build succeeded with 230 verified offline assets. Raw TypeScript still reports
91 existing baseline diagnostics; none matched the changed files. Full feature
acceptance, CI and deployment remain outstanding.


## Anonymous saved themes and storage recovery — 2026-10-16

Theme Studio now saves named themes in the anonymous workspace, using the same
`normalizeSavedTheme` token sanitizer as the account writer. Generic mutations
still refuse the protected theme kind. Dedicated save/delete/active operations
stay local; canonical imports validate theme-only content, mint fresh local IDs,
and enforce the 100-theme limit transactionally. Imports do not change the active
selection. Export excludes local identity and visibility bookkeeping.

A production-build browser check with no account session verified save, reload,
fully offline cold load, edit/save and a second offline reload. The standard
Transfer UI downloaded valid canonical JSON and imported a second editable copy;
apply and delete also worked offline. Save/delete network captures contained no
mutation requests. The library fit 1440×1000, 390×844 and 320px with no horizontal
overflow. Disposable local themes and browser overrides were cleaned up. Evidence:
`tmp/draft-qa/anonymous-theme-export.json`, `anonymous-themes-offline-desktop.png`
and `anonymous-themes-offline-390.png` in the same directory.

Public profiles, activity, people search and shared themes remain available
without login through credential-free public reads; the explicit public waitlist
writer remains available. Retired anonymous API facades cannot run those callbacks
under a later account. Account theme synchronization and local Timeline history
are still separate outstanding work; this is not full theme-family acceptance.

Authoritative root refusals now invalidate active local editors and remote
workers as well as the saved fallback pointer. Reconfirming the same account
cannot revive a retired operation. IndexedDB opening has a ten-second bound,
clear blocked/error/closed diagnostics, retry after failure and cleanup of late
upgrade/success callbacks. Focused regression tests cover these failure paths.

## Anonymous algorithm checkpoint

`LocalAlgorithms` uses the existing canonical profile parser and feed scoring /
training functions. Named profiles are protected `feed-algorithm` Things; generic
Thing updates cannot bypass their writer. The shared limit is 50 profiles, with
atomic import quota checks. Portable exports contain only the canonical name,
emoji, weights and training statistics; imports get fresh IDs, no sharing or
lineage, and never change the active selection.

Only credential-free public feed observations supply training features. This
bounded cache stores at most 1,000 post feature records (not complete posts),
200 observations per fetched page and 100 tags per post. Training batches use
the existing 100-event limit. Feed session and pending buffers are bounded,
identity invalidation clears them, and built-in sorts do not train. All flushes
use the workspace facade, including page-hide flushes; no direct beacon can
borrow another account's cookies. Failed training reports a visible error.

Local weights and IDs never go into the feed request. The browser requests the
public chronological feed and ranks each available page locally; this is not a
global ranked cursor. The UI states that limit. Community discovery remains a
credential-free online read; branching remote profiles still requires account
authority. Account profile sync and full offline public-feed pagination remain
separate unfinished work.

Local production-build browser verification covered logged-out create/select,
offline cold reload, rename/branch, canonical download/import/re-export, deletion
and 1440/390/320px layout. A synthetic public-feed response rendered through the
normal feed card and trained the profile with no server mutation; no post was
published. The actual trained JSON and imported re-export had identical profile
content and different IDs. Browser overrides were restored and all four test
profiles deleted. Evidence is in `tmp/draft-qa/anonymous-algorithm-*.json` and
`anonymous-algorithms-offline-*.png`. These are local checks, not deployed proof.

## Anonymous file transfer checkpoint

Canonical ZIP imports store attachment metadata and actual bytes in the same
scoped IndexedDB transaction. The dedicated attachment writer reuses canonical
metadata sanitization, recording/file validation, checksums and composition media
remapping. Generic Thing mutation cannot write attachment bookkeeping. Binary
records share the workspace quota ledger and are inaccessible through generic
JSON collection operations. Imports validate and snapshot all bytes before any
write; failures roll back metadata, placement and bytes together.

The normal Things importer saves local bytes without an upload stage. Export
uses the existing canonical collector, validator and serializer, including
component dependencies and referenced media. Its in-process byte reader is
identity-scoped and never falls back to HTTP. Missing/corrupt bytes fail the
whole export. Copies have independent IDs and bytes; deleting a target cascades
its bound attachments, while deleting a folder containing standalone files still
requires explicit recursive deletion. Portable JSON contains no local storage or
server approval fields. Account file imports remain refused until their dedicated
sync adapter is complete.

A logged-out production-build browser imported a disposable ZIP with networking
disabled, downloaded it through the normal Transfer dialog, cold-reloaded offline,
imported that actual download, deleted the original and exported the surviving
copy. Both downloads passed the canonical archive decoder and serializer with
identical 82-byte content and different root IDs. Observed import/export requests
were empty. The local import notice and controls fit 390px, and the export dialog
fit 320px without horizontal overflow. Test files were removed and browser
network/viewport overrides restored. Evidence: `tmp/local-attachments/` contains
`browser-export.zip`, `browser-roundtrip.zip`, their canonical JSON manifests and
`offline-import-390.png`. These are local results, not deployed acceptance.

Composer uploads, draft attachment copying, linked galleries and account
attachment synchronization remain unfinished. Normal file-picker saving and native
image preview are covered by the checkpoint below. The
existing account upload permissions, access checks, moderation and signed byte
URLs are unchanged.


## Anonymous normal file UI and native preview — 2026-10-16

The existing Files browser now uses the anonymous workspace for **Add files**,
folders, downloads, copy and cut/paste. Each file is saved with canonical
attachment metadata and checksum-verified bytes in one transaction. A stable
request ID makes exact retries idempotent; changed retries, missing/corrupt bytes,
invalid placement, quota failures and cancelled writes fail explicitly. Empty
files are supported. Local limits remain 16 MiB per file and 64 MiB per workspace.
Paired-device discovery/commands require an account and never run in this adapter.

The existing shared-media URL resolver reads canonical local attachment references
from that same scoped store. It creates reference-counted object URLs for native
Thing/HTML/image/audio/video consumers without HTTP fallback. It bounds reads to
three concurrent files, 64 active references and 64 MiB, revokes URLs on release,
deletion and identity retirement, and reports missing bytes. HTML/SVG and other
non-preview files use opaque download MIME. Local `/media/:id` routes reuse the
normal Thing detail renderer; they do not invent a server social-post projection.
Local comments and media annotations remain unfinished.

Workspace API callback identities now remain stable within one identity. This
fixes repeated Thing detail fetches and React's update-depth failure, while
retired callbacks retain their original forwarding cell and workspace lease.

Local browser evidence: networking disabled, no account session, normal folder
creation and file picker saved a PNG, text file and zero-byte file. Downloaded
text and PNG matched the selected files exactly. Copy, cut/paste into another
folder, native image rendering and cold offline reload passed. The decoded PNG
was 360×240; its native preview fit 1440, 390 and 320 CSS-pixel widths with no
horizontal document overflow. Test data was deleted through normal Things menus;
network/viewport overrides were restored and the task tab closed. Evidence is in
`tmp/local-file-ui/`, including `browser-download.png`, `browser-download.txt`
and `offline-native-preview-390.png`. No account or public content was created.

Checks: 62 workspace/offline, 295 attachment, 315 Things and 48 component tests
passed; webpage/shared-media tests passed 152 with four existing skips. The client
build verified 231 assets (11,032,140 bytes). Raw TypeScript still reports the
same 91 baseline diagnostics, with no added diagnostic signatures. This is local
verification, not CI or deployed acceptance. Normal Things checkbox selection and
folder deletion semantics still need complete UI acceptance; the local adapter
currently refuses a nonempty folder unless explicitly recursive, while the generic
confirmation describes reparenting. Cleanup removed child files before folders.


## Anonymous composer, media drafts and posts — 2026-10-16

The normal PostComposer and attachment queue now use the anonymous workspace
identity and byte adapter. Save on this device validates the canonical post,
binds files and commits it atomically without waiting for draft saving. Account
posting still uses the existing authorized transport. Local posts are private
projections, do not enter the public feed and cannot target remote subspaces.
Local identity labels do not link to an unrelated `/profile/local` account.

Draft snapshots use the existing revision/write-id/tombstone protocol. Media
metadata and bytes share the workspace transaction and quota. Templates and
recovery copies receive new file IDs and remapped layout references. Only active
working drafts can donate their files to a post; cleanup preserves committed
files. Released unbound files expire after 24 hours and are reaped on later local
file/draft writes. No temporary account, server upload or publication is created.

Local production-build browser verification, no account and network disabled:
normal picker upload, draft autosave, post create/edit, cold reload, comment and
nested reply creation/reload, template creation/reuse and independent image
survival after original deletion passed. Existing-image editor tiles reuse the
native shared/local media resolver. Post GET restores relational comments; deeper
replies load on demand through the normal list adapter. 1440×1000, 390×844 and
320×844 had no document horizontal overflow. The audited template-edit/save
interval had zero network mutations; cached static assets and normal shell GETs
remain observable. Disposable posts/comments/template were removed and browser
overrides restored. Evidence: `tmp/local-composer-ui/verification.json` and native
screenshots in that directory.

Local checks: 68 workspace/offline, 26 drafts, 78 feed, 56 hooks and 295 attachments
passed. Canonical post/file export/import preserves exact bytes with fresh IDs.
TypeScript retains the same 91 baseline diagnostics, with no added signatures.
Client build verifies 231 assets (11,047,709 bytes). These are local results;
CI and preview acceptance must be tied to the pushed revision. Linked-media
minting, annotation, reactions/saves/polls, full signed-in offline posting and
account byte synchronization remain unfinished. The full matrix above still
blocks merge.

The normal offline import/export dialogs also passed an image-post ZIP with the
actual 14,451-byte PNG. Its browser download validated canonically and round-tripped
through the isolated normal importer with fresh IDs and identical bytes. The
validator receives verified attachment context; imported comment files retain
comment purpose. Evidence: `tmp/local-composer-ui/browser-image-post.zip`,
`browser-image-post.json` and `roundtrip-verification.json`.
