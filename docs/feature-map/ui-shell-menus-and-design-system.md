# UI shell, menus and design system

## Editable LiDAR capture controls

The Things root shows an editable LiDAR scan section on iOS. Its
`SettingsDocumentHost` uses separate heading, description, start, retry, status,
and receipt-link blocks. `useTtActionClicks` also lets a saved Builder button
open the same scanner with the allowlisted `$ui` native capability `lidar.scan`.
Only direct activation of a regular button can request capture. The native
scanner requires a separate Start gesture before opening the camera.

`LidarScanProvider` checks the current Home account and compatible iOS
`lidarVersion`; native replies must match the exact request, owner and origin.
An iPhone or iPad browser can hand off its HTTPS origin to the app, where the
app independently checks the account. Local originals and upload retries stay
in native storage. Run `lidarScanBridge.test.ts` and
`remix/scripts/lidar-scan.browser.mjs`. See [native LiDAR scans](../native-lidar-scans.md)
for the bridge, archive and hardware acceptance.

## Native mobile background presence

`MobileDevicePresenceBootstrap` owns the Activity manager preference and identity
fence. `mobileDeviceBridge` negotiates iOS pairing bridge 1.1.0 before requesting
`presence(enabled:true)`; 1.0.0 hosts retain foreground `status`. Identity changes
and stopping the activity withdraw background approval even between requests;
ordinary page hiding only cancels the foreground request. Native
`MobileDeviceBackgroundPresence` registers Background App Refresh, keeps one
foreground-verified origin/owner binding and sends scoped device-bearer check-ins
without using web cookies. iOS controls timing. See `iOS/README.md` and the mobile
presence checklist in `TESTING.md`; run native lifecycle/pairing and web bridge/
presence tests together.

## Incoming sharing and contextual toolbar

`/share` uses the focused shell in `app/root.tsx`, with the existing Post,
Messenger and Things destination interfaces. `IncomingShare/ContextActionToolbar`
accepts registered action descriptors and the active context. Its persisted
`SettingsDocumentHost` document contains individually editable buttons, labels,
icons and accents; `TransientBlockHost` binds selection and permitted actions.
`ThingsPage.locationPicker` retains folder navigation and creation while keeping
**Save here** above the measured, full-width toolbar. See
[incoming sharing](../incoming-sharing.md) and the incoming-sharing checklist in
`TESTING.md`; `scripts/incoming-share-acceptance.mjs` exercises real disposable
API data and desktop/mobile rendering.

`ContextActionDock`, `useContextViewportDock` and `contextViewport` share keyboard
placement across the toolbar and existing destination controls. Keep CSS layout
coordinates distinct from client rectangles when WebKit pans its visual
viewport; count the pan once. Focus reveal uses measured control bounds and
bounded settling, while the Builder blocks remain individually editable.
`test:attachments` includes the IncomingShare viewport/bridge regressions.

## Editable map markers and connector settings

Authored buttons can opt in to Ctrl/Cmd primary selection and use ordinary
touch and keyboard selection controls. `webpageRuntime.tsx` keeps a transient
contextual list at `page.selection`; the owner-only delegated click handler
captures the complete selection for sequential Action batches. Named passive
cursor sources expose grouped rows at `page.collections`. The same keyed
repetition works in any authored subtree, including map markers.
See [Builder browser Actions](../builder-browser-actions.md).

Saved `tt-rich-text` fields/read views reuse `LongTextEditor`/`RichTextBlocks`.
`componentFormFields.ts` captures native fields at activation and awaits trusted
editor adapters before confirmation/dispatch; JSON plus optional plain text share
one snapshot. `tt-menu contextMenu:true` adopts editable target/content slots and
an ordinary touch trigger. The native popup remains mounted while hidden, uses
its owning document/window, and leaves field typing/toolbars alone. The safe
intrinsic allowlists, `templateToBlocks` and `HtmlBlockElement` share both tags.
Run authored-control, template, editor, capability and composed browser checks.

