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
- The provider's internal root `timemachine` path (including `tt`/`thingtime`
  aliases) is deliberately channel-local. Undo and redo still broadcast the
  ordinary data path they restore, while one tab can never replace another
  tab's timeline metadata. Nested user data such as `Content.timemachine`
  remains syncable.
- Remote-applied state schedules the existing `latestRevisionAutosave`
  coordinator. `ThingtimeProvider` remains the sole LocalForage writer.
- Missing `BroadcastChannel` support returns to the prior single-tab behavior
  without adding a fallback store.

## Validation

- `npm run test:autosave`: 32/32 passed, including the active safe codec,
  malformed/self messages, lifecycle fallback, and tab-local timeline guard.
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

## Optional future hardening

A discarded or long-suspended tab can still miss broadcasts entirely. A future
focus-time revision comparison may reconcile that cold-tab case, but it should
extend the current autosave/codec path rather than introduce another state
store. The open-tab last-writer clobber fixed by this PR does not depend on that
optional layer.
