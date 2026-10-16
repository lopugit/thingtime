# Things and folders

Normal account ZIP import uses `local-workspace/accountImport.ts` for shared
UI/facade routing, and `AccountThingSync` plus `AccountFileSync.contentHooks`
for atomic local admission and receipt-dependent media remapping. Regressions:
`accountFileImport.test.ts` and opt-in production-client
`accountFileImport.browser.test.ts`. Standalone file/ordinary content is covered;
bound, recording, linked and managed imports remain separate acceptance work.
See [local workspaces](../local-workspaces.md#account-file-transfer-imports--2026-10-17).

Server Action admission/outcomes use `api/utils/timeline/actionOutcome.ts` and
shared `timeline/actionOutcome.ts`, called from the canonical server executor.
They retain safe effect receipts in the existing Timeline, never a new history
store or growing array. `api.actions-run` 1.37.0 and `api.timeline` 1.16.0 publish
this contract; the first-party client negotiates it. `test:timeline:action-outcomes`
checks real replica APIs, optional quota, privacy, partial failures and sealed
completion recovery. `timeline/actionRecovery.ts` validates delivery bundles;
`api/utils/timeline/actionRecovery.ts` verifies server proofs and admissions.
`localBackend.client.ts`, the existing IndexedDB store/sync and `useApi` retain
and resend the identical canonical event. `auth/jwt.ts` provides a durable
content seal using configured keys, never the development fallback. See
[the Timeline ledger](../unified-timeline.md) for incomplete-receipt boundaries.

Everything is a Thing in one logical `things` collection (physical `things_v2`,
always through `getThingsCollection()` / `getHomeThingsCollection()`, never a
raw name). Folders are `folder` Things; containment is the child's `folderId`
pointing at a folder owned by the same account (`FUNDAMENTALS.md` §3).

## Where the code lives

| Concern | Path |
| --- | --- |
| Canonical Thing utilities: `createThing`, `updateThing`, `deleteThing`, `listThings`, `getThing`, `findViewableThing`, projections (`toPublicThings`, posts) | `app/api/utils/things/things.ts` (large; grep the export you need) |
| Folder rules (`resolveFolderAssignment`, `FOLDER_UNFILEABLE`, cycle checks) | `app/api/utils/things/things.ts` (`folderId` handling) |
| Bulk move/copy/delete/share | `app/routes/api/v1/things/bulk` |
| Thing routes | `app/routes/api/v1/things/_things.tsx` (GET/POST/PATCH/PUT/DELETE) plus `export`, `import`, `fork`, `share`, `react`, `comment`, `save`, `vote`, `updown`, `views`, `search`, `feed`, `trending`, `rss`, `reveal`, `actions` |
| Portable transfer (export plan, ZIP/JSON bundles, import) | `app/api/utils/things/exportTransfer.ts`, `importTransfer.ts`, `app/utils/thingTransfer/*` (client: `browser.ts`, `archive.ts`) |
| Kind schemas and protected kinds | `app/schemas/registry.ts` (`PROTECTED_THINGTIME`, `folderSchema`, `isProtectedThingtime`) |
| Indexes | `app/api/utils/mongodb/collections.ts` `ensureIndexes()` (central registry; new indexes are rare, evidence-backed exceptions) |
| Shared event/link records, IndexedDB relational queue/index, bounded cache, draft recorder and account sync | `app/timeline/` (`records.ts` and `branches.ts` are the identical local/remote durable schemas) |
| Transactional history recording, protected binary event Things and paging | `app/api/utils/timeline/` |
| Trusted Action/AI attribution and relational operation grouping | `app/api/utils/timeline/mutationContext.ts`, established by `actions/execute.ts`, `actions/firstPartyActionHost.ts` and `lopu/chatTools.ts`; not request-controlled |
| Shared History modal and managed Timeline folder | `app/components/Timeline/TimelineHost.tsx` |
| Account/database-qualified History links and Thing caches | `app/utils/dataPlane.ts`, `app/hooks/useDataPlane.ts`, `app/routes/thing.tsx`; root identity invalidation also handles database selection across tabs |
| Approved saved-theme content history, home transaction and retained deletion accounting | `app/timeline/themeContent.ts`, `app/api/utils/timeline/themeContent.ts`, dedicated `app/api/utils/themes/themes.ts` writer |

Local-capable details use `local-workspace/posts.ts` for the separate generic
Thing discussion projection and `api.client.ts` for paged local comments.
`ThingComments.tsx` keys its state by the full workspace identity.
`PersistedThingMenu.tsx` uses workspace ownership for rename while retaining real
account authentication for History and recording handoff. The API adapter owns
capability negotiation; local rename makes no remote manifest request. See
[the local workspace matrix](../local-workspaces.md) for remaining coverage.

## Conditional account interaction sync

`local-workspace/accountInteractions.ts` retains account-only desired save/reaction
membership; `accountApi.client.ts` overlays cached owned and bundled catalogue
entries and drains this queue independently of content/drafts after verified
binding. `AccountSyncStatus.tsx` exposes retries and reviewed device/account
choices. Uncached targets retain the existing online adapter.

`routes/api/v1/things/interactions/_interactions.tsx` exposes first-party
`api.things-interactions` 1.0.0. `readInteractionStates`/`writeInteractionState`
in canonical Things utilities use current visibility and bounded conditional
writes. Canonical create/update/shared deletion accounting atomically invalidate
interaction revisions, including the old toggles. Internal revision metadata
never enters portable exports. No new physical collection or index is needed.
Run `test:local-workspace`, `test:things`, `test:api-capabilities` and the opt-in
`local-workspace/accountInteractions.browser.test.ts`; see the local workspace
matrix and TESTING checklist for exact coverage and remaining work.

## Authorization helper

- Reads: `findViewableThing` / `canViewInherited` (see
  [sharing-and-audiences.md](sharing-and-audiences.md)).
- Owner writes: `updateThing`, `deleteThing` check ownership and PAT scopes
  through `resolveThingsActor(scope)`; new things routes must pass
  `thingsScope`.
- Folder listing (`listThings({ folder })`) is owner-only; `FOLDER_UNFILEABLE`
  kinds (reactions, saves, votes, updowns) live under their target.
- Deleting a folder drains direct children to its parent in bounded transactions
  before removing the folder. Each child move and its Timeline event commit
  together; subfolder descendants stay nested. `things/folderPlacement.ts` writes
  private ancestor fences shared by canonical, managed and archive placements,
  preventing deleted destinations and concurrent folder cycles. Protected library
  moves use a metadata-only history adapter. Deleting a post cascades its
  attachments through `prepareAttachmentCascadeForThing`.

## `/things` page (Drive surface)

| Piece | Path |
| --- | --- |
| Page state, fetching, DnD, dialogs, action dispatch (`onItemAction`, `onItemMenuAction`) | `app/components/Things/ThingsPage.tsx` |
| Grid/list/columns views, tile menu button, `ThingsItemAction` union | `app/components/Things/ThingsViews.tsx` |
| Item and background context-menu models | `app/components/Things/thingsMenuModel.ts` (built on `buildThingEntityMenu`) |
| Pure helpers/types (`ThingsThing`, `isFolder`, sort/group options, cache keys) | `app/components/Things/thingsCore.ts`, `thingsLocation.ts` |
| Dialogs (new folder, rename, move, share, delete, preview) | `app/components/Things/ThingsDialogs.tsx` |
| Export/import dialogs | `ThingExportDialog.tsx`, `ThingImportDialog.tsx` |
| Universal Thing page `/thing/:id` | `app/routes/thing.tsx` |
| Device page `/things?device=<id>&deviceView=page` | `app/components/Things/ThingsPage.tsx` selects the same `DeviceDetailsDrawer.tsx` content used in the drawer; device cards/rows have a navigation-only right-click menu |

Adding an item action: extend `ThingsItemAction` in `ThingsViews.tsx`, add the
action to `buildThingsItemMenu`, handle it in both `onItemAction` and
`onItemMenuAction` in `ThingsPage.tsx`, and keep bulk selections in mind
(`actCount > 1`).

## Folder and metadata editing

Explicit legacy data folders use the same browsing, owner and cycle fences as
native folders. `thingsCore.ts` preserves scalar null, false, zero and empty
strings. `renameLibraryThing.ts` permits only display-title metadata changes for
protected library kinds; it preserves payload, ACL, owner, namespace and stale
write checks. Its regression is included in `test:things`. New folder actions
appear at every tree depth and column; the page cog owns view/error-log options.

## Registration

Same three places as every endpoint (route file, import map, `apiDocs.ts`
entry) — see [api-endpoints-and-capabilities.md](api-endpoints-and-capabilities.md).
New kinds: add a schema to `app/schemas/registry.ts`; protected/managed kinds
go into `PROTECTED_THINGTIME` and get dedicated endpoints.

## Tests

- `npm --prefix remix run test:things` (menu models, page cores, transfer),
  `test:acl`, `test:collections` (index registry), `test:transfer-binary` /
  `test:transfer-archives` (opt-in integration on a disposable replica set).
- `TESTING.md`: "Things page", "/things Duplicate", "Recording folder
  transfers".
- Realistic local data: `node remix/scripts/seed-fixture.mjs create` makes a
  folder holding a post with stored files.
- Direct named branch lookup uses `TimelineSync.branchHead` and the existing
  private Timeline route (`api.timeline` 1.9.0); it is independent of branch
  paging. The branch-merge and home-scope HTTP checks cover this read path.
- `test:timeline` covers the shared schema, two IndexedDB connections, draft
  recovery pointers, retries, byte-bounded paging, private envelopes, branch command reload/concurrency, event-before-command ordering, and route
  authority. `test:timeline:integration` uses HTTP-only fixtures on the explicitly
  disposable local replica set described in [Unified Timeline](../unified-timeline.md).
- `test:timeline:themes` verifies dedicated theme events, rename/move ancestry,
  private history and custom-selection home accounting. `test:timeline:quota`
  uses normal synthetic admin assignments for exact-ceiling refusal, deletion
  and the below-usage downgrade guard; see README's disposable setup.
- `test:timeline:home-scope` checks real two-database isolation, identical event
  and live Thing ids, scoped branch creation, home restore and stale-source
  GET/PATCH/DELETE refusal. `thingDatabaseIdentity.test.ts` covers qualified links
  and cache separation. `storageScope.ts`,
  `connectionPool.ts` and `TimelineProvider.tsx` share canonical queues across
  home/selected discovery while keeping different data planes separate.

## Remote and stored files

`FilesystemThingsBrowser.tsx` adapts ephemeral remote inode entries into the
same `ThingsGridView`/`ThingsListView` used by `/things`. The full-page entry is
`/things?files=thingtime` (or a device id); `DeviceDetailsDrawer` mounts the same
component with `compact` and an expanded pop-up. Folder/path query parameters
survive reload. `filesystemClient.ts` negotiates capabilities and polls exact
owner-scoped commands; `filesystemTransfer.ts` preflights recursive copies and
checks source versions before cross-location move cleanup. See
[the remote file contract](../remote-files.md) for bounds and failure semantics.

Stored files remain protected attachment Things with purpose `file`; imports
use `file-import` drafts and `recordingTransfer.ts` preserves the purpose.
`test:things` covers orchestration, client retry identities and portable file
contracts; `test:devices` covers leases, private result expiry and byte redaction.
Native `RemoteFilesystemTests` exercise actual temporary-directory bytes and
no-follow operations. The manual checklist is “Remote brightness and files”.

## Editable Builder definitions

`Builder/DefinitionEditor/ThingDefinitionEditor.tsx` exposes owner-only fields
and source editing through the canonical Things update path. Component/page
menus and the Action inspector reuse it. It preserves Thing identity and ACLs,
replaces the validated crystal, and refuses stale `expectedUpdatedAt` writes.
Workspace ownership enables this editor and Builder duplication offline for
anonymous and remembered account workspaces; sharing still requires login.
`definitionDraft.ts` validates recovery envelopes separately from unfinished
JSON and preserves raw numbers, field expansion and editor mode. Content writes
use `createWithDraft` and never await recovery/Timeline queues. Component source
controls use `componentSourceDraft.ts`; recovery does not bind or execute Actions.
`accountApi.client.ts` and `api.client.ts` route ordinary private forks/copies
through canonical local export/import; dedicated media/managed paths remain guarded.
See [browser Actions and editor checks](../builder-browser-actions.md) and the
[local recovery checkpoint](../local-workspaces.md#builder-definition-and-source-control-recovery-checkpoint--2026-10-16).


## Web standards app

Worker-compatible Web API member recipes live in `app/webPlatform/webApiFixtures.ts`.
They preserve complete editable programs when saved as Components; native
receiver results are projected into bytes, entries, text and geometry values.
`eventFixtures.ts`, `streamFixtures.ts` and `controllerFixtures.ts` add listener,
abort, stream and controller lifecycles. Shared data-node constructors live in
`programBuilders.ts`; the runtime continues to execute complete saved programs.

`schemas/appSuites/webStandards.ts` authors the reusable page/components/actions.
`webPlatform/` holds the versioned inventory, recipe generator and generic
isolated data-program runtime. Saved examples use ordinary Component Things,
not native page blocks. See [runtime and coverage](../web-standards-builder.md).
`test:web-platform` validates every catalogue definition and generic worker
behavior; `audit:web-platform` executes interactive recipes in a fresh browser
against a local or HTTPS preview runtime, without creating account data.
`javascriptSyntax.ts`, `javascriptSymbols.ts`, `javascriptDefinitions.ts` and
`javascriptControl.ts` author language/symbol fixtures, including classes,
functions, generators and control flow. `interfaceProbe.ts` inspects browser
descriptors without executing getters. `workerLifecycle.ts` separately bounds startup and execution, with
controlled-clock regressions for timeouts, cancellation and duplicate readiness.

`webPlatform/draft.ts` supplies the shared Run/Save snapshot. The authored
`save-draft` Action stores a complete private Component, and `componentTemplate.ts`
keeps its program data opaque. `schemas/actionJsonInput.ts` and
`api/utils/actions/actionInputs.ts` validate reusable JSON inputs; the generic
form boundary decodes JSON text before transport. Regression coverage lives in
`webPlatform/draft.test.ts`, `actions/actionInputs.test.ts` and the form tests.

`domFixtures.ts` adds detached DOM receiver examples. `domBridge.ts` implements
bounded native member calls through worker messages; `domProtocol.test.ts` and
`workerLifecycle.test.ts` cover that transport and lifecycle. Programs remain
ordinary saved Component data. See the detached-context limits and browser
acceptance checklist in the runtime documentation and `TESTING.md`.

`rangeFixtures.ts` adds editable live/static range programs. Boundary inputs,
operations and projections survive ordinary Component serialization; no new
Thing kind, collection or persistence path is involved. See
[live and static ranges](../web-standards-builder.md#native-live-and-static-ranges).

`animationFixtures.ts` authors 111 reusable animation programs. Keyframes, timing,
callbacks and native operations are complete saved Component data; existing
catalogue/save Actions and private Thing serialization remain canonical. See
[native animation programs](../web-standards-builder.md#native-web-animation-programs).

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

Timeline large-version retention uses `timeline/snapshotParts.ts` as the shared
part/reference contract and `api/utils/timeline/snapshotParts.ts` for atomic
storage and checked reconstruction. Each part is its own protected Thing; event
headers stay bounded and carry no part-id arrays. The event accounts for original
retained bytes; part envelopes are control storage.

`ariaFixtures.ts` supplies 53 editable ARIA programs. Role/value inputs, selectors,
relationships and projections persist in ordinary Components through the canonical
suite Actions and can be referenced by another page. See [native ARIA programs](../web-standards-builder.md#native-aria-object-programs).

`traversalFixtures.ts` produces 41 reusable tree traversal programs. Synchronous filter definitions and explicit captured bindings persist as ordinary Component data. Live traversers and callbacks are recreated each run; the existing suite/save Actions and Thing API remain the only storage path. See [native traversal programs](../web-standards-builder.md#native-traversal-and-synchronous-callback-programs).

## Public built-in Schema Things

`registry.ts` projects every built-in definition, including root and physical-collection shapes, through the same Schema grammar used for user definitions. The existing fenced storage-accounting migration seeds public `schema-<id>` Things owned by `system`; reserved IDs prevent user squatting. `schemaCopies.ts` preserves fields, bounded JSON objects and render templates while adding `forkOf`. Schema browse/detail views copy any visible definition into an independent owned Schema; Lopu uses `get_schema` and `create_schema` with `extends` through the same validation. Copies do not authorize protected-kind writes or expose any record contents. `test:schemas`, `test:migrations` and `test:lopu` cover projection completeness, native write restrictions and extension limits.


`timelineConnectionForViewer` in `app/timeline/connectionPool.ts` guards both
missing viewer and missing connection before checking the cached account/data
plane. Signed-out pages and sign-out transitions return no Timeline connection;
`storageScope.test.ts` covers this alongside the existing scope isolation tests.


Named-branch merge review is `components/Timeline/TimelineBranchMerge.tsx`;
`TimelineVersionComparison.tsx` is shared with live restore/merge. The same
canonical local event and branch queue upload in parent-first order. The
read-only server preview and compact-version materializer live under
`api/utils/timeline/`. `test:timeline:branch-merge` covers the real API and
`timeline-folders.integration.mts` checks folder-move → draft reconstruction.


`TimelineBranchEditor.tsx` checks out an exact named head and reuses
`Builder/DefinitionEditor/DefinitionValueEditor.tsx` for fields. Changes use
`TimelineDraftRecorder`, the canonical local event store and the existing branch
queue. `timeline/branchCheckout.ts` owns the bounded transient checkout contract;
`api/utils/timeline/branchCheckout.ts` reconstructs private historical content.
`test:timeline:branch-merge` also checks real checkout, edit, retry and divergent
push preservation. The visual Builder still edits the published Thing.


Visual branch checkout uses `Builder/BranchWebpage.tsx`,
`useBranchWebpageDraft.ts` and `branchWebpageCore.ts` over the same
`timeline/branchWorkingCopy.ts` / `useTimelineBranchDraft.ts` field-editor model.
`LiveWebpageView` accepts either adapter; a branch never mounts the published
writer or AI save bridge. Draft/cache/outbox schemas are unchanged. See
[visual named-branch editing](../unified-timeline.md#visual-named-branch-editing--2026-09-28).


Recorded component definitions use `timeline/componentBindings.ts`,
`useCapturedComponents.ts` and `components/Timeline/TimelinePagePreview.tsx`.
`api/utils/timeline/componentBindings.ts` captures direct page dependencies in the
content transaction; `service.ts` batches their private reads after a byte-budget
preflight. Device drafts use the same event/link records and outbox. The visual
branch adapter defaults to recorded definitions, with an explicit current preview.
Run `test:timeline:components` on the guarded local replica set; see the recorded
component section in [Unified Timeline](../unified-timeline.md).


Named-branch component merges use `timeline/componentMerge.ts` plus the existing
`TimelineBranchMerge.tsx` and shared inert `TimelinePageCanvas.tsx`. Selected
canonical captures are cached before the merge event and guarded branch push.
Transient comparison maps never become parent-document history arrays. See
`test:timeline:component-merge` and the Unified Timeline acceptance notes.

Published restoration uses `timeline/publishedVersion.ts` for the shared bounded
protocol and `api/utils/timeline/publishedComponents.ts` for recorded/live
comparison and deterministic copy planning. `componentDefinitions.ts` supplies
the atomic merge and stable block alignment; `TimelineVersionActions.tsx` and
`TimelinePublishedPagePreview.tsx` share the inert canvas and comparison UI.
Canonical create/update utilities compose copy inserts, accounting and Timeline
records in the same transaction, deferring creation effects until commit.
Run `test:timeline:published-components` on the guarded replica and `test:timeline`.


The History browser is available at `/history` and in the Things navigation.
`TimelineEventBrowser.tsx` is the shared List/Cards/Line/Frames presentation;
`timeline/browserModel.ts` derives historical labels/filters/coordinates from
canonical cached records. It shares TimelineHost's version details and commands.
[Design mapping](../timeline-design-integration.md) records the source concept,
loaded-window filter boundary and remaining features.

Page + related History (`api.timeline` 1.13.0) uses
`api/utils/timeline/relatedHistory.ts` and the existing authorized composition
resolver. It merges only owned source histories with one bounded target query;
`timeline/relatedHistory.ts` validates the cursor membership projection and
`relatedHistoryCache.ts` stores eight disposable scoped hints. UI and canonical
IndexedDB records are shared. See `test:timeline:related`, `test:timeline`, and
[the design limits](../timeline-design-integration.md#page--related--2026-09-30).

Deleted Thing recovery (`api.timeline` 1.14.0) uses `deletedThing.ts` for trusted
deletion/absence checks, `publishedHead.ts` for the reserved canonical main head,
and the existing `versions.ts` service for preview and atomic create-after-delete.
`branchEnvelope.ts` shares Mongo envelopes with named branches; local IndexedDB
uses the same branch/head schemas. `TimelineVersionActions` reviews private
recovery and the original ID. Existing component-copy, quota and receipt paths
remain shared. Run `test:timeline:recovery`; see the acceptance boundaries in
[Unified Timeline](../unified-timeline.md#deleted-thing-recovery--2026-09-30).

## Anonymous draft preview

`app/draftPreview/` hosts the canonical schema/transfer/resolver and native
HTML/page renderers without an account runtime or storage. The static entry is
`/draft-preview/index.html`, linked from Builder. `MCP/src/renderExport.ts` and
`renderWorker.ts` expose bounded offline PNG/JSON artifacts through existing
stdio MCP. See [connection, security scope and acceptance](../no-login-draft-preview.md).
`test:draft`, the opt-in MCP browser tests and `draft-roundtrip.integration.mts`
cover this boundary; existing account drafts and import permissions are unchanged.


## Password manager

See [password-manager.md](../password-manager.md). `api.passwords` 1.0.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
Native integrations live in `apple/Passwords`, `apple/PasswordProvider`,
`iOS/Thingtime/Web/PasswordBridge.swift` and `electron/lib/password-provider.cjs`.

## Browser workspace adapter (in progress)

`app/local-workspace/things.ts` reuses the canonical crystal, extended and tag
validators, component selector and transfer collector. `accountSync.ts` adds an
atomic account queue and conditional conflict resolution; `accountApi.client.ts`
intercepts supported owned creates/updates/reads before the remote adapter.
`accountTransport.client.ts` pins actor/data-plane headers. Unsupported fields
must never be silently dropped. Anonymous storage has no account sync transport.
The completion matrix and exact local verification limits are in
[local-workspaces.md](../local-workspaces.md). Run `npm run test:local-workspace`
from `remix/` alongside the existing Things suites.

Anonymous themes use the dedicated `app/local-workspace/themes.ts` writer, with
shared `app/theme/savedTheme.ts` normalization and portable theme validation.
The generic local writer still rejects protected kinds. Local transfer imports
validate and normalize themes, remap IDs and enforce the shared theme quota in
one transaction; imports never select or publish a theme. Account theme sync and
local Timeline integration remain outstanding (see `docs/local-workspaces.md`).


## Anonymous Action execution

`app/actions/runtime.ts` owns the shared bounded data interpreter. The server
adapter remains in `app/api/utils/actions/execute.ts`; the isolated anonymous
adapter is `app/local-workspace/actions.ts`. Both retain the canonical saved
Action grammar and capability envelopes. Browser flows reuse the existing interpreter. `local-workspace/actionRequests.ts`
adapts supported Things CRUD and data-Action requests without HTTP; unsupported
services fail explicitly. Remaining endpoint adapters and account execution/sync are still pending.
Web Platform execution now uses the same compiled runtime in a sandboxed offline document. Protected local `action-run` children are bounded and excluded from
transfer; they do not substitute for canonical Timeline history.
`useWorkspaceScope` partitions Action view/cache identity, while the shared
`ThingDefinitionEditor` uses local drafts for anonymous definitions. See
[local workspace coverage](../local-workspaces.md) for the remaining merge gate.


Local page source availability and full workspace cache scope live in
`Builder/webpageRuntime.tsx`; `liveComponent.tsx` and `useCollectionSource.ts`
execute through the existing API adapter. `sourceWorkspace.browser.test.ts`
verifies real local Action execution/refresh and inert/identity boundaries;
`webpageRuntime.test.ts` covers account/origin/data-plane cache separation.
See [the local source checkpoint](../local-workspaces.md#local-page-sources-checkpoint--2026-10-16).


Bundled suite installation shares `schemas/suiteInstallation.ts` between the
existing server adapter and `local-workspace/suites.ts`. `LocalThings.atomic`
reuses normal validators/quota checks for one install transaction. The gallery
and control fallbacks use `Builder/installSuite.ts` to choose the current
workspace. `suites.test.ts` covers all bundles, concurrent install, normalization,
edit preservation, rollback and canonical transfer. `actionRequests.test.ts`
covers the closed no-network request host; `suites.browser.test.ts` is the opt-in
clean offline gallery/edit/save/reload test. It verifies cold offline native execution, workers, form events and error/Stop
behavior under production CSP. `scripts/platform-runtime-plugin.mjs` packages the
compiled renderer as a virtual document; `scripts/platform-runtime.mjs` pins its
only script by hash. Embed/draft bundles keep the standalone URL. Vite preview
uses the production app CSP plus the existing isolated-runtime CSP middleware. See the dated checkpoint in
[local-workspaces.md](../local-workspaces.md).


Library text search uses `local-workspace/librarySearch.ts` behind the explicit
`workspace: true` API option. `accountApi.client.ts` returns local content first,
then owner-filtered remote results with separate remote/pending continuations in
`searchCursor.ts`; identity leases and aborts retire stale results. The Things UI
keeps content on errors, offers Retry and load-more, and labels visible selection
checkboxes. Structured/public search is a separate unfinished local adapter.
`librarySearch.test.ts`, `searchCursor.test.ts`, adapter tests and the opt-in
`search.browser.test.ts` cover this path. See the dated search checkpoint and
remaining matrix in [local workspaces](../local-workspaces.md).


Anonymous ordinary content mutations now append canonical history through
`local-workspace/timeline.ts` in the same workspace transaction. It reuses
`timeline/thingContent.ts`, normalized event/link records, the local page resolver
and shared component captures. `TimelineProvider` connects the existing history
UI and draft queue to this isolated authority and captures its connection API
facade. No account Timeline requests or authority are borrowed. Run
`test:timeline`, `test:local-workspace`, `test:things` and the opt-in
`timeline.browser.test.ts`. See the dated Timeline checkpoint and still-open
restore/merge/export/account-sync matrix in [local workspaces](../local-workspaces.md).


Anonymous contextual owner notes use `local-workspace/timelineNotes.ts` with the
shared note validators and the existing Timeline queue. They are separate scoped
records, batched with History pages and included in their byte budget. Atomic
caps and content-free deletion markers prevent cross-tab overfill and delayed
retry resurrection. `timelineNotes.test.ts` covers those boundaries and
`timeline.browser.test.ts` covers offline save/reload/remove and actionable
refusals. Lopu explanations retain their real account/provider requirements.


Version name mutation/replay semantics are shared in
`timeline/versionNameMutation.ts`. The existing server adapter retains its
transactions and protected writer; `local-workspace/timelineVersionNames.ts`
commits canonical names/effects and clear-revision metadata atomically in the
anonymous namespace. `timelineVersionNames.test.ts` covers replay after later
changes, concurrent CAS, rollback, damaged metadata and scope isolation. The
ordinary offline History browser test includes name/rename/clear/reload. Run
`test:timeline:versions` against its disposable replica for server regression;
the script now binds the response to the exact sent operation ID and cleans up
only Things it created, including after a test failure.


Anonymous variations use `local-workspace/timelineBranches.ts` behind the
existing Timeline facade and durable working-copy queue. Canonical branch/head
records and effect receipts are unchanged. Shared `timeline/branchMutation.ts`
and `timeline/versionGraph.ts` enforce replay, CAS, bounded ancestry and fixed
historical checkout for both authorities. `BranchWebpage` accepts the exact
local owner/plane pair via content identity; global account data-plane validation
is unchanged. Native Builder edits remain isolated from the current Thing, and
branch Actions/live data stay paused. Run the local branch tests, offline History
browser test and disposable `scripts/timeline-branches.integration.mts` for
account writer parity. Account offline sync remains pending.

Branch comparison is shared in `timeline/branchMergePreview.ts`; bounded recorded
component reads use `timeline/recordedComponentReader.ts`. Anonymous `LocalTimeline`
binds both to one readonly workspace transaction. `timelineBranchMerge.test.ts`
covers conflict choices, exact captures, preflight byte limits, stale heads and
scope refusal; the offline browser and real API branch checks cover canonical
merge save/reload without changing the current Thing. Current-content
restore/undo/merge now shares `timeline/versionPlan.ts` and
`publishedComponentTools.ts` with account Timeline. `timelineVersions.ts` supplies
anonymous readers and uses `LocalThings.versionTransaction` for normal validation,
placement, quota and atomic content/copy/capture writes. Hashing stays outside IDB;
head/timestamp/component preimages are rechecked inside the write transaction.
`timelineVersions.test.ts` covers replay, recovery, races, copy isolation,
validation and rollback. The ordinary offline browser test and both guarded
version/component API integrations cover the native flow and account parity.
Historical export now uses shared `timeline/exportVersion.ts`; `LocalTimeline`
binds it to one readonly anonymous transaction. The same version archive retains
content, notes, name and canonical dependency references. It is distinct from a
portable Thing transfer: restore recorded content/components, then use normal
Thing export/import for that workflow. `timelineExport.test.ts`, the offline
History browser download and real version API integration cover both paths.
`LocalThings.hasReference` routes restored copies and retained deleted identities
within the anonymous partition. GenericThingPage uses workspace ownership;
PostCard comments/replies use matching local author projections. Local Actions
and interactions resolve targets through scoped storage, never an ID prefix.
`restoredRouting.test.ts` and the offline History/detail browser tests cover
public/account isolation and native restored-copy editing.
Page + related History now uses `local-workspace/timelineRelated.ts` to traverse
only the active anonymous partition, with canonical composition references and
component selection. Shared `timeline/relatedHistory.ts` supplies request checks
and the sorted membership digest to both account and browser readers. Browser
hashing occurs between readonly transactions; membership is rechecked before
reading events. Changed cursor membership resets both paging directions, while
a change between the two reads returns an explicit retry error. The offline
History browser regression includes filter selection, cold reload, responsive
bounds and membership replacement after restore. `timelineRelated.test.ts`
covers args, aliases, caps, cycles, scope isolation and transaction races; the
guarded `timeline-related.integration.mts` verifies the real account API and
cleans up its own fixture Things. Protected histories and account sync remain
pending.


Anonymous Timeline library discovery uses `localTimelineFolder` in
`local-workspace/timeline.ts` and `LocalThings.librarySnapshot` for managed
read projections. `snapshot` stays authored-content-only; normal mutations and
transfers cannot alter/copy the History container. `api.client.ts` routes its
exact reserved identity locally, including an empty workspace's not-found read.
`ThingsPage` only negotiates remote rename capabilities for account operations.
Run `test:local-workspace` and `timeline.browser.test.ts` with a production client
build; it defaults to actual offline emulation and refuses recovered module
errors. See the managed-folder checkpoint in `docs/local-workspaces.md`.


Account bulk moves now enter the existing sync queue through the `LocalThings.move`
mutation hook, in the same transaction as placement and revision. The account API
hydrates only missing owned sources/ancestors, guards mixed pending/managed
batches and overlays local placement on fresh/cached folder listings. Remote
flush still uses conditional Things PATCH with exact actor/data-plane headers.
Guarded remote API methods reject promises while unconfirmed; optional archive
metadata probes can handle that refusal without crashing cold offline folders.
`accountMove.browser.test.ts` uses `TT_LOCAL_ACCOUNT_MOVE_URL` (disposable local
server only), `TT_SHARED_PLAYWRIGHT_PATH`, optional `TT_SHARED_CHROME_PATH` and
`TT_LOCAL_ACCOUNT_MOVE_ARTIFACTS`. It creates/cleans its own private fixture and
checks normal Move UI, cold reload, server-before/after state and responsive
bounds. See [account move acceptance](../local-workspaces.md#account-folder-moves--2026-10-16).

## Device definition catalogues

`app/local-workspace/definitionCatalog.ts` filters and pages local schema and
component snapshots. `ComponentsLibrary/bundledComponentCatalog.ts` projects the
existing bundled suites without persisting or assigning ownership. Catalogue and
detail editors use `drafts/useComponentVersionDraft.ts`; canonical Thing creation
is independent of ancillary draft saves. Run `test:components`, `test:drafts`,
`test:local-workspace` and the opt-in `components.browser.test.ts` flow described
in [local workspaces](../local-workspaces.md). Remote account authorization and
component trust/source confirmation remain separate from local ownership.


Global/site page definitions share `app/schemas/sitePages.ts` between the server
seed and local Builder. They remain canonical webpage Things, privately owned
in the selected workspace. `local-workspace/runtime.client.ts` broadcasts only
scope invalidation after writes; recipients ignore other account/origin/data-plane
scopes. `siteBlocks.browser.test.ts` verifies anonymous offline edits, scoped
account sync, normal import remapping and native source rendering. See the
[local workspace checkpoint](../local-workspaces.md#global-and-site-blocks--2026-10-16).


Account ordinary deletion is handled by `local-workspace/accountSync.ts` and the
existing `accountTransport.client.ts` conditional DELETE. Intent and content
removal share a workspace transaction; pending before-images use the existing
storage quota, and acknowledged tombstones suppress stale cache resurrection.
Folder drains and target-linked deletions order their dependencies; reviewed
child restoration blocks an outstanding parent cascade. `AccountSyncStatus.tsx`
provides explicit review and restore/delete choices. `ThingsPage.tsx` refreshes
visible folders on scoped local changes. `accountDelete.test.ts` and its browser
counterpart cover failure/retry, scope and real offline UI behavior. Protected
kinds retain their dedicated adapters; see the outstanding acceptance matrix.


`utils/thingTransfer/importContent.ts` contains the shared account import ordering
and independent-copy crystal preparation. `importTransfer.ts` reuses it on the
server; `LocalThings.import` uses it for account copies and calls the existing
mutation hook in the same transaction. `accountApi.client.ts` routes ordinary
JSON imports into that queue, with managed/file imports retaining their dedicated
adapters. `accountImport.test.ts` covers rollback, frozen retries and references;
`accountImport.browser.test.ts` covers the normal dialog offline and a real server
export/import round-trip. Offline account export completeness remains a separate gate.


Account Download uses `local-workspace/accountExport.ts` and the shared
`exportLocalThingSnapshot` collector. `AccountThingSync.exportSnapshot` captures
content and queue/tombstones together. Complete canonical online plans supply
scoped export-only dependency snapshots; partial library pages never establish
completeness. The existing account transport now also serves export preparation
with actor/data-plane headers and capability negotiation. `accountExport.test.ts`
covers missing coverage, stale copies, pending edits, alias ownership, quota,
cancellation and identity fencing. `accountImport.browser.test.ts` exercises
real offline normal-dialog downloads and round-trips the downloaded file.
Saved standalone account files now participate in this collector (see the file-transfer checkpoint below); linked-gallery and managed-account offline export remain separate work.


Account catalogue discovery uses `accountThingTransport.browse` and bounded
`AccountThingSync.rememberMany` to retain only owned Component/Schema definitions.
Online projections retain shared entries without giving them local ownership.
`useWorkspaceRefresh` coalesces scope-only invalidations for device catalogues
and Component detail; family rosters clear before re-reading. See the
[account catalogue checkpoint](../local-workspaces.md#account-catalogue-discovery-and-cross-tab-refresh--2026-10-16).


Anonymous bundled Component bookmarks/reactions use `LocalInteractions` with an
exact code-shipped resolver supplied by `anonymousApi`. Only relational children
are stored; bundled targets remain read-only and outside Mine/ordinary export.
`browseLocalDefinitions` includes bookmarked bundled entries and sorts Library by
save time without changing projected definition timestamps. Existing scoped
refresh handles changes from other tabs. Account interaction sync remains a
separate gate; see the [bundled Library checkpoint](../local-workspaces.md#anonymous-bundled-bookmarks-and-reactions--2026-10-16).


Account ordinary exports now include new or retained standalone device files via
`AccountFileSync.library/readFile`, with canonical media rewriting and immutable
scoped readers. `accountFileExport.test.ts` covers repeat export, aliases, bytes,
deletions and scope; its production-client browser fixture covers normal Download
and anonymous round-trip Import. See [remaining file-transfer work](../local-workspaces.md#account-file-transfer-exports--2026-10-17).
