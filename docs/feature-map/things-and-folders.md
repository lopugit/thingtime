# Things and folders

Local browser `http.request` Actions use `local-workspace/actionRequests.ts` for
editable Things CRUD, owner-scoped search and bulk move/copy/delete. Bulk selection
has no additional item ceiling; sequential ordinary writes retain interpreter
budgets, cancellation and per-item results. `actions.ts` binds account moves and
deletes to `AccountThingSync` so content and queue intent commit together. Copies
use canonical export/import, require a complete device closure for account
Actions, and refuse protected child content before writes.
Regression: `actionRequests.test.ts` and `accountActions.test.ts`. `sharedCopy.browser.test.ts` seeds a synthetic saved browser Action, runs it with the normal Action page button offline, and reads theme/algorithm changes and history after cold reload; its fixture never invokes the interpreter. Normal transfer
selection uses `thingTransfer/readFile.ts` without a separate selected-file cap;
`transferBatch.browser.test.ts` exercises 20 JSON files through the offline native
dialog and cold reload (`TT_DRAFT_WEB_BASE`, `TT_DRAFT_ARTIFACT_DIR`, shared browser
paths). Canonical transfer budgets and protected-kind request refusals remain.

Account native copy/fork uses `accountApi.client.ts` with the existing scoped
`accountExport.ts` Blob plan and `LocalThings.import` transaction. An internal
commit callback rechecks source refusals/deletion, file metadata/bytes and
protected library state after hashing, in the same transaction as copied
content and file/content queue intents. Account file aliases map to the new
root explicitly. Folder deletion drains surviving file children through
`AccountFileSync.contentHooks.mutate`. `accountCopy.test.ts` covers these paths,
atomic failure, selections above 200 items and deep folder traversal;
`accountFileCopy.browser.test.ts` covers normal native Duplicate with exact
bytes, cold reload and independent reconnect queues (no shared-Fork UI claim).

