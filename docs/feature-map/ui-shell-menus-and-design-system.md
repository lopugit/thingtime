# UI shell, menus and design system

The web app is Vite + React Router (non-framework mode) + Nitro; `entry.client.tsx`
mounts with `createRoot`. Chakra UI primitives are wrapped by Thingtime's own
components; reuse them instead of adding parallel versions.

## Where the code lives

| Concern | Path |
| --- | --- |
| Thing context menu model (sections, actions, submenus, drill paths) | `app/components/Thingtime/ContextMenu/contextMenuModel.ts` |
| Menu renderer, trigger, hover/right-click/pinned behaviour | `app/components/Thingtime/ContextMenu/ThingContextMenu.tsx`, `ThingContextMenuTrigger.tsx`, `useThingContextMenu.tsx` |
| Base verbs every persisted Thing inherits (`open`, `inspect`, `copy-link`, `download`, `edit`, `share`, `delete`, `send-to-lopu`) | `app/schemas/thingActions.ts` (`THING_ACTIONS`), `ContextMenu/thingEntityMenu.ts` (`buildThingEntityMenu(capabilities, extensions)`) |
| Persisted-Thing menu button used by cards and pages | `ContextMenu/PersistedThingMenu.tsx` (fetches the Thing on open, handles copy-link/open/inspect/download/send-to-lopu; adapters pass `extensions` + `capabilities` + `onAction`) |
| Canonical link copying | `ContextMenu/thingEntityLink.ts` |
| Icons: emoji ↔ lucide registry (`LUCIDE_ICONS`, `LUCIDE_FOR_EMOJI`) | `app/theme/icons.tsx`; renderer `app/components/Icon/Icon.tsx` |
| Toasts / notifications | `app/components/Lopu/useLopu.tsx` (`useLopu()`, `useLopuStream()`) — never raw Chakra `useToast` or `alert()` |
| Device notification history | `app/local-workspace/notifications.ts`, `notifications.client.ts`; `NotificationsPage.tsx` reuses the normal rows/filters. Anonymous messages never sync; account messages use the existing home-pinned recorder after verified login. |
| Layering (z-index) | `app/components/Things/transferLayers.ts` and the shared layer constants; never ad-hoc z-index escalation |
| Page shell, nav clearance, drawers | `app/components/Layout/Main.tsx`, `app/components/Nav/*` (`--tt-nav-clearance`, safe-area vars) |
| Device menu and full page | `app/components/Things/ThingsPage.tsx`, `ThingsViews.tsx`, `app/components/Devices/deviceNavigation.ts`, `DeviceDetailsDrawer.tsx` (one shared details tree for drawer and page) |
| Desktop footer build identity | `app/components/Nav/Footer.tsx` reads `thingtimeDesktop.getInfo().buildIdentity` from the packaged `electron/dist/web/metadata.json`; remote-origin status remains separate |
| Design tokens / CSS vars | `var(--tt-*)` tokens (surface, border, muted, ink, accent, radius); rainbow text in `app/theme/rainbow.ts` |
| Design system docs page | `/docs/design-system` (`app/routes/docs/*`) |
| Local cache tiers (first-paint) | `app/hooks/localCache.ts` (`tt-<domain>` keys) |

## Adding a menu action (any Thing surface)

1. Model: add a `ThingContextAction` (`id`, `command`, `label`, `icon`
   emoji, `lucide` name, optional `hint`/`kbd`/`danger`/`submenu`) to a section
   in the adapter's `extensions` (post: `PostThingMenu.tsx`; `/things`:
   `thingsMenuModel.ts`; generic: `buildThingContextMenuModel`). Shared verbs
   used by several surfaces belong in one helper (example:
   `attachmentArchiveActions.ts` `buildArchiveMenuSection`).
2. Icon: if the lucide name is new, import the component in
   `app/theme/icons.tsx`, add it to `LUCIDE_ICONS`, and map the emoji twin in
   `LUCIDE_FOR_EMOJI` so both icon styles render.
3. Dispatch: handle the `command` in the adapter's `onAction` switch; `/things`
   also needs the `ThingsItemAction` union and both dispatchers in
   `ThingsPage.tsx`.
4. Feedback through `useLopu()`; mutations reauthorize server-side.
5. Verify mouse, keyboard (arrow/Enter/Escape), touch, desktop and 375 px, and
   that menus stay clickable (no drag start) and reachable under the nav.

## Shared navigation and Builder controls

