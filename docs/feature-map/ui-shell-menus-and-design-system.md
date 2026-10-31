# UI shell, menus and design system

The web app is Vite + React Router (non-framework mode) + Nitro; `entry.client.tsx`
mounts with `createRoot`. Chakra UI primitives are wrapped by Thingtime's own
components; reuse them instead of adding parallel versions.

Device sync management is available to the signed-in device owner in browsers
through `DeviceSyncPanel` and `RemoteDeviceSync`, independently of local pairing.
The installed app retains direct controls for its own device. Remote controls use
editable settings blocks and the existing configuration form; see
[browser device sync](../browser-device-sync.md) and its browser/installed checks.

## Where the code lives

| Concern | Path |
| --- | --- |
| Native desktop View menu and Command/Control zoom input | `electron/main.cjs`, `electron/lib/window-zoom.cjs`; regression: `electron/test/window-zoom.test.cjs`, `pnpm --dir electron verify:window-zoom` (real Electron fixture) |
| Thing context menu model (sections, actions, submenus, drill paths) | `app/components/Thingtime/ContextMenu/contextMenuModel.ts` |
| Menu renderer, trigger, hover/right-click/pinned behaviour | `app/components/Thingtime/ContextMenu/ThingContextMenu.tsx`, `ThingContextMenuTrigger.tsx`, `useThingContextMenu.tsx` |
| Base verbs every persisted Thing inherits (`open`, `inspect`, `history`, `pause-history`, `resume-history`, `copy-link`, `edit`, `share`, `delete`, `send-to-lopu`; the two pause verbs are owner-only and backed by the history prefs store, see [history-and-timeline.md](history-and-timeline.md)) | `app/schemas/thingActions.ts` (`THING_ACTIONS`), `ContextMenu/thingEntityMenu.ts` (`buildThingEntityMenu(capabilities, extensions)`) |
| Persisted-Thing menu button used by cards and pages | `ContextMenu/PersistedThingMenu.tsx` (fetches the Thing on open, handles copy-link/open/inspect/send-to-lopu; adapters pass `extensions` + `capabilities` + `onAction`) |
| Canonical link copying | `ContextMenu/thingEntityLink.ts` |
| Icons: emoji ↔ lucide registry (`LUCIDE_ICONS`, `LUCIDE_FOR_EMOJI`) | `app/theme/icons.tsx`; renderer `app/components/Icon/Icon.tsx` |
| Toasts / notifications | `app/components/Lopu/useLopu.tsx` (`useLopu()`, `useLopuStream()`) — never raw Chakra `useToast` or `alert()` |
| Device notification history | `app/local-workspace/notifications.ts`, `notifications.client.ts`; `NotificationsPage.tsx` reuses the normal rows/filters. Anonymous messages never sync; account messages use the existing home-pinned recorder after verified login. |
| Retained account history | `app/local-workspace/notificationPages.ts`, `notificationHistoryAccess.ts`; exact query/cursor snapshots and scoped refusal guards. `app/hooks/useDebouncedSearchDraft.ts` preserves newer typing across delayed URL updates. Native tests cover offline/retry, pagination invalidation and refused cached projections. History filters use the existing launcher-clearance marker, shared by the mobile Lopu and DevKit shortcuts. |
| Layering (z-index) | `app/components/Things/transferLayers.ts` and the shared layer constants; never ad-hoc z-index escalation |
| Page shell, nav clearance, drawers | `app/components/Layout/Main.tsx`, `app/components/Nav/*` (`--tt-nav-clearance`, safe-area vars) |
| Password surfaces | `app/root.tsx` keeps `/passwords/provider` in the focused authorization shell; `/passwords` and `/settings/passwords` retain navigation while hiding floating assistant/developer launchers that can cover narrow credential controls. |
| Custom drawer links and Thing attachments | `app/components/Nav/Drawer/drawerCustomItems.ts`, `customDrawerBlocks.ts`, `CustomDrawerItems.tsx`, and `useDrawer.tsx`; account-scoped device entries use parent IDs for arbitrary-depth menus, shared Commander search, individually editable Builder blocks. Add finishes both the root list and active submenu and creates in that parent. Submenu controls bind to each row’s available direct children (including migrated authored templates); leaf links and Add + stay available. Submenus stay below the root list with Back and ancestor navigation. Settings exposes parent selection, sibling ordering and the actual menu template, saved as a private webpage Thing through `SettingsDocumentHost`, with scoped legacy device-layout recovery and editable template migrations. `scripts/custom-drawer-acceptance.mjs` checks matched row styling, real API/browser persistence and nested Builder edits; its `nested` scope covers deeper menu navigation |
| Device menu and full page | `app/components/Things/ThingsPage.tsx`, `ThingsViews.tsx`, `app/components/Devices/deviceNavigation.ts`, `DeviceDetailsDrawer.tsx` (one shared details tree for drawer and page) |
| Desktop footer build identity | `app/components/Nav/Footer.tsx` reads `thingtimeDesktop.getInfo().buildIdentity` from the packaged `electron/dist/web/metadata.json`; remote-origin status remains separate |
| Design tokens / CSS vars | `var(--tt-*)` tokens (surface, border, muted, ink, accent, radius); rainbow text in `app/theme/rainbow.ts` |
| Shared native selects | `app/Providers/Chakra/Components/Select.tsx`, registered in `theme.tsx`; Chakra `Select` consumers (including Character posting and CI providers) inherit runtime colors, borders, radii and keyboard focus; Theme Studio controls the focus border and two-color glow through `theme/tokens.ts` and `theme/customise.ts` |
| Design system docs page | `/docs/design-system` (`app/routes/docs/*`) |
| Local cache tiers (first-paint) | `app/hooks/localCache.ts` (`tt-<domain>` keys) |
| Nested Builder insertion and ancestry | `Builder/WebpageBlocksRenderer.tsx`, `blockChromePath.ts`, `useBuilderChrome.tsx`, `webpageBlocks.ts`; one ancestor toolbar, populated-parent append controls, and directional insertion that preserves neighboring layout |
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
5. Verify mouse, keyboard (arrow/Enter/Escape), touch, desktop and 375 px, and
   that menus stay clickable (no drag start) and reachable under the nav.

## Shared navigation and Builder controls

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
