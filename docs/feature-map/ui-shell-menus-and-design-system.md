# UI shell, menus and design system

The web app is Vite + React Router (non-framework mode) + Nitro; `entry.client.tsx`
mounts with `createRoot`. Chakra UI primitives are wrapped by Thingtime's own
components; reuse them instead of adding parallel versions.

## Where the code lives

| Concern | Path |
| --- | --- |
| Native desktop View menu and Command/Control zoom input | `electron/main.cjs`, `electron/lib/window-zoom.cjs`; regression: `electron/test/window-zoom.test.cjs`, `pnpm --dir electron verify:window-zoom` (real Electron fixture) |
| Thing context menu model (sections, actions, submenus, drill paths) | `app/components/Thingtime/ContextMenu/contextMenuModel.ts` |
| Menu renderer, trigger, hover/right-click/pinned behaviour | `app/components/Thingtime/ContextMenu/ThingContextMenu.tsx`, `ThingContextMenuTrigger.tsx`, `useThingContextMenu.tsx` |
| Base verbs every persisted Thing inherits (`open`, `inspect`, `copy-link`, `edit`, `share`, `delete`, `send-to-lopu`) | `app/schemas/thingActions.ts` (`THING_ACTIONS`), `ContextMenu/thingEntityMenu.ts` (`buildThingEntityMenu(capabilities, extensions)`) |
| Persisted-Thing menu button used by cards and pages | `ContextMenu/PersistedThingMenu.tsx` (fetches the Thing on open, handles copy-link/open/inspect/send-to-lopu; adapters pass `extensions` + `capabilities` + `onAction`) |
| Canonical link copying | `ContextMenu/thingEntityLink.ts` |
| Icons: emoji ↔ lucide registry (`LUCIDE_ICONS`, `LUCIDE_FOR_EMOJI`) | `app/theme/icons.tsx`; renderer `app/components/Icon/Icon.tsx` |
| Toasts / notifications | `app/components/Lopu/useLopu.tsx` (`useLopu()`, `useLopuStream()`) — never raw Chakra `useToast` or `alert()` |
| Layering (z-index) | `app/components/Things/transferLayers.ts` and the shared layer constants; never ad-hoc z-index escalation |
| Page shell, nav clearance, drawers | `app/components/Layout/Main.tsx`, `app/components/Nav/*` (`--tt-nav-clearance`, safe-area vars) |
| Password surfaces | `app/root.tsx` keeps `/passwords/provider` in the focused authorization shell; `/passwords` and `/settings/passwords` retain navigation while hiding floating assistant/developer launchers that can cover narrow credential controls. |
| Custom drawer links and Thing attachments | `app/components/Nav/Drawer/drawerCustomItems.ts`, `customDrawerBlocks.ts`, `CustomDrawerItems.tsx`, and `useDrawer.tsx`; account-scoped device entries use parent IDs for arbitrary-depth menus, shared Commander search, individually editable Builder blocks. Add finishes both the root list and active submenu and creates in that parent. Submenus stay below the root list with Back and ancestor navigation. Settings exposes parent selection, sibling ordering and the actual menu template, saved as a private webpage Thing through `SettingsDocumentHost`, with scoped legacy device-layout recovery and editable template migrations. `scripts/custom-drawer-acceptance.mjs` checks matched row styling, real API/browser persistence and nested Builder edits; its `nested` scope covers deeper menu navigation |
| Device menu and full page | `app/components/Things/ThingsPage.tsx`, `ThingsViews.tsx`, `app/components/Devices/deviceNavigation.ts`, `DeviceDetailsDrawer.tsx` (one shared details tree for drawer and page) |
| Desktop footer build identity | `app/components/Nav/Footer.tsx` reads `thingtimeDesktop.getInfo().buildIdentity` from the packaged `electron/dist/web/metadata.json`; remote-origin status remains separate |
| Design tokens / CSS vars | `var(--tt-*)` tokens (surface, border, muted, ink, accent, radius); rainbow text in `app/theme/rainbow.ts` |
| Shared native selects | `app/Providers/Chakra/Components/Select.tsx`, registered in `theme.tsx`; Chakra `Select` consumers (including Character posting and CI providers) inherit runtime colors, borders, radii and keyboard focus; Theme Studio controls the focus border and two-color glow through `theme/tokens.ts` and `theme/customise.ts` |
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

## Tests

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