Native transfer export carries Blob handles through `collectTransfer`,
`exportLocalThingSnapshot`, `accountExport.ts` and `bundleFromPlan`. Downloads use
the chunked Blob ZIP encoder; byte/clipboard compatibility callers materialize only
their final serialized output. Prepared anonymous bundles preserve identity and
cancellation fences; account file availability remains scoped. Regressions:
`transferBlobs.test.ts`, `accountFileExport.test.ts`, `api.client.test.ts` and
`thingTransfer/{browser,collect}.test.ts`. See the
[export checkpoint](../local-workspaces.md#blob-export-collection--2026-10-18) for
native acceptance and remaining retention/transport work.


Normal account ZIP import uses `local-workspace/accountImport.ts` for shared
UI/facade routing, and `AccountThingSync` plus `AccountFileSync.contentHooks`
for atomic local admission and receipt-dependent media remapping. Regressions:
`accountFileImport.test.ts` and opt-in production-client
`accountFileImport.browser.test.ts`. Standalone files, recordings, post/comment files and ordinary content use this path.
`accountBoundImport.test.ts` covers ordered bindings, private receipt-dependent
sync, exact-byte round trips and atomic refusal. Linked and managed imports
remain separate acceptance work. Native
library bulk deletion routes saved files through `AccountFileSync`, cancels
unstarted uploads and reports partial failures without a remote fallback for
device bytes. Regression: `accountApi.test.ts` and
`accountRecordingImport.browser.test.ts`.
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

Known account read refusals invalidate retained export closures through
`local-workspace/accountReadRevocation.ts`. `accountExport.ts` supplies an
in-process availability fence used by the canonical transfer browser/archive
helpers before returning bytes. `AccountFileSync.assertFileReadable` shares the
live file metadata check with byte reads. Regressions: `accountReadRefusal.test.ts`,
`accountExport.test.ts`, `accountFileExport.test.ts`, and opt-in
`accountExportRefusal.browser.test.ts` (existing local file-export fixture env).

## Where the code lives

| Concern | Path |
| --- | --- |
| Canonical Thing utilities: `createThing`, `updateThing`, `deleteThing`, `listThings`, `getThing`, `findViewableThing`, projections (`toPublicThings`, posts) | `app/api/utils/things/things.ts` (large; grep the export you need) |
| Folder rules (`resolveFolderAssignment`, `FOLDER_UNFILEABLE`, cycle checks) | `app/api/utils/things/things.ts` (`folderId` handling) |
| Bulk move/copy/delete/share | `app/routes/api/v1/things/bulk` |
| Thing routes | `app/routes/api/v1/things/_things.tsx` (GET/POST/PATCH/PUT/DELETE) plus `export`, `import`, `fork`, `share`, `react`, `comment`, `save`, `vote`, `updown`, `views`, `search`, `feed`, `trending`, `rss`, `reveal`, `actions` |
| Portable transfer (export plan, ZIP/JSON bundles, import) | `app/api/utils/things/exportTransfer.ts`, `importTransfer.ts`, `app/utils/thingTransfer/*` (client: `browser.ts`, `archive.ts`) |
| Independent sealed backup copies | `app/api/utils/backups/portableBackup.ts`, shared `backupObjectKey.ts`, `localBackupStore.ts`, `s3BackupStore.ts`; native/worker pipe entry `scripts/backup-replica.mts` (`backup:replica`), transport/resume tests in `s3BackupStore.test.ts`. Same portable v1 format; explicit vault credentials, no ambient provider configuration. Setup and incomplete live-provider/UI gates: `docs/portable-backups.md#independent-s3-replica-worker` |
| Kind schemas and protected kinds | `app/schemas/registry.ts` (`PROTECTED_THINGTIME`, `folderSchema`, `isProtectedThingtime`) |
| Indexes | `app/api/utils/mongodb/collections.ts` `ensureIndexes()` (central registry; new indexes are rare, evidence-backed exceptions) |
| Internal point-in-time owner inventory (managed-family coverage incomplete) | `app/api/utils/backups/accountInventory.ts`, `withHomeMongoSnapshot` in `collections.ts`; canonical snapshots plus all seven Timeline record families via `backups/timelineRecords.ts`; ready attachment bytes and file-history dependency checks via `backups/attachmentRecords.ts`; offline current/version reads via `accountFileRecovery.ts`; exact draft/template/tombstone records and media dependencies via `draftRecords.ts`; large canonical ordinary content via `thingSnapshots.ts`; saved canonical themes via `themeSnapshots.ts`; approved account profile/private preferences and exact profile-media closure via `accountSnapshots.ts` and shared `timeline/accountContent.ts`; bounded owner/ID paging, modern index plan only. Contract: `docs/portable-backups.md` |
| Shared event/link records, IndexedDB relational queue/index, bounded cache, draft recorder and account sync | `app/timeline/` (`records.ts` and `branches.ts` are the identical local/remote durable schemas) |
| Transactional history recording, protected binary event Things and paging | `app/api/utils/timeline/` |
| Trusted Action/AI attribution and relational operation grouping | `app/api/utils/timeline/mutationContext.ts`, established by `actions/execute.ts`, `actions/firstPartyActionHost.ts` and `lopu/chatTools.ts`; not request-controlled |
| Shared History modal and managed Timeline folder | `app/components/Timeline/TimelineHost.tsx` |
| Account/database-qualified History links and Thing caches | `app/utils/dataPlane.ts`, `app/hooks/useDataPlane.ts`, `app/routes/thing.tsx`; root identity invalidation also handles database selection across tabs |
| Approved saved-theme content history, home transaction and retained deletion accounting | `app/timeline/themeContent.ts`, `app/api/utils/timeline/themeContent.ts`, dedicated `app/api/utils/themes/themes.ts` writer |

Local-capable details use `local-workspace/posts.ts` for the separate generic
Thing discussion projection and `api.client.ts` for paged local comments.
`ThingComments.tsx` keys its state by the full workspace identity.
`PersistedThingMenu.tsx` uses workspace ownership for rename and local-capable
History while retaining real account authentication for recording handoff. The API adapter owns
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

See [password-manager.md](../password-manager.md). `api.passwords` 1.1.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
Native integrations live in `apple/Passwords`, `apple/PasswordProvider`,
`iOS/Thingtime/Web/PasswordBridge.swift` and `electron/lib/password-provider.cjs`.

Stable file roots (`api.files` 1.0.0) use `api/utils/files/files.ts` with the
shared `fileSync/cloudFile.ts` contract and `file-content` Timeline snapshots.
Their byte versions are canonical bound attachments. `ownerLibraryQuery.ts`
lists live roots once; existing managed placement/recordFolderPlacement handles
file moves and folder deletion. `test:files` and `file-versions.integration.mts`
cover the API; see the full mobile sync ledger for pending product integration.


Android offline folders use the bounded native `ManagedFileStore` catalog and
`OfflineDocumentsProvider`, exposed only after the native `FolderBridge`
creation consent. Android Files gets read-only document snapshots; editable
connection Things and Timeline remain shared. `OfflineDocumentsProviderTest`
and the opt-in `THINGTIME_OFFLINE_FILES_TEST=1` installed-app flow cover root
visibility, ancestry, read-only handles, migration and real picker/byte reads.
See [mobile sync](../mobile-file-sync.md) for pending download integration and
the broader cross-device requirements.


Android `ManagedFolderAccess` connects the shared foreground download target to
Thingtime offline roots. Publication bridge 1.1 requires each selected root's
capability, current OS read grant and native approval bound to the exact saved
connection. Generic SAF roots remain upload/read-only. The native catalog serves
stable scan/read versions and shared publication receipts; provider notifications
refresh Android Files. `media-cache-core.mjs` excludes pinned ranges, fingerprint
JSON and expected-actor/data-plane requests from media interception. See the
[download acceptance ledger](../mobile-file-sync.md).


`foregroundSync.ts` also executes two-way runs through the existing cloud and
native adapters. `MobileSyncConnections` obtains scoped native approval and
exposes Sync now only for publication-capable roots with deletes disabled.
`foregroundSync.test.ts` covers mixed-direction recovery and pre-effect conflicts;
Android's optional `THINGTIME_TWO_WAY_SYNC_TEST=1` checks actual mixed bytes and
independent edits. Mac adapters and native workers remain in the mobile sync ledger.


Apple native grants, scan/read and publication are now shared in
`apple/FileSync/Sources/AppleFileSync`; iOS `MobileFolderBridge` imports that
local package. `FileSyncOwnerScope` preserves the pairing/grant key and JSON.
`FolderBookmark` owns the iOS/macOS bookmark differences. Common folder and
publication tests live under the package; iOS retains its host bridge extensions.
The shared `PublicationProcessAcceptance` fixture runs through iOS's test host
and Mac's test-only child executable. `ThingtimeNodeCore/MacFolderSync.swift`
now wraps that package in local XPC dispatch, live paired-identity checks,
owner-scoped grants and configuration-bound native write consent. The Node app
owns picker/approval dialogs and endpoint-isolated staging. Generic/leased
commands cannot call it. `electron/lib/folder-sync.cjs` now verifies the active
Chromium account and selected origin around native dispatch. `DesktopFolderAccess`
reuses `MobileFolderAccess`/`MobileSyncConnections` through a `FolderHost`; the
desktop runtime maps canonical API requests onto the bundled cookie proxy and
preserves anonymous signed uploads. Native network/power conditions use the shared
contract. Installed acceptance, restart persistence and native streaming remain
pending; see the current release boundary in the mobile sync ledger.

Android staging 1.1 uses `FolderRangeSource` and `mobileRangeFrames.ts` for
nonce-bound, native-pulled binary WebView frames. `SyncStaging.appendRange`
retains the lock and checkpoints once per bounded range; older WebViews fall
back to staging 1.0. See the dated [sync ledger](../mobile-file-sync.md).

`fileSync/conflictResolution.ts` binds explicit file choices to reviewed stamps
and configured direction. `foregroundSync.ts` reauthorizes/rescans before the
existing durable run is created. `Devices/SyncConflictReview.tsx` supplies the
paginated review in `MobileSyncConnections`; cancellation/visibility changes
release the waiting review. `conflictResolution.test.ts`, `foregroundSync.test.ts`
and `file-sync-foreground.integration.mts` cover stale choices and receipt recovery.

## Retained file history

Device sync ignore rules use `fileSync/syncIgnore.ts` and the shared
`syncIgnore.fixtures.json` Git oracle corpus. `SyncIgnoreRulesEditor` exposes
editable Builder blocks, dependency-folder defaults and a path tester inside
`MobileSyncConnections`. Nonempty rules require configuration version 2,
`api.things` 1.38 and native file access 1.9; older clients refuse the policy.
Apple's `MobileFolderIgnoreRules` prunes matching entries before descent or
hashing. Planner/checkpoint journals preserve ignored baseline entries so a new
exclusion cannot become a deletion. `syncIgnorePolicy.test.ts` and
`scripts/test-sync-ignore-ui.mjs` cover policy changes, save-only behavior and
responsive Builder editing. See the sync ledger for installed acceptance.

`components/Timeline/TimelineFileVersions.tsx` renders canonical `file-content`
Timeline snapshots and uses `fileSync/fileVersions.ts` for content identity and
restore validation. `useApi().v1.files` reads/commits through the existing files
API with account/origin/home fences. Downloads use `attachmentContentUrl` and the
existing `getAttachmentDownload` permission gate. Restore commands persist only
retry metadata; bytes/history remain in accounted attachments and Timeline.
`fileVersions.test.ts`, `storageScope.test.ts`, `scripts/file-history.browser.html`
and `scripts/file-versions.integration.mts` cover this path. Installed native
History/download acceptance and native retained-version browsing remain open.


`NativeFileSession.swift` shares pinned-cookie, same-origin binary reads between
native History exports and iOS sync. Staging 1.2 accepts only pinned cloud file
metadata through `NativeCloudFile.swift`; `mobileStaging.client.ts` keeps the shared
journal/verification flow while the host fetches byte ranges directly. See the
[iOS native cloud range runbook](../../iOS/README.md#native-cloud-download-ranges)
and the corresponding `TESTING.md` checklist.


`SyncConflictReview` offers explicit Save versions and ignore for two existing
files. `MobileSyncConnections` shows muted saved confirmation only after the
foreground retention run completes and links to Timeline's Files view. Capture
keeps the conflict unresolved and the sync baseline unchanged. See
`docs/mobile-file-sync.md` for installed acceptance and whole-backup boundaries.


Android offline retained versions use `ManagedFileStore.versionList`,
`versionInspect` and `restoreVersion`, gated by `ManagedFolderAccess` and the
origin/account-authenticated `FolderBridge`. Schema 4 keeps the existing
immutable blobs and atomic receipts. `fileVersionsVersion` 1.0.0 enables the
version mode in `NativeFileRecovery`; `nativeRecovery.ts` validates saved intents
and `mobileFolders.client.ts` verifies native replies. `ManagedVersionTest`,
`NativeVersionAcceptance` and `native-recovery.browser.tsx` cover storage,
installed cancel/reload/copy restore and responsive controls. This is local
recovery; cloud versions continue through the canonical Timeline path above.


Android original-media backup uses `PhotoLibrary` (MediaStore) and the read-only
`PhotoDocumentsProvider` (system folder selection). `FolderBridge` requests
permissions only after native selection and rechecks access before disclosure.
`ManagedFolderAccess` projects source kind and current permission extent.
`fileSync/photoSourcePolicy.ts` enforces backup-only intent against fresh native
roots; `MobileSyncConnections` exposes the same editable connection Thing and
foreground pipeline. `PhotoLibraryTest`, `PhotoBackupAcceptance` and
`photoSourcePolicy.test.ts` cover original bytes, native permission boundaries,
read-only access and retained cloud copies. See `android/README.md` for setup and
`docs/mobile-file-sync.md` for bounded foreground coverage.

Apple photo originals use `apple/FileSync/PhotoLibraryReader` and the PhotoKit
`SystemPhotoResources` adapter. `MobileFolderStore` stores a read-only source
intent in the existing account/origin Keychain envelope. iOS `MobileFolderBridge`
owns native source/permission dialogs, rejects photo mutations and projects live
access into the shared backup-only editor. `PhotoLibraryTests` covers private
one-resource caching and authority boundaries; `PhotoBackupInstalledTests` drives
real original-byte cloud acceptance. See `iOS/README.md` for current local-original,
foreground and inventory limits. Installed Mac PhotoKit UI acceptance remains pending.

### iOS file-backed multipart upload path

`mobileFolderSource()` in `remix/app/fileSync/mobileFolders.client.ts` advertises
the optional native part uploader only for an explicit iOS capability. The shared
`cloudTransport.ts` keeps reservation, journal, composite-fingerprint and commit
logic. `iOS/Thingtime/Files/NativeUploadPartRequest.swift` validates source/part
identity; `MobileFolderBridge.swift` reauthorizes the scoped grant and delegates
to `apple/FileSync/Sources/AppleFileSync/FileUploadPart.swift`. That shared core
captures bounded folder/PhotoKit streams into private part files.
`NativeFileSession.swift` obtains signed parts from the pinned API session;
`NativeFileUpload.swift` sends a credential-free, redirect-refusing file PUT with
bounded responses/cancellation. `NativeFileUploadTests`, `FileUploadPartTests`
and `PhotoBackupInstalledTests` cover the unit and installed paths.

Mac Photos uses `MacFolderSyncDialogs` for explicit source selection/permission,
`MacFolderSync` 1.3.0 for account-bound read-only grants and binary ranges, and the
same `apple/FileSync/PhotoLibraryReader` as iOS. `MacPhotosSyncTests` and
`mac-file-sync.integration.mts --photos` cover native gates and real API transfers
with synthetic photo resources. Actual signed installed Mac PhotoKit acceptance
is separate. Usage strings belong in helper Info.plist and Electron extendInfo.

The iOS upload capability 1.1.0 adds `FileUploadPartStore.swift`, using the shared
`NativeFileJournal` for bounded durable upload bytes, original request identity,
rehash-on-reuse and exact grant cleanup. `MobileFolderBridge` revalidates the live
source and API reservation before reuse and releases only verified completions.
`FileUploadPartStoreTests`, `UploadPartProcessAcceptance` and
`test-upload-part-process.sh` exercise corruption, limits and real process exits;
the installed photo test checks cache cleanup. This remains foreground retry input,
not native background scheduling or a separate version-history database.

### iOS whole-file upload handoff

`fileUploadVersion` 1.2.0 connects `FingerprintSource.uploadFile` and
`cloudTransport.ts` to `NativeFileUploadJob.swift`. The native loop uses retained
parts and verifies the multipart composite before attachment completion; the
shared runner checks stored content and publishes the existing Timeline write.
`NativeUploadAuthorization.swift` checks the reviewed private configuration,
pairing and network/power conditions between parts. Capability 1.3 adds the
continued-processing lifecycle below; history remains in the shared Timeline.

### iOS continued-upload lifecycle

`NativeUploadBackground.swift` owns one registered iOS 26+ continued-processing
slot and its progress/expiry lifecycle. `MobileFolderBridge.swift` permits the
current upload while that lease is active and defers its result until foreground
owner revalidation. `nativeUploadBackground.ts` tracks exact native authority on
the runner's abort signal; `mobileFolders.client.ts` negotiates 1.3 acknowledgements
and visibility-aware inactivity deadlines. `MobileSyncConnections.tsx` preserves
only those acknowledged jobs on visibility changes; page exit still cancels.
Timeline publication stays in the shared runner. Scheduler refusal falls back to
foreground; actual background completion and relaunch acceptance remain open.


### Android current-file upload continuation

`NativeUploadContinuation.java` owns one nonpersistent, token-scoped OS lease.
`NativeUploadJobService.java` implements Android 14+ user-initiated transfer jobs;
`NativeUploadForegroundService.java` is the older Android compatibility service.
`NativeUploadStopReceiver.java` handles only the matching notification Pause.
`FolderBridge.java` separates notification preparation from upload authority and
holds completed replies until foreground account validation. Shared
`MobileSyncConnections.tsx` negotiates Android preparation before starting sync,
then uses the existing exact background acknowledgement and Timeline journal.
`NativeUploadBackgroundAcceptance.java` observes real API completion while the
activity is paused; `NativeUploadServiceTest.java` verifies OS lifecycle controls.
No process-relaunch scheduler or independent history store is introduced.

Cloud backup capture now streams `pendingBackupItems` to acquire/renew source
retention through attachment-content 1.15.0. A prepared inventory alone is not a
hold; only a verified completion seal proves independent bytes. Complete range
receipts skip source re-acquisition on retry, with full verification at sealing.
The [retention contract](../portable-backups.md#source-version-retention--2026-10-19)
tracks rollout, early-release/pruning and full-account limits.

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
validate and normalize themes and remap IDs in one atomic transaction; imports
never select or publish a theme. Device admission uses browser storage capacity,
without a fixed theme count. Dedicated account sync and device History are
covered below; native/API acceptance remains open (see `docs/local-workspaces.md`).


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
Saved standalone account files and locally held linked-gallery metadata now participate in this collector (see the file-transfer checkpoint below). URL metadata remains an external reference; managed kinds outside these dedicated adapters retain their existing export contracts.


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


The legacy generic editor tree now uses `local-workspace/editorTree.ts` and
`WorkspaceThingtimeProvider.tsx` for the shared scoped transaction/quota boundary.
Native `ThingtimeProvider` accepts this storage adapter; explicit flush lets
reviewed legacy copies finish independently of ancillary draft saves. Recovery
appears only on generic editor/view routes, not embedded foreign previews.
Run `editorTree.test.ts`, opt-in `editorTree.browser.test.ts`, generic draft
browser recovery and account draft/post independence regressions. Setup and
remaining gates are in [local workspaces](../local-workspaces.md#legacy-native-editor-tree-isolation--2026-10-17).


The generic Thing detail menu now offers existing History for scoped anonymous
ownership and retained offline account ownership. `TimelineHost` retires its target
on workspace-generation changes; account-only handoff remains authenticated.
`details.browser.test.ts` verifies anonymous cold-reload history and
`historyMenu.browser.test.ts` verifies cached account versions, native account
switching and desktop/390/320px interaction. Account-local history capture/sync
remains open in the [coverage matrix](../local-workspaces.md#native-anonymousoffline-history-menu--2026-10-17).


Account device History uses `local-workspace/thingChanges.ts` to capture before
and after values atomically, and `accountTimeline.ts` to retain the canonical
normalized events/links in the existing account partition. `scopedTimelineStore`
merges these authoritative versions into the established History cache/sync/UI.
Server receipts remain authoritative; uploaded device versions use client/draft
provenance. Tests: `accountTimeline.test.ts`, opt-in
`accountTimeline.browser.test.ts`, and `historyMenu.browser.test.ts`. See
[coverage and remaining controls](../local-workspaces.md#account-device-history-capture-and-sync--2026-10-17).


Account History Export uses `local-workspace/accountTimelineExport.ts` over the
existing scoped Timeline stores. `accountApi.client.ts` exposes local capability
to the normal version controls and permits verified network fallback only for
missing retained history. `timeline/exportVersion.ts` owns shared materialization
and archive validation; server receipts remain mandatory on network reads.
`accountTimelineExport.test.ts`, `accountApi.test.ts` and the enabled native
`accountTimeline.browser.test.ts` cover offline downloads and identity fences.
See [remaining History controls](../local-workspaces.md#offline-account-history-export--2026-10-17).


Account restore/undo uses `local-workspace/accountTimelineVersions.ts` with the
shared `LocalTimelineVersions` authority seam and `timeline/versionPlan.ts`.
`LocalThings.versionTransaction` requires an account capture+sync adapter before
admitting account mutations. Accepted comparison bases retain their real receipts;
new device results remain drafts. `TimelineVersionActions` skips upload dependency
only for the matching local account capability. Regressions:
`accountTimelineVersions.test.ts`, `accountApi.test.ts`, and opt-in
`accountTimelineRestore.browser.test.ts`. See [remaining recovery/History gates](../local-workspaces.md#offline-account-history-restore-and-undo--2026-10-17).


Ordinary deleted account Things recover offline through `AccountTimelineVersions`
and the same `LocalTimelineVersions` transaction used by anonymous recovery.
`LocalThings.versionTransaction.recover` delegates queue reconciliation to
`AccountThingSync`: preserve frozen requests, advance the local revision, and
keep recovered content pending after a late delete acknowledgement. Regressions:
`accountDelete.test.ts`, `accountTimelineVersions.test.ts` and opt-in
`accountTimelineRecovery.browser.test.ts`. Attachment-bound/protected recovery
and broader acceptance remain open; see [local workspaces](../local-workspaces.md#offline-recovery-of-ordinary-account-things--2026-10-17).


Account History names use `timeline/nameQueue.ts` with canonical name commands
and accepted records in the existing scoped IndexedDB backend. `TimelineSync`
freezes requests, rebases unsent successors and preserves ambiguous retries;
`TimelineProvider` gates remote work while offline. Account note controls finish
after local queueing, independently of remote sync. `accountTimelineExport.ts`
uses accepted retained names only. Tests: `nameQueue.test.ts`,
`accountTimelineExport.test.ts`, v6 migration in `indexedDb.test.ts`, and the
README-enabled native `accountTimelineNames.browser.test.ts`. Client drafts now use
the shared `canNameTimelineVersion` eligibility rule and the same queue/authority
contract (`api.timeline` 1.20.0). Names wait for the exact draft acknowledgement
without changing its provenance. Anonymous draft exports reuse
`createVersionExportReader` with local authority and no account fallback.
Regressions extend `accountTimeline.browser.test.ts`, `timeline.browser.test.ts`,
`timelineVersionNames.test.ts`, `timelineExport.test.ts` and name queue tests.
See the local workspace matrix for remaining broader coverage. Pending-note removal uses
`TimelineNoteStore.ready` to wait for its exact add acknowledgement. IndexedDB
v8 adds one read revision fence per scope; old reads and duplicate add replies
cannot recache removed notes. The shared `TimelineNoteRemoval` record replaces
the removed protected note payload on the account and upgrades existing local
`timeline-meta` removal markers. `api.timeline` 1.19.0 advertises durable removal;
`test:timeline:notes` checks real transaction races and delayed replay refusal.

Anonymous saved themes use the shared approved `theme-content` snapshot in
`local-workspace/themes.ts` and `timeline.ts`. `timeline/exportVersion.ts` keeps
that protected projection in History downloads for local and account authority
(`api.timeline` 1.21.0), without widening generic mutation/restore permissions.
`AccountThemeSync.mutated` also records device-authored theme changes through
`accountTimeline.recordAccountThemeChange`: content, intent and normalized History
commit together. Only this dedicated writer supplies the approved before/after
projection; generic account captures still reject protected kinds. Hydration,
selection and remote acknowledgements do not author edits. The existing History
queue and version exporter consume these private drafts without inventing server
receipts or waiting for theme-content sync. `scopedTimelineStore` includes this
account's authored home rows while a custom database is selected; the normal
account facade exports home versions through its home worker. Both keep the
selected-account lease and retire on identity or database changes. Regressions:
`local-workspace/themeHistory.test.ts`, `accountThemeHistory.test.ts`,
`accountThemeHistoryScope.test.ts` and the opt-in
`anonymousThemeHistory.browser.test.ts`. The new opt-in
`accountThemeHistory.browser.test.ts` verifies three native offline edits, two
canonical History exports and real receipt acceptance while the independent
content queue fails, then reverses that failure and retries History. Native
import/move/title/delete and custom-plane acceptance, plus protected
restore/undo/merge, remain open.

Owned account themes join the existing `accountExport.ts` collector through
`AccountThemeSync.exportSnapshot`, never the generic protected writer. The
`themes/sync` catalogue 1.2.0 supplies explicit home folder placement; selected
custom-plane folder collisions refuse. `accountThemeExport.test.ts` covers
canonical remapped round-trip, pending edits, deletion, old cache upgrades and
scope refusal. `accountThemes.browser.test.ts` exercises the real offline
Transfer download; `themeSync.api.test.ts` verifies normal managed placement.

Account theme import adds the dedicated AccountThemeSync.importIn hook to the
existing LocalThings transaction and AccountThingSync constructor. Generic
protected writes stay refused. accountImportSupported is shared by the UI,
import facade and duplicate/fork path. Theme sender placement waits for the
folder receipt; AccountThingSync completion wakes that sender. Tests:
accountThemeImport.test.ts, accountApi.test.ts, accountThemeImport.browser.test.ts
and themes/themeImport.api.test.ts. See the theme workspace guide for unfinished
History and wider library integration work.


Theme library projections and move/delete lifecycle use AccountThemeSync hooks
inside the existing AccountThingSync/LocalThings transaction. The theme sender
records acknowledged remote placement; folder deletion waits for those receipts
without delaying local completion. Scoped theme tombstones suppress stale reads.
Anonymous folder deletion drains contents by default, retaining bytes; recursive
removal remains explicit. See accountThemeOrganization.test.ts,
themeOrganization.test.ts and accountThemeOrganization.browser.test.ts.

The Things library supplies authenticated identity separately from editable
workspace identity for remote computer discovery. useDeviceStore pauses remote
refresh/poll effects offline while retaining cached snapshots and resumes on
connectivity changes. The theme organization browser regression checks no
offline device reads or automatic refresh-error overlay.


Theme display-title editing uses `LocalThings.renameLibrary` and the dedicated
`AccountThemeSync.renameIn` hook. Generic protected writes remain refused. Shared
`utils/libraryTitle.ts` validation and the existing canonical theme writer retain
metadata across conditional sync and portable transfer. `readManagedContentMetadata`
adds an owned/home title projection; folder-only readers preserve their original
contract. The native library organization fixture also exercises offline renames.
See `themeTitle.test.ts`, theme transfer/capability tests and the theme workspace
guide for verification status and remaining integration gates.

The library Rename callback delegates capability negotiation to the selected
adapter, so cached account themes and ordinary Things can finish locally after
cold offline reload. The normal remote rename adapter retains its manifest check.


Explicit local home views use `useApi({localPlane: 'home'})` and the existing
`accountApi` facade. `accountHomeApi.test.ts` verifies whole mixed transfers and
independent generic/theme sender admission. `homeThemeMigration.ts` and
`homeThemes.ts` provide the not-yet-activated consolidation path; see
[account theme workspace](../account-theme-workspace.md) for UI integration gates.


`RetainedThemeReview` in Theme Studio reads legacy account partitions through
`RetainedAccountThemes`; private recovery and ordinary remote conflict copies
share `AccountThemeSync.copyIn`. `ThingExportDialog.localView` selects the normal
home API for recovered downloads without changing remote authority. Local
`theme-recovery` receipts prevent duplicate/recreated copies. See
`retainedThemes.test.ts` and `retainedThemes.browser.test.ts`.


## Local home library destination

`ThingsPage.tsx` validates account-bound destination URLs through
`thingsLocation.ts` and scopes its existing dialogs with `LocalApiView`.
`useApi` inherits that local destination while preserving actual root authority;
`useDataPlane` remains the selected remote identity. Cache and cut-intent keys
include destination scope. Home folder links retain that scope, while detail and
inspect links retain the existing owner/database guard. See
[account theme workspace](../account-theme-workspace.md#native-home-library-destination--2026-10-18)
for current native evidence and unfinished detail/editor integration.


## Local schema-backed detail previews

The native `/thing/:id` view reads owned schemas through `readThingSchema.ts`
and `useApi`, so an anonymous or offline record can render its saved template
without capability HTTP. Shared/keyed roots keep the authorized composition
read. A directly refused foreign schema may use that same root read; network,
authentication, identity and cancellation failures do not trigger a fallback.
Library/detail preview caches share `thingsWorkspaceCacheKey` and include the
full workspace and local destination. Failed schema reads surface a retry control
while the Thing data remains available. Tests: `readThingSchema.test.ts`,
`thingsCore.test.ts`, and opt-in `schemaDetail.browser.test.ts`.


Algorithm library titles use the existing `LocalThings.renameLibrary` adapter
and `AccountAlgorithmSync.renameIn`. The canonical algorithm transfer/parser
preserves optional `crystal.title`; private catalogues and title writes negotiate
`api.algorithms-sync` 1.3.0. Run algorithm library/facade/transport tests and the
opt-in algorithm API/native browser fixtures. See
[algorithm display titles](../local-workspaces.md#algorithm-library-display-titles--2026-10-18).
Password migration coverage and encrypted file lifecycle: `passwords/onePassword.ts`,
`transfer.ts`, `fileCrypto.ts`, `files.client.ts`, `backup.client.ts`, and
`api/utils/passwords/files.ts`. Every original 1PUX member is retained as an
encrypted attachment to a source archive entry; item editors preserve structured
values, source context and password history. See [the password contract](../password-manager.md).

## Mac backup scan implementation

`Commander/crates/commander-indexer/src/backup.rs` adapts the shared bounded Rust
walker to private JSONL backup observations. `backup_ignore.rs` matches the same
Git oracle as the web/Apple adapters. `apple/FileSync/.../CommanderBackupCapture.swift`
runs the bundled helper under the selected grant, validates returned metadata and
feeds the existing `MobileFolderInventory` SQLite sink. MacFolderSync still gates
sealing/reads on live authority; transient identity failures survive through
`NodeController`, Electron `folder-sync.cjs` and `nativeInventory.ts` into the
existing retry scheduler. Run `macos/ThingtimeNode/scripts/test-commander-backup.sh`,
native MacFolderSync/ThingtimeAPIClient tests and `test:file-sync`.

Upload order preferences use `fileSync/syncPriorityJournal.ts` and the existing
paged execution journal, with editable `SyncUploadPriorities` blocks and file-tree
controls in `SyncProgressViewer`. Preferences are device-local scheduling hints,
not API grants or deletion permission. `syncPriorityJournal.test.ts`,
`uploadPriorityEditor.test.ts` and the editable sync progress browser check cover
recovery, parent ordering, scope, persistence and nested Builder controls.

Normal ZIP file selection uses `decodeTransferArchiveBlob` in
`utils/thingTransfer/archive.ts`; the same two-pass validator serves byte callers.
`readFile.ts` and `ThingImportDialog.tsx` carry Blob handles into
`LocalThings.import`, with account queue admission in the existing transaction.
`utils/thingTransfer/binary.ts` owns the chunked checksum shared with device files.
Download uses `encodeTransferArchiveBlob` and freezes caller-owned input before
async work. Run transfer/archive regressions, `transferBlobs.test.ts`, Things and
local-workspace suites. See [coverage and remaining buffers](../local-workspaces.md#blob-zip-import-and-download-assembly--2026-10-18).


## Device catalogue admission

`local-workspace/themes.ts`, `algorithms.ts` and `things.ts` no longer couple
local save/import admission to server catalogue counts. `accountThemes.ts` and
`accountAlgorithms.ts` retain all pending local content alongside validated
remote snapshots and permit reviewed private conflict copies beyond the former
counts. `homeThemeMigration.ts` uses the same native IndexedDB capacity and
multi-scope atomic rollback boundary. Tests in those local-workspace families
cover 101+ themes, 51+ profiles, reload/export, protected intents and real-class
browser quota failure. Remote response parsing/server limits are unchanged and
remain a separate capacity-contract audit.

### Device sync and file locations (2026-10-22)

The device details sync section opens `/things?device=<id>&deviceView=sync`,
which owns configuration, resource controls and transfer progress. The root
library contains Things, not setup/sync panels. `api.things` 1.39.1 corrects
root containment before pagination: parent/target children, storage attachment blobs and file-sync
configuration records are excluded; explicit folders and search retain their
scopes. Expiring unbound uploads are drafts, while legacy durable standalone
files remain content in `/things?unfiled=attachments` and search. This virtual
recovery collection explicitly records that no original folder location is
known; it never fabricates a device path. No migration or deletion is performed.

`ThingFileLocation.tsx` renders editable breadcrumb blocks on file/attachment
details. `fileLocationCore.ts` follows an attachment's recorded canonical file
target and that file's actual folder ancestry through authorized generic reads.
Unbound blobs have no recorded location; inaccessible or cyclic ancestry is
reported as unavailable. Names and MIME types never establish a path.


### Device activity ownership

`/things?activity=1` is a dedicated editable Builder surface linked from device
sync. `app/activity/activityManager.ts` owns registered view polling, listeners,
sync discovery and transfer execution, with persistent origin/device preferences
and real teardown. Register new background producers with a stable semantic ID;
return cleanup and honor the supplied abort signal for active asynchronous work.
A disabled view timer cannot cancel an already-issued read unless its owner
supports cancellation. The manager does not monkey-patch browser globals.

The desktop preload exposes versioned `activityRequest` 1.0.0. Only the trusted
main renderer at its configured node origin may invoke it. The native Node
service is one separately controlled owner; disabling it persists intent before
stopping launchd, while retaining pairing, grants and transfer journals. Browser
lease/deadline cleanup guards remain required. Measurements cover Electron
processes only; native Node children, MongoDB and API runtimes are explicitly
outside that resource total. This is a registered-owner inventory, not a claim
that arbitrary third-party listeners or all operating-system processes are
instrumented. Native inventory refresh is manual and does not add a poll.

Verification commands: `npm --prefix remix run test:activity`,
`npm --prefix remix run test:activity-ui`, and
`node --test electron/test/activity-manager.test.cjs`.

### Referenced-by parent paths

`ThingParentPaths.tsx` on Thing data offers an explicit reference scan, never an
automatic home-library sweep. Each action reads up to ten ordinary owner-list
pages of 50 rows and retains its cursor plus a compact inverse reference map.
Continue scan discovers more rows; More parent paths resumes the traversal
frontier (20 paths / at most 200 ACL reads per action). Cancel, account/data-plane
changes and unmount abort requests.

`thingParentPathsCore.ts` indexes canonical file content identities, existing
post Thing collection references and the shared authored webpage media scanner
(`Builder/webpageAttachmentRefs.ts`, also used by the server binder). Actual
folder/target/parent lineage comes from exact current reads. Every incoming typed
reference is revalidated through the source's ACL-checked read; stale matches,
missing ancestors and cycles do not create invented complete paths. Each segment
is clickable and separately editable through Builder. Original sync upload
provenance remains a separate display, never a current-parent edge.

Coverage is the user's accessible owner library plus viewable direct ancestors.
Other accounts' reverse references, arbitrary text, unknown reference kinds and
private managed content excluded by the ordinary library API are not covered.
Incomplete scan/traversal status remains explicit. No new API contract or
background indexing service is introduced. Unfiled files independently loads
one page at a time and requires Load more for each subsequent page.


### Algorithm History ownership

`local-workspace/algorithms.ts` owns atomic anonymous profile changes;
`accountAlgorithms.ts` keeps the dedicated scoped content queue and records
owner device drafts through `accountTimeline.ts`. `timeline/algorithmContent.ts`
is the approved design projection. `local-workspace/algorithmVersions.ts` opts
into the shared Timeline planner through the dedicated algorithm transaction,
preserving current sharing/listing, lineage, selection and library title/folder.
Generic protected writes and deleted-profile recovery remain refused.

History displays algorithm versions through `timeline/browserModel.ts`;
`timeline/exportVersion.ts` validates canonical local and remote archives.
Remote algorithm draft export is the additive `api.timeline` 1.22.0 contract in
`docs/apiDocs.ts`, published on both manifests and negotiated in `useApi.tsx`.
It preserves actual receipts and never acknowledges the algorithm content queue.
See [Algorithm device versions](../unified-timeline.md#algorithm-device-versions--apitimeline-1220).
Regressions: `algorithmHistory.test.ts`,
`api/utils/timeline/exportVersion.test.ts`, `test:api-capabilities`; native
offline restore/organization/reconnect: `algorithmHistory.browser.test.ts`.


Local draft media now include canonical linked URL metadata alongside stored files.
`local-workspace/drafts.ts` rechecks prepared metadata in the destination transaction,
binds URLs to one working draft, and gives template/recovery copies independent
attachment and account request IDs. Releases expire only unbound selections; URL
rows never allocate fake bytes or fetch their content. `linkedDrafts.test.ts` covers
mixed media across reopen, remapped layouts, account queue rollback and partition
separation, plus metadata changes before commit. Account registration and later
post/draft binding use the dedicated `AccountFileSync` journal.


Local portable ZIP capacity uses `utils/thingTransfer/format.ts` consumer budgets,
`collect.ts` Blob collection, `archive.ts` bounded entry processing and ZIP32 field
checks, and `readFile.ts` selected-file decoding. Buffered/clipboard and account
import/export budgets are explicit at their consumers; this does not change the
remote API contract. Run the transfer unit tests and opt-in `capacity.test.ts`;
see [the local archive checkpoint](../local-workspaces.md#local-blob-archive-capacity--27-october-2026).

The subsequent remote contract removes the aggregate 512 MiB budget from
metadata-only `importTransfer`/`chatArchiveTransfer` and `exportTransferPlan`.
`utils/thingTransfer/remoteCapabilities.ts` centralizes export 1.18.0, large
import 1.15.0 and pinned content 1.18.0 requirements. Normal UI/account clients
negotiate before work; `ThingImportDialog` also checks before uploads and fences
the dialog lifetime/bundle across negotiation. `browser.ts` uses immutable
1 MiB Blob segments and retains the legacy budget for unpinned remote reads.
Upload approval, quota accounting and transaction boundaries remain canonical.
Run the transfer/capability tests and the opt-in
`scripts/transfer-capacity-acceptance.mjs` real-byte fixture; see the
[remote checkpoint](../../artifacts/anonymous-local-first-2026-10-27-remote-transfer/README.md).