Map overlays accept optional visual scale/SDK zoom adaptation and explicit keyed
association. `Maps/mapboxScale.ts` keeps SDK anchor transforms intact;
`mapboxGrouping.ts` preserves every original authorized member without coordinate
merging. `markerGroup` and `map` scopes supply editable badge/menu composition.
Ordinal labels are computed from all rank-sorted items before coordinate filtering.
No application-specific menu or marker definition is committed. See the canonical
Builder guide and `TESTING.md` for input, iframe, grouping and mobile acceptance.

Saved `tt-mapbox` Webpage elements may contain ordinary editable child blocks,
including literal saved Component references. The existing resolver and sharing
traversal authorize those references. Each marker receives `point` (normalized
geometry/appearance/selection) and `item` (the authorized source row); the SDK
positions stable neutral hosts while normal Builder rendering owns controls,
layout and accessible names. Editing reveals the child template. An authored
`data-tt-reveal` value reveals that element when its bound selection changes,
without navigation or stealing focus. No private app definition is bundled.
Clients authoring this composition require `api.things` 1.48.0,
`api.things-update` 1.17.0 and `api.webpages-resolve` 1.10.0.

Settings → Connections → Thingtime connector confirmations
(`#connector-confirmations`) uses SettingsDocumentHost with independently editable labels, native inputs and
status blocks; TransientBlockHost binds state and actions. Ten individual
checkboxes and an all/mixed checkbox control only Thingtime prompts. Account
changes clear previous settings; writes preserve content and use one inline
status/error. Authentication, scopes, revisions and host approvals remain
independent. Run the focused connector tests and desktop/mobile browser fixture.

Saved map workspaces use the shared `$ui` query action with `scope: 'page'`
for dynamic tabs, filtering and details while retaining URL deep-link defaults.
`webpageRuntime.tsx` clears transient query and form state at actual navigation or
account/database access changes. Editable `tt-upload` elements reuse the normal
attachment picker; Mapbox markers compose a photo, icon, wrapping label and
optional icon strip. `node remix/scripts/routes-map.browser.mjs` checks these
interactions on desktop/mobile with synthetic replies and an isolated browser;
live saved-page acceptance is required separately.

Admin MongoDB connections reuses the existing admin category/deep-link model and
the private settings-document Builder host. `mongoConnectionInventoryBlocks.ts`
contains editable search, freshness filter, metric, deployment, feature, runtime
and pool templates, with progressively disclosed details;
`MongoConnectionInventory.tsx` supplies ephemeral authenticated observations.
`mongodb-connections-acceptance.mjs` covers real data, desktop/mobile scrolling,
expanded details and independent nested Builder edits with saved-Thing readback.
Only exact previous defaults migrate; custom saved layouts are preserved.

The web app is Vite + React Router (non-framework mode) + Nitro; `entry.client.tsx`
mounts with `createRoot`. Chakra UI primitives are wrapped by Thingtime's own
components; reuse them instead of adding parallel versions.

Device sync management is available to the signed-in device owner in browsers
through `DeviceSyncPanel` and `RemoteDeviceSync`, independently of local pairing.
The installed app retains direct controls for its own device. Connection editor
journals preserve multiple drafts per origin/account/storage plane/device,
including legacy single drafts and incomplete resource input; only explicit
Save or Discard removes the selected draft. `test-sync-drafts-ui.mjs` covers
Add, switching, collapse/reopen, reload and account/device isolation. Remote controls use
editable settings blocks and the existing configuration form; see
[browser device sync](../browser-device-sync.md) and its browser/installed checks.

Lopu’s floating shortcut is opt-in through `settings.lopu.launcher`. The chat
composer gear and Settings → Lopu share that persisted preference through
`useLopuChat` / `useLopuSettings`; `LopuHost` honors it even when minimised.
Navigation can always reopen the chat. Missing preferences default off while
explicit saved choices survive. See the unified Lopu checklist in `TESTING.md`.

Mobile native presence is owned by `Devices/MobileDevicePresenceBootstrap` in the authenticated root shell, separately from sync admissions and page lifetime. `mobileDevicePresence.ts` refreshes saved native pairing status while visible, on resume/online/bridge readiness, with bounded retry backoff and immediate identity cancellation. Settings/setup retains explicit pairing; it does not own a second polling loop. Run its deterministic lifecycle tests and the mobile-presence checklist in `TESTING.md`.

