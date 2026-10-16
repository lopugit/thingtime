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
  and note queues. Account history discovers an authenticated remote scope; the anonymous
  adapter now has a separate browser-local authority (checkpoint below).
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
10,000 records, 1 MiB per ordinary JSON record, 16 MiB per file and 64 MiB per workspace (metadata and bytes together). Canonical Timeline event records alone allow the shared 4 MiB event ceiling plus receipt overhead; their relational links and headers count toward the same workspace quota. Failed saves report an
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
| Local storage and account boundaries | Unit-tested persistence, atomic rollback, concurrent edits, scope isolation and identity invalidation. Settings now shows scoped device usage and offers browser eviction protection without login, with offline reload, other-tab writes and failed-accounting browser checks. Finish broader multi-tab and account-switch regressions. |
| Builder pages | Live logged-out create, text edit, save and reload verified. Component reference maps now reuse canonical selection, with export/render agreement tested for versioned aliases. Finish responsive, component UI, global/site block and interaction checks. |
| Things and folders | Core CRUD, folder placement, cycle checks, copy/move/delete and portable text/component transfer implemented. Library text search now works across folders offline, with bounded cursor pages and visible error/retry states. Clean-browser acceptance covers 61 matches, kind filters, rename/reload and grid/list mouse selection at 1440/390/320px. The earlier checkbox report came from targeting its hidden input; clicking the visible label works, and descriptive labels/regressions now cover it. The native Search page now has a separate structured device view, with canonical field operators and credential-free anonymous online search (checkpoint below). Advanced shortcut filters/ranking, wider account discovery caching and remaining normal UI flows still require completion. |
| Drafts and templates | Shared snapshot/retry/conflict/tombstone semantics implemented locally and unit-tested. Post template creation, independent media copies and reuse pass offline browser checks. Schema builder/form recovery now passes offline reload and malformed-copy preservation checks (checkpoint below). Finish other definition recovery, media kinds and account draft sync. |
| Components and schemas | Local storage and public discovery adapter started. Bundled suite installation and the Web Standards editable component save/export now have offline browser evidence. The schema catalogue, schema authoring, copies and data forms now pass offline browser checks (checkpoint below). Component catalogue/detail and argument/version recovery now pass local offline browser checks (checkpoint below). Finish remaining Builder surfaces, account discovery caching and cross-tab UI refresh. Generic local Thing details now expose the standard discussion projection; comments, nested replies, search and owner rename pass a cold-offline browser regression. |
| Actions and app suites | Anonymous data Actions now reuse the canonical interpreter with local schema-scoped CRUD, nested runs, expressions and packs; pure browser flows reuse the browser interpreter. Native no-login create/edit/run/error/history/export/import verified offline. Local page component/collection sources now load and refresh after controls, with cold offline reload evidence. Bundled suites now install atomically offline; browser Actions have closed local Things CRUD and data-Action request adapters. Finish remaining endpoint adapters, dedicated component surfaces and account execution/sync. The actual opaque-origin Web Platform runtime now runs after a cold offline reload, including worker programs and native form events, with the existing sandbox and network restrictions. External lookups and public/system searches remain explicit remote requirements. |
| Timeline | Canonical anonymous revisions and authored draft admission now use transactional browser authority, the existing History UI and recorded native page previews. Owner notes now save/remove offline through the existing canonical queue and note contract. Version names now name/rename/clear through the shared mutation contract offline. Local variations now create, advance, checkout, edit and merge offline in History and the native Builder, including recorded-component conflict review. Ordinary current-content restore/undo/merge and deleted recovery now reuse the canonical account planner and atomic local writer; native offline restore/undo/merge/reload is verified. Historical version archive export now works offline through the shared account resolver, including compact ancestry, deleted before-images, names and notes. Page + related History now resolves stored local composition and arguments offline, with bounded membership, cursor resets and cold-reload browser coverage. The managed Timeline folder now appears in the local library and literal search, with native offline navigation and cold-rename coverage. Scoped device usage and browser protection controls are available in Settings. Protected-kind adapters and account synchronization remain required. Restored component detail/discussion/Action routing now uses scoped local records and local author projections, with offline regression coverage; IDs alone grant no local access. |
| Attachments and media | Anonymous canonical ZIP import/export/copy/delete now stores metadata and bytes atomically with shared quota accounting; normal UI offline round-trip verified. Normal file-picker save, download, copy/move and native image preview now pass offline browser checks. Native composer file selection and draft/template copies now pass offline browser checks. Finish linked galleries, media annotation/audio/video acceptance and account sync. Never treat a cached cloud attachment as locally authorized bytes. |
| Posts, comments and saved items | Native local post create/edit, image attachments, comment/reply reads and writes pass offline browser checks. Saved items, emoji reactions and poll cast/change/removal now pass native offline browser checks; up/down votes and scoped relational storage pass adapter tests. Linked Things, cross-account/multi-tab browser acceptance and complete account sync remain. Public posting, remote reactions and recipient delivery remain authenticated operations. |
| Themes, visual settings and algorithms | Anonymous saved-theme CRUD, active selection, quota and canonical transfer now work through Theme Studio and have offline browser evidence. Anonymous algorithms now support local CRUD/branching, active selection, bounded public-feed training, per-page ranking and canonical JSON round-trip. Account theme/algorithm sync, local Timeline history and cross-tab acceptance remain outstanding. |
| Passwords | Audit and implement local encrypted storage/unlock using the existing vault contract. No plaintext substitution or server-password bypass. |
| Apps, integrations and native/browser tools | Separate locally available adapters from paired remote devices, external services and their consent requirements. Verify each applicable local surface. |
| Lopu and automation | Local documents, authored definitions and drafts should remain editable. Lopu toast/stream messages now persist locally and have a device-history view; verified account messages sync through the existing recorder. Remote social history caching, retry controls and cross-tab history refresh remain unfinished. Provider inference, external delivery and hosted scheduled execution still need their real services. |
| Auth, social, remote devices, billing and admin | Remote authority is retained. Do not substitute a local actor for a signed-in account. |
| Offline startup | Verified static-shell cache implementation and policy tests added. Production-build offline reload, editing, save and second reload passed in a clean local origin. A rebuilt shell also passed account cold reload/edit/reload with no networking. Continue update recovery, cross-account coverage and real-device startup verification. Chromium offline-emulation module cancellations remain under investigation; request blocking is no longer accepted without its root-read failure probe; the latest checkpoint defaults to actual offline emulation and retains failures as merge gates. |
| Signed-in local-first operation | Owned data/folder/page/component/schema/Action creates and updates now have an atomic account-scoped queue, immutable ambiguous retries, conditional updates and reviewed conflict choices. Native Builder resolves pending pages locally. Local fixture create/edit/reload/reconnect and conflict review passed. Account offline cold startup, native page editing and reconnect verification now pass locally. Ordinary account bulk moves now commit locally with queue intent, survive cold offline folder reload, and sync conditionally after verified reconnect. Ordinary account deletion and Builder reset now commit locally, retain conditional deletion intent and expose reviewed conflicts (checkpoint below). Ordinary JSON imports now create private independent local copies with atomic queue intent and verified canonical server round-trip (checkpoint below). Ordinary JSON downloads now use device content and complete scoped export snapshots, with native offline dialog/download/reload and normal-importer round-trip evidence (checkpoint below). Complete file/managed imports, protected-kind deletion/moves, attachments, all dedicated adapters, full cached-list membership/pagination and multi-tab UI refresh before merge. No anonymous sync queue may be replayed as account content. |

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

## Anonymous interactions checkpoint — 2026-10-16

`LocalInteractions` uses the normal emoji validator and poll/up-down contracts.
Each reaction, bookmark and vote is a separate scoped child Thing. Generic
CRUD/import cannot mint the managed slots, content export omits local activity,
and deleting content cascades its interaction children. Limits and replacements
share the same atomic transaction/quota boundary as other local Things. Account
interactions still use authenticated endpoints; this does not implement their
future local-first sync adapter or let anonymous users mutate remote posts.

The existing Saved page is available from the logged-out drawer. Its synchronous
cache is keyed by anonymous/account origin, owner and data plane; changing the
scope remounts its state and retires in-flight reads. Native PostCards keep their
optimistic interaction behavior. One target index serves the whole saved page.

Local production-build browser acceptance with no account and networking disabled
covered native poll creation, vote changes/removal, emoji addition/removal,
bookmarking, Saved navigation, reload and unsaving. Deleting the disposable post
removed it from Saved. 1440×1000, 390×844 and 320×844 measurements show no document
horizontal overflow. Evidence: `tmp/local-interactions-ui/verification.json` and
`saved-{1440,390,320}.jpg`. The recorded interaction interval contains no mutation
requests; offline public-marketing GET attempts are separate background reads.
The fixture was removed and temporary browser overrides restored.

Up/down semantics, reaction limits, invalid inputs, cursor behavior, account/
remote-ID refusal, cross-tab transactions, rollback and portable-export exclusion
are covered by `interactions.test.ts`; `api.client.test.ts` proves the facade
uses no remote calls and rejects retired callers. Signed-in sync and the full
matrix remain required before merge. CI/deployment evidence is separate.


