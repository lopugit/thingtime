# Unified Thing history and timeline browser baseline

**Status:** Evidence note plus a delivered design concept; no storage, API, or
sync implementation is authorized by this document

**Grounded:** 2026-09-27, Australia/Melbourne

**Plan:** [Unified Thing history roadmap](../PLAN/unified-thing-history-roadmap.md)

**Execution epic:** [TODO 50 — Unified Thing history and the timeline browser](../TODO/claude-todo/50-unified-thing-history-and-timeline-browser.md)

**Design concepts:** [`docs/design/thingtime-history-timeline/`](../docs/design/thingtime-history-timeline/index.html) and
[`docs/design/thingtime-history-evolution/`](../docs/design/thingtime-history-evolution/index.html)
(interactive, fictional data; listed on `/docs/design`)

## Why preserve this note

On 2026-09-27 the owner asked for "a visual timeline/events browser with
things cards/changes contextual messages" for the unified history feature that
a ChatGPT/Codex investigation ("Investigate unified version history", shared
2026-09-27) had just scoped. That investigation answered the owner's question
"I can't seem to find the version/edit history for things? We did this right?"
with: the rich-text **Changes** history exists but only in memory for the
mounted editing session; older Thingtime undo persists locally but does not
cover every saved Thing or API operation; broader experience history was
documented docs-only; and no complete shared implementation of universal
saved-Thing history or branch/merge/push/pull existed at the time it looked.
The owner's direction was explicit: history should be durable **locally
first**, then kept in sync with the account, surviving refreshes, restarts,
offline work, and device switches.