Owned Things inherit `history` from `THING_ACTIONS`. `TimelineHost` opens the
same History modal from Things, persisted entity menus and Builder definitions;
`TimelineLibrary` renders the managed Timeline folder through PageShell.
`TimelineVersionActions` previews restores/merges and presents conflict choices.
`TimelineMessages` renders note/Lopu/system bubbles in every look and the
Message tab composer (add note, Ask Lopu, remove) over `connection.notes`.
`TimelineBranches` creates named alternatives from a selected version, pulls heads,
loads an exact version and pushes a selection with a durable command queue. A
refused push stays visible on that branch; it does not turn healthy History reads
into an error. Unknown outcomes retain the original request identity.
Draft recovery uses the account-scoped `TimelineProvider` queue independently
of an open modal. See [contract and acceptance](../unified-timeline.md).

The compact Commander trigger opens shortcuts, recents, remote search and
commands in one surface. Builder page/component menus share `BuilderThingMenu`;
ordinary public page views do not expose floating editor controls. Admin remains
immediately below Dev and restricted to administrators. `NativeControlsEnabled`
also gates service-workspace rendering: inert catalog/preview panes cannot mount
workspace loaders, while interactive shared pages retain authorized staff access.

## House rules

`Kinds/HtmlTemplateField.tsx` keeps data-authored input, textarea and select
defaults in sync when asynchronous results arrive. It preserves visitor edits
when the current value differs from the previous default. Its opt-in browser
regression covers initial/changed defaults and dirty fields; the Web standards
browser acceptance also checks reload and repeated search through the renderer.

- Optimistic rendering: never flash a spinner when prior or cached state
  exists; paint the last-known value and reconcile.
- Every new user-facing feature gets a sensible settings surface when there is
  a real choice; popup and dedicated Settings views share category behaviour.
- Configurable images/files use the shared upload-first pattern (upload picker
  + "Use URL instead").
- Lopu has no gender; use **it**.

## Tests

- `scripts/lopu-popovers.browser.html` mounts the real floating host, full page,
  or embedded chat with synthetic HTTP/preferences. It checks popup hit testing,
  model/list selection and scrolling, setting persistence, repeat taps, Escape
  and outside dismissal. Lopu popovers set `rootProps.zIndex` on Chakra’s
  positioner, using `DRAWER_POPUP_Z`; child content alone cannot escape a lower
  stacking context.

- `scripts/lopu-dictation.browser.html` exercises the real Lopu voice surface
  with synthetic speech/HTTP: live composer revisions, stop/resume, edits,
  mode switches, stale callbacks, recognition failure and rejected-send recovery.
  `composerDictation.test.ts` covers draft merging and the shared input limit.
  `dictationSilence.ts` owns a logical recording's configurable five-second send
  window and ten-second Hear me out reminder, surviving native recognizer
  restarts. Desktop speech bridge 1.1.0 uses continuous native capture for the
  composer while retaining the legacy/private-page utterance boundary.
  `LopuDictationSettings` shares controls across Settings → Lopu and
  the voice gear; chat settings exposes the same Hear me out preference.
  Timers submit the current composer draft through `externalSubmitDraftRef`,
  never cached recognition text. Stop/edit/owner/chat/mode changes cancel them.
  Hear me out uses Mac/browser device dictation; native iOS recording refuses
  this mode instead of silently auto-sending. Dedicated Transcribe/Direct voice
  retain their flows while it is off.
- `npm --prefix remix run test:nav`, `test:lopu-ui`, `test:things` (menu
  models), `test:feed` (card contracts). Menu/layout behaviour is verified in a
  live browser at desktop and 375 px widths (`TESTING.md` "Shared page shell",
  "Things page", attachment/media sections).

## Compact file browser

`FilesystemThingsBrowser` reuses Things views, `ThingActionMenuButton` and
`ThingContextMenu` for file/folder actions. The optional `compact`, `itemHref`,
`itemMenuFor` and `menuZIndex` view handlers support narrow drawers and the
expanded transfer dialog without changing the ordinary library defaults.
Popup menus use the shared transfer layer constants; keyboard copy/cut/paste
only intercepts events inside the browser and leaves editable inputs alone.

`app/local-workspace/AccountSyncStatus.tsx` sits in normal page flow with the
shared nav clearance. It distinguishes device saves, retries, refusals and
conflicts. Comparison uses bounded scrollable content and explicit keep-device /
keep-account choices; stale review must fail instead of overwriting new edits.
Verify at 1440, 390 and 320 CSS pixels, including expanded comparison and long IDs.