## Anonymous Action execution checkpoint — 2026-10-16

`app/actions/runtime.ts` is the existing bounded data interpreter extracted behind
storage/service ports. The account host in `api/utils/actions/execute.ts` retains
its authentication, ACL, Vault, public/system query, Timeline admission/outcome
and notification boundaries. The anonymous host in `local-workspace/actions.ts`
uses only its isolated workspace and the normal local Thing validator/writer.
It re-sanitizes stored programs, resolves schemas and latest Action keys locally,
shares nested operation/expression budgets, pins writes to a current lease and
deadline, and allows at most four concurrent runs per browser database instance.
No Action is queued for remote replay.

The native Actions list, inspector, full program composer and shared definition
editor accept local content ownership. Views and caches are keyed by the full
workspace partition. Definition drafts use the existing local draft adapter;
anonymous edits do not require an account Timeline. Delegated clicks can run
locally owned Actions, but cannot reach cloud install fallbacks. Automatic
component/collection source gates and local suite installation still need work.

Execution details are protected relational `action-run` children, capped at 50
per Action and omitted from ordinary reads/lists, imports and portable exports.
Deleting an Action cascades its details. A run finishing after deletion cannot
recreate orphan history. Failure to save execution details reports `historyError`
without retrying the already completed program. This debug trail is not yet
canonical local Timeline history.

Pure browser Actions use `executeBrowserAction`. Browser request steps explicitly
refuse until their dedicated local endpoint adapter exists. Public/system data
searches and Vault lookups also refuse locally without a request or credential
fallback. Account Actions retain their existing authenticated execution path;
account offline execution/sync remains incomplete.

Local automated checks: 80 workspace/offline-shell, 156 Action (one opt-in skip),
56 hooks, 44 autosave, 27 draft and 315 Things checks passed. The existing live
`verify-actions.mjs` passed 100/100 against the disposable local server, covering
account permissions, private creation, nested budgets, recursion and protected
history. Raw TypeScript retains the 91-diagnostic parent baseline; it is not clean.

The production-build browser at the isolated local origin verified no-login
creation, pure execution, cold offline reload, definition editing, invalid JSON,
a deliberate execution failure and persisted details. Normal JSON download and
import produced a new local ID; the copied Action returned the same expected
failure. The canonical validator accepted the download with one editable Action,
no account authority and no run history. Desktop 1440×1000, 390×844 and 320×844
had no horizontal overflow. Both disposable Actions were deleted and a fresh
Actions list confirmed cleanup. Evidence lives in `tmp/local-actions-ui/`.
The complete initial create/run network interval contained zero mutation
requests; the longer edit/import event buffer was truncated, so it is not a
complete network transcript. Those operations ran with networking disabled.
Browser overrides were restored and task-created tabs closed.

The generic Thing page still reports unavailable comments and omits owner menu
operations for local Action Things; the Things library supports their deletion.
Those shared-surface gaps remain in the broader rollout. CI and branch-preview
checks are separate from this local acceptance; this checkpoint is not deployed
feature acceptance and does not make the full-suite PR merge-ready.


## Local page sources checkpoint — 2026-10-16

The real page runtime now separates content-workspace availability from account
sign-in. Anonymous owned pages run saved source Actions through the existing local
API adapter. `viewer.signedIn` remains false; this does not grant server authority.
Component and collection hooks retain sibling-load deduplication, bounded paging,
retry behavior and refresh after a control completes. Disabled Builder previews
remain inert. Shared-root runs retain their separate server-authorized path and
never read or write the owned source cache.

Source cache entries now use the full account/origin/data-plane or anonymous
partition rather than an account ID alone. Old unqualified entries are not
adopted. Runtime results, last-control state and local form state retire on a
workspace boundary. The transport's existing lease remains the final authority.
This change does not implement offline account Action execution.

Local production-build acceptance imported a six-Thing canonical fixture through
normal Transfer (schema, Data, two Actions, Component and webpage). With no login,
the source Component and its native Collection rendered the saved Data. With all
networking disabled, a delegated control updated it and both sources refreshed;
a cold offline reload retained the new value. 1440×1000, 390×844 and 320×844 CSS
viewports had no horizontal overflow. The complete recorded update/reload interval
had zero mutation requests. Only disposable local fixture Things were changed.
Evidence: `tmp/local-sources-ui/verification.json` and `offline-sources-*.png`.

Regression coverage: 445 automated checks passed across webpages, Actions,
workspace/offline shell and hooks, plus one real-browser lifecycle regression
(`sourceWorkspace.browser.test.ts`) against Vite. It covers anonymous execution,
sibling deduplication, refresh, inert mode, malformed collection output and
workspace retirement with all API requests refused. Cache tests cover account,
origin and data-plane isolation. Raw TypeScript retains the same 91 baseline
diagnostics; changed-file lint is clean. Client build: 237 verified offline assets.
These are local checks; deployed and full-suite acceptance remain incomplete.


## Bundled suites and local browser requests — 2026-10-16

`schemas/suiteInstallation.ts` shares the existing materialization and installation
plan between the authorized server and anonymous storage. The local adapter runs
the entire install in one transaction, reuses the normal validators/quotas, binds
page component IDs, and preserves seeded sample edits on reinstall. Only-missing
installation preserves authored definitions. Canonical normalization happens
before comparison so repeated installs do not rewrite unchanged content.

The normal demo gallery installs bundled definitions without an account or a
catalog request. Browser Actions reuse their existing interpreter and saved
capability grammar. The local request host accepts only supported versions of
Things CRUD (editable definitions, Data and folders) and data-Action execution.
It never fetches; remote IDs, public ACLs, ownership fields, protected-kind writes
and unsupported services fail explicitly. Identity retirement and cancellation
fence writes. Browser composition keeps its existing shared budgets. Account
installation still uses the authorized endpoint, with expected actor/data-plane
headers, identity cancellation and a bounded request. Account offline installation
and suite sync remain unfinished.

A clean production-build browser with `user: null` installed Web Standards while
fully offline, edited a button, saved it through the suite's browser Action,
opened the native Component and cold-reloaded it with the edited input intact.
The complete automated request capture contained zero network mutations. Normal
Transfer downloaded an eight-Thing JSON bundle; canonical validation and isolated
normal import remapped every ID, preserved the input and ran the catalogue Action.
Re-exporting the page collected its six referenced dependencies/root; the older
unreferenced save-component Action and independently saved button remain separate.
Manual 1440×1000, 390×844 and 320px checks found no horizontal overflow.

**Historical runtime gate (resolved by the next checkpoint):** Chromium's opaque-origin Web Platform iframe cannot
load through the app service worker while disconnected. Run example reports the
existing runtime-load error; it does not return a fabricated result. With network
restored, the actual isolated runtime rendered the button and returned an
HTMLButtonElement. Sandbox permissions and CSP were not relaxed. Vite preview now
applies the same existing isolated-runtime CSP as development. Local Component
comments still show a read error and need their own adapter work.

Local verification: 456 passing workspace/offline-shell, webpage, Action, hook
and media-cache tests, plus two explicit browser tests; seven opt-in skips in
the ordinary suites. The existing server app-suite fixture passed 53/53 against
disposable local Mongo. Targeted lint has no errors (one pre-existing constructor
warning). Raw TypeScript retains the 91-diagnostic baseline. The production
client build has 243 verified offline assets. These are local results, not CI
or deployed acceptance of the complete feature matrix.

Run the opt-in browser test against a production client served on an isolated
localhost origin, with its normal API pointing at disposable test data:

```sh
TT_LOCAL_SUITE_URL=http://127.0.0.1:22470 \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
TT_LOCAL_SUITE_ARTIFACTS=../tmp/local-suites-ui \
  corepack pnpm --dir remix exec node --import tsx --test app/local-workspace/suites.browser.test.ts
```

Evidence: `tmp/local-suites-ui/native-suite-export.transfer.json`,
`roundtrip-verification.json`, `browser-verification.json`,
`offline-saved-component.png`, `offline-component-1440.png`,
`offline-component-390.png`, `offline-component-320.png` and
`online-native-runtime.png`. Manual PNGs are lossless format conversions of the
actual browser JPEG captures, without resizing or redrawing. The eight manual
production-origin fixture Things were deleted; the pre-existing page was retained.


## Offline Web Platform execution — 2026-10-16

The native `WebPlatformSurface` now embeds the exact compiled `runtimeEntry.ts`
renderer as a build-produced `srcdoc`. Opaque-origin frames cannot load through
the application service worker, so caching the old runtime URL was insufficient.
Caller programs remain data sent through the existing validated message protocol;
no caller content enters the document template. Workspace changes retire the frame.

The iframe keeps its opaque origin and existing sandbox. Its CSP permits only
the exact hash of the compiled script, preserving the existing connect, form,
worker and resource restrictions. Production application CSP adds that same hash
so the inherited policy permits the trusted renderer; it adds no inline, eval,
blob-script or wildcard permission. Embed and inert draft bundles retain the
standalone runtime URL. The build checks the deployed hash against its output.