**Correction (Lopu review of PR #947).** That last point has since been
overtaken by this repository's own work. The Unified Timeline foundation —
a durable local event log with a sync queue, server-side event recording,
relational branches and versions, a cursor-paged `/api/v1/timeline` route, and
a working History panel behind the `history` Thing verb — is **already merged
into both `develop` and `main`** as of 2026-09-27 (merge base `2d21d89a`). The
ledger below has been corrected accordingly. This epic is therefore a
*continuation* of the Unified Timeline, not a greenfield feature: its real
contribution is the browsing experience (Scope × Look, as-of Thing cards,
contextual messages, friendly version vocabulary), not a second event store.

This note records what the repository actually has today, what the design
concept assumes, and the questions a real implementation must settle. It is
product and engineering research. Nothing here proves that a historical row is
a legal record, an audit trail, or evidence of authorship beyond what the
current Thing envelope stores.

## Evidence ledger

| Claim | Current evidence | Confidence and refresh trigger |
| --- | --- | --- |
| The shared editor already keeps a branching, property-level change journal. | [`editorHistory.ts`](../remix/app/components/Editor/editorHistory.ts) records `EditorHistoryEvent { id, parentId, time, label, doc, changes }`, diffs documents into `HistoryChange { blockId, path, before, after }`, labels events (`Add block`, `Edit block`, `Move block`, …), keeps abandoned futures (`select`, preferred redo per parent), and can `patch` one event in either direction while counting conflicts instead of overwriting. [`EditorHistoryControls.tsx`](../remix/app/components/Editor/EditorHistoryControls.tsx) renders Undo · Redo · Changes and a paged "Editor changes" modal. Merged PR [#635](https://github.com/lopugit/thingtime/pull/635). | High for the inspected `develop` snapshot. Recheck after any editor journal or Changes UI change. |
| That *editor* journal is still not durable. | PR #635's note states "History is local to the mounted editing session, not persisted across reloads." The class holds `events` in memory and exposes a DOM `tt-editor-update` event; no IndexedDB, localStorage, or API write exists for it. | High, and still true at the merge base. Note this is now a gap *between* the editor journal and the merged Timeline event log, not an absence of durable history — see the Unified Timeline row below. |
| The Thing envelope itself retains only the current state and two timestamps; prior revisions live beside it in the Timeline. | The Thing envelope carries `createdAt` and `updatedAt`; generic `updateThing` replaces the crystal and honours `expectedUpdatedAt` stale-write checks (see [`ThingDefinitionEditor`](../remix/app/components/Builder/DefinitionEditor/ThingDefinitionEditor.tsx) and the [things feature map](../docs/feature-map/things-and-folders.md)), which [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md) also records. Revisions are *not* lost: per [`docs/unified-timeline.md`](../docs/unified-timeline.md) each history event is an atomic protected Thing under the account's private **Timeline** folder, keyed by `targetId`, deliberately never embedded on the target Thing or its folder. | High for the current writers. Recheck when the things write path or provenance work changes. |
| Thingtime already has an owner-private, cursor-paged history list engine. | The `/notifications` page ([`NotificationsPage.tsx`](../remix/app/components/Notifications/NotificationsPage.tsx)) paints the last page synchronously from `tt-notif-history-<viewer>`, keeps URL-driven filters (category, type, unread, search, date window), pages with a stable cursor, and never flashes empty. History rows are protected notification Things written before delivery preferences (PR [#705](https://github.com/lopugit/thingtime/pull/705)). | High. The timeline browser should reuse this pattern rather than add a second list engine. |
| The base verb set already carries a `history` verb, and it already opens a history panel. | [`THING_ACTIONS`](../remix/app/schemas/thingActions.ts) lists `open`, `inspect`, **`history`**, `copy-link`, `rename`, `edit`, `share`, `delete`, `send-to-lopu`; `buildThingEntityMenu` and `PersistedThingMenu` render it on cards and pages ([UI shell map](../docs/feature-map/ui-shell-menus-and-design-system.md)), and `case 'history'` calls `openThingHistory(id)` from [`TimelineHost.tsx`](../remix/app/components/Timeline/TimelineHost.tsx) in `PersistedThingMenu`, `ThingsPage`, `SeamlessPageEditor` and `ThingDefinitionEditor`. `thingEntityMenu.test.ts` asserts the verb is offered on a single Thing and withheld from bulk selections. | High for the merge base. The contextual entry point exists; M1 extends it rather than adding it. |
| Local-first event primitives now exist, not only whole-state ones. | [`localCache.ts`](../remix/app/hooks/localCache.ts) (`tt-<domain>` keys, first paint), the async localforage `thingtime` blob, and [`latestRevisionAutosave.ts`](../remix/app/Providers/latestRevisionAutosave.ts) (debounced latest-revision writes with page-hide flush) persist whole state, and [TODO 07](../TODO/claude-todo/07-cross-tab-thingtime-sync.md) syncs it across tabs. Separately, the merged Unified Timeline adds the append-only event log this note originally called missing: [`app/timeline/records.ts`](../remix/app/timeline/records.ts), [`indexedDb.ts`](../remix/app/timeline/indexedDb.ts), [`localStore.ts`](../remix/app/timeline/localStore.ts) and [`sync.ts`](../remix/app/timeline/sync.ts). | High. [TODO 44](../TODO/claude-todo/44-local-first-agency-and-accountable-synchronization.md) owns the general local-first contract. |
| A substantial Unified Timeline implementation is already merged — on `develop` **and** `main`. | [`docs/unified-timeline.md`](../docs/unified-timeline.md) is the accepted 2026-09-27 product contract (its own header notes implementation is still in progress, so this is not a claim the feature has shipped end to end). Merged code spans the client event log and sync queue (`app/timeline/records.ts`, `indexedDb.ts`, `localStore.ts`, `sync.ts`, `clientEvents.ts`, `draftRecorder.ts`, `branchStore.ts`, `useThingTimeline.ts`), the server side ([`api/utils/timeline/recordMutation.ts`](../remix/app/api/utils/timeline/recordMutation.ts), `repository.ts`, `service.ts`, `versions.ts`, `branches.ts`, `snapshotParts.ts`, `envelope.ts`), the [`/api/v1/timeline`](../remix/app/routes/api/v1/timeline/_timeline.tsx) route (cursor `before`/`after`/`limit`, `history=1`, `branches`), and the UI ([`TimelineHost.tsx`](../remix/app/components/Timeline/TimelineHost.tsx), `TimelineBranches.tsx`, `TimelineVersionActions.tsx`, `app/timeline/TimelineProvider.tsx`). Merged PRs [#956](https://github.com/lopugit/thingtime/pull/956), [#959](https://github.com/lopugit/thingtime/pull/959), [#965](https://github.com/lopugit/thingtime/pull/965), [#966](https://github.com/lopugit/thingtime/pull/966), [#970](https://github.com/lopugit/thingtime/pull/970) extend it to API/Action/AI provenance, folder moves, library renames and saved themes. Unit and integration coverage exists (`api/utils/timeline/*.test.ts`, `app/timeline/*.test.ts`, `routes/api/v1/timeline/timelineRoute.test.ts`, `remix/scripts/timeline*.integration.mts`). | High for the merge base (`2d21d89a`), which landed the Timeline foundation the same day this concept was authored. **This is the foundation the roadmap must build on; do not design a second event store, sync queue, or history route.** Recheck before starting M1. |
| Adjacent epics already claim neighbouring territory. | [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md) owns replayable experience snapshots (feed/search state), [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md) owns provenance and correction semantics of the artifact, [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export/deletion, [TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md) owns roles and exact-version contributions. | High for the current backlog. The roadmap defines boundaries rather than a second implementation. |
| The investigation reproduced a draft-loss bug adjacent to history. | The shared thread reports that large drafts and chat continuations can omit their blocks, that the server interprets the omission as an empty page, and that targeting the same page by ID reuses the empty draft. It was not verified against the owner's private page. | Medium; not reproduced in this repository session. Reproduce on a disposable fixture before treating it as a history requirement. |
| The design concept exists and is registered. | `docs/design/thingtime-history-timeline/index.html` (self-contained, Prism tokens) is listed in `remix/app/routes/docs/designEntries.ts` and `docs/design/README.md`; it shows the global browser, the contextual panel, versions and merge review, local-first states and settings, with fictional data only. | High for this branch. Refresh when the concept or gallery registration changes. |
| The Evolution view (one Thing, left to right) is a second registered concept. | `docs/design/thingtime-history-evolution/index.html` follows the owner's horizontal-timeline reference (2026-09-27, uicookies-style: nodes on one line, labels alternating above and below, a quiet axis): a Line look with true-time positions that spreads only colliding nodes, a Frames look with as-of renders, scrub/play/compare, and a dashed variation lane. The timeline concept's browser carries the same line view in place. | High for this branch. As-of rendering assumes property diffs can be folded forward from the first version; block-tree edits need a block-aware fold before implementation. |
| Owner language for versions is fixed. | The investigation and the owner's reply settle the everyday vocabulary: **Try a variation**, **Get latest changes**, **Review and combine**, **Send changes**, with ancestry preserved underneath for merging from a shared starting version. | High as product direction; wording may still be tuned in the UI. |

## What the concept commits to

- One event row = the Thing card **as of that version**, property-level change
  chips, an optional contextual message (owner note, Lopu explanation, app
  capture note, system line), and a truthful sync pill.
- Restore and undo append new versions; nothing is rewritten or truncated.
  Undo reverts one event's properties only and reports conflicts instead of
  overwriting later edits, mirroring `EditorHistory.patch`.
- Scope is explicit: everything, one Thing, or a page plus the Things it
  renders. Filters live in the URL, as on `/notifications`.
- Local first: an event is durable on the device before the request leaves;
  a queue syncs it; guest history stays local until adopted; syncing a private
  draft never publishes it.
- Conflicts on one property keep both branches and ask the owner to review.

## Open questions

1. **Granularity.** Which settled changes become events for non-editor
   writes (generic `PATCH`, bulk moves, share changes, Lopu tool patches)? The
   editor journal already coalesces typing; server writes need an equivalent.
2. **Storage class and quota.** Are `history-event` rows `content` (billable,
   counted against the account ledger) or `control`? Retention defaults and
   per-Thing pause change the answer. *Partly settled already:*
   [`docs/unified-timeline.md`](../docs/unified-timeline.md) makes each event a
   protected Thing under the private Timeline folder and has canonical
   mutations append the event in the same transaction as their content **and
   storage accounting** — read that contract before re-opening this.
3. **Ordering across devices.** Two offline devices can append to the same
   Thing; the concept assumes parent pointers plus capture time. *Settled by
   the merged contract:* a server receipt supplies ordering and proof of
   acceptance, and client clocks are explicitly **not** used to resolve
   conflicts. Do not introduce a hybrid logical clock without revisiting that
   decision.
4. **Message privacy.** Messages travel with events and can quote content.
   They need the same redaction and projection rules as notification text.
5. **Dependent versions.** Restoring a page that references Components must
   restore the Component versions it was rendered with, or say that it cannot.
6. **API surface.** Record (batched, idempotent by client event id), list
   (cursor, scope, filters), restore, and named versions — with semantic
   feature versions on both capability manifests. *Largely exists:*
   [`/api/v1/timeline`](../remix/app/routes/api/v1/timeline/_timeline.tsx)
   already serves `history=1`, `branches`, and `before`/`after`/`limit`
   cursors. The open part is the **scope and filter** surface the browser needs
   (everything / one Thing / page + related, kind·who·what, search, day
   window) — extend that route, do not add a parallel one.
7. **Export and deletion.** History must join the existing export archive and
   per-entry/by-date/clear-all deletion flows rather than add a second path.

## Refresh triggers

- Any change to `editorHistory.ts`, `EditorHistoryControls.tsx`, the things
  write path, `THING_ACTIONS`, or the notifications list query.
- A merged PR that persists editor history or adds revision storage.
- Owner decisions on storage class, retention, or the vocabulary above.
- **Any change under `remix/app/timeline/`, `remix/app/api/utils/timeline/`,
  `remix/app/components/Timeline/`, `remix/app/routes/api/v1/timeline/`, or
  [`docs/unified-timeline.md`](../docs/unified-timeline.md).** The Unified
  Timeline is this epic's foundation and is still moving; re-read it before
  M1 rather than trusting this snapshot.