## Where the code lives

| Concern | Path |
| --- | --- |
| Native Commander result navigation | `Commander/apps/desktop-ui/src/components/Launcher.tsx`, `hooks/useResultNavigation.ts`, and `components/ResultIcon.tsx`; precise taps, accelerated held arrows, immediate gesture cancellation and stable native icon requests. Regression and native acceptance: `Commander/docs/TESTING.md`. |
| Native desktop View menu and Command/Control zoom input | `electron/main.cjs`, `electron/lib/window-zoom.cjs`; regression: `electron/test/window-zoom.test.cjs`, `pnpm --dir electron verify:window-zoom` (real Electron fixture) |
| Thing context menu model (sections, actions, submenus, drill paths) | `app/components/Thingtime/ContextMenu/contextMenuModel.ts` |
| Menu renderer, trigger, hover/right-click/pinned behaviour | `app/components/Thingtime/ContextMenu/ThingContextMenu.tsx`, `ThingContextMenuTrigger.tsx`, `useThingContextMenu.tsx` |
| Base verbs every persisted Thing inherits (`open`, `inspect`, `copy-link`, `download`, `edit`, `share`, `delete`, `send-to-lopu`) | `app/schemas/thingActions.ts` (`THING_ACTIONS`), `ContextMenu/thingEntityMenu.ts` (`buildThingEntityMenu(capabilities, extensions)`) |
| Persisted-Thing menu button used by cards and pages | `ContextMenu/PersistedThingMenu.tsx` (fetches the Thing on open, handles copy-link/open/inspect/download/send-to-lopu; adapters pass `extensions` + `capabilities` + `onAction`) |
| Canonical link copying | `ContextMenu/thingEntityLink.ts` |
| Icons: emoji ↔ lucide registry (`LUCIDE_ICONS`, `LUCIDE_FOR_EMOJI`) | `app/theme/icons.tsx`; renderer `app/components/Icon/Icon.tsx` |
| Toasts / notifications | `app/components/Lopu/useLopu.tsx` (`useLopu()`, `useLopuStream()`) — never raw Chakra `useToast` or `alert()` |
| Device notification history | `app/local-workspace/notifications.ts`, `notifications.client.ts`; `NotificationsPage.tsx` reuses the normal rows/filters. Anonymous messages never sync; account messages use the existing home-pinned recorder after verified login. |
| Retained account history | `app/local-workspace/notificationPages.ts`, `notificationHistoryAccess.ts`; exact query/cursor snapshots and scoped refusal guards. `app/hooks/useDebouncedSearchDraft.ts` preserves newer typing across delayed URL updates. Native tests cover offline/retry, pagination invalidation and refused cached projections. History filters use the existing launcher-clearance marker, shared by the mobile Lopu and DevKit shortcuts. |
| Layering (z-index) | `app/components/Things/transferLayers.ts` and the shared layer constants; never ad-hoc z-index escalation |
| Page shell, nav clearance, drawers | `app/components/Layout/Main.tsx`, `app/components/Nav/*` (`--tt-nav-clearance`, safe-area vars). `SiteBlocksHost.tsx` keeps the native outlet mounted while site blocks or a refresh notice change its layout. The workspace identity still owns the outlet lifetime. |
| Password surfaces | `app/root.tsx` keeps `/passwords/provider` in the focused authorization shell; `/passwords` and `/settings/passwords` retain navigation while hiding floating assistant/developer launchers that can cover narrow credential controls. |
| Custom drawer links and Thing attachments | `app/components/Nav/Drawer/drawerCustomItems.ts`, `customDrawerBlocks.ts`, `CustomDrawerItems.tsx`, and `useDrawer.tsx`; account-scoped device entries use parent IDs for arbitrary-depth menus, shared Commander search, individually editable Builder blocks. Add finishes both the root list and active submenu and creates in that parent. Submenu controls bind to each row’s available direct children (including migrated authored templates); leaf links and Add + stay available. Submenus stay below the root list with Back and ancestor navigation. Settings exposes parent selection, sibling ordering and the actual menu template, saved as a private webpage Thing through `SettingsDocumentHost`, with scoped legacy device-layout recovery and editable template migrations. `scripts/custom-drawer-acceptance.mjs` checks matched row styling, real API/browser persistence and nested Builder edits; its `nested` scope covers deeper menu navigation |
| Device menu and full page | `app/components/Things/ThingsPage.tsx`, `ThingsViews.tsx`, `app/components/Devices/deviceNavigation.ts`, `DeviceDetailsDrawer.tsx` (one shared details tree for drawer and page) |
| Device dashboard | `app/components/Devices/DeviceDashboard.tsx` binds the paired device’s optional observations into the private, editable `deviceDashboardBlocks.ts` layout in both views. `deviceResourceMetrics.ts` keeps unknowns separate from measured zero and derives the network arc from the download/upload split. |
| Desktop footer build identity | `app/components/Nav/Footer.tsx` reads `thingtimeDesktop.getInfo().buildIdentity` from the packaged `electron/dist/web/metadata.json`; remote-origin status remains separate |
| Design tokens / CSS vars | `var(--tt-*)` tokens (surface, border, muted, ink, accent, radius); rainbow text in `app/theme/rainbow.ts` |
| Shared native selects | `app/Providers/Chakra/Components/Select.tsx`, registered in `theme.tsx`; Chakra `Select` consumers (including Character posting and CI providers) inherit runtime colors, borders, radii and keyboard focus; Theme Studio controls the focus border and two-color glow through `theme/tokens.ts` and `theme/customise.ts` |
| Design system docs page | `/docs/design-system` (`app/routes/docs/*`) |
| Local cache tiers (first-paint) | `app/hooks/localCache.ts` (`tt-<domain>` keys) |
| Nested Builder insertion and ancestry | `Builder/WebpageBlocksRenderer.tsx`, `blockChromePath.ts`, `useBuilderChrome.tsx`, `webpageBlocks.ts`; one ancestor toolbar, populated-parent append controls, and directional insertion that preserves neighboring layout |
| Current-page Builder | The drawer footer and focused surfaces toggle `Builder/CurrentPageBuilder.tsx` for the active route and account. `SettingsDocumentHost` shows layout controls only in Builder mode. View mode renders saved layouts and keeps in-progress drafts for reentry. `scripts/subspace-messages-acceptance.mjs --ui` exercises the toggle and saved layouts. |
| Builder inspector chrome | `Builder/BuilderOverlayHost.tsx` exposes the shared launcher-suppression CSS used by `root.tsx`: floating Lopu/DevKit launch buttons step aside while a `.ttBuilderDrawer` exists and return on close, without changing panel state or preferences. Real viewport hit coverage: `scripts/preview-retention-overlay-acceptance.mjs`. |
| Editable block structure dialog | `Builder/BlockContextMenu.tsx`, `BlockStructureModal.tsx`, `blockStructure.ts`; page/parent/block projections rendered through `SettingsDocumentHost` and `TransientBlockHost`, selecting the original page block in its inspector |


