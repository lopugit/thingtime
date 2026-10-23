# 07 — Cross-tab sync for persisted thingtime state

> **Status (reconciled with current `develop` on 2026-08-18): 🟢 Built.**
> `remix/app/Providers/thingtimeSyncChannel.ts` broadcasts successfully applied
> local writes on `BroadcastChannel('thingtime')`. Values use the active safe
> codec in `thingtimeSerialization.ts`; remote writes use the normal mutation
> queue with `{ ignoreUndoRedo: true, fromRemote: true }`. Unit coverage runs in
> `test:autosave`; live two-tab results are recorded below. Remaining optional
> hardening: cold-tab revision reconciliation (implementation item 5) and
> same-path concurrent-write resolution (implementation item 6).

## What it's for

Two open tabs on the same origin should share one live thingtime state instead
of silently overwriting each other's saved state. A settings change (drawer
width, direction, ordering, commander prefs, Content edits…) made in one tab
should appear in the other tabs without a reload — and must never be clobbered
by a stale tab writing its old in-memory tree.

## Current persistence architecture

- `ThingtimeProvider.tsx` loads the LocalForage snapshot once, repairs it with
  `parseThingtimeWithDiagnostics`, merges code-defined defaults, and keeps the
  single `localforage.setItem('thingtime', …)` write path.
- `latestRevisionAutosave.ts` debounces full-tree snapshots, bounds continuous
  editing with max-wait, serializes only the newest revision, and drains a newer
  revision after an in-flight write.
- `thingtimeSerialization.ts` is the active persistence boundary. It preserves
  explicitly tagged Dates, cycles, and ordinary ISO-looking strings while
  omitting functions and inertly removing legacy function tags.
- `setThingtime(path, value, { ignoreUndoRedo, namespace })` batches path-level
  writes through one microtask queue. Pre-hydration writes wait and then apply
  on top of the restored root.

## Original failure

- **Last-writer-wins clobbering.** Each tab holds its own full in-memory tree
  and writes the whole thing on any change. Tab B's next write silently
  reverts everything Tab A changed since B last loaded.
- **No live propagation.** Other tabs only see changes after a full reload.
- **Observed live (2026-07-05):** while building the drawer nav, a second dev
  tab (HMR re-render → persist) reverted `thingtime.settings.drawer.*` values
  (width/direction/searchClosesDrawer) that the first tab had just written.

## Implementation

1. **Publish applied changes.** `ThingtimeProvider` opens one
   `BroadcastChannel('thingtime')` per mount. A local write is published only
   after the mutation queue applies it successfully, as
   `{ path, payload, sourceTabId, timestamp }`.
2. **Apply in other tabs.** On message, apply via the existing `setThingtime`
   queue with `{ ignoreUndoRedo: true, fromRemote: true }`. Each provider owns a
   stable tab id and ignores messages carrying that id.
   Root `timemachine` metadata (including `tt`/`thingtime` aliases) is rejected
   in both directions so timelines remain tab-local; ordinary data writes made
   by undo/redo still broadcast normally. A bare `tt`/`thingtime` path is
   rejected too: `applyThingtimeUpdate` reads it as a whole-tree replacement,
   which would overwrite each receiving tab's root — `timemachine` included —
   rather than apply a path-level write.
