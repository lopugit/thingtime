# Things and folders

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
