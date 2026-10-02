# Experience checkpoints and the unified Timeline

**Status:** Evidence note · **Grounded:** 2026-10-02 (Australia/Melbourne)

## Question

Does the unified Timeline make [TODO 20 — versioned experience history](../TODO/claude-todo/20-versioned-experience-history.md) redundant, or should feed/search checkpoints become a separate history system?

## Evidence from the integration branch

The current [`docs/unified-timeline.md` contract on `develop`](https://github.com/lopugit/thingtime/blob/develop/docs/unified-timeline.md) describes a private, account-scoped event history for changes to Things. Its canonical `TimelineEventRecord` and `TimelineLink` records cover local drafts, server-accepted changes, relationships, provenance, recovery, and supported Action outcomes. The same document says experience checkpoints are related but separately scoped: they retain feed/search membership and viewport state, and should adopt the shared contract rather than create another synchronization system.

The contract's delivery ledger is still in progress. This note therefore treats its detailed implementation statements as repository documentation on `develop`, not as proof that every listed behavior is released or production-verified.

## Boundary to keep clear

| Concern | Unified Timeline | Experience checkpoints (TODO 20) |
| --- | --- | --- |
| Primary question | What changed on this Thing, by whom or what, and what recovery/merge path exists? | What view did I experience, and can I revisit its captured results and position? |
| Durable identity | Immutable event and relationship records linked to affected Things and branches. | A versioned, bounded view-state adapter with ordered result references, pages, and a stable viewport anchor. |
| Shared work | Account/origin/data-plane isolation, event validation, local persistence, sync receipts, paging, and safe history integration. | Must not create a competing event log, outbox, or synchronization protocol; retain its own view-state and redaction semantics. |
| Not implied | A complete replay of search inputs, feed ordering, loaded-page depth, or viewport state. | Permission to restore deleted/private content, execute code, replay external effects, or rerun an old algorithm as if it were historical truth. |

The distinction is useful even if both experiences appear in a shared History surface: a Thing mutation is not a snapshot of the surrounding feed or search results. A checkpoint must continue to distinguish historical captured membership from a fresh query against current data.

## Next design step

Before implementation, map the checkpoint envelope to the Timeline's existing adapter/version and account-scope boundaries. Decide which checkpoint metadata is an event, which bounded result-page data is a related record, how deletion/access changes suppress cached projections, and how local-only guest state is adopted without implicit upload. Then test one synthetic feed/search checkpoint without claiming full experience replay is already delivered.

## Sources

- [`docs/unified-timeline.md` on `develop`](https://github.com/lopugit/thingtime/blob/develop/docs/unified-timeline.md), especially “One record format,” “Writes and concurrency,” “Delivery and acceptance ledger,” and “Related but separately scoped.”
- [`TODO 20 — Versioned experience history`](../TODO/claude-todo/20-versioned-experience-history.md), which defines the still-needed feed/search membership and viewport contract.
- Integration-branch evidence reviewed at `origin/develop` commit `713e4797a3`; this is branch documentation and code evidence, not an independent production verification.