A clean browser using the production CSP installed, edited, ran, saved and
cold-reloaded a Web Standards Component entirely offline. The actual runtime
returned `HTMLButtonElement`. Worker execution returned 42; native form events
cancelled navigation; authored failures were reported; Stop removed the frame
and output. After reconnecting, security probes still could not access the parent,
cookies or local storage, run arbitrary inline JavaScript or fetch a same-origin
URL. The complete capture contained zero mutation requests and zero escaped
probe requests. Manual 1440×1000, 390×844 and 320×844 viewports had no horizontal
overflow. Eight disposable manual fixture Things were removed; the existing page
was retained. Local Component comments still show a read error and remain open.

Normal Transfer downloaded `tmp/offline-platform-ui/native-export.transfer.json`.
Canonical validation and normal import in an isolated local fixture produced a
fresh ID and preserved the editable program and exact “Running entirely offline”
input. Native PNGs, `browser-verification.json` and `runtime-boundaries.json` live
alongside it. Mobile PNGs are full-page captures at the documented CSS viewport;
manual PNGs are format conversions of browser captures without resizing/redrawing.

Run the existing `suites.browser.test.ts` command above with
`TT_LOCAL_SUITE_ARTIFACTS=../tmp/offline-platform-ui` to repeat the production-CSP
browser check. These are local results. Account suite sync, remaining request
adapters and the full feature matrix are still required before merge.

Local verification for this checkpoint: 280 passing automated checks across Web
Platform, workspace/offline shell, draft preview, embed and build/CSP suites,
plus one explicit production-browser regression; two opt-in skips in ordinary
suites. The watcher lifecycle test uses isolated real filesystem output and
checks invalidation, reload and unchanged asset re-emission. Changed-file lint
has no errors. Raw TypeScript matches the same 91 baseline diagnostics. The
production client build contains 245 verified offline assets (21,139,396 bytes).
The full client/server build, Vercel output patch and output verification also
passed locally, including the packaged runtime/CSP hash check. No deployment was
performed by that build.

The original no-login acceptance also passed again after this build: two real
MCP/running-app browser tests verified exact affirmation text, native desktop,
390px and 320px PNGs, card crop, canonical dependencies and explicit invalid/
invisible/overflow failures. The exported JSON is byte-identical to the previous
acceptance export. The normal server importer round-trip passed against the
isolated local draftPreview replica: fresh IDs, remapped dependency, private ACL,
anonymous 404s and canonical re-export. Both imported Things were deleted and the
synthetic fixture logged out. Current artifacts: `tmp/offline-platform-affirmation/`.
This does not connect a web-only agent host to local stdio; the documented host
bridge requirement remains.


## Generic Thing discussions and rename checkpoint — 2026-10-16

Local Component, Action and Data reads now supply the same separate discussion
companion as ordinary server Thing reads. Comments remain relational child Things,
read in bounded cursor pages rather than embedded recursively. One target index
is shared across each comment page. Anonymous public discussion reads continue
through the credential-omitting public adapter, including share keys and cursors;
local identities still cannot comment on remote Things.

The shared detail menu uses workspace content ownership for local rename and
lets the selected API adapter negotiate remote capabilities. Local rename no
longer waits for a remote manifest or triggers an account root refresh. History
and recording handoff continue to require real account authentication. Discussion
and menu state retire on full workspace identity changes, including data plane.

Local verification: 536 passing workspace, feed, Things and hooks checks, two
opt-in browser skips, plus the explicitly enabled production-browser regression
in `app/local-workspace/details.browser.test.ts`. The clean context had no account
session. Import, comment, nested reply, rename, cold reload and comment search
completed offline with zero mutation requests. Measured 1440×1000, 390×844 and
320×844 views had no horizontal overflow. Evidence lives in
`tmp/local-details-ui/` (native PNGs and `browser-verification.json`). Changed-file
lint has no errors; raw TypeScript retains the same 91 baseline diagnostics.
The production client build passed. These are local results, not deployed proof.

Run that opt-in regression with `TT_LOCAL_DETAILS_URL` pointing to the isolated
loopback production preview, `TT_SHARED_PLAYWRIGHT_PATH` to the installed
Playwright module, and `TT_SHARED_CHROME_PATH` to its Chromium executable; set
`TT_LOCAL_DETAILS_ARTIFACTS` to an output directory. Use the same production CSP
and offline-shell setup as the existing browser checks above.

This closes the Component comments-read error. Account discussion sync, local
Timeline authority and other matrix items remain unfinished. Saved currently
lists post-shaped targets, matching the server's existing contract; generic
Component/Data bookmarks are not yet surfaced in that list.


## Library search checkpoint — 2026-10-16

The existing Things library search now calls the current workspace adapter with
an explicit `workspace: true` option. Anonymous search reads only the scoped local
snapshot and never sends an account request. It searches authored crystal/tag
strings literally, case-insensitively with Unicode normalization, across folders.
It excludes activity rows and draft/attached files using the same visibility
predicate as normal library listing. Text is limited to 200 characters, kinds to
20, and pages to 50; cursors bind the query and kind filter. This is library text
search, not the separate public/structured search contract.

Confirmed account searches paint cached owned content first and refresh through
the existing owner-filtered API. Only supported owned kinds enter the local cache;
unsynced edits win over older remote hits. Pending and server results retain
independent continuations, so neither truncates the other. Offline results are
explicitly incomplete. Failed refresh keeps existing content visible with Retry;
query, workspace, data-plane and identity changes retire old responses. Local
substring matching and server relevance matching retain their existing different
semantics. The shared search transport strips the client-only workspace flag.

Clean production-browser verification passed both anonymous and disposable
account paths. Anonymous import of 61 nested Things, two-page search, kind filter,
offline rename, cold reload, oversized-query error and visible checkbox selection
made zero mutation/search requests. Native 1440×1000, 390×844 and 320×844 views
had no horizontal overflow. Account search loaded two private synthetic Things,
retained them under an injected 503, and found them after a cold offline reload;
the final run deleted both through the normal API and logged out. An earlier
cleanup-test failure left two synthetic Things in its separate disposable local
account; no existing account or public content was modified. Empty fixture accounts
remain in the disposable replica. The account offline screen still shows the
existing remote-computer refresh error; native/remote device work is a separate
matrix item.

Evidence: `tmp/local-search-ui/` (native PNGs and separate anonymous/account
verification reports). Run `app/local-workspace/search.browser.test.ts` with
`TT_LOCAL_SEARCH_URL` set to the isolated loopback production preview and the
shared Playwright/Chromium variables above. Set `TT_LOCAL_SEARCH_ACCOUNT=1` only
for the disposable local account fixture; `TT_LOCAL_SEARCH_ARTIFACTS` chooses its
output directory. Ordinary suites skip these browser checks.

Local validation: 463 passing workspace/offline-shell, Things and hooks tests,
four opt-in skips, plus both explicitly enabled browser tests. Changed-file lint
has no errors. Raw TypeScript retains 91 existing diagnostics; the new file
annotation test's missing typed stub was repaired. The production client build
passed with 245 verified assets (21,148,320 bytes). This checkpoint also preserves
the review bot's local-file annotation adapter and regression. Full account sync,
canonical local Timeline and other matrix items remain required before merge.


## Canonical local Timeline checkpoint — 2026-10-16

Ordinary anonymous Thing create/update/delete/import changes append the existing
canonical Timeline event, receipt and individual relationship records in the
same browser transaction as content. The shared `thingContentSnapshot` projection
is now browser-safe; the server keeps its existing behavior. Anonymous snapshots
carry no account audience. The local authority uses `local-workspace` for its
owner and data plane; these local ordering receipts are never uploaded or treated
as account authorization. No account writer has been redirected to this namespace.

`local-workspace/timeline.ts` reads authoritative history from scoped workspace
records, while the existing Timeline IndexedDB store remains an evictable view
and pending queue. Corrupt/missing links, mismatched index metadata, changed retry
payloads, missing ancestry, wrong scope, retired identities and aborted requests
fail explicitly. Pages contain at most 40 entries within the shared event-size
budget; component batches have a 4 MiB ceiling. Workspace record/byte quotas still
apply. A history write failure rolls back the associated content write.

Page versions use the same local component resolver as live pages and the shared
component-capture contract. Unchanged captures are reused, and deleted pages keep
their saved dependencies. The native preview stays inert. Local History labels
say saved on this device, never synced to account. Connection transports retain
the API facade that created them; a later login cannot redirect an anonymous
queue into account APIs. Unsupported commands return explicit 422 refusals, not
an authentication prompt or a cloud fallback.

Local verification: 652 passing workspace/offline-shell, Things and shared
Timeline tests, five ordinary opt-in skips, plus one explicitly enabled clean
production-browser test. It imports a page/component through the normal importer,
renames offline, opens the recorded native preview, and repeats after a cold
offline reload. It observes zero mutation requests, zero account Timeline calls
and zero page errors. Native 1440×1000, 390×844 and 320×844 views have no horizontal
overflow. The in-app Browser separately verified the logged-out History UI and
recorded preview. Evidence: `tmp/local-timeline-ui/` (PNGs, manual JPEGs and
`verification.json`). Changed-file lint has zero errors and three constructor
warnings; raw TypeScript has exactly the same 91 diagnostic identities as the
preceding checkpoint. Production client build succeeds. These are local checks,
not proof of CI or deployed behavior.