## Anonymous theme library

`ThemeSettings/ThemeStudio.tsx` uses content identity from `useWorkspaceUser`.
Anonymous saves show device-only wording and use the dedicated `local-workspace/themes.ts`
writer; account routes retain their authentication and publication rules.
`theme/savedTheme.ts` is the shared token sanitizer. Normal Transfer controls
reuse `utils/thingTransfer/theme.ts` validation and the local import transaction.
Verify offline save/reload/apply/delete and transfer at desktop/390/320px with
`test:local-workspace`, `test:things` and `test:theme`. Account theme sync and
local history remain tracked in [the local coverage matrix](../local-workspaces.md).


## Device workspace storage

`Settings/ThingsSettings.tsx` includes `WorkspaceStorageSettings`, shared by the
Settings page and drawer. `local-workspace/storageStatus.client.ts` binds only
the active anonymous or account/origin/data-plane lease; identity invalidation
clears old values before a new workspace renders. `WorkspaceTransaction.usage`
reads the existing ledger and counts exact-scope keys without file-body reads.
`storagePersistence.ts` separates passive browser protection checks from an
explicit, bounded `StorageManager.persist()` request. No origin-wide usage
estimate, account HTTP request or anonymous synchronization is introduced.
Run `test:local-workspace`; `storage.browser.test.ts` uses `TT_LOCAL_STORAGE_URL`,
`TT_SHARED_PLAYWRIGHT_PATH`, optional `TT_SHARED_CHROME_PATH` and
`TT_LOCAL_STORAGE_ARTIFACTS` with the built local client. It verifies offline
reload, other-tab writes, ledger failure/recovery, protection outcome and
1440/390/320px layout. See the device-storage checkpoint in
[local workspaces](../local-workspaces.md).


## Local global/site composition

`BuilderPagesList` links global editing and canonical site routes to `BuilderPage`.
`schemas/sitePages.ts` supplies the same native-section definitions to offline
Builder and server seeding. `SiteBlocksHost` resolves the workspace's pages with
`useWebpage` and a bounded identity-owned `siteBlocksCache`; failed refreshes
retain paint and offer Retry. Each global/route composition uses the existing
webpage runtime, with native permission and Action trust checks intact.
`drafts/sitePageDraft.ts` validates recoverable editor snapshots against the saved
page revision. Cross-tab refresh is a scope-only local-workspace invalidation.
Run `test:webpages`, `test:drafts`, `test:local-workspace` and the opt-in
`local-workspace/siteBlocks.browser.test.ts` described in `docs/local-workspaces.md`.


Persisted Thing menus share `ThingExportDialog` with the Things library. The
`download` verb preserves the shared-link context and closes/cancels across
workspace/Thing identity changes. Account and anonymous posts/replies use the
same portable JSON/ZIP flow; file-only archive actions remain distinct. The
opt-in `accountBoundRetention.browser.test.ts` exercises keyboard menu opening,
touch selection, responsive dialogs and real offline export/import. Managed
Timeline folders continue to use their dedicated History workflow.


Owned anonymous and offline account Things expose History through
`PersistedThingMenu` using workspace content identity. Its menu callbacks and
`TimelineHost` targets include the root generation; identity changes retire the old
modal and callbacks. Server handoff and account History authorization stay separate.
Run the enabled `details.browser.test.ts` and `historyMenu.browser.test.ts` alongside
Things, Timeline, navigation and local-workspace suites. See the
[History checkpoint](../local-workspaces.md#native-anonymousoffline-history-menu--2026-10-17)
for cached-account versus authoritative anonymous coverage and remaining sync work.

## Settings sections

`SettingsSection.tsx` is the shared, initially collapsed disclosure card for
personal settings (page and popup) and admin configuration. It keeps children
mounted, exposes a title/description/summary, and opens enclosing cards for
fragment links. `SettingRow` gives labels a readable wrapping basis before
controls move to the next line. Admin categories live in `adminRoutesCore.ts`:
AI Providers, Lopu, Platform, and Access & limits replace System; legacy System
links resolve to AI Providers or to Lopu for Lopu anchors. Browser regression:
`/scripts/settings-sections.browser.html`; route coverage: `test:admin-integrations`.


The local storage browser regression explicitly opens the shared collapsed card
with keyboard and pointer, checks cold offline reload, and compares unchanged
authored records plus refreshed byte accounting while native editor-tree
preferences initialize. See `storage.browser.test.ts` and the PR #1000 upstream
integration note for 1440/390/320px coverage.