Repeated feedback from one editor can pass a stable `id` to `useLopu`;
`lopuToastDelivery.ts` replaces only an active notification with the same account
and caller key. Unkeyed notifications and every-event history stay separate.
`lopuToastDelivery.test.ts` runs in `test:client-errors`; the native instruction
Settings test checks repeated saves and unobscured 1440/390/320px guidance.

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
5. For library Archive/Restore, derive the action from the entire owned selection
   and use the same dispatcher for the right-click and row menu.
6. Verify mouse, keyboard (arrow/Enter/Escape), touch, desktop and 375 px, and
   that menus stay clickable (no drag start) and reachable under the nav.

## Shared navigation and Builder controls

`Nav/Nav.tsx` shares Back and Forward with the Electron titlebar. The
web navbar adds Refresh and exposes all three in standalone browsers and the
iOS app’s selected URL view.
Back and Forward traverse the current tab history and Refresh reloads the
current document. See the shared page shell checklist in `TESTING.md`.

Builder-authored Things carry the composable `builder-thing` schema in the
existing `thingtime` array. Shared Builder classification also recognizes legacy
canonical Builder kinds and app folders. Owner opening is separate from the
canonical permalink: webpages use `/builder?page=<id>`, other authored Things
use `/builder?thing=<id>`, and app folders use Builder folder navigation. The
shared Thing menus expose **Open in Builder** and supported **Open live page**
destinations while Copy link/Share retain view links. See the Builder Thing
navigation checklist in `TESTING.md` for ownership, legacy data and mobile menus.
`node remix/scripts/builder-thing-navigation-acceptance.mjs` exercises the real
API with disposable accounts, replica data and browser profiles. Build the Nitro
node server first, supply `BUILDER_NAVIGATION_EVIDENCE_DIR`, and select an installed
browser with `PLAYWRIGHT_MODULE` and `CHROMIUM_EXECUTABLE`; `THINGTIME_TEST_MONGOD`
overrides the local Mongo binary. Ports 19651–19654 must be free. The runner
starts its own Vite shell and removes its test processes and private fixtures.