Run `app/local-workspace/timeline.browser.test.ts` with `TT_LOCAL_TIMELINE_URL`
pointing at the isolated loopback production preview, the shared Playwright and
Chromium variables used above, and optional `TT_LOCAL_TIMELINE_ARTIFACTS`. The
test owns a clean anonymous context and writes no account data.

This is not the completed Timeline feature: the folder ID currently identifies
the History route, not a persisted protected Timeline folder. Named branches,
notes/version names, restore/merge, version export, related composition history,
protected-kind histories, full account local-first synchronization and storage
cleanup at quota remain on the merge gate. Ordinary draft admission is covered
by adapter tests; every editor's draft-recovery lifecycle still needs its own
acceptance coverage. Existing history is not reconstructed retroactively.


## Local History notes checkpoint — 2026-10-16

Anonymous History's Message tab now saves and removes owner notes through the
existing canonical `TimelineNote`/command/result contract and queue. Each note
is a separate relational workspace record, never an array on a Thing or event.
Pages batch notes once and include their UTF-8 bytes in the response limit.
The shared eight-note cap is enforced in the same serialized transaction as the
write, including simultaneous browser connections. Invalid targets, changed
retries, damaged stored records, aborted operations and retired identities fail
explicitly. Removal records a small internal marker without note text so delayed
adds cannot resurrect a removed note; markers count toward workspace quota.
Quota failure rolls back both removal and its marker. Account note behavior is
unchanged. Provider-generated explanations remain an explicit remote requirement.

The normal UI reports device-only saves/removals. A refused command retains its
text with Retry/Dismiss controls without making the whole History unavailable.
Local tests: 105 workspace/offline-shell and 238 shared Timeline passes, five
ordinary opt-in skips, plus one explicitly enabled production-browser pass.
That clean context verifies offline import/rename, save-note/reload/remove,
rejection and dismissal of a ninth note, and the recorded native preview at
1440×1000, 390×844 and 320×844. It observes zero account Timeline requests,
zero mutation requests and zero page errors. The in-app Browser also verified
normal note editing and the three layouts. Evidence is in
`tmp/local-timeline-notes-ui/`, including `verification.json` and native PNGs.
The production client build passed (245 assets, 21,159,536 bytes); changed-file
lint has zero errors and one constructor warning. Raw TypeScript remains at the
same 91 diagnostic identities as the preceding checkpoint. These are local
checks, not CI or deployed verification. Version names, branches and the other
outstanding rows above remain on the full rollout's merge gate.


## Local History version names checkpoint — 2026-10-16

The normal Versions tab can name, rename and clear anonymous saved versions
without network access. `timeline/versionNameMutation.ts` now holds the shared
mutation planner and replay semantics used by both the existing server service
and the browser adapter. Canonical version names remain separate relational
records; each actual change appends the same immutable effect contract. Local
`source: api` means the local API authority in the isolated local data plane,
not an account receipt or permission. Anonymous receipts never sync to accounts.

Commands use identical canonical SHA-256 signatures. Hashing finishes before
opening the browser transaction. Names, effects, links, ordering and monotonic
clear/recreate metadata commit together. Concurrent edits require the current
revision; retries return the original receipt without overwriting a later name.
No-op names/clears retain the existing server semantics and append no event.
Name records are batched beside selected History entries and count toward page
byte limits. The mounted name editor retains an uncertain request identity for
retry; this is not a durable account name queue or lost-process recovery.

Local verification: 110 workspace/offline-shell and 238 shared Timeline tests
passed, with five ordinary opt-in skips. The explicitly enabled production
browser test passed offline name/rename/reload/clear/reload, notes and recorded
native previews, with zero account Timeline calls, mutation requests or page
errors. Layout checks cover 1440/390/320px; the in-app Browser separately verified
naming and all three layouts. Evidence: `tmp/local-version-names-ui/`.
The real server version integration passed against the disposable loopback
Mongo replica, including canonical naming, concurrency, replay, undo/export and
private access. Its previously mismatched retry ID was corrected, and created
Things now clean up in `finally`. The initial attempt before that cleanup fix
left two synthetic private Things in a disposable test account; no existing
account content was changed. The successful rerun cleaned its own Things.

Production client build: 245 verified assets / 21,163,888 bytes. Application lint
has zero errors and one constructor warning; the `.mts` integration test uses
an explicit TypeScript ESLint parser. Raw TypeScript has the same 91 diagnostic
identities as the previous checkpoint. These are local checks, not deployed
acceptance. Account Timeline offline writes/synchronization and the remaining
full coverage matrix still block completion and merge.


## Local variations checkpoint — 2026-10-16

Anonymous History can create a named variation, edit its fields, open its exact
recorded head in the native Builder and save further edits while offline.
`timeline/branchMutation.ts` and `timeline/versionGraph.ts` share canonical
operation receipts, revision checks, bounded ancestry and historical content
materialization with the existing account services. The account services retain
protected Mongo writers, transactions, storage accounting and authentication.

`local-workspace/timelineBranches.ts` stores the same canonical branch and
per-Thing head records separately in the anonymous partition. A small separate
index retains creation receipt positions for stable pagination. Effects, links,
heads, metadata and quota commit together. A lost reply replays its original
receipt; stale or divergent advances fail without replacing either version.
The ordinary durable branch queue and working copy are reused. Checkout resolves
recorded ancestry and components; it never borrows the current Thing. Browser
routes admit the explicit local owner/plane pair without widening the account
source validator. Actions and live data remain paused in branch previews.

Verification: 116 workspace/offline-shell and 238 shared Timeline tests passed,
plus three focused Builder contract tests. Five ordinary opt-in browser tests
skip unless enabled. The explicitly enabled clean production browser test
passed offline variation creation, field edits, native Builder save/reload,
recorded component rendering, unchanged current content, and 1440/390/320px
layouts. It observed zero HTTP mutations, account Timeline requests or page
errors. Manual in-app Browser checks separately confirmed the same native
branch path. Artifacts: `tmp/local-branches-ui/`.

The real account API regression passed on the disposable local replica with
create/replay/CAS/ancestry/checkout, stale-head errors and anonymous 401s.
Run `node --import tsx scripts/timeline-branches.integration.mts` from `remix`
with `TIMELINE_TEST_BASE` pointing to a disposable loopback app. Its default DB
guard expects `127.0.0.1:20337` / `timeline-rs`; an explicitly isolated fixture
can supply `TIMELINE_TEST_MONGO_HOST` and `TIMELINE_TEST_REPLICA_SET`. The test
creates its own account and private Thing and deletes only that Thing in
`finally`; its test account and canonical audit history remain in the disposable
DB. No pre-existing account is read or changed.

Production build: 245 verified assets / 21,173,785 bytes. Raw TypeScript retains
the prior 91 diagnostics; application lint has zero errors and one existing
constructor warning. These are local checks, not deployed acceptance. Account
Timeline synchronization, branch merging, restore/export and the full remaining
coverage matrix still block completion and merge.


## Canonical local branch merges — 2026-10-16

Anonymous History can now compare a selected saved version with a named variation,
resolve content and recorded-component conflicts, preview through the native
renderer, and save through the existing durable event/branch queue. The shared
`timeline/branchMergePreview.ts` contains the existing account comparison rules;
`recordedComponentReader.ts` preflights the complete component byte budget before
payload reads. Account readers remain owner-scoped and authenticated. The local
adapter uses one read-only anonymous workspace transaction and never reads live
account Things or executes Actions. Applying retains the canonical merge event
before the existing revision-fenced branch command. A stale head preserves the
proposal without overwriting the newer branch or current Thing.

Local verification: 121 workspace/offline-shell and 238 shared Timeline tests
pass, with five ordinary opt-in skips. The explicit production-shell browser
check passes offline conflict review, native preview, save and cold reload at
1440/390/320px with zero HTTP mutations, account Timeline requests, page errors or
document overflow. Manual in-app Browser review/save also passed. Evidence:
`tmp/local-branch-merge-ui/verification.json`, `branch-merge-1440.png`,
`branch-merge-390.png`, `branch-merge-320.png`, and manual phone screenshots in
that directory. The browser test now waits for the branch row before choosing
its merge control and waits for asynchronous note removal to finish repainting.

The guarded real API branch regression also passes comparison, explicit conflict
choices, canonical merge upload, idempotent head advance, cold checkout, stale
preview refusal, unchanged current Thing and anonymous 401s. It uses only a new
synthetic account on the disposable loopback replica and cleans up its created
Thing in `finally`; that test account and immutable audit remain in the fixture
DB. No existing account data was changed.

