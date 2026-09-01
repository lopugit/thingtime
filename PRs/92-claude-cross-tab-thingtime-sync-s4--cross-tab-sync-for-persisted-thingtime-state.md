# PR #92 — Cross-tab sync for persisted Thingtime state

## Current-develop reconciliation

PR #92's original feature commit (`9336700e8`) predated the current persistence
architecture. The remote branch later accumulated repeated automated merge and
rebase commits, leaving a conflicting 28-file diff with large generated-graph
churn. This reconciliation rebuilds the PR from the current `develop` tip and
retains only the feature's owned source, tests, and documentation.

The important architecture change is PR #99's consolidation of persisted state
into `remix/app/Providers/thingtimeSerialization.ts`. Cross-tab payloads now
import that active safe codec directly:

- tagged Dates and circular/shared aliases survive;
- ordinary ISO-looking user text remains text;
- functions are omitted and legacy function tags are never compiled;
- an explicit envelope distinguishes a legitimate `undefined` write from a
  top-level function removed by the serializer.

There is no second persistence codec or storage mechanism.

## Provider integration

- One `BroadcastChannel('thingtime')` is opened per mounted provider, with a
  stable per-tab id and cleanup that survives React Strict Mode replay.
- A local mutation is published only after the existing queue applies it
  successfully. Failed updates are never announced to peers.
- Received writes re-enter the same queue with
  `{ ignoreUndoRedo: true, fromRemote: true }`, so pre-hydration writes remain
  ordered, undo history stays local, and broadcasts cannot echo.
- The provider's internal root `timemachine` path is deliberately channel-local.
  Because `applyThingtimeUpdate` re-establishes `tt`/`thingtime` as self-
  references on every write, the classifier collapses the whole *leading run* of
  root aliases before deciding, so `tt.timemachine`, `tt.tt.timemachine`, and
  `thingtime.tt.timemachine` are all recognised as the same tab-local node — and
  a path that is nothing but aliases (`tt`, `tt.tt`, `thingtime.tt`) is treated
  as a whole-tree replacement rather than being broadcast. Undo and redo still
  broadcast the ordinary data path they restore, while one tab can never replace
  another tab's timeline metadata or detach its root self-alias. Only a leading
  run counts, so nested user data such as `Content.timemachine` and
  `Content.tt.timemachine` remains syncable.
- Remote-applied state schedules the existing `latestRevisionAutosave`
  coordinator. `ThingtimeProvider` remains the sole LocalForage writer.
- Missing `BroadcastChannel` support returns to the prior single-tab behavior
  without adding a fallback store.

## Validation

- `npm run test:autosave`: 41/41 passed, including the active safe codec,
  malformed/self messages, lifecycle fallback, the tab-local timeline guard, and
  the call-site guards for every viewport-scoped key.
