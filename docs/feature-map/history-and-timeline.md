# History and Timeline

The Unified Timeline is one ledger per account: every saved change is a
protected `timeline-event` Thing recorded inside the content transaction;
client drafts, named branches, notes, version names, the History browser and
the Settings → History category all read and write that one ledger. Contract
and invariants: [`docs/unified-timeline.md`](../unified-timeline.md) (read the
dated sections newest-first); design integration:
[`docs/timeline-design-integration.md`](../timeline-design-integration.md).

## Where the code lives

| Concern | Path |
| --- | --- |
| Shared event/link/branch/note/name contracts, Timeline id rule, page size, byte budgets | `app/timeline/contract.ts`, `records.ts`, `branches.ts`, `notes.ts`, `versionNames.ts` |
| History preferences contract (`HistoryPrefs`, `parseHistoryPrefs`, `parseHistoryPrefsPatch`, `applyHistoryPrefsPatch`, `HISTORY_PAUSED_THINGS_MAX`, `HISTORY_THING_ID_PATTERN`) | `app/timeline/historyPrefs.ts` (server-safe: no React, IndexedDB or `window`) |
| Home-pinned prefs store (`createHistoryPrefsStore`, `historyPrefsStore`, `getUserHistoryPrefs` / `setUserHistoryPrefs`, `mutateUserThingSecureIn`, `SecureWriteContendedError`) | `app/api/utils/auth/users.ts` — `secure.meta.historyPrefs` on the user Thing with the legacy `users.meta.historyPrefs` fallback; never a collection, index or crystal field |
| Timeline route (discovery, history pages, drafts, versions, branches, notes, names, export) | `app/routes/api/v1/timeline/_timeline.tsx` (`createTimelineHandlers(overrides)`) |
| History settings route (`api.timeline-settings`) | `app/routes/api/v1/timeline/settings/_settings.tsx` (`createTimelineSettingsHandlers(overrides)`; 64 KiB body cap; 401 / 400 / 404 / 413 / 429 / 503 + `Retry-After: 1`) |
| Transactional recording, paging, versions, branches, notes, names, export, Action outcomes | `app/api/utils/timeline/*` |
| IndexedDB queue/index/cache (`pendingCount()`), draft recorder, account sync (`push`, `scan`), connection pool, provider sessions | `app/timeline/localStore.ts`, `draftRecorder.ts`, `sync.ts`, `connectionPool.ts`, `TimelineProvider.tsx` |
| Client prefs store (per-owner `tt-history-prefs:<ownerId>` cache, `useHistoryPrefs`, `isHeld` / `isPaused`, `ready`) | `app/timeline/historyPrefsClient.ts`; `useApi().v1.timeline.settings.get/set` |
| Draft capture hook (paused Things: `record()` → `null`, `release`/`dismissRecovery` refuse, `flush` still drains) | `app/timeline/useTimelineDraft.ts`; callers `app/components/Builder/useWebpage.ts` (`webpage-draft`) and `app/components/Builder/DefinitionEditor/ThingDefinitionEditor.tsx` (`definition-source`) |
| History browser model (filters incl. the per-viewer `messages` default, search, system lines) | `app/timeline/browserModel.ts` |
| History modal/page host, panel, version actions, compare, branches, messages, merge, export download | `app/components/Timeline/*` (`TimelineHost.tsx` exports `openThingHistory`, `HistoryPage`, `ThingHistorySection`) |
| Settings → History category and the bounded client export | `app/components/Settings/HistorySettings.tsx`, `settingsTabs.ts` (`history`), `SettingsContent.tsx`; `app/components/Timeline/historyExport.ts` |
| Menu verbs `history`, `pause-history`, `resume-history` | `app/schemas/thingActions.ts`, `app/components/Thingtime/ContextMenu/thingEntityMenu.ts`, `PersistedThingMenu.tsx`; icons `app/theme/icons.tsx` |
| Editor entry point | `app/components/Editor/EditorHistoryControls.tsx` (`thingId` → ghost History button) threaded from `LongTextEditor.tsx`; `app/components/Feed/PostComposer.tsx` passes the edited post id |
| Thing page entry point | `app/routes/thing.tsx` mounts `ThingHistorySection` for the owner (collapsed; the panel mounts only while open) |