Build: 245 verified assets / 21,181,018 bytes. Targeted lint has zero errors and
one existing constructor warning. Raw TypeScript retains the exact same 91
baseline diagnostics. This is local verification; CI and deployed evidence are
separate. Current-content restore/undo/merge, historical export, related history,
protected histories/folder, account sync and the full remaining local-first
matrix are unfinished. PR #1000 remains open; do not merge this checkpoint.


## Canonical local restore, undo and current-content merge — 2026-10-16

Anonymous History now applies saved ordinary Thing versions offline, including
restore, undo of one saved edit, current-content three-way merge and deleted
Thing recovery. `timeline/versionPlan.ts` extracts the existing account planner;
`publishedComponentTools.ts` shares component choices, bounded hash preimages,
copy identities and composition rewriting. The canonical request signature and
receipt format are unchanged. Account authentication, protected writers and
transactional component rechecks remain in the server adapter.

`local-workspace/timelineVersions.ts` plans through anonymous readers, performs
WebCrypto hashing outside IndexedDB transactions, then rechecks the content head,
updated timestamp and complete component comparison preimage in the write
transaction. `LocalThings.versionTransaction` reuses normal validation, placement,
quota and canonical capture. Restored components are independent validated Things
with the same deterministic SHA-256 identities as the account planner. Content,
copies, events and head changes commit together. Retries return the original
receipt even after later edits; stale revisions or components never overwrite
newer content. Abort or receipt failure rolls back the complete operation.
Deleted recovery uses a recorded main deletion and the original identity; a
missing folder falls back to Things. Anonymous content stays on this device.

Verification: 134 workspace/offline-shell and 238 Timeline tests passed, five
ordinary opt-in skips. Thirteen new local cases cover restore/replay/CAS, undo
choices, independent merges, recorded copies/cold storage reopen, current mode,
missing definitions, deleted recovery, concurrent submissions, component changes
between plan and commit, schema validation, rollback and cancellation. The clean
production-shell browser passes offline undo, current merge, recorded restore and
native Builder cold reload at 1440/390/320px with zero HTTP mutations, account
Timeline requests, page errors or document overflow. Manual in-app Browser restore
and native Builder reload also passed. Evidence: `tmp/local-restore-ui/`.

Both guarded real API integrations (`timeline-versions` and
`timeline-published-components`) passed against the disposable loopback replica,
including undo/export parity, independent component copies, stale fences, exact
retries and atomic copy rollback. They create synthetic accounts and clean up
only their own Things; test accounts and immutable audit remain in that fixture
DB. No existing account data was changed. Replica host/name can be supplied
explicitly; defaults retain the original test replica. See README.

Build: 245 verified offline assets / 21,198,448 bytes. Raw TypeScript retains
exactly the same 91 baseline diagnostics. Targeted lint has zero errors and three
constructor warnings (two existing, one new TypeScript parameter-property
constructor). These are local checks, separate from CI and deployment. Historical
export, related history, protected-kind adapters/folder/storage controls, account
Timeline sync and the remaining local-first matrix are still unfinished. Do not
merge this checkpoint.


## 2026-10-16: offline historical version archives

The existing Versions → Export control now uses anonymous authority through
`LocalTimeline.exportVersion`. `timeline/exportVersion.ts` is the shared account
and local resolver; the server remains behind its existing authentication,
selected-plane checks and export rate limit. The local adapter takes one readonly
workspace transaction for retained content, notes and names. It never reads the
current Thing to fill missing history and makes no account requests. Compact
folder revisions resolve their recorded ancestors; deletion exports the saved
before-image. Missing/unsupported ancestry, non-revision events, retired scopes,
invalid IDs and cancellation refuse. Large snapshot references are checked before
parts reads; the final archive has the existing 4 MiB ceiling. A download cannot
start after its version editor has unmounted.

History archives retain the existing `formatVersion: 1` record: immutable event
and receipt, resolved content, notes and name. Dependency links remain references;
they are not a self-contained transfer bundle. To make a historical page portable,
restore its recorded components, then use normal Thing export. The round-trip test
uses the normal importer in an independent workspace, verifies remapped IDs and
recorded component text, and leaves the formerly shared component unchanged.

Local evidence: six export tests, 378 workspace/Timeline passes in total, a clean
production-shell offline browser download, and manual in-app Browser export. The
actual JSON and screenshots are in `tmp/local-history-export-ui/`. The browser
retains the existing 1440/390/320px restore/merge/reload checks and reports zero
account Timeline requests, mutations, page errors or document overflow. The real
`timeline-versions.integration.mts` account regression passes against the guarded
disposable loopback replica, including export privacy and rate limits. Build:
245 assets / 21,200,676 bytes. TypeScript retains the identical 91 baseline errors;
targeted lint has zero errors and one existing constructor warning. CI and deployed
verification are separate. The full matrix above remains incomplete.


## 2026-10-16: restored component routing

Restored copies use the canonical account planner's `restored-` identity format.
Local reads and discussions now check the active anonymous partition instead of
assuming every local Thing starts with `local-`. Retained History heads keep
deleted local identities from falling through to public reads. Public restored
IDs still use the credential-free public transport; an account partition never
supplies anonymous content or write authority. Routing rechecks the workspace
lease after asynchronous lookup.

The normal detail page uses workspace ownership for editable local content.
PostCard's local comment/reply controls require a local author projection matching
the anonymous workspace, rather than a prefix. Local Action requests and
interactions still resolve their target in the scoped store, enforce supported
kinds and use the existing atomic writer; they never fall back to HTTP.

Four focused regressions cover a real recorded-component restore, read/comment/
reaction/save/rename/delete, browser Action GET/PATCH/DELETE, account partition
isolation, public reads, deleted identities and identity changes during lookup.
The clean production-shell History test passed restore → Things detail → native
preview → comments/reply → Rename → cold reload at 1440/390/320px, with no
horizontal overflow, HTTP mutations, account Timeline requests, restored-ID public
reads or page errors. Manual in-app Browser verification passed the same detail
editing/reload at 390px. Workspace/offline-shell, Timeline and feed: 460 passes,
five ordinary opt-in skips; both History and ordinary-detail browser tests were
run explicitly and passed. Final build has 245 verified assets / 21,201,007 bytes;
TypeScript remains at 91 identical baseline diagnostics, lint has zero errors
and two existing warnings. Evidence: `tmp/local-restored-routing-ui/` and
`tmp/local-restored-routing-details/`. See the PR checkpoint for the earlier
unclassified offline startup failure and the separately tracked CI/preview state. Related and
protected History, Timeline folder/storage controls, account sync and the full
local-first matrix remain unfinished; this is not a merge-ready completion.

## Anonymous Page + related History — 2026-10-16

`LocalTimeline.page` now supports the existing related-scope contract. It reads
only stored Things in the anonymous partition and traverses the canonical
composition references, including saved/default and per-instance component args,
Action steps, Data and Schema references. Component aliases reuse the normal
selector; Action/schema aliases follow the local runtime ordering. Public caches
and account partitions are not inputs, and discovery executes no Actions or
network requests. Missing external dependencies contribute no event membership.

Both account and local readers use the same request checks and sorted SHA-256
membership identity in `timeline/relatedHistory.ts`. The local adapter hashes
outside IndexedDB, then rechecks membership in the readonly event transaction.
Concurrent changes produce an explicit refresh error. Membership changes since
an existing cursor reset both paging directions, including when a newly related
Thing has older history. Ordinary content edits keep the same membership hash.
Bounds remain 128 Things, 512 contexts/references and the existing page byte cap.

Seven new local tests cover five-kind traversal, exact membership hashing,
reopen, both cursor directions, arg contexts, aliases, cycles, complexity/page
limits, account/public isolation, cancellation and membership races. The guarded
real account API integration retains its auth/source/privacy checks and now
cleans up its own synthetic Things in `finally`; see the README disposable
replica setup. Protected History, Timeline folder/storage controls, account sync
and the other matrix rows remain unfinished.


Local validation: 390 workspace/offline-shell and Timeline tests pass, with five
ordinary opt-in skips. The production-shell History regression passes with all
network requests rejected after the verified cache is ready, including related
filter/cold reload, component membership replacement after restore and layout at
1440/390/320px. It asserts root API reads are unavailable, with zero HTTP
mutations, account Timeline requests, restored-ID public reads or page errors.
Manual in-app Browser also verified related page/component events and reload at
1440/390px; task tabs were closed and viewport overrides reset. Evidence:
`tmp/local-related-ui/`, `tmp/local-related-network-blocked-ui/`.

At this historical checkpoint the History regression used `TT_LOCAL_TIMELINE_NETWORK_MODE=blocked-requests`:
Playwright rejects actual requests while allowing the service worker's cached
responses. `navigator.onLine` remains true in this mode. Select
`TT_LOCAL_TIMELINE_NETWORK_MODE=offline-emulation` to retain the browser's offline
flag diagnosis. That mode intermittently cancelled cached module loads during
cold navigation; this was reproduced independently at navigations 48 and 52.
All 246 cache entries remained present and a failed module was still fetchable.
The original app passed 80 cold navigations with requests blocked. Experimental
preload removal and buffered cached responses were reverted: this evidence does
not establish the cancellation cause or a general startup fix. Keep real-device
offline startup and browser-emulation reliability open before full completion.

