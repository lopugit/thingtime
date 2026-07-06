# 07 — Cross-tab sync for persisted thingtime state

## What it's for

Two open tabs on the same origin should share one live thingtime state instead
of silently overwriting each other's saved state. A settings change (drawer
width, direction, ordering, commander prefs, Content edits…) made in one tab
should appear in the other tabs without a reload — and must never be clobbered
by a stale tab writing its old in-memory tree.

## What already exists

- `remix/app/Providers/ThingtimeProvider.tsx` — the single persist path:
  - Loads thingtime from localforage **once on mount** (restore effect around
    L369–417, merging stored data over defaults via `smarts.merge`).
  - Persists the **entire** thingtime object (flatted `stringify` →
    `localforage.setItem('thingtime', …)`) on **every state change** (effect
    around L420–450).
- `setThingtime(path, value, { ignoreUndoRedo, namespace })` — queued writes,
  processed one per render; already supports skipping the undo timeline.
- No cross-tab channel of any kind: no `BroadcastChannel`, no `storage`
  events (localforage uses IndexedDB, which doesn't emit them anyway).

## What's missing / broken

- **Last-writer-wins clobbering.** Each tab holds its own full in-memory tree
  and writes the whole thing on any change. Tab B's next write silently
  reverts everything Tab A changed since B last loaded.
- **No live propagation.** Other tabs only see changes after a full reload.
- **Observed live (2026-07-05):** while building the drawer nav, a second dev
  tab (HMR re-render → persist) reverted `thingtime.settings.drawer.*` values
  (width/direction/searchClosesDrawer) that the first tab had just written.

## Plan

1. **Publish changes.** In `ThingtimeProvider`, open a
   `BroadcastChannel('thingtime')`. Whenever `setThingtime` applies a write,
   publish `{ path, value, sourceTabId, timestamp }` (per changed path — the
   queue already normalises writes to path+value granularity).
2. **Apply in other tabs.** On message, apply via the existing `setThingtime`
   queue with `{ ignoreUndoRedo: true }` and a guard flag so applied remote
   writes are not re-published (no echo loops). Tag each tab with a session id
   (e.g. `uuidv4()` at provider init) and ignore self-messages.
3. **Persist ownership.** Keep the single persist path in `ThingtimeProvider`
   (per `FUNDAMENTALS.md` single-source-of-truth thinking). Remote-applied
   writes will re-persist the merged tree, which is fine once all tabs
   converge on the same state; optionally debounce persists to reduce
   redundant full-tree serialisation.
4. **Fallback consideration.** If `BroadcastChannel` is unavailable (very old
   WebKit), degrade gracefully to current behaviour — do not add a second
   storage mechanism.
5. **Cold-tab staleness.** Optional hardening: on tab focus/visibilitychange,
   diff a lightweight revision counter (e.g. `thingtime.__rev` bumped on each
   persist) against storage and re-merge if the stored revision is newer.

## Done when

- Change a drawer setting (e.g. width or `opens.direction`) in Tab A → Tab B
  reflects it within ~a second without reload, and vice versa.
- A stale tab that hasn't been touched no longer reverts newer settings when
  it re-persists (verify by editing in A, then triggering a state change in B:
  A's edit survives).
- Undo/redo timelines stay per-tab (remote writes use `ignoreUndoRedo`).
- No echo storms: rapid edits in one tab produce one applied write per change
  in other tabs, and CPU/persist volume stays sane with 3+ tabs open.
- Verified live in two real browser tabs on `localhost:9999` (desktop) per the
  repo's browser-verification rule.

## Notes

- Origin: spotted during the drawer nav revamp
  (`PRs/28-codex-service-account-api--drawer-based-nav-revamp.md`);
  pre-existing behaviour, not introduced by that PR.
- Repo rule: run `graphify query "<question>"` from the repo root before
  exploring raw source; `graphify explain "ThingtimeProvider"` is a good
  starting point.