2b. **Keep view chrome out of the channel.** A few `settings.*` keys are not
   user data or saved preferences — they describe what is currently open and
   focused in *this* viewport, under an id that is byte-identical in every tab
   (`settings.drawer.open`; `settings.commander.<id>.commanderActive`, where
   `commanderId` is the literal `nav`/`global`). Broadcasting them made one tab
   actuate another's UI: closing the palette in Tab A ran Tab B's toggle
   effect, which clears its input under the default `clearCommanderOnToggle`
   and so destroyed a query being typed there; opening it focused Tab B's
   input. Such writes pass `{ tabLocal: true }` to `setThingtime`, which
   suppresses only the broadcast. They are still persisted, so a reload
   restores them exactly as before. The intent is declared at the write site
   rather than pattern-matched in the transport, so `thingtimeSyncChannel.ts`
   keeps no list of feature paths. Be clear that this distributes the denylist
   rather than removing it: broadcast is still the default, so a new chrome key
   *does* cross tabs until somebody annotates it — review found seven such keys,
   each after the previous was called the last. The fail-safe inversion (publish
   nothing unless a write opts in, or allowlist syncable subtrees) is recorded as
   a known trade-off in `thingtimeSyncChannel.ts`; the call-site guard tests are
   the compensating control until it is decided. Genuine
   preferences under the same keys — drawer width, `opens.direction`,
   ordering, the Commander's `clearCommanderOnToggle`/`hideSuggestionsOnToggle`
   — are unaffected and still sync; sharing them is the point of this channel.
3. **Persist ownership.** Keep the single persist path in `ThingtimeProvider`
   (per `FUNDAMENTALS.md` single-source-of-truth thinking). The channel imports
   `stringifyThingtime` / `parseThingtime` directly rather than maintaining a
   second codec. Remote writes join the latest-revision autosave normally.
4. **Fallback consideration.** If `BroadcastChannel` is unavailable (very old
   WebKit), degrade gracefully to current behaviour — do not add a second
   storage mechanism.
5. **Cold-tab staleness.** Optional hardening: on tab focus/visibilitychange,
   diff a lightweight revision counter (e.g. `thingtime.__rev` bumped on each
   persist) against storage and re-merge if the stored revision is newer.
6. **Same-path concurrency.** Optional hardening, and a known limit of what
   shipped: messages carry a `timestamp` but nothing compares it, so per path
   the channel is last-writer-wins *by arrival order*. Two tabs writing the same
   path inside one message round-trip do not converge — each applies its own
   value, then applies the other's, and the two end up holding each other's
   value until something else writes that path. Narrow in practice (it needs
   sub-round-trip concurrency on one key, and the whole-tree clobber this
   channel exists to fix is unaffected), and pinned by a regression test in
   `thingtimeSyncChannel.test.ts`. Resolving it belongs in `ThingtimeProvider`,
   not the channel: reject a remote write older than the last write applied
   locally at that path, which needs per-path applied timestamps beside the
   mutation queue plus eviction so that map cannot grow with the tree. Tabs on
   one machine share a clock, so the comparison would be sound.

## Done when

- Change a drawer setting (e.g. width or `opens.direction`) in Tab A → Tab B
  reflects it within ~a second without reload, and vice versa.
- A stale tab that hasn't been touched no longer reverts newer settings when
  it re-persists (verify by editing in A, then triggering a state change in B:
  A's edit survives).
- Undo/redo timelines stay per-tab (remote writes use `ignoreUndoRedo`).
- No echo storms: rapid edits in one tab produce one applied write per change
  in other tabs, and CPU/persist volume stays sane with 3+ tabs open.
- Verified live in two real browser tabs on the current worktree dev URL
  (desktop) per the repo's browser-verification rule.

## Validation

- `npm run test:autosave`: 43/43 pass, including safe-codec Date/string/cycle
  round-tripping, function stripping, malformed messages, self-echo, close,
  explicit `undefined`, tab-local timeline metadata, the call-site guards for
  every viewport-scoped key, the pinned same-path arrival-order semantics
  (implementation item 6), and the no-`BroadcastChannel` fallback.
- Targeted provider/channel ESLint passes.
- Full unit suite and production/Vercel build pass.
- Live two-tab verification passed bidirectionally, including a 20-write burst,
  stale-tab preservation, autosave/reload restoration, and local undo isolation;
  see PR #92's implementation note in `PRs/`.

## Notes

- Origin: spotted during the drawer nav revamp
  (`PRs/28-codex-service-account-api--drawer-based-nav-revamp.md`);
  pre-existing behaviour, not introduced by that PR.
- Repo rule: run `graphify query "<question>"` from the repo root before
  exploring raw source; `graphify explain "ThingtimeProvider"` is a good
  starting point.