Build: 245 verified assets / 21,203,554 bytes. TypeScript retains 91 baseline
diagnostics; targeted lint has no errors and one existing constructor warning.
These are local results, separate from CI and deployed behavior. The complete
local-first rollout remains unfinished and must not be merged yet.


The combined branch preserves review-bot commit `82eae71f6`: unreachable or
damaged CacheStorage falls back to the real network for build assets; a failed
navigation retains its original network error. Its four offline-shell tests and
the rebuilt native History regression pass. This cache-error fallback does not
establish a fix for the separately observed module cancellations.


## Managed anonymous Timeline folder — 2026-10-16

After the first saved local event, Things and its literal library search expose
`timeline-folder-local-workspace`. The existing folder route opens the same
History UI. The folder is a readonly projection of the earliest canonical local
receipt, with stable dates and paged library membership; no mutable folder or
new history format is persisted. Content snapshots, portable transfers and
account partitions exclude it. Ordinary rename/move/delete, target/folder
placement and import into the container fail before mutation. Historical
version export remains available inside History.

Cold navigation exposed another missing local link: library rename required a
fresh server capability manifest after reload. Anonymous local rename now relies
on its existing validator and workspace lease. Account capability negotiation
is unchanged. A clean offline browser verifies import → folder → cold reload →
back to Things → rename → cold reload, plus the entire prior History flow.

Local verification: 149 workspace tests, four offline-shell tests and 238 shared
Timeline tests pass; five opt-in browser cases are skipped by the ordinary unit
command. The explicitly enabled History case passes (35.5 seconds), with no
account Timeline calls, HTTP mutations, restored-ID public reads, page errors or
recovered module errors. Folder bounds are 1440/1440, 390/390 and 320/320 CSS
viewport/scroll widths. Manual in-app Browser verification also passes at
desktop/390px; task tabs are closed and viewport overrides reset. Evidence:
`tmp/local-timeline-folder-ui-checkpoint/` (including `folder-verification.json`),
`tmp/local-timeline-folder-ui/manual-folder-*.png`. Build verifies 245 assets /
21,205,081 bytes. TypeScript retains exactly the prior 91 diagnostics; targeted
lint has zero errors and six pre-existing warnings.

The default History network mode is now `offline-emulation`. A new attempt with
`blocked-requests` failed the explicit root-network probe: routing did not make
the API unreachable. That opt-in mode still asserts the same condition. Two
earlier emulated runs completed the functional steps but failed on recovered
entry-module load errors; the final run passed. This is not a startup reliability
fix. Real-device/offline startup, protected History, local storage controls,
account sync and the rest of the matrix remain unfinished. These are local
results, not CI or deployed acceptance. Do not merge yet.


## Device storage settings — 2026-10-16

Settings → Things now shows the current device workspace's accounted bytes and
record count against the existing 64 MiB / 10,000-record limits. The readonly
usage operation compares its scoped ledger with a key-only count in the same
transaction. It does not enumerate other partitions, load file bodies, request
account data or display browser-wide usage estimates. Missing/malformed or
count-mismatched accounting is unavailable, never an empty-success meter;
refresh retains the previous values with an explicit last-known label.

Anonymous, account, API-origin and data-plane partitions stay separate. The
Settings binding uses the existing workspace lease, including offline account
copies whose remote session is unconfirmed. Identity changes hide the previous
meter immediately and retire pending operations. Refreshes also run on local
writes, focus and a bounded 15-second timer, with newer results winning.

The explicit Protect device storage button requests the browser's standard
origin-wide eviction protection. Merely reading settings never requests it.
Granted, declined, unsupported, failed and timed-out results are distinct;
late completion cannot update a retired workspace or start a protection request
after the check has timed out. Protection is not a backup
or protection from manually cleared site data. Normal Things export/management
and History are linked from the same section. No content or history purge,
new transfer format, remote sync or account permission is added.

Five new tests cover logical JSON/binary/zero-byte usage, rollback, exact scope
separation, damaged accounting without content loss, persistence results and
late completion, missing storage APIs, immediate identity retirement and
unconfirmed offline-account reads. The workspace/offline-shell suites pass
159 checks (six opt-in browser skips). The enabled clean-browser storage case
passes with actual networking disabled: import, cold Settings reload, a second
tab's local write, refresh, injected missing ledger, retained last-known usage,
ledger recovery and unchanged Things. The real browser declined protection and
the UI reported that result. No HTTP mutations or page/module errors occurred;
1440/390/320px views have matching viewport/scroll widths. Manual IAB desktop and
390px views also passed; task tab and viewport override were cleaned up.

Evidence: `tmp/local-storage-controls-ui-late/verification.json` and screenshots;
manual screenshots are in `tmp/local-storage-controls-ui/`. Production client
build: 245 verified assets / 21,211,055 bytes. TypeScript retains the previous
91 diagnostics. Targeted lint has zero errors and one existing constructor
warning. These are local results; account UI sync coverage, broader cross-account
acceptance, offline startup reliability and the unfinished matrix still gate
merge. Browser storage protection does not repair the known startup issue.

The branch review fix for a damaged Timeline view cache is included. Its library
regression and the storage timeout boundary pass together (13 targeted checks).


## Account folder moves — 2026-10-16

Normal bulk moves for locally supported account Things now use `LocalThings.move`
and the existing account create/update queue. Placement, revision and queue intent
commit in one transaction; missing sync bases, cycles and failed writes roll back
all selected items. The destination and ancestor chain must belong to this exact
workspace. Previously uncached sources/ancestors may be fetched while confirmed
online; offline missing content reports a clear error. Mixed batches cannot send
pending local Things through a dedicated remote adapter. Anonymous moves retain
their separate local writer and never create account sync entries.

New local destination folders sync before their children. Existing destinations
use the normal conditional PATCH and expected actor/data-plane headers. Lost
responses retain the frozen operation; a subsequent move remains pending until
that exact operation is acknowledged. Concurrent server changes require the
existing explicit conflict review. Local placement filters apply to both fresh
and cached account folder pages, so a stale remote listing cannot put a pending
move back into its previous folder. This does not complete general pagination or
membership reconciliation.

Cold account folder navigation exposed a separate failure: the optional remote
attachment-manifest probe expected a promise rejection, while the account guard
threw synchronously. That escaped the probe's `.catch()` and unmounted the local
screen into session recovery despite an intact account pointer. Guarded account
API calls now reject promises with the same authority refusal. They do not gain
remote permission or send a request while unconfirmed.

Local acceptance: 164 workspace/offline-shell checks pass, with seven opt-in
browser skips. The enabled clean-browser account-move case passes in 6.2 seconds:
register a disposable local fixture, create two private Things and a folder,
move via the normal multi-select dialog offline, cold-navigate/reload the folder,
verify the server is unchanged, reconnect, and verify two conditional account
PATCHes. All fixture Things are deleted by the test's own cleanup. No account
bulk endpoint is called. There are no page/module or caught-router errors in the
final run; viewport/scroll widths match at 1440/390/320px. Evidence:
`tmp/local-account-move-ui-final/verification.json` and PNGs.

The existing success-notification helper attempted one remote history request
while offline; no claim of zero ancillary requests or complete notification
support is made. Earlier failures in `tmp/local-account-move-ui*` retain the
folder-probe crash evidence. This fix is distinct from the known intermittent
entry-module cancellation issue. Build: 245 assets / 21,212,773 bytes. TypeScript
retains the same 91 baseline diagnostics; targeted lint has zero errors and one
existing constructor warning. These are local results, not CI/deployed proof.
Deletion acknowledgements, coordinated dependency imports, protected adapters,
account Timeline sync and the rest of the matrix still gate merge.


## Device notification history checkpoint — 2026-10-16

`useLopu` and completed streams now commit validated, credential-redacted
messages to the current browser workspace before waking background account sync.
Toast/action completion remains independent. The same message contract and safe
internal-link parser serve the existing authenticated recorder; the shared
redactor uses standard cryptographic UUIDs in both Node and browsers. No new
endpoint, private read permission or remote delivery behavior is introduced.

Open `/notifications?source=device` for this workspace's local Lopu messages.
Anonymous/offline workspaces use that view by default, accessible through the
normal nav bell. Verified accounts retain the existing account-history default
and can switch to device history. Both reuse existing rows, URL filters and
pagination controls. Device rows are already-read, history-only messages; they
do not create a second push/email or an unread badge. Account/social history is
not silently represented as a complete offline cache.

History and queue state share one bounded IndexedDB record. The workspace quota
applies; no count-based deletion occurs. Account origin, owner and selected data
plane partition local copies, even though server notification history remains
home-pinned. Anonymous records never enter a sync state. Account changes retire
transactions and requests. The transport rechecks verified identity, uses the
existing body-recipient check, rejects redirects, caps responses and times out
at 20 seconds. A pass sends at most 20 records, claims expire after 30 seconds,
and transient failures stop after five attempts with a visible failed count.
A lost response reuses the same event UUID and canonical server ID. Permanent
or exhausted failures retain the message; a manual retry UI is still pending.