Agent browsers are linked from Lopu's drawer group to `/agent-browsers` and
`/agent-browsers/:taskId`. `AgentTasks/AgentNetworkSettings.tsx` shares the device
default and task checkbox controls; `AgentBrowserViewer.tsx` observes or controls
the current claim. The task board and detail pages come from the editable
`schemas/appSuites/agentTasks.ts` suite, using normal Things and Actions for
tasks, todos and progress. See [the runtime contract](../agent-browsers.md) and
the Agent browsers section of `TESTING.md` for real data, responsive layout and
live-viewer acceptance. Device-only operations use the trusted desktop bridge.

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

`Lopu/useLopuLauncherClearance.ts` observes shared post/comment composers, including
the collapsed post trigger, and
temporarily hides the phone launcher while its saved position intersects a
composer. Scroll, resize and newly mounted composers restore or hide it without
changing saved placement; navigation still opens Lopu. The native
`Sharing/inheritedAudience.browser.test.ts` checks submit and collapsed-trigger hit targets and bounds
at 1440, 390 and 320 px.

## Tests

- `pnpm --dir remix run test:webpages` covers block mutations and structure
  projections. `node remix/scripts/builder-nesting-acceptance.mjs` exercises
  repeated nested insertion, directional menus, ancestry, structure selection,
  save/readback/reload and responsive layouts against a disposable real API and
  replica set. It owns its browser profile, database, ports and cleanup.

- `node remix/scripts/run-select-theme-browser.mjs` builds the real shared theme
  and Character selector in a network-isolated browser fixture. Set
  `TT_QA_IMAGE` to an installed isolated runtime and `TT_QA_SECCOMP` to its
  Chromium sandbox profile, as required by the runner. It checks desktop/mobile,
  light/dark themes, native options, keyboard focus and selection, overflow,
  and real Theme Studio editing/save/reload against synthetic HTTP;
  it does not perform live-account or CI-provider mutations.

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
`ThingTransferControls` keeps document menus in document coordinates and fixed
inspector menus in their container layer. Shared viewport overflow constraints
and a scrollable menu keep import/export reachable on long pages and phones.


