# Unified Thing history roadmap

**Status:** Proposed (M0 design concept delivered)

**Prepared:** 2026-09-27, Australia/Melbourne

**Evidence:** [Unified Thing history and timeline browser baseline](../NOTES/unified-thing-history-timeline-baseline.md)

**Execution epic:** [TODO 50 — Unified Thing history and the timeline browser](../TODO/claude-todo/50-unified-thing-history-and-timeline-browser.md)

**Design concepts:** [`docs/design/thingtime-history-timeline/`](../docs/design/thingtime-history-timeline/index.html) · [`docs/design/thingtime-history-evolution/`](../docs/design/thingtime-history-evolution/index.html)

## Outcome

Every Thing, page, Component and property opens the same contextual History
panel, and one global timeline shows every recorded change with the Thing as
it was, what changed, and why. History is durable on the device the moment a
change settles, syncs to the account, survives refresh, restart, offline work
and device switches, and never loses a version: restore, undo and variations
append. Versions use friendly words — **Try a variation**, **Get latest
changes**, **Review and combine**, **Send changes** — over real ancestry.

## Boundaries with adjacent work

- [Versioned experience history (TODO 20)](../TODO/claude-todo/20-versioned-experience-history.md)
  owns replayable search/feed/navigation snapshots. This roadmap owns the
  change history of Things themselves; the two may share the timeline UI but
  not a storage shape.
- [Content provenance and correction](./content-provenance-and-correction-roadmap.md)
  owns what a revision *means* (authorship, sources, corrections). This
  roadmap supplies the revision evidence it needs and borrows none of its
  authority.
- [Local-first agency and accountable synchronization](./local-first-agency-and-accountable-synchronization-roadmap.md)
  owns the general local-state charter. The history event log is its first
  append-only, idempotent instance and must follow its classification,
  fresh-authority and cleanup rules.
- [Collaboration agency and shared stewardship](./collaboration-agency-and-shared-stewardship-roadmap.md)
  owns roles, invitations and exact-version contributions. Merge review here
  is a private owner decision; shared authority stays with that roadmap.
- [Data portability and graceful exit](./data-portability-and-exit-roadmap.md)
  owns export, deletion and account closure. History joins those flows.

## Non-goals

- Live simultaneous editing (explicitly later, on top of this foundation).
- Rewriting history, squashing versions, or deleting a version to "restore".
- Treating a history row as proof of authorship, truth, or legal record.
- A second list engine, menu system, toast, or settings surface beside the
  existing ones.
- Storing secrets, tokens, raw prompts, or other people's private content in
  an event or its message.

## Principles

1. **History only grows.** Restore, undo, variation and merge append events.
2. **The card is as of then.** Titles, previews and property values come from
   the version, never from today's Thing.
3. **Local first, truthfully.** A row says where it lives: saved on this
   device, synced to the account, or needs review. Unknown is shown as unknown.
4. **Property-level, never a text splice.** Diffs, undo and merges operate on
   named properties, mirroring `EditorHistory.patch` and its conflict count.
5. **One panel everywhere.** The ⋯ menu verb, the editor's Changes control and
   card "Edited" chips open the same scoped panel.
6. **Sync is not publish.** Syncing a private draft or variation never widens
   its audience.
7. **Relational, bounded, idempotent.** One protected `history-event` Thing per
   settled change, linked by `targetId`; batched, idempotent recording; bounded
   payloads with quota-aware degradation.

## Milestones

| # | Milestone | Gate to pass | Status |
| --- | --- | --- | --- |
| M0 | **Design concepts** — global timeline, contextual panel, versions/merge review, local-first states, settings, and the left-to-right Evolution view; both registered on `/docs/design`. | Owner reviews the concept; vocabulary and anatomy confirmed or corrected. | Delivered 2026-09-27 (this branch) |
| M1 | **Durable editor journal** — persist `EditorHistory` events to a local IndexedDB log keyed by account, origin and Thing; reload restores the journal; page-hide flush reuses `latestRevisionAutosave` discipline. | Reload, crash and account switch tests keep every branch; no cross-account leakage; storage bounded. | Planned |
| M2 | **Contextual History panel** — `history` joins `THING_ACTIONS`; `PersistedThingMenu`, the editor Changes control and PostCard "Edited" chips open one panel scoped to the Thing, with preview, restore-as-new-version and undo-one-change. | Desktop and 390px browser checks; restore never removes a row; conflicts reported, not overwritten. | Planned |
| M3 | **Account sync** — `history-event` protected Things (`targetId`, owner-private, bounded), batched idempotent record endpoint, cursor list endpoint, semantic capability versions on both manifests, sync queue with "saved on this device" → "synced" transitions. | Real-API tests on a disposable replica set; offline → reconnect converges without duplicates; export and delete flows include history. | Planned |
| M4 | **Timeline browser `/history`** — scope, URL filters, day grouping, density scrubber, cache-first paint, messages (owner notes, Lopu, apps, system), and the **Evolution** view (one Thing left to right: line look with true-time spacing, frames look with as-of renders, scrub/play/compare). | `TESTING.md` checklist; no loading flash with cached rows; screen-reader operation of rows and panel. | Planned |
| M5 | **Versions** — named/pinned versions, variations (private branches), Get latest changes, Send changes, Review and combine (property-level three-way merge). | Merge keeps both branches; dependent Component versions restore with the page or the UI says they cannot. | Planned |
| M6 | **Expansion** — non-editor writers (bulk, share, Lopu tools, apps) record events; retention and storage settings; collaboration hand-off. | Every generic writer emits or explicitly opts out; quota degradation tested. | Planned |

## Metrics and experiments

- Recovery: a synthetic crash mid-edit loses at most the last unsettled change
  and never an earlier branch.
- Fidelity: a restored version renders byte-identical crystal for the
  restored properties and leaves other properties at their current values.
- Sync honesty: after offline edits on two devices, both timelines show both
  branches with correct "needs review" rows and no duplicated events.
- Cost: history rows per Thing per day and bytes per event stay within the
  bounds chosen in M3; degradation drops display caches before ordered ids
  and messages.

## Risks and stop conditions

- **Index budget.** History must ride the existing general Thing indexes
  (`targetId`, `ownerId`, `createdAt` ordering). A new index requires the
  evidence-backed exception process; if it cannot be avoided, stop and decide.
- **Quota surprises.** If events are billable content, owners must see it in
  storage settings before M3 ships; otherwise reclassify as control.
- **Conflict semantics.** If property-level three-way merge proves
  insufficient for block-tree edits, pause M5 and design a block-aware merge
  rather than shipping a text splice.
- **Privacy.** Any message or preview that leaks another account's private
  content stops the rollout until projection rules are fixed.