Local verification: canonical/redaction/notification tests, workspace suite and
client build; clean anonymous actual-offline import → history → cold reload →
search → reconnect with zero mutation requests and no page/module errors.
Measured 1440, 390 and 320px pages have no horizontal overflow. The disposable
account move fixture also verifies offline message persistence and one server
row per event after verified reconnect, through both history views. Evidence:
`tmp/local-notifications-ui-final/verification.json` and
`tmp/local-notifications-account-ui/verification.json`. These are local checks;
CI/preview status is reported separately. General offline-entry reliability,
other notification kinds, cross-tab live refresh and the wider matrix remain
open. The earlier account-move checkpoint's ancillary request is fixed here.


## Structured device search checkpoint — 2026-10-16

`/search?source=device` searches only saved Things in the current workspace,
without login or a network connection. Anonymous/offline visitors default to
this view. `Online search` explicitly selects the ordinary server search, with
its existing authentication, visibility and rate-limit checks. Anonymous online
requests use the existing read-only search POST with credentials omitted,
redirects refused, a 20-second deadline and a 32 KiB body ceiling. Public query
caches are separate from authored local content and never confer ownership.

The device adapter reuses `api/utils/things/searchGrammar.ts`, extracted from
the existing server compiler. All existing field operators, nested all/any
groups, literal escaped string predicates, named emoji matches, primitive types,
array membership and root dates use the same validation. Inherited JavaScript
names are no longer accepted as datatype aliases. Device evaluation reads only
own saved properties, excludes protected records and draft files, and cannot
resolve another account or data plane. No Actions execute during search.

Call the application adapter with `{ workspace: true, device: true, conditions,
q, thingtime, sort, limit, cursor }`. Pages contain at most 50 rows; field groups
retain the shared 32-condition/three-level bounds, filters cap at 32 KiB, and
cursors bind a SHA-256 hash of the workspace and filters. A removed continuation
anchor or changed scope/filter returns an error. Account device results explicitly
remain incomplete: they are saved local content, not the whole remote account.
The existing library's local-first account refresh/pagination is unchanged.

Free text searches literal normalized authored values, not field names. Device
sorts are newest/oldest; Mongo stemming/relevance, author/audience, geographic,
engagement and shortcut filters remain outside this adapter and fail explicitly
rather than silently changing the result set. The UI offers supported device
controls and a local schema rail. Field filters can already express predicates
such as schema ID, tags and date ranges. Schema creation/form UI and account
schema dependency handling remain outstanding in the coverage matrix.

Search caches include origin/account/data plane and source. Views remount on
identity generation/source changes; outstanding results cannot repaint or write
another view's cache. Invalid filters retain the last successful result set and
show an explicit error. Normal source changes do not mix account and device
pages or their cursors.

Local verification: 173 workspace tests passed, with ten opt-in browser skips.
The enabled production-build browser regression separately checks anonymous
25-Thing import and two-page offline search, native numeric filtering, invalid
path errors, cold reload, source changes, no mutation/upload and desktop,
390px and 320px bounds. A disposable private account compares 25 canonical field
queries against the real server API and verifies account device cold reload;
a separate anonymous context cannot read those private fixtures. Evidence:
`tmp/local-structured-search-ui-final/`. The client build contains 242 verified
offline assets (21,512,349 bytes). Lint passes; raw TypeScript retains the same
91 normalized diagnostics as the preceding branch checkpoint, with none added.
These are local checks, not CI/deployed verification or full rollout completion.

## Schema workflow checkpoint — 2026-10-16

`/schemas` defaults to **This device**, combining bundled platform shapes with
schemas saved in the active workspace. **Online catalogue** remains an explicit
remote view. Device search filters before paging; library membership, reactions
and usage counts come from relational local records. Account device results
explicitly describe their partial cache. Protected native schemas retain their
dedicated creation requirements; an editable copy grants no protected authority.

Schema creation and schema-driven Thing creation use the existing canonical
validators and workspace API. Draft flush and retirement run independently of
the content write, including when either draft operation hangs or rejects.
Successful creation retires its draft; failed creation preserves it. Account
data waits for its new schema dependency to sync before its own remote write.

Schema draft contexts include a SHA-256 workspace-scope suffix (origin, account
and data plane). Captured leases reject retired workspace callbacks. Earlier
account/device drafts are explicitly recoverable as independent editor copies.
Malformed local recovery is retained byte-for-byte and cannot seed an autosave
or crash the recursive editor; the UI explains that draft saving is paused while
Thing creation stays available. Existing account draft revision, retry and
tombstone rules remain in force. Account draft transport itself is still online;
its complete local-first sync adapter remains outstanding.

Local production-client browser regressions pass for anonymous offline schema
authoring, builder/form draft reload, data creation and second reload, independent
schema copying and saved-library membership. No anonymous mutation requests were
sent. Native builder/detail layouts fit 1440/390/320px. A disposable authenticated
fixture created and synced a schema and its data while three draft mutations
remained stalled; reload did not reopen the completed draft. A separate malformed
recovery fixture created content while retaining its old recovery bytes.

Run these opt-in checks against the documented disposable local stack:

```sh
TT_LOCAL_SCHEMAS_URL=http://127.0.0.1:22470 \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chromium \
TT_LOCAL_SCHEMAS_ARTIFACTS=/absolute/path/to/artifacts \
node --import tsx --test app/local-workspace/schemas.browser.test.ts
```

Run from `remix/`; only loopback targets are accepted. Evidence for this checkpoint
is local, not CI or deployed verification. Broader catalogue caching, account
interactions/draft sync, multi-tab refresh and the full matrix remain merge gates.

## Component catalogue and version drafts — 2026-10-16

`/components` defaults to **This device**, combining existing bundled suite
components with this workspace's saved copies. Bundled projections remain
unowned and are excluded from Mine/Library. Save a version before applying
local library membership or reactions. **Online catalogue** is an explicit
separate source; device account results do not claim a complete server catalogue.
Library/category/family filters and family grouping run before bounded paging.

Detail and card argument editors reuse the native template resolver and renderer.
Arguments, version name and audience recover through the shared scoped draft
session. Saving uses the canonical Thing writer and never waits for draft sync
or retirement. Each saved device copy opens by its own ID. URL Action sources
retain the existing confirmation and trust ladder; catalogue preview controls
remain inert. Account content identity permits local editing but grants no
remote authorization. Failed refreshes keep the prior preview with an explicit
retry instead of reporting a network failure as a missing component.

Local checks: components 48/48, drafts 32/32, workspace 176 passing with 15
opt-in browser skips, offline shell 4/4; enabled browser scenarios cover fully
offline anonymous browsing, native argument rendering, detail/card draft reload,
independent copies, library membership and 1440/390/320px overflow checks. A
separate disposable account completes and syncs its version while draft writes
never finish, then reloads offline. Raw TypeScript retains the same 91 normalized
baseline diagnostics; focused lint and client build pass (247 offline assets,
21,528,619 bytes). Evidence lives in `tmp/local-component-workflow-ui-final/`.
These are local results, not CI or deployed verification.

Run from `remix` against the isolated production client:

```sh
TT_LOCAL_COMPONENTS_URL=http://127.0.0.1:22470 \
TT_LOCAL_COMPONENTS_ARTIFACTS=../tmp/local-component-workflow-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/components.browser.test.ts
```

Pending component coverage includes full account discovery caches, cross-tab
refresh, source-control editing recovery, bundled-only bookmarks and remaining
Builder global/site block surfaces. The broader merge gates above still apply.


## Global and site blocks — 2026-10-16

Builder now offers **Customize a site page** alongside **Global blocks** without
requiring an account. Both surfaces use the existing webpage Thing schema,
canonical writer and native section renderer. The server seed and offline editor
share the same 27 route definitions; saving creates a private workspace version,
not a replacement system definition. Native sections keep their own permissions.

The editor recovers name, blocks and audience with the shared workspace draft
session, fenced against a newer saved page. Save and reset do not await account
draft transport or cleanup. Discard and reset retire unfinished recovery so it cannot
resurrect after reload. Existing Timeline/history behavior is unchanged.

The site host resolves anonymous and offline account pages through their existing
local adapters. Its bounded cache belongs to the full workspace identity, keeps
last loaded blocks after refresh failure, exposes Retry and fences delayed reads.
Same-origin tabs exchange scope-only invalidations, never content or credentials.
Global and route-specific sources have separate existing webpage runtimes; source
execution still uses the normal Action adapters and authorization/trust policies.

Local verification: 156 webpage, 33 draft, 178 workspace and four offline-shell
tests pass (5 webpage and 18 workspace integration/browser tests opt-in). Three
clean production-client browser scenarios cover fully offline draft recovery,
normal save/reset, two-tab updates, native section uniqueness, 1440/390/320px
layout, account/anonymous isolation, confirmed server sync while account drafts
stall, and imported source-bound components after offline reload. The actual
server resolver confirms sync; browser-local reads are not sync evidence.
The build has 247 verified assets (21,535,609 bytes); raw TypeScript retains the
same 91 baseline diagnostics. Focused lint has only six existing useWebpage
warnings. Screenshots and checks: `tmp/local-site-blocks-ui/`.

