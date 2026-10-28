# Things and folders

`validateThingtimeCrystal` preserves explicit `renderComponent` metadata across
typed and data Thing writes. See [the presentation contract](api-endpoints-and-capabilities.md)
for saved/embedded definitions, PATCH/replacement semantics and tests.

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
| Independent sealed backup copies | `app/api/utils/backups/portableBackup.ts`, shared `backupObjectKey.ts`, `localBackupStore.ts`, `s3BackupStore.ts`; native/worker pipe entry `scripts/backup-replica.mts` (`backup:replica`), transport/resume tests in `s3BackupStore.test.ts`. Same portable v1 format; explicit vault credentials, no ambient provider configuration. Setup and incomplete live-provider/UI gates: `docs/portable-backups.md#independent-s3-replica-worker` |
| Kind schemas and protected kinds | `app/schemas/registry.ts` (`PROTECTED_THINGTIME`, `folderSchema`, `isProtectedThingtime`) |
| Indexes | `app/api/utils/mongodb/collections.ts` `ensureIndexes()` (central registry; new indexes are rare, evidence-backed exceptions) |
| Internal point-in-time owner inventory (managed-family coverage incomplete) | `app/api/utils/backups/accountInventory.ts`, `withHomeMongoSnapshot` in `collections.ts`; canonical snapshots plus all seven Timeline record families via `backups/timelineRecords.ts`; ready attachment bytes and file-history dependency checks via `backups/attachmentRecords.ts`; offline current/version reads via `accountFileRecovery.ts`; exact draft/template/tombstone records and media dependencies via `draftRecords.ts`; large canonical ordinary content via `thingSnapshots.ts`; saved canonical themes via `themeSnapshots.ts`; approved account profile/private preferences and exact profile-media closure via `accountSnapshots.ts` and shared `timeline/accountContent.ts`; bounded owner/ID paging, modern index plan only. Contract: `docs/portable-backups.md` |
| Shared event/link records, IndexedDB relational queue/index, bounded cache, draft recorder and account sync | `app/timeline/` (`records.ts` and `branches.ts` are the identical local/remote durable schemas) |
| Transactional history recording, protected binary event Things and paging | `app/api/utils/timeline/` |
| Trusted Action/AI attribution and relational operation grouping | `app/api/utils/timeline/mutationContext.ts`, established by `actions/execute.ts`, `actions/firstPartyActionHost.ts` and `lopu/chatTools.ts`; not request-controlled |
| Shared History modal and managed Timeline folder | `app/components/Timeline/TimelineHost.tsx` |
| Account/database-qualified History links and Thing caches | `app/utils/dataPlane.ts`, `app/hooks/useDataPlane.ts`, `app/routes/thing.tsx`; root identity invalidation also handles database selection across tabs |
| Explicit data-Thing presentation | `app/components/Thingtime/ThingView.tsx`, `ThingRenderComponent.tsx`; `renderComponent` points to an independently readable saved Component or embeds its canonical render definition. See [the authoring and access contract](posts-comments-and-feed.md#subspace-messages-and-embedded-things). |
| Approved saved-theme content history, home transaction and retained deletion accounting | `app/timeline/themeContent.ts`, `app/api/utils/timeline/themeContent.ts`, dedicated `app/api/utils/themes/themes.ts` writer |

## Authorization helper

- Reads: `findViewableThing` / `canViewInherited` (see
  [sharing-and-audiences.md](sharing-and-audiences.md)).
- Owner writes: `updateThing`, `deleteThing` check ownership and PAT scopes
  through `resolveThingsActor(scope)`; new things routes must pass
  `thingsScope`.
- Folder listing (`listThings({ folder })`) is owner-only; `FOLDER_UNFILEABLE`
  kinds (reactions, saves, votes, updowns) live under their target.
- Builder apps are top-level owner `folder` Things with `crystal.builderApp=true`.
  `GET /api/v1/things?folder=root&builderApp=true` filters them before cursor
  pagination (`api.things` 1.45.0). A child's existing `folderId` organizes it
  into the app; it never grants access or changes protected OAuth `appId`.
- Optional `GET /api/v1/things?thingtime=data&schemaId=<saved Schema Thing ID>&parentId=<related Thing ID>`
  narrows exact `crystal.schemaId` and `crystal.parentId` before canonical cursor pagination. Owner, app
  namespace, PAT visibility and per-Thing ACL checks still apply; exact-ID and
  discussion projection reads do not accept this list filter (`api.things` 1.43.0).
- Saved Webpage create/update accepts guarded `tt-form`, `tt-select`, `tt-style`,
  `tt-change` and `tt-mapbox` element blocks with nested editable children.
  Builder conversion keeps repeated-card templates, source bindings and child
  selection IDs (`api.things` 1.44.0, `api.things-update` 1.14.0).
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
| Builder app/type browsing reusing the same page, app metadata and assignment dialogs | `app/components/Builder/BuilderPage.tsx`, `BuilderAppDialog.tsx`, `BuilderAssignDialog.tsx` |
| Grid/list/columns views, tile menu button, `ThingsItemAction` union | `app/components/Things/ThingsViews.tsx` |
| Item and background context-menu models | `app/components/Things/thingsMenuModel.ts` (built on `buildThingEntityMenu`) |
| Pure helpers/types (`ThingsThing`, `isFolder`, sort/group options, cache keys) | `app/components/Things/thingsCore.ts`, `thingsLocation.ts` |
| Dialogs (new folder, rename, move, share, delete, preview) | `app/components/Things/ThingsDialogs.tsx` |
| Export/import dialogs | `ThingExportDialog.tsx`, `ThingImportDialog.tsx` |
| Universal Thing page `/thing/:id` | `app/routes/thing.tsx` |
| Device page `/things?device=<id>&deviceView=page` | `app/components/Things/ThingsPage.tsx` selects the same `DeviceDetailsDrawer.tsx` content used in the drawer; device cards/rows have a navigation-only right-click menu |

Shared item activation is defined in `browseInteraction.ts`: ordinary clicks
open once; Cmd/Ctrl/Shift clicks select, and title links retain native
middle-click navigation. `ThingsViews.tsx` supplies labelled hover/focus
checkboxes and action menus for Things, files and devices in every layout;
coarse-pointer controls remain visible. Device controls are siblings of their
primary button to preserve independent keyboard and pointer actions.
`FolderTree.tsx` reuses those controls only when browsing handlers are supplied;
Move dialog pickers remain independent. Its folder button expands children in
place, while modifier clicks select and context controls preserve location.

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

- `scripts/things-single-click-acceptance.mjs` exercises the real isolated API
  and browser click, selection, context-menu and file-download paths; prerequisites
  and invocation are in the "Things page" section of `TESTING.md`.
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
See [browser Actions and editor checks](../builder-browser-actions.md).


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

`PasswordGenerator.tsx`, `PasswordIcon.tsx` and `PasswordPasskeySetup.tsx` compose
editable settings blocks; secret output stays in the controlled entry draft.
`passwords/generator.ts` owns WebCrypto/preset validation. `passwords/icons.ts`,
`icons.client.ts` and `api/utils/passwords/icons.ts` own descriptors, anonymous
image loading and the separately sealed list projection. `test:passwords` covers
these boundaries; `scripts/password-tools.browser.html` is an isolated synthetic
UI fixture, not native-provider acceptance.

See [password-manager.md](../password-manager.md). `api.passwords` 1.3.0 is a
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