## Authorization helper

- Every Timeline read/write: `getCurrentUser(request)` plus the route's
  `ownerId` / `dataPlane` fences and `storage=home` scoping; scoped credentials
  (PATs, app tokens) resolve to `null`. Lopu explanations need a full account.
- History settings: `getCurrentUser(request)`; `temporary` or
  `accountKind !== 'user'` → 401. No `ownerId` / `dataPlane` fence (the
  preference is account-level); the catch-all's `enforceExpectedActor` applies
  when the client sends `X-Thingtime-Expected-Actor`. The store is home-pinned
  by construction, so a selected custom data source changes nothing.
- Rate keys (all `failClosed: true`): `timeline.read`, `timeline.write`,
  `timeline.explain`, `timeline.export`, `timeline.settings` (30/min).
- Prefs never reach `toPublicUser` / `toPublicProfile`. Per-viewer conveniences
  stay in localStorage keyed by owner and are swept on sign-out
  (`clearLocalCachePrefix('tt-history-prefs:')` in `useApi.tsx`).

## Honest semantics (say exactly this in UI and docs)

- `syncHold` pauses uploading every device's pending queue for the account;
  pending rows stay on each device (already eviction-proof); nothing is deleted;
  unknown prefs never hold (fail-safe = keep syncing); resuming drains the queues.
- `retention` is stored only — no retention policy runs, nothing is deleted.
- `pausedThingIds` stops **client draft capture** for those Things in the
  Builder page and definition editors; canonical server revisions keep
  recording; named-branch editing keeps capturing. Ids only, capped at 200,
  patched as `pause` / `resume` deltas.
- No per-kind history storage figure exists; never derive one from IndexedDB
  bytes or account totals. Never fabricate version counts, titles or an
  "Edited" indicator.

## Registration (in order)

1. Shared contract in `app/timeline/*` (server-safe) and the server service in
   `app/api/utils/timeline/*` or the store in `app/api/utils/auth/users.ts`.
2. Route or command with injectable deps: `_timeline.tsx` for anything on
   `/api/v1/timeline`, `settings/_settings.tsx` for preferences.
3. Import map `remix/server/routes/api/[...].ts`, docs entry in
   `app/docs/apiDocs.ts` (set `contractVersion` **and** `featureVersion`; bump
   `api.timeline` only for changes on `/api/v1/timeline` itself), rate key in
   `RATE_LIMIT_DEFAULTS` (an unregistered key is a silent allow).
4. Client gate in `app/hooks/useApi.tsx`
   (`requireThingtimeCapability('api.timeline…', '<minimum>')`), with
   `expectedActor` on writes.
5. Menu verbs: `THING_ACTIONS` + `buildThingEntityMenu` +
   `PersistedThingMenu` capabilities + `LUCIDE_ICONS`; the Drive menu
   (`thingsMenuModel.ts`) is separate.
6. Settings rows: `settingsTabs.ts`, the signed-out list in
   `SettingsContent.tsx`, the category component.

## Tests

- `npm --prefix remix run test:timeline` (globs `app/timeline`,
  `app/api/utils/timeline`, `app/routes/api/v1/timeline` and
  `app/components/Timeline`, one level each — new tests must sit at those
  depths), `test:api-capabilities` (both manifests + `routeModules`),
  `test:rate-limit`, `test:settings`, `test:things` (menu verbs).
- Opt-in replica scripts on the guarded `timeline-rs` replica:
  `test:timeline:versions`, `test:timeline:notes`, `test:timeline:related`,
  `test:timeline:action-outcomes`.
- The `users.ts` history-prefs round-trip against a real replica set is
  integration-tier beyond the injected-collection unit test
  (`app/api/utils/timeline/historyPrefsStore.test.ts`).
- Manual: `TESTING.md` → `## Unified Timeline`.