Run from `remix/` against the isolated production client:

```sh
TT_LOCAL_SITE_BLOCKS_URL=http://127.0.0.1:22470 \
TT_LOCAL_SITE_BLOCKS_ARTIFACTS=../tmp/local-site-blocks-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/siteBlocks.browser.test.ts
```

These are local results. CI and deployment have not verified this checkpoint.
This closes basic global/site composition, draft recovery and source rendering;
full control-editing recovery, account reset/delete sync, cross-device conflicts,
and the broader acceptance matrix above remain merge gates.


## Account deletion and reset — 2026-10-16

The existing account queue now handles ordinary owned data, folders, webpages,
components, schemas and Action definitions through canonical `DELETE /api/v1/things`.
Deleting content and recording deletion intent commit atomically. Never-sent local
creates disappear without a remote request. Attempted creates/updates retain their
frozen request until its outcome is known, then delete using the acknowledged
server timestamp. Ambiguous deletes require scoped absence readback; permission
refusals cannot be mistaken for success. Identity retirement fences late responses.

Folder deletion moves cached direct children to the surviving parent and syncs
those moves first. Target-linked children delete first; a conflicting child holds
its parent. Keeping a linked account version visibly blocks the parent deletion
until that child is explicitly deleted. Unknown/protected content continues using
its dedicated authorized adapter; this does not complete every deletion adapter.

Before-images remain in the same bounded workspace storage while deletion is
pending. Acknowledgment releases their content and retains a small tombstone to
prevent stale list/resolve reads from resurrecting it. Conflict review offers the
account version or deletion of the explicitly reviewed version. Cached list
membership retains hidden IDs so restoration appears immediately; the Things UI
refreshes visible folders after scoped workspace changes. A false browser online
hint cannot make an unverified workspace fetch its reset page remotely.

Local verification covers normal offline Things deletion and Builder global reset,
cold reload, zero offline mutations, real server readback, child preservation and
both conflict choices at 1440/390/320px. The existing account-move and three site
composition browser scenarios also pass. Unit coverage includes reload/lost
responses, in-flight create refusal, two-tab claims, permission refusals, retained
content bounds, identity changes and dependency conflicts. Evidence lives under
`tmp/local-account-delete-ui/` and `tmp/local-account-delete-*-tests.log`.

Run from `remix/` against a disposable production client:

```sh
TT_LOCAL_ACCOUNT_DELETE_URL=http://127.0.0.1:22470 \
TT_LOCAL_ACCOUNT_DELETE_ARTIFACTS=../tmp/local-account-delete-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/accountDelete.browser.test.ts
```

These results are local, not deployed verification. The full matrix above remains
the merge gate; protected History/account Timeline synchronization, dedicated
adapters, imports and wider account discovery still need completion.

Final local checks: 192 workspace tests and four offline-shell tests pass (19
opt-in workspace/browser tests skipped in the default command). Five enabled
browser scenarios pass; the deletion scenario was rerun after the final safety
change. Client build: 247 verified static assets / 21,541,680 bytes. Raw
TypeScript retains the same 91 normalized baseline diagnostics. Focused lint:
zero errors and four existing ThingsPage hook warnings. No baseline was relaxed.


## Account import checkpoint — 2026-10-16

The normal Things import dialog now imports ordinary account data, folders,
webpages, components, schemas and Action definitions locally before networking.
Caller JSON is validated, bounded and copied before asynchronous work. New IDs,
rewritten references, content and sync intent commit atomically. Cancellation,
unsupported kinds, quota or placement failures cannot leave a partial local batch.
No Action runs during import, and legal executable cycles keep their remapped IDs;
structural/provenance cycles use the canonical import rejection.

`utils/thingTransfer/importContent.ts` shares the account server/device copy rules:
fresh definition keys and schema names, no inherited site placement, and canonical
reference remapping. Account destination folders also contain unparented dependencies,
matching the normal importer. Anonymous import retains its existing local IDs and
site/suite behavior; this checkpoint does not claim complete import-semantic parity.
Account copies use the existing private ordinary-Thing queue and expected-actor/
data-plane transport. Server synchronization can complete individual records at
different times; unresolved sync stays visible and exact retries keep their IDs.
Anonymous storage is never adopted by this queue. Files, linked media and managed
kinds continue through their dedicated adapters and remain outstanding offline
account work. Account export UI/cache completeness is also still outstanding;
the export in the browser round-trip below deliberately uses the normal server API.

Local checks: 197 workspace tests, four offline-shell tests and 315 Things tests
pass (20 workspace/browser tests require explicit opt-in). Four enabled browser
scenarios pass: the new normal-dialog account import plus the three existing site
composition checks. The account fixture imports while fully offline, renders
through the native page/component renderer, edits before sync, cold-reloads, fits
1440/390/320px, sends zero offline mutations, and verifies private server copies
after reconnect. A real server export then passes the canonical validator and
normal importer with independent IDs and complete schema/component references.
Evidence: `tmp/local-account-import-ui/`, including `exported.thingtime.json`.

Client build: 247 verified assets / 21,543,863 bytes. Raw TypeScript retains the
same 91 normalized baseline diagnostics. Focused lint has zero errors and one
existing LocalThings constructor warning. These are local results, not deployed
verification or completion of the full matrix.

Run from `remix/` against the disposable production-client fixture:

```sh
TT_LOCAL_ACCOUNT_IMPORT_URL=http://127.0.0.1:22470 \
TT_LOCAL_ACCOUNT_IMPORT_ARTIFACTS=../tmp/local-account-import-ui \
TT_SHARED_PLAYWRIGHT_PATH=/absolute/path/to/playwright/index.mjs \
TT_SHARED_CHROME_PATH=/absolute/path/to/chrome \
node --import tsx --test app/local-workspace/accountImport.browser.test.ts
```


## Account export checkpoint — 2026-10-16

The normal Things Download dialog now exports ordinary account content locally.
`accountExport.ts` reuses `exportLocalThingSnapshot`, the existing collector,
composition rewriter, canonical validator and serializer. New unsynced content
requires no draft save, sync or network request. Pending edits, moves and
local deletions overlay the last complete device export snapshot. The UI calls
this a device snapshot; it cannot promise changes made elsewhere while offline.

A cached library page is not proof that all folder children, dependencies or
media were read. For existing server content, the adapter prepares missing
coverage through the canonical server exporter while online and verified, then
retains validated content-only snapshots in the account/origin/data-plane scope.
Missing coverage or required dependencies refuse the download while offline;
no partial success is returned. Existing shared-link requests remain uncached.
Export-only dependency copies are not editable owned Things, sync entries or
alias candidates for account-owned definitions. Exact dependency IDs retain
meaning; shared keys cannot capture a local component alias.

Snapshots are keyed by selected IDs and every include option, limited to 16
entries and the existing 1 MiB record / 64 MiB workspace quotas. Cache retention
is optional: an over-quota snapshot does not prevent downloading the only local
copy (`retainedOnDevice: false`). Local collection uses one content/sync snapshot;
identity, cancellation and the canonical 30-second preparation deadline fence
completion. Remote preparation uses bounded responses and the existing actor/
data-plane transport, capability negotiation and 20-second request timeout.

This checkpoint covers ordinary no-file/no-link transfers. Media and managed
content retain their dedicated online export path; pending local edits cannot
silently be replaced with older server content. Offline file/linked-gallery and
managed-account exports remain acceptance work, as do broader catalogue/cache
membership and cross-device refresh. Account imports with files remain gated.

Local verification: 206 workspace tests and four offline-shell tests pass;
20 opt-in workspace/browser cases are skipped in the general suite. All 315
Things tests pass. The enabled disposable-account browser scenario now downloads
actual JSON from the normal dialog while fully offline, preserves all five
Things and the pending page edit, round-trips that exact file through the normal
server importer, and downloads the same device snapshot after sync and cold
reload. It verifies zero offline mutations, no browser errors, native preview
bounds at 1440/390/320px, and a usable 320px Download dialog. Artifacts live in
`tmp/local-account-export-ui/`, including `offline-exported.thingtime.json` and
`export-dialog-320.png`. Run the existing `accountImport.browser.test.ts` with
its documented environment and this artifact directory to repeat it.

Client build: 247 verified offline assets / 21,549,320 bytes. Focused lint has
zero errors and the existing LocalThings constructor warning. Raw TypeScript
retains the same 91 normalized baseline diagnostics. These results are local;
CI and deployed behavior remain separate, and the full matrix is not complete.

Final graph verification: the semantic refresh hit Graphify's shrink guard for
the PR note (two semantic nodes became one), so no partial semantic graph was
accepted. The earlier semantic extraction is retained and the final source uses
the repository-permitted structural refresh. Final documentation semantic
freshness is unverified; source fingerprint and graph/manifest coverage are
checked separately.
