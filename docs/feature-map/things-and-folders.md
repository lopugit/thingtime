# Things and folders

Archive and Restore use the shared Thing action registry, `PersistedThingContextMenu`
and exact-subject `/things/actions` availability/mutation contract. The canonical
server predicate owns authorization; a page, content kind or stale parent projection
must not independently decide permission. Batch library operations reuse that predicate.
Extended reads require `LIBRARY_ARCHIVE_READ_REQUIREMENTS` (`api.things` 1.63),
independent of Component argument bindings at 1.62. The shared Archive checker
negotiates both the origin manifest and fixed active API source; action/search/
bulk gates retain their own 1.1/1.7/1.9 contracts.
This is private owner library placement, not unpublishing: original content, links,
folder relationships and audiences remain unchanged. Explicit list filters apply before
pagination. The Archived view can restore across folders, including static metadata
cards for dedicated protected content whose body is unavailable to generic Things reads.
Those cards expose Restore only. Builder Apps retains its root/app-only filter;
Builder library folders share Archive/Restore. See [the manual
checklist](../../TESTING.md#things-library-archive).

## Thing storage choices

`ThingStoragePanel` and the shared Thing context menu expose individually editable
storage controls. `thingStoragePolicy.ts` in the Things utility layer owns private,
revision-fenced owner and device preferences; `storage/thingReplicaStore.ts` and
`thingReplicas.client.ts` own browser JSON and byte copies. iOS `FileReplicaBridge`
uses the shared AppleFileSync managed-copy adapter. Preferences never authorize
cloud deletion or imply a completed transfer. See [Thing storage](../thing-storage.md)
and the Thing storage and device copies checklist in `TESTING.md`.

## Idempotent Action creation

A server Action can require an exact invoker-owned folder on a `things.get`
step before using the authorized Data Thing in a composed workflow. The step
adds a verification flag without exposing placement metadata. See [Action authoring](../builder-browser-actions.md)
and the real API checks in `remix/scripts/verify-actions.mjs`.

Server Actions use `things.ensure` to create or reuse one owned Data Thing by
intent. The key is scoped to the invoker and saved Action in the selected data
plane. A protected root unique key and the canonical insert serialize
concurrent creation. An existing readable Thing with the same schema retains
its current fields, placement and audience. See [Action authoring](../builder-browser-actions.md)
and the real API regression in `remix/scripts/verify-actions.mjs`.
Ordered batches reuse the same protected namespace. An optional exact
scalar match can reuse an accessible existing Data Thing with the same
owner and schema before a new key is created. Existing rows retain their
fields, placement and audience.

## Derived Thing metadata

`ThingMetadataPanel.tsx` sits at the top of Thing detail pages. Its individually
editable `thingMetadataBlocks.ts` layout shows canonical JSON and original file
bytes separately. `thingMetadata.ts` in the Things utility layer reauthorizes
the source, measures sorted-key JSON with `thingMetadataCore.ts`, verifies
attachment bindings and saves one protected metadata reference. GET measures;
owner POST rebuilds. The exact metadata permalink always rechecks its source.
Run `test:thing-metadata`, `test:thing-metadata:integration` and the
[manual checklist](../../TESTING.md#thing-metadata-and-file-sizes).
See the [format and lifecycle](../thing-metadata.md).

Device pages expose Location history through `DeviceLocationWorkspace`, a
scoped data/action adapter that resolves private saved `/devices/location` and
`settings-device-location-settings` layouts. Map markers, filters, retention,
message controls and uploads remain separately editable blocks. Protected
`device-observation` history is read through its owner-only device API, not
ordinary Things discovery. See the [API map](api-endpoints-and-capabilities.md)
and the Device location history checklist in `TESTING.md`.

## Native external-volume reconnect

`FolderBookmark` distinguishes a detached original volume from deletion on an
online volume without prompting or mounting it. `NativeFilesystemContinuity`
and `RustInventoryClient.Root` retain volume UUID, root inode and birth as an
additional recovery fence; exact live descriptor checks remain mandatory.
`MobileFolderInventory` retires old device/path snapshots and creates fresh
generations rather than rewriting their identities. Legacy captures require
the original nonstale bookmark's saved UUID and original root inode.

`NativeSymbolicLinks` and Rust `backup/native_receipts.rs` resolve matching
persistent receipt aliases for journals and portable links, including current
attachment migration of older receipts. A legacy journal with insufficient
volume proof is unreadable, never ordinary upload content. The small
`commander-platform` descriptor metadata adapter isolates Darwin UUID FFI from
the indexer's `forbid(unsafe_code)` policy.

`MobileSyncStaging` uses an on-volume verified candidate for different-device
regular downloads. Root/candidate/displaced/journal anchors and the private
marker/content hash gate uncertain-publication recovery. Historical receipts
remain historical; missing legacy anchors never authorize another swap.

The Electron host recognizes only fixed typed availability markers. Existing
job backoff resumes offline work. `nativeFeedRecovery` ends the old local hint
prefix through `pagedRunJournal.endRemountedLocalFeed`, retaining every cursor,
operation and receipt; the ordinary guarded consumer drains it before fresh
sealed reconciliation can publish agreement. Native contracts are Mac file
access 1.20.0 and publication 1.3.0.

Regressions: `DriveReconnectTests` (opt-in real APFS), `nativeFeedRecovery`,
`twoWayStreaming`, `desktopFolders.client`, Electron `folder-sync`, Rust native
receipt tests and `commander-platform`. Runbooks: `TESTING.md` external-drive
reconnect checklist. APFS images prove native remount behavior; physical USB
hardware and the final signed installation are separate acceptance gates.

## Incoming-share location selection

`ThingsPage` accepts an optional `locationPicker` adapter. It keeps the existing
list/grid/columns, breadcrumbs and folder creation while staying inside `/share`.
`ShareSaveDestination.tsx` saves through the ordinary home-plane Things and Files
APIs, reads results back, and retains immutable retry commands. Shared relative
paths recreate their folder hierarchy, including empty directories. The sticky
**Save here** controls are individual Builder blocks. See
[incoming sharing](../incoming-sharing.md).
Shared text uses the canonical Data sanitizer without a product string-length
ceiling (`api.things` 1.50.0). It preserves explicit embedded Component defaults
through exact readback and retry, rather than reporting a normalization change
as a failed save. Types, cycles, storage admission and access checks still apply.


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

Private `file-sync` configurations can be managed from any signed-in browser.
The device sync screen keeps saved connection editing available offline and
uses a protected, leased control channel for live device operations. Native
grants and transfer journals stay on the target device. See
[browser device sync](../browser-device-sync.md) for code paths and checks.
Guarded streaming preparation defers missing journal ancestry before policy RPCs;
protected point reads and executable bindings retain current policy checks. The
`--healthy` canonical fixture lane separates startup timing from accepted-loss
recovery while retaining exact hashes and strict checkpoints.
The indexed local feed races its live native long poll against a cancellable,
revisioned durable-consumer wake. Buffered revisions and the native finish/poll
handshake still drain normally; legacy adapters keep their polling fallback.
See `streamingIndexRecovery.test.ts` and the idle-wake checklist in `TESTING.md`.
Mac access 1.21.0 adds the typed `observe-path` boundary used only by two-way
streaming preparation. `nativePathObservation.ts` is shared by the installed
adapter and canonical fixture: current saved settings are checked first, then
one native request observes the candidate and immediate parent under live
network/charging, expiry, bookmark and CPU guards, with fresh entry/reply
identity. Older hosts retain separate context/inspection requests. This does
not reuse identity responses or change transfer, scan, CPU or identity budgets.
Regressions cover settings changes before IO, exact complete response binding,
queue expiry, cancellation, account/grant revocation and conditions changes.
Mac paged native inventory reads use `MobileFolderInventory.read` and
`RustInventoryClient.checkedPage`: each Rust `page` reply includes its checked
status so the client can validate generation, root version and coverage with
one helper request per page. The 10,001-entry regression in
`MobileFolderInventoryTests` asserts 79 bounded pages and no separate status
request during read. See the Mac paged checklist in `TESTING.md`.

## Where the code lives

| Concern | Path |
| --- | --- |
| Builder identity, legacy detection and additive marker updates | `app/schemas/builderThing.ts`, `registry.ts`; `builder-thing` composes with the original content schema. Generic Things writes persist it for canonical Builder kinds; Builder-created data and app folders explicitly retain it. The marker grants no access and never chooses a renderer. |
| Canonical Thing utilities: `createThing`, `updateThing`, `deleteThing`, `listThings`, `getThing`, `findViewableThing`, projections (`toPublicThings`, posts) | `app/api/utils/things/things.ts` (large; grep the export you need) |
| Folder rules (`resolveFolderAssignment`, `FOLDER_UNFILEABLE`, cycle checks) | `app/api/utils/things/things.ts` (`folderId` handling) |
| Bulk move/copy/delete/share | `app/routes/api/v1/things/bulk` |
| Thing routes | `app/routes/api/v1/things/_things.tsx` (GET/POST/PATCH/PUT/DELETE) plus `export`, `import`, `fork`, `share`, `react`, `comment`, `save`, `vote`, `updown`, `views`, `search`, `feed`, `trending`, `rss`, `reveal`, `actions` |
| Portable transfer (export plan, ZIP/JSON bundles, import) | `app/api/utils/things/exportTransfer.ts`, `importTransfer.ts`, `app/utils/thingTransfer/*` (client: `browser.ts`, `archive.ts`) |
| Independent sealed backup copies | `app/api/utils/backups/portableBackup.ts`, shared `backupObjectKey.ts`, `localBackupStore.ts`, `s3BackupStore.ts`; native/worker pipe entry `scripts/backup-replica.mts` (`backup:replica`), transport/resume tests in `s3BackupStore.test.ts`. Portable v1 container with retained v1 readers; ordinary `backup-thing-content@2` uses `utils/canonicalJsonStream.ts` and streaming retention without backup-only record caps (`thingStream.test.ts`). Explicit vault credentials, no ambient provider configuration. Setup and incomplete live-provider/UI gates: `docs/portable-backups.md#independent-s3-replica-worker` |
| Kind schemas and protected kinds | `app/schemas/registry.ts` (`PROTECTED_THINGTIME`, `folderSchema`, `isProtectedThingtime`) |
| Indexes | `app/api/utils/mongodb/collections.ts` `ensureIndexes()` (central registry; new indexes are rare, evidence-backed exceptions) |
| Internal point-in-time owner inventory (managed-family coverage incomplete) | `app/api/utils/backups/accountInventory.ts`, `withHomeMongoSnapshot` in `collections.ts`; canonical snapshots plus all seven Timeline record families via `backups/timelineRecords.ts`; ready attachment bytes and file-history dependency checks via `backups/attachmentRecords.ts`; offline current/version reads via `accountFileRecovery.ts`; exact draft/template/tombstone records and media dependencies via `draftRecords.ts`; large canonical ordinary content via `thingSnapshots.ts`; saved canonical themes via `themeSnapshots.ts`; approved account profile/private preferences and exact profile-media closure via `accountSnapshots.ts` and shared `timeline/accountContent.ts`; stored ordinary reference/media and active-selection evidence through `storedReferences.ts`; streamed notification history through `notificationSnapshots.ts` and `timeline/notificationContent.ts`; explicit subscription-authority exclusions; bounded owner/ID paging, modern index plan only. Real API proof: `test:backups:references`. Contract: `docs/portable-backups.md` |
| Shared event/link records, IndexedDB relational queue/index, bounded cache, draft recorder and account sync | `app/timeline/` (`records.ts` and `branches.ts` are the identical local/remote durable schemas) |
| Transactional history recording, protected binary event Things and paging | `app/api/utils/timeline/` |
| Trusted Action/AI attribution and relational operation grouping | `app/api/utils/timeline/mutationContext.ts`, established by `actions/execute.ts`, `actions/firstPartyActionHost.ts` and `lopu/chatTools.ts`; not request-controlled |
| Shared History modal and managed Timeline folder | `app/components/Timeline/TimelineHost.tsx` |
| Account/database-qualified History links and Thing caches | `app/utils/dataPlane.ts`, `app/hooks/useDataPlane.ts`, `app/routes/thing.tsx`; root identity invalidation also handles database selection across tabs |
| Explicit data-Thing presentation | `app/components/Thingtime/ThingView.tsx`, `ThingRenderComponent.tsx`; `renderComponent` points to an independently readable saved Component or embeds its canonical render definition. See [the authoring and access contract](posts-comments-and-feed.md#subspace-messages-and-embedded-things). |
| Approved saved-theme content history, home transaction and retained deletion accounting | `app/timeline/themeContent.ts`, `app/api/utils/timeline/themeContent.ts`, dedicated `app/api/utils/themes/themes.ts` writer |

## Builder provenance

`app/schemas/builderThing.ts` defines the composable `builder-thing` schema id
and legacy recognition for Webpages, Components, Actions, Schemas and explicit
`builderApp` folders. Canonical validation adds the marker on writes; ordinary
data/folders opt in explicitly. PATCH/PUT and the update alias may add the marker
without changing stored content schemas. Marker metadata grants no access and
does not select a renderer. The contracts are `api.things` 1.46.0 and
`api.things-update` 1.15.0. Draft export/reopen and archive folder destinations
ignore the marker when enforcing content-kind exclusivity. Coverage lives in
`schemas/builderThing.test.ts`, `draftPreview/prepare.test.ts`,
`api/utils/things/chatArchiveTransfer.test.ts` and both capability test suites.

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
  The map viewport's reusable favourites/route Action sources drain cursor
  pages through `useThingSource` and `Maps/mapboxSource.ts`; numbered route
  overlays preserve favourite pins and scope transient geometry to the selected
  route. See [editable maps](../maps.md) and `pnpm --dir remix run test:maps`.
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
| Device page `/things?device=<id>&deviceView=page` | Device cards and rows link to the dedicated page. `ThingsPage.tsx` shares `DeviceDetailsDrawer.tsx` and the top dashboard with the explicit Quick view (`deviceView=quick`); the device menu also links to sync and saved files. |

Shared item activation is defined in `browseInteraction.ts`: ordinary clicks
open once; Cmd/Ctrl/Shift clicks select, and title links retain native
middle-click navigation. `ThingsViews.tsx` supplies labelled hover/focus
checkboxes and action menus for Things, files and devices in every layout;
coarse-pointer controls remain visible. Device controls are siblings of their
primary link to preserve independent keyboard and pointer actions.
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

Completed one-way and two-way streams retain their exact receipt link through
strict reconciliation. `pagedRunJournal.ts` builds a restartable completion
summary in bounded history pages, separating cumulative confirmed activity from
latest-per-path checkpoint effects and excluding unpublished intents.
Historical-only paths remain activity records, without inventing current files
or checkpoint effects; parent/root counters include that activity.
`progressProjection.client.ts` joins per-path historical counters into the saved
progress tree; `backupCompletionProgress.test.ts` covers completed/reloaded,
no-work, A/B/A revision, and interrupted-migration behavior.

For connected folder sync, `app/fileSync/streamingForegroundSync.ts` can
prepare two-way copies from native and cloud index hints while both source
feeds remain open. `app/api/utils/files/inventory.ts` resolves the exact
destination under the same transaction and ancestor locks used by the
canonical file and folder writers. Early two-way cloud writes negotiate
`api.files` 1.10.0 before using that guard. The strict paged plan and
checkpoint remain responsible for reconciliation and agreement.
`app/fileSync/cloudIndexChanges.client.ts` validates Timeline deltas against
the same sync entry contract as snapshots: nonempty files require multipart
fingerprints, while canonical zero-byte files use the empty SHA-256 identity.


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
one-resource caching and authority boundaries. iOS Photos automation 1.4.0
feeds bounded, newest-first asset groups into the durable queue, streams
per-asset discovery to the editable activity card, and preserves automatic
backup after a continued-task interruption. `PhotoBackupInstalledTests`
drives real original-byte cloud acceptance, including the mixed Photos/video
fixture with `THINGTIME_PHOTO_EXPECT_NEWEST=1`. See `iOS/README.md` for current local-original,
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

`filesystem-indexer/crates/indexer/src/backup.rs` adapts the shared bounded Rust
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


Mac folder-grant location metadata uses `MacFolderSync` `fileAccessVersion`
1.15.0 and `MobileFolderStore.sourcePath`. The owner-verified native response
adds optional `roots[].sourcePath`, preserving the exact selected absolute POSIX
location without granting ancestor access. `mobileFolders.client` validates it
separately from root-relative file paths and exposes `supportsNativeSourcePaths`.
Stale/unavailable bookmarks and Photos omit it. `MobileFolderTests` and
`MacFolderSyncTests` cover owner isolation and continued rejection of absolute
paths by file operations; `mobileFolders.client.test.ts` covers negotiation,
correlation and malformed location metadata. This field does not change signed
sync policy, existing cloud destination identities, or public manifests.

Device-wide resource controls use `fileSync/remoteDeviceResources.client.ts` for
one identity-qualified status session shared by overview and connection manager.
`remoteSyncProtocol.ts` defines the rootless read/save contract, strict policy and
measurement projections; client and worker require `api.devices-sync-control`
1.2.0 plus native fileAccess 1.16.0 / fileResourceLimits 1.1.0. The existing paired
mailbox retains ownership, leases and immutable saves. Focused protocol/client,
worker, session and `deviceSyncControl` tests cover paused changes, no folder/job
side effects, stale replies and shared polling. See browser-device-sync.md.
The installed Mac dashboard shares one Activity Manager sampler per active
local run. It reads the existing rootless resources lane while visible, and
Electron projects current worker samples from the same device governor without
changing limits. Stale transfer, scan and memory measurements expire.

Sync history uses `fileSync/deviceSyncHistoryRecorder.ts` inside the admitted
native runner, independently of dashboard mounting. `deviceSyncHistoryJournal.ts`
stores individual origin/owner/device/data-plane scoped observations in the
existing IndexedDB journal. Range reads process all matching rows in bounded
batches; display buckets retain measured sample counts and null gaps.
`deviceSyncHistory.client.ts` reads locally or requests the paired worker's
read-only `history` command after negotiating `api.devices-sync-control` 1.4.0.
The API lease completion and remote client both validate the requested range
and strict result projection. `DeviceSyncResources` and
`deviceSyncResourceBlocks.ts` expose editable live/history controls and stats.

Mac signed-range staging uses the existing attachment and file reads through
`electron/lib/folder-download.cjs` and its transport child. Native
`fileDownloadVersion` 1.0.1 reports temporary transport failures as a runnable
wait. Retry rechecks the same owner, selected origin, cloud revision and signed
range, then resumes from native staging's retained offset. The folder diagnostic
log records only closed phase and result labels. Test the retry and range
integrity in `electron/test/folder-download.test.cjs`.

POSIX symbolic-link metadata lives in `fileSync/symbolicLink.ts`; `SyncEntry`
content/stamp equality includes link kind and exact raw target identity.
`cloudFile.ts`, canonical `files/files.ts`, inventory projections and
`fileVersions.ts` preserve it through uploads, retained history and guarded
restore. `api.files` 1.9.0 / `api.file-sync-batches` 1.3.0 and native fileAccess
1.17.0 / fileSymbolicLinks 1.0.0 are explicit requirements. Targets are never
followed. Tests: `symbolicLink.test.ts`, canonical file/route suites and the
isolated Mac paged HTTP lane described in mobile-file-sync.md.

### Files browser and sync folder publication

The Files browser includes canonical live `file` Things. Its file actions use
the private file API and versioned attachment ranges. Moves and Trash use
the selected Timeline revision and preserve the original file ID and history.
Browser Upload reuses the existing upload control, then publishes the ready
attachment with the file API when the destination is in a saved owned sync
folder. The destination lookup reads only saved sync configurations and exact
folder ancestry, once per distinct folder in the current operation. Other
uploads keep their ordinary attachment placement. The sync inventory still
enumerates only canonical files and folders.

## Numeric summaries

`GET /api/v1/things` (1.47.0) accepts `maxCrystalField` for first-party owner/PAT
`thingtime=data` lists with exact `schemaId` and `parentId`; `excludeArchived=true`
omits archived entries. `numericSummary.ts` streams the existing `listThings`
projection and accumulates finite numbers without an item-count cap or a new
index. It returns only a complete `summary.max`, or null for no numbers. Abort,
pagination and access failures never return a partial maximum. This read does
not allocate an atomic sequence. Focused tests cover filtering and complete
pagination; real API acceptance must verify separate account/PAT boundaries.


## Exact authorized counts and visible offset windows

`api.things` 1.49.0 adds authenticated `GET /api/v1/things?count=true` with
ordinary list filters (`thingtime`, exact `schemaId`/`parentId`, `target`,
`folder`, `appId`, `builderApp` and `excludeArchived`). It returns
`{ ok: true, count }` or an explicit error, never a loaded-row subtotal.
`excludeArchived=true` excludes only literal `crystal.archived=true` in both
ordinary lists and counts before pagination. Count requests reject paging,
exact-ID and discussion-projection parameters.

Optional list `offset` is a zero-based ordinal of authorized visible rows and
returns `offset` plus `nextOffset` (null at the end), alongside the normal
`things` and `nextCursor`. It cannot be combined with a cursor or discussion
projection. This removes client-side serial page fetching for a distant page;
it does not promise constant-time access or a reserved snapshot.

`things.ts` shares `prepareThingsList` and `visibleThingsPage` across these
reads. Ordinary owned `['data']` rows with no inherited ACL, blocked moderation
or PAT visibility restriction can be counted natively. All exceptional rows
stream only authorization metadata through the canonical ACL gate; app
namespace, liveness, moderation and inherited audiences retain their exact
checks. Offset windows scan metadata and hydrate only the requested window.
There is no raw Mongo query input, new index, public projection or item cap.

Run `test:things`, `test:api-capabilities`, and
`node remix/scripts/things-counts-acceptance.mjs` after building Nitro with the
node-server preset. The latter uses a fresh disposable replica and API-created
accounts/data, checks privacy and page results, and records actual payload and
latency observations. Synthetic measurements do not establish production
latency or large-account query plans.


### Ordered exact-ID joins

The same `api.things` 1.49.0 contract accepts authenticated `GET /things?ids=`
with one URL-encoded JSON array of Thing ID strings. `getThings` reads unique
IDs in processing chunks, applies the same exact-read protected-record,
inherited ACL, PAT, app namespace and author-liveness gates as `getThing`, and
batches the generic public projection. It returns `{ ok: true, things }`
aligned to the requested order, including duplicates. Each inaccessible,
missing or protected row is `null`; no existence reason is disclosed.
There is no discussion hydration or discovery write. `ids` rejects other
list/id/projection parameters; the optional existing `key` remains supported.

This is the existing GET endpoint, so browser Actions retain their registered
read-only classification and canonical capability negotiation. No new route,
MCP server/tool, URL fetcher or raw query escape hatch is introduced. The array
has no product item cap; deployed URL and response transports remain finite.
Clients should chunk by encoded URL bytes (and split again on a transport
refusal) and retain all input positions, instead of truncating the selection.
Small processing chunks can preserve input positions across related-row joins.

Explicit-kind list/count requests pass their required kinds to
`ownerLibraryQuery.ts`, pruning impossible exact managed-kind OR exceptions
before Mongo planning while preserving the ordinary protected-kind exclusion.
Legacy post compatibility retains the full library query. The helper truth-table
regression covers mixed protected kinds and every retained managed guard.

Timeline page capture and comparison share
`app/timeline/pageBlockTraversal.ts`: an iterative preorder walk over authored
container/element/collection/condition children. It rejects ancestor cycles
without rejecting reused values and has no page block-count/nesting cap.
`componentBindings.ts` retains existing reference validation and capture/ACL
contracts; `componentDefinitions.ts` aligns nested stable identities. The
compatible write corrections are `api.things` 1.49.2, `api.things-update` 1.18.1
and `api.timeline` 1.19.1. Run `test:timeline` and the disposable
`test:timeline:large-pages:acceptance` after a node-server build.

### Builder app entry points and scoped navigation

`components/Builder/builderAppNavigation.ts` resolves
`crystal.metadata.entryPointThingId` through independent authorized app and target
reads. `/builder?app=<id>` opens the target's existing live reader. An unset
entry point browses contents; invalid, missing, inaccessible and folder/cyclic
targets show an error with Browse/Retry. Navigation never executes an Action,
changes audiences or assigns Things. `BuilderAppDialog` exposes a paged saved-page
selector and exact Thing ID input, validating availability before saving.

App cards keep explicit Browse/Edit controls. Kind, view, sort, group, display
and search changes preserve `folder` and query in the current URL; only explicit
All apps navigation leaves the container. Scoped search uses the existing
ACL-checked search conditions, not client-only filtering. Coverage:
`builderAppEntryPoint.test.ts`, `thingsLocation.test.ts`, and the isolated
`scripts/builder-entrypoint-acceptance.mjs` real API/browser check.


## Reviewed account recovery planning

`app/backups/accountRestore.ts` defines machine-readable whole-account scope and
explicit unknown source coverage/unavailable writer readiness.
`api/utils/backups/accountRestorePlan.ts` and `accountRestoreRecord.ts` validate
sealed independent entries, index reference mappings in disposable local-worker
SQLite, and seal immutable paged reviews through `BackupObjectStore`.
`backupObjectKey.ts` admits only generated `restore-plans` review keys.
No destination mutation endpoint or account writer is introduced. Run
`test:backups`; see [planning and completion boundaries](../portable-backups.md#account-restore-admission-and-durable-review-plans).

## Reviewed ordinary creation and execution holds

`backups/ordinaryRestoreTransaction.ts` composes the existing canonical Thing
writer and accounted Timeline effects for explicitly selected, closed private
graphs. Parent containment and strict reference closure are preflighted on
disposable disk indexes. Command intents, per-effect receipts and the folder's
protected scalar checkpoint provide resumable state; SQLite supplies no durable
write authority. `things/contentExecutionGate.ts` and canonical
`timeline/recordMutation.ts` fence current edits and release execution only after
the exact new completion proof. `auth/fenceAccountSession.ts` checks the current
full principal and writes its live session in the home content transaction.
See [portable backups](../portable-backups.md#selected-ordinary-graph-execution-primitives--2026-11-06).
Run `test:backups:ordinary-restore`, `test:backups`, and `test:api-capabilities`.
No whole-account readiness or public restore endpoint is added.

### File phase over reviewed restored folders

`backups/accountFileRestore.ts` reuses ordinary restored folder Things and their
protected creation/completion provenance; it never duplicates folder creation.
`things/contentExecutionGate.attachContentExecutionHold` accounts a new scoped
hold on an exact reviewed row and refuses an active prior hold. Canonical files
and compact managed placements advance the active root epoch before completion
can release holds. `api.things-bulk` 1.7.1 and `api.things-delete` 1.1.1 publish
managed placement/drain fencing. Run the file-restore real-replica proof plus
Things/Files/Timeline and content-gate regressions. UI/job activation, History
audit grouping and installed/native acceptance remain separate.

### Normal device folders and default destinations

`api.devices` 1.16.0 adds an origin/account/content-plane scoped
`rootFolderId` reference. `api.devices-folders` 1.0.0 is registered in
`apiDocs.ts` and the Nitro import map. Its GET is read-only: one device returns
the owned root (or null before creation); no device ID lists paginated owned root
references (50 per request, canonical chronological cursor), so devices are discoverable before uploads. POST verifies the
owned device in the home control plane and resolves ordinary private `folder`
Things through `createThing`/`getThing`, including canonical accounting,
placement and uniqueness. There is no mixed device/folder kind or new index.

`fileSync/deviceFolders.ts` keys roots and Files folders by origin, owner,
content plane and device; each leaf also uses the stable connection ID. Labels
never determine identity. New destinations are `Device / Files / Source label`
(including Photo Library). Existing explicit remote destinations, opaque native
root IDs, grants, drafts and pause settings are preserved. No save starts a
transfer. Renames are retained; moved child folders and replaced/shared
identities require explicit selection. Recreating a deleted root never moves
surviving contents back implicitly.

`SyncDestinationControl` uses editable Builder path/action/repeated-option
blocks with searchable paginated collections and explicit More devices discovery. `folderPaths.ts` reads actual
owned/private ancestry with a shared cache, four concurrent workers and scope/
cancellation fences; transport failures remain retryable. Device page and menu
Show Folder inspect an existing reference before creating a missing root, so
cloud navigation works while the physical device is offline. Root browsing
suppresses only an exact managed root already represented by its Device card;
search, folder-only views and location pickers retain normal folder results.

`SyncFolderCard` has an editable quick action outside collapsed settings,
with separate error and destination fields. The remote command worker runs
on paired Macs. Remote iPhone and Android panels show saved settings, and
the current iPhone can jump to its local transfer controls. Mounted panels
share verified saved revisions for the same owner, origin and device.
Photos sources display their virtual source label.
The native-only compact Things entry links to `/things?deviceSetup=1`; that
page reuses normal device pairing and folder-grant controls.

Run focused `deviceFolders`, capability, folder-card tests and
`node scripts/test-remote-device-sync-ui.mjs`. Build the Node middleware server,
then run `node scripts/test-device-sync-control.mjs .output/server/index.mjs
<path-to-mongod> --device-folders` from Remix for disposable real-API acceptance.
The launcher starts its own replica and seeds users/devices through APIs only.

## Durable backup authority boundary

`api/utils/backups/backupJobs.ts` owns private home-plane backup-job/event control
Things, original-session leases and atomic cursor/hash-reference checkpoints.
`things.ts` refuses their generic exact, inherited, mixed-kind and exported reads;
ordinary descendants cannot borrow a public ancestor through that private boundary.
`api.things` 1.52.1, `api.things-export` 1.16.1 and `api.things-bulk` 1.7.2 publish
that corrected permission boundary. Unit checks are `test:backups:worker`; actual
API-utils/replica transaction checks are `test:backups:workflow`.
`backupWorkflow.server.ts` reuses the supported ID-only Vercel Workflow lifecycle;
`backupEngine.server.ts` composes bounded inventory/capture/verification units.
No public admission/UI entry is enabled until the full supported execution path
and deployment readiness are independently accepted. Snapshot/reference sidecars
and plaintext-bearing encrypted hasher state stay in the independent backup store,
never ordinary Thing crystal fields. See `docs/portable-backups.md` and TESTING.

iOS Photos uses `PhotoLibraryReader` and the Rust capture's gap ledger. File
access 1.6.0 keeps iCloud-only resources explicitly incomplete while transferring
available originals. File access 1.7.0 can fetch an exact iCloud original
only with the saved explicit cellular allowance and live power/device checks.
File access 1.8.0 uses `PhotoBackupQueue` for one date-ordered queue of asset
groups. The Rust indexer seals selected originals and exact iCloud gaps;
untouched assets need no synthetic gap rows. After the initial checkpoint,
`pagedForegroundSync` reads only the scoped paths needed for the next batch
and merges its verified pairs into the existing baseline. Native batch
acknowledgement checks the exact cloud original fingerprints.
Native upload 1.5.0 negotiates the origin's scoped transfer
admission and queues a bounded set of already planned originals in
`NativeDeferredUpload`. `BGProcessingTask` can finish those attachments;
`pagedForegroundSync` retains canonical cloud folder and Timeline publication.
See the [iOS runbook](../../iOS/README.md#deferred-photos-transfers) and the
iOS deferred Photos checklist for installed and physical acceptance.

Native Photos automation 1.3.0 reports the measured activity of the single
worker through the owner/device/revision-bound status reply. The editable
connection card exposes the current stage, known counts and recent events.
On iOS 26+ continuation 1.1.0 can attach an explicit Back up now request to
that same worker while it prepares the first newest asset group. Subsequent
selections retain their normal batching. Verify stage reporting, alias-safe
reopen and signed physical behavior with the Photos launch checklist.

Native Photos automation 1.5.0 uses the same ordered queue's per-asset outcomes
to retain exact deferred originals and their retry timing. One authorized
PhotoKit preparation can run alongside date-ordered local selections. Every
prepared original rejoins the same verified upload and receipt path. Use the
editable activity panel for measured concurrent iCloud progress.

Explicit iOS Start/Retry recovers changed Photos backup settings for the same
authorized grant and device with cloud copies retained. It verifies the current
saved revision, native grant and destination, disarms the prior native queue
and verifies the current settings again before atomically archiving the old
operation/review pointers and admitting a fresh job. The new queue epoch
reconciles current observations against the saved folder. Already copied files
keep their revisions, and the saved network and charging rules still apply.
A repeat retry of the exact revision resumes the current epoch. The root lock
and live configuration check fence new dispatches under the old settings. If
an earlier unguarded file publication is already in flight at the server,
a same-folder rescan can still race that commit. The earlier journal and any
published revision remain available. Verify both journal formats and the
signed upload path with `photoSettingsRecovery.test.ts`.

Photos installed acceptance uses `iOS/ThingtimeUITests/PhotoLibraryConsentUITests.swift`
and `iOS/scripts/test-mobile-sync-installed.sh`: ordinary consent, same-grant
original hashes and reopen, with storage-readiness gates and nonzero executed-test
assertions. `nativeDeviceSyncGovernor` allows legacy connections without saved
limits on unsupported iOS while refusing explicit device and connection limits.
`deviceResourcePolicy.test.ts` covers that boundary; Mac enforcement is unchanged.

`fileSync/configurationStart.ts` is the explicit manual Start preflight shared
by native-host and remote controls. It rereads the exact reviewed owned revision,
refuses retained selected drafts/identity changes, CAS-patches only paused=false,
requires a successful acknowledgement and matching fresh readback, then returns
the confirmed configuration for existing runner admission. Uncertain writes
never start or blindly retry. Save/open and automatic scheduling never unpause
a connection; unrelated Home settings/drafts stay intact. Test with
`configurationStart.test.ts`, `test-explicit-sync-start-ui.mjs` and the compiled
device-folder replica fixture.

`DeviceSyncResources` and connection limit controls classify the actual selected
iOS bridge capability. A locally paired match is verified through its native
identity; other devices use their scoped status. Missing native resource support
shows iOS-managed/unavailable rather than Mac budgets or invented zero telemetry.
Existing explicit limits/drafts remain intact; ordinary connection progress is
independent from native CPU/scan telemetry. The paused-start browser harness
exercises unsupported iOS capabilities and retained controls at both widths.
