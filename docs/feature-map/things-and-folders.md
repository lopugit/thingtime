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

## Authorization helper

- Reads: `findViewableThing` / `canViewInherited` (see
  [sharing-and-audiences.md](sharing-and-audiences.md)).
- Owner writes: `updateThing`, `deleteThing` check ownership and PAT scopes
  through `resolveThingsActor(scope)`; new things routes must pass
  `thingsScope`.
- Folder listing (`listThings({ folder })`) is owner-only; `FOLDER_UNFILEABLE`
  kinds (reactions, saves, votes, updowns) live under their target.
- Deleting a folder re-parents its contents to the folder's parent; deleting a
  post cascades its attachments through `prepareAttachmentCascadeForThing`.

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

`schemas/appSuites/webStandards.ts` authors the reusable page/components/actions.
`webPlatform/` holds the versioned inventory, recipe generator and generic
isolated data-program runtime. Saved examples use ordinary Component Things,
not native page blocks. See [runtime and coverage](../web-standards-builder.md).
`test:web-platform` validates every catalogue definition and generic worker
behavior; `audit:web-platform` executes interactive recipes in a fresh browser
against a local or HTTPS preview runtime, without creating account data.