- `npm run test:unit`: passed (the repository's complete unit/contract suite).
- `npm run build`: passed, including client, Nitro/Vercel output patching, and
  `verify:vercel-output`.
- Targeted ESLint: passed for the provider, channel, and channel tests.
- Targeted Prettier: passed after formatting.
- Live two-tab browser verification: passed on fresh same-origin desktop tabs.
  Writes propagated in both directions without reload; the formerly stale tab's
  unrelated write retained the first tab's value; a 20-write burst converged in
  the peer and restored after the 2-second max-wait autosave plus reload. After
  a clean server restart, bidirectional sync and a local undo were rechecked
  with the timeline guard active: the undo result reached the peer while its
  independent value remained. Both consoles had zero errors and no channel,
  serializer, echo, or lifecycle diagnostics.
- Full PR checks and preview: pending the published head.

## Review follow-up — view chrome is not broadcast (Lopu, 2026-08-30)

The first cut broadcast every applied non-remote write, holding back only root
`timemachine` and whole-tree replacements. A few `settings.*` keys are neither
user data nor saved preferences — they describe what is open and focused in the
current viewport, under an id that is identical in every tab
(`settings.drawer.open`; `settings.commander.<id>.commanderActive`, where
`commanderId` is the literal `nav`/`global`). One tab therefore actuated
another's UI, and the closing direction lost typed input: Tab A closing the
palette ran Tab B's toggle effect, which clears its input under the default
`clearCommanderOnToggle`.

Those five call sites now pass `{ tabLocal: true }` to `setThingtime`, which
suppresses only the broadcast — the values are still persisted, so a reload
restores them exactly as before this PR. The rule lives at the write site, not
as a path denylist in `thingtimeSyncChannel.ts`, so the transport stays generic.
Two source-contract tests in `thingtimeSyncChannel.test.ts` hold the line,
which matters because `setThingtime` is typed `any` at every consumer and a
misspelled flag would otherwise fail silently.

Drawer width, `opens.direction`, ordering, and the Commander's own preferences
are untouched and still sync — that sharing is the point of this channel.

### Second pass — `settings.drawer.selectedItem` (Lopu, 2026-08-30)

That sweep classified by "is this open/focused here", which missed a key that is
viewport state for a different reason: **which** section the drawer shows.
`DrawerContent` writes `settings.drawer.selectedItem` from this tab's `pathname`,
so two tabs on two routes hold two legitimately different — and both correct —
selections. Broadcasting it moved a peer's drawer to a section that peer was not
on, changing the submenu under it.

Nothing in the receiving tab put it back. The pathname-sync effect re-runs only
on `pathname`/`open`/`variant`/`loading`, none of which a remote write touches,
and it returns early entirely while that peer's drawer is closed — so the wrong
section persisted until that tab next navigated. `selectedItem` now passes
`{ tabLocal: true }` as well, and the drawer source-contract test asserts `open`
and `selectedItem` together so the next key of this shape is caught by name.

### Second pass — `settings.editor.openConfig`, both directions (Lopu, 2026-08-30)

The previous pass recorded this key as "odd but harmless — doesn't actuate a
peer". That was wrong, and the correction is the reason it moved. `EditorSplit`
does not merely read the name on mount: `openedConfigRef` is a per-mount latch
that starts `false`, and the effect re-runs on `pendingConfigName`. A tab sitting
on `/editor` that has not consumed an intent since mounting will therefore pick
up a *remote* name and call `applyLayout` over the windows someone has open
there. `EditorDrawerSection` states the intended scope in its own comment —
"remember which config to load, then head to the editor" — a handoff to the
writing tab's next navigation. When the editor is already mounted it does not use
this key at all; it emits on the tab-local events bus.

Both directions now pass `{ tabLocal: true }`, because suppressing only the write
leaves the pair lopsided: the consuming clear would still cross and erase an
intent another tab set but has not navigated to yet. A third source-contract test
pins both call sites.

### Third pass — the DevKit prefills, and the default that keeps producing these (Lopu, 2026-08-30)

`devKit.registerPrefill` and `devKit.loginPrefill` were still on the wire. A
prefill fills the form in front of *that* DevKit, and `root.tsx` renders DevKit
for every session — it is not dev-only. `Login`/`Register` consume it from an
effect keyed on `_ts`, a fresh `Date.now()` per click, so the effect always
re-fires: one click in Tab A replaced the username/email/password a peer had
typed into its own form and called `setPasswordVisible(true)` there. Both writes
now pass `{ tabLocal: true }`; a fourth source-contract test pins them, and also
pins the two consumers, since they are what makes the broadcast actuating.

That is the seventh such key. The pattern is worth naming rather than fixing
once more: **broadcast is the default and `tabLocal` is opt-out**, so every miss
fails toward "a peer's state is overwritten" instead of "this key quietly does
not sync". The module comment previously claimed the write-site rule prevented
accidental cross-tab keys; it does not — it distributes the denylist rather than
removing it, and the comment now says so. The fail-safe inversion (`shared: true`
opt-in, or an allowlist of syncable subtrees) is recorded there as the known
trade-off. It is a real design change that re-annotates every genuine data write,
so it is the author's call, not a reviewer's; the guard tests hold the line
meanwhile.

Two robustness items from the same pass:

- **A broadcast failure could discard a local write.** `flushSetThingtimeQueue`
  published inside the callback whose return value *is* the new state, and
  `drainThingtimeMutationQueue` drops any update whose apply throws — so a throw
  on the publish path would silently roll back a write that had already applied.
  Not live (the channel catches internally), but the publish is now contained in
  its own `try` so it stays that way independently of the transport.
- **The array-path validation asymmetry is closed, and must not be "fixed".**
  An earlier pass flagged that string paths are split before validation while
  array parts are matched exactly, so `['a.__proto__']` slips past. Verified
  against `smarts.setsmart`: it never re-splits an array element, assigning
  `obj[ee(part)]` directly, so a dotted part is one literal own key reaching
  neither the prototype nor the timeline. A test now pins that (with a
  sensitivity check that the segmented form *does* reach the timeline). The
  proposed inverse — normalising array parts through the string splitter —
  would have been a regression: legitimate keys contain dots (`useTtTheme`'s
  `custom` map is keyed `'windows.close'`).

## Optional future hardening

A discarded or long-suspended tab can still miss broadcasts entirely. A future
focus-time revision comparison may reconcile that cold-tab case, but it should
extend the current autosave/codec path rather than introduce another state
store. The open-tab last-writer clobber fixed by this PR does not depend on that
optional layer.