Owned anonymous and offline account Things expose History through
`PersistedThingMenu` using workspace content identity. Its menu callbacks and
`TimelineHost` targets include the root generation; identity changes retire the old
modal and callbacks. Server handoff and account History authorization stay separate.
Mobile version details use a bounded inner scrollport with safe-area content
and scroll padding, so keyboard focus and revealed restore controls clear the
viewport edge and floating launchers. `themeVersions.browser.test.ts` checks
the real restore button at 1440/390/320 px.
Run the enabled `details.browser.test.ts` and `historyMenu.browser.test.ts` alongside
Things, Timeline, navigation and local-workspace suites. See the
[History checkpoint](../local-workspaces.md#native-anonymousoffline-history-menu--2026-10-17)
for cached-account versus authoritative anonymous coverage and remaining sync work.

## Native mobile device setup

`components/Devices/MobileDeviceSetupCard.tsx` is shared by Things and Things
settings. `mobileDeviceBridge.ts` negotiates the explicit native capability and
fences responses by request, account and origin. iOS implements the bounded
bridge in `iOS/Thingtime/Devices/`; Android uses `android/app/src/main/java/com/thingtime/mobile/`. Native credentials never reach the renderer.
Run `test:devices` and the opt-in iOS/Android mobile-device acceptance scripts. See
[full mobile and sync scope](../mobile-file-sync.md).
## Incoming mail

See [incoming-mail.md](incoming-mail.md) for Email settings, IMAP/POP3, private cloud storage, the paired local connector, offline reading and proxy inbox views.

## Settings sections

`SettingsSection.tsx` is the shared, initially collapsed disclosure card for
personal settings (page and popup) and admin configuration. It keeps children
mounted, exposes a title/description/summary, and opens enclosing cards for
fragment links. `SettingRow` gives labels a readable wrapping basis before
controls move to the next line. Admin categories live in `adminRoutesCore.ts`:
AI Providers, Lopu, Platform, and Access & limits replace System; legacy System
links resolve to AI Providers or to Lopu for Lopu anchors. Browser regression:
`/scripts/settings-sections.browser.html`; route coverage: `test:admin-integrations`.

## Native Commander controls

`Commander/hosts/macos/Sources/Commander/Windows/LauncherPanelController.swift`
owns the launcher's native edge/corner resize gesture. Passive cursor and tracking
events must preserve that gesture; release, deliberate input and lifecycle changes
end it. `CommanderLauncherContentView.swift` places eight native resize handles
above WebKit; their bounded, minimally painted regions keep the transparent outer half in WindowServer's
input surface as well as AppKit hit testing. Separate always-active movement tracking supports non-key pinned
panels; panel motion dispatch selects the existing native handle cursor without rebuilding region geometry.
Central content retains WebKit cursors, and disabling custom resizing hides both input and painted handles.
`CommanderWebView.swift` supplies anchored frame geometry. Regression coverage is
in `CommanderWebViewTests.swift`, with native hover/drag acceptance in
`Commander/docs/TESTING.md`.

The native launcher emits reopen and command shortcut events into its retained
web view. `useCommander.ts` gives each command view opening a fresh session;
`App.tsx` uses it to mount a new `EmojiPicker` with a blank search while retaining
locally saved preferences. `useCommander.test.tsx` covers a same-batch reopen.

The desktop launcher gear reuses `builtin:settings` / `open-settings` in
`Commander/apps/desktop-ui/src/components/Launcher.tsx`. `ProcessesPanel.tsx`
and `processModel.ts` share sorting, averaging, filters and local view preferences
between Activity and `ProcessesWindow.tsx`. `useSystemMetrics.ts` polls the native
bridge without overlapping requests. `SystemMetricsService` and
`ProcessUsageHistory` share sampled history across native windows, with stable
process identities and explicit coverage. `CommanderUtilityWindow` implements
maximize/restore; `SettingsWindowController` hosts Settings and Processes, and the
native bridge applies Keep above only to the requesting utility window. Checks:
Commander TypeScript/Vitest and Swift tests, plus TESTING.md's native launcher
checklist on the installed signed app.


The local storage browser regression explicitly opens the shared collapsed card
with keyboard and pointer, checks cold offline reload, and compares unchanged
authored records plus refreshed byte accounting while native editor-tree
preferences initialize. See `storage.browser.test.ts` and the PR #1000 upstream
integration note for 1440/390/320px coverage.

Account Theme Studio now uses the same local theme writer with independent
content/selection queues in `accountApi.client.ts`. `AccountThemeSyncStatus`
provides retries and exact conflict comparisons. ThemeStudio keys its state by
workspace identity; ThemeHost uses retained content before network refresh.
See [account theme coverage](../account-theme-workspace.md) for native browser
fixtures, unresolved transfer/History integration and verification boundaries.

Theme Studio Save/Apply flushes the existing native editor persistence before
reporting local completion; account queues still run independently. The mobile
History detail sheet retains bottom clearance so floating developer controls
cannot cover its last export action. Native regressions:
`anonymousThemeHistory.browser.test.ts`, `accountThemeConflict.browser.test.ts`.
## Editable private settings

`Settings/SettingsDocumentHost.tsx` composes the ordinary Builder drawer/chrome
with authored `WebpageBlock[]`. Account layouts use private keyed webpages through
`settingsDocument.client.ts` and existing Things revision fences. Device recovery
uses the same document format with origin/authority scoped local storage and Web
Locks. Neither adapter captures form DOM or runtime credential state.

`desktopSettingsDocuments.ts` defines the runtime, endpoint and previous-workspace
recovery controls as editable intrinsic blocks. `useDesktopSettingsAdapter.ts`
provides public bindings and a bounded transient native-operation map. Sensitive
hosts reject external sources, native/component blocks and persisted password/file
values before rendering; normal Builder insertion and source editing follow the
same restrictions. Scope changes abort transient controls and fence late results.

## Password manager navigation

`Nav/Drawer/drawerMenu.tsx` exposes an authenticated Password manager entry for
`/passwords` and `/settings/passwords`. The shared `Settings/settingsTabs.ts`
category supports full-page/popup navigation, reload and the legacy
`#password-manager` anchor. `PasswordManagerSettings.tsx` composes an editable
settings document with `PasswordPasskeySetup`; its explicit Thingtime sign-in
passkeys link targets `/settings/security#account-passkeys`. Browser approval at
`/passwords/provider` uses the same safe editable-document and transient-control
hosts; passwords and signing keys never enter layout blocks. Check keyboard,
Back, nested Builder selection, narrow/mobile widths and full-page scroll in the
real browser. See [password manager](../password-manager.md#browser-passkeys-and-settings).


## Automatic page titles and social previews

`app/utils/pageTitle.ts` and the server's shared social resolver use
`automaticRoutePreview.ts`. `scripts/generate-route-previews.mjs` discovers the
real eager/lazy/nested/index route tree from `app/routes.tsx` without importing
pages. Vite watches route/module changes; Vite and Nitro builds regenerate the
portable `automaticRoutePreviews.generated.json`. New ordinary routes receive
safe pattern-derived copy and a branded image automatically. Parameter values,
queries/fragments and wildcard/unknown paths do not supply metadata text.

Optional literal `socialPreview` exports customize display copy/card variant;
`pageTitle` is the document-title label, independent of the share headline.
No backend page-metadata registry is maintained. For saved `/p/:id` and `/t/:id`
pages, supported anonymous public headings/prose/managed images supply defaults;
existing saved `name`/`description` fields override them. The extractor does not
execute Actions, sources or client JavaScript, infer private bindings, or expose
system `siteRoute` layouts. Access/indexability and attachment ACLs remain in
the canonical server paths. Run `test:social-previews`; see
[the metadata contract](../seo-social-metadata.md) and TESTING's social-unfurl
checklist. Live rendered/crawler acceptance remains a separate check.

### Customised link previews

`Sharing/SharePreviewHost.tsx` supplies the shared modal opened by the canonical
`share-preview` Thing verb, Things library menus, profile links and generated
invite links. `sharePreviewBlocks.ts` is an individually editable settings
layout with repeated theme/layout choice templates; `TransientBlockHost` binds
only public metadata and ephemeral presentation/copy actions. Themes and layout
travel as `previewTheme`/`previewLayout` on the copied destination. Existing
navigation/access parameters remain intact; anonymous metadata lookups exclude
unrelated queries and fragments and require `api.social-previews` 1.2.0.
The live card loads the server's actual `/social-card` PNG and retains its
previous image during refresh. Account, data-plane, route and request changes
fence responses and close obsolete dialogs. Run `test:things` for menu, link and
editable-document contracts, then browser acceptance for desktop/mobile,
selection, copy, error/retry, save/reload and nested Builder edits.

## Share preview customisation

`Sharing/SharePreviewHost.tsx` hosts one shared modal from `share-preview`
context-menu actions. `sharePreviewBlocks.ts` is its individually editable
Settings document; `TransientBlockHost` supplies only temporary selection and
copy/share controls. `sharePreviewLink.ts` preserves the exact same-origin
navigation destination, including fragments, while the anonymous metadata
lookup omits unrelated values. The server PNG is the displayed preview.
`sharePreviewLink.test.ts` covers link preservation/refusal;
`scripts/share-preview-acceptance.mjs` covers disposable real API and browser
acceptance. See `docs/seo-social-metadata.md` for template/capability contracts.

Builder rich text inside responsive viewport documents loads the same Editor.js
library and standard tools in the holder's document via the fixed bundled
`Editor/editorJsRuntime.entry.ts` module. `editorJsRuntime.ts` shares a load per
document and permits recovery after load failure; it does not start another app
or API runtime. Selection, tool panels, keyboard guards and cleanup use the
owning document. `Builder/authoredControlOwnership.ts` follows actual same-origin
iframe ancestry for React portal controls while refusing unrelated documents.
The real API regression is `npm --prefix remix run test:authored-controls:browser`
(requires a built node-server handler, mongod and isolated Playwright/Chromium).

Authored `tt-menu` lifetime follows its owned popup/target DOM elements, not
React children reference identity. Same-record source refreshes reconcile
conditional triggers and item roles without hiding the popup or moving focus.
A payload-free local activation acknowledgement in
`Builder/componentControlActivation.ts` from the existing Action handler dismisses the owning menu only after native validity and awaited rich
snapshots succeed. Native submit dismisses on its valid submit event. Invalid
fields retain their menu and validation focus; click propagation is irrelevant.
Actual slot replacement, disable and unmount end the binding. `scripts/routes-map.browser.mjs` covers same-popup refresh, conditional controls, replacement/disable,
keyboard focus and iframe ownership; the real API authored-control fixture
retains ordinary/rich form submission coverage.

## Inert previews during reviewed creation

`Builder/ContentExecutionHold.tsx` composes the server-derived `executionHeld`
flag through Components, Webpages and nested renderers. Held content stays
readable; source Actions, local/pseudo controls, native/upload mounts, pending
confirmation and delayed native callbacks remain disabled until release.
`liveComponent`, `PageActionSurface`, the shared action-click hook, detail
surfaces and the HTML/Chakra renderers share the same inherited gate; a child
cannot release an ancestor hold. The server independently checks immutable
completion before both server and browser Action admission.
Run `test:content-execution:browser` for synthetic API desktop/mobile, scroll,
nested controls, live release and retained draft checks; the separate
`test:backups:ordinary-restore` proves real-replica projection/receipt behavior.
A projected folder `creationProgress` is not a finished restore dashboard,
folder badge or installed-app acceptance.


## Detail-page Schema revalidation

`routes/thing.tsx` binds a live Schema template to origin, viewer/data plane,
Thing, Schema, link and root-identity generation. A separate refresh generation
invalidates execution before an async read starts, retains only the same-scope
template on transient failure, and aborts/ignores stale reads. Refusal clears the
template. The unscoped list-template cache cannot establish this provenance.
`ContentExecutionScope` blocks activation/native callbacks quietly;
`ContentExecutionBoundary` preserves actual restoring ancestry and stable fields.
The parent page runtime remains stable during verification to retain drafts.
Run `test:content-execution:browser` and the real compiled
`test:content-execution:route` fixture; see the Schema checklist in `TESTING.md`.

Device contact badges use `Devices/deviceStatusPresentation.ts` across cards,
lists, details, connector status and desktop node controls. Offline/stale contact
and the queue-compatible `degraded` enum render as one neutral “Last seen …”
label. Only `lastSeenAt` supplies contact time; missing/invalid times remain
unknown. Pairing, approval, permission, compatibility and concrete errors keep
their independent safety meanings. Run `deviceStatusPresentation.test.ts` with
the device component tests; machine status contracts and action admission stay
unchanged.

### Shared HTML and CSS inspector

`app/components/ElementInspector/` supplies the Builder and image editor with
editable property and attribute rows, typed value choices and CSS source. Its
lazy catalog is a projection of the existing standards pipeline. See
[the inspector contract](../web-standards-builder.md#html-and-css-inspector)
and the Builder element inspector checklist in `TESTING.md`.
