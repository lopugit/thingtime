# 50 — Unified Thing history and the timeline browser 🕰️

**Status:** 🟣 Design concept delivered · owner review needed before M1

**Priority:** P1 fundamental · requested 2026-09-27

**Evidence:**
[Unified Thing history and timeline browser baseline](../../NOTES/unified-thing-history-timeline-baseline.md)

**Roadmap:**
[Unified Thing history roadmap](../../PLAN/unified-thing-history-roadmap.md)

**Design concepts:**
[`docs/design/thingtime-history-timeline/index.html`](../../docs/design/thingtime-history-timeline/index.html)
and [`docs/design/thingtime-history-evolution/index.html`](../../docs/design/thingtime-history-evolution/index.html)
— interactive, fictional data, listed on `/docs/design` (bundle URLs
`/docs/design-bundles/<slug>/index.html`).

## Goal

Give every Thing, page, Component and property one contextual **History**
panel and one global **timeline browser**, where each moment shows the Thing
card as it was, the property-level changes, and the contextual message that
explains why. History is durable locally first, then synced to the account,
and it only ever grows: restore, undo, variations and merges append versions.

## Problem

> **What already exists (corrected during Lopu's review of PR #947).** The
> [Unified Timeline](../../docs/unified-timeline.md) foundation is **merged into
> both `develop` and `main`**: a durable client event log with a sync queue
> (`remix/app/timeline/records.ts`, `indexedDb.ts`, `localStore.ts`, `sync.ts`),
> server-side recording in the mutation transaction
> (`remix/app/api/utils/timeline/recordMutation.ts`, `versions.ts`,
> `branches.ts`), a cursor-paged `/api/v1/timeline` route (`history=1`,
> `branches`, `before`/`after`/`limit`), a working History panel
> (`remix/app/components/Timeline/TimelineHost.tsx`), and a wired `history`
> verb in `THING_ACTIONS`. Merged PRs #956, #959, #965, #966, #970 extend it to
> API/Action/AI provenance, folder moves, library renames and saved themes.
> **This epic continues that work; it must not build a second event store, sync
> queue, or history route.** Read `docs/unified-timeline.md` first.

The gaps this epic actually closes:

- The shared editor's Changes journal (`remix/app/components/Editor/editorHistory.ts`,
  PR #635) is branching and property-level but lives in memory for the mounted
  session only — it is not yet joined to the durable Timeline event log.
- The Thing envelope still keeps only `createdAt`/`updatedAt` and the current
  crystal. Revisions exist, but as separate protected Timeline Things — so
  rendering a Thing **as of** a past version needs a fold that
  `docs/unified-timeline.md` does not yet specify for block trees.
- There is a History panel, but no **global** browser: no `/history` route, no
  Scope (Everything · This Thing · Page + related) × Look (List · Cards · Line ·
  Frames) dials, no kind/who/what filter chips, search, or day scrubber, and no
  as-of Thing cards or contextual message bubbles in the list.
- Friendly version vocabulary (**Try a variation · Get latest changes · Review
  and combine · Send changes**) is not yet the user-facing language over the
  existing relational branches, and merge review is not surfaced.

## Required experience (the concept, in words)

### One browser: Scope × Look

- There is one History browser with two dials. **Scope** says what is on the
  timeline (Everything · This Thing · Page + related). **Look** says how it is
  drawn (List · Cards · Line · Frames). Every combination shares the filter
  chips, search, the 30-day scrubber and the detail panel; variations are
  drawn as dashed lanes inside every look rather than a separate "Versions"
  view, and named versions get a pin.

### Global timeline browser — `/history`

- **List look** (the default): newest first, grouped by day, with a session
  sub-label (count · devices).
- Scope segmented control: **Everything**, **This Thing**, **Page + related**
  (the page plus the Components and records it renders).
- URL-driven filters, as on `/notifications`: kind (posts, pages, components,
  data, files), who (you, Lopu, collaborators, apps), what (edited, created,
  moved, shared, restored, synced), sync state (only on this device, needs
  review), free-text search, day jump from a 30-day density scrubber.
- Event row anatomy: left rail with a dot per verb colour (dashed purple lane
  for a variation), time + device, actor avatar and sentence ("**You** changed
  **colour** on **Primary button**"), the **Thing card as of that version**
  (kind icon, title then, sub-line, `vN` chip), **change chips** (`colour:
  Sage green → Deep green`, adds green, removals red), the **contextual
  message** bubble (owner note, Lopu explanation with the gradient border,
  app capture note, dashed system line), the **sync pill**, and hover actions
  Preview · Compare · Restore.
- Detail panel (right column on desktop, bottom sheet at ≤820px): the big Thing
  card, ancestry chips (`v3 · from v2 · 🌱 darker palette · You`), tabs
  **Changes** (before/after per property, or Then/Now when comparing with the
  present), **Message** (read, add a note, ask Lopu to explain), **Versions**
  (the Thing's version list, name/pin, export). Buttons: **Restore this
  version** (new version from this one), **Undo this change** (revert only
  these properties, later edits kept), **Try a variation**, **Compare with
  now**; rows that need review offer **Review and combine** instead.
- Optimistic rendering: paint the cached first page per viewer + scope, then
  reconcile; never flash empty.

### Horizontal looks — Cards, Line, Frames (any scope)

- The same events drawn left to right, oldest on the left, newest at **now**;
  with scope Everything the spine carries every Thing's changes, with This
  Thing (or Page + related) it reads as that Thing's evolution. Hollow nodes
  coloured by verb; labels alternate above and below (version · time, the
  change label, actor and sync state); minor moments (a sync, an attachment)
  are small dots; a variation runs on a dashed lane below its starting version;
  a quiet day axis sits under the line, which brightens toward now.
- **Real time** spacing keeps true positions and spreads only the nodes that
  would collide; **Even** spacing puts every version a step apart.
- **Cards** look (the default): the Thing's own card rendered as of each
  version, hanging alternately above and below a spine that fills with the
  brand gradient up to the selected version; each card carries an edit callout
  (what changed), the actor and sync state, and a 📌 badge when the version is
  named; later cards wait faded until you reach them; moments sit on the spine
  as dots; a variation gets its own dashed row; a minimap under the strip shows
  the whole history and the viewport; Comfortable/Compact density.
- **Frames** look: each version becomes a filmstrip card that renders the
  Thing as it was (page heading/folder/blocks/attachments, a Component's actual
  button, a record's fields, a post's text and audience) with change chips and
  elapsed time on the connectors.
- Scrub with a slider, ←/→, Home/End or the minimap; Space or **Play** steps
  through versions; select a node or card to see the diff in the shared panel;
  **Compare** any two versions (even across a variation) read-only.
- Concepts: the timeline concept's browser carries all four looks at every
  scope; [`docs/design/thingtime-history-evolution/index.html`](../../docs/design/thingtime-history-evolution/index.html)
  is the same browser with the scope dial set to This Thing and as-of renders
  inside the cards.

### Contextual entry points

- `history` joins `THING_ACTIONS` so `buildThingEntityMenu`/`PersistedThingMenu`
  show **History** on every persisted Thing.
- The editor's existing Undo · Redo · **Changes** footer opens the same panel
  scoped to that Thing; the count on the button comes from the durable log.
- PostCard and Thing pages show an honest **Edited · N versions** chip that
  opens the panel; a UI chip is not redaction, the server projection decides
  what a viewer may see.

### Versions in friendly words

- **Try a variation** starts a private branch from a shared starting version;
  **Get latest changes** pulls; **Send changes** pushes; **Review and combine**
  resolves a property changed on both sides with a calm three-way choice
  (keep mine, keep theirs, keep both as named variations). Both branches stay
  in history whatever is chosen.
- Named and pinned versions survive automatic retention.

### Local first, then synced

- A durable local event log (IndexedDB, keyed by account, origin and Thing)
  records every settled change before the request leaves; a sync queue ships it.
- Sync pills tell the truth: **Saved on this device** → **Synced to your
  account** → **Needs review**. Offline edits queue; reconnect converges
  without duplicates. Guest history stays local until adopted into an account.
- Syncing a private draft or variation never publishes it.

### Settings surface

- One **History** category shared by the popup and the Settings page: record
  history automatically (on), sync history to my account (on), keep history
  (forever / 90 days / pinned only), show messages in the timeline (on),
  storage usage with export and **Clear history…**; per-Thing **Pause** from
  the ⋯ menu.

## Data and API contract (already merged — audit in M3, do not redesign)

The Unified Timeline landed this shape on `develop` and `main` before this
epic's M3. Read it before touching storage; extending it is the job, and a
second event kind, route or sync queue is out of scope.

- One owner-private, protected Thing per settled change, kind
  **`timeline-event`** (`TIMELINE_EVENT_KIND`, `remix/app/timeline/contract.ts`)
  with **`timeline-link`** for reverse links, linked by root `targetId` to the
  changed Thing and filed under the private Timeline folder
  (`api/utils/timeline/repository.ts`). It rides the shared
  `ownerId`/`thingtime`/`targetId`/`createdAt` indexes, bounds each event at
  `TIMELINE_EVENT_MAX_BYTES`, validates every envelope against its payload on
  read, and appends in the same transaction as the content mutation and its
  storage accounting (`recordMutation.ts`). There is no embedded array on the
  target. A new index remains an evidence-backed exception.
- Endpoints ship at **`/api/v1/timeline`**
  (`app/routes/api/v1/timeline/_timeline.tsx`), with `timeline.read` /
  `timeline.write` already in `api/utils/rateLimit/config.ts`:
  - `GET` — cursor-paged **list** (`thingId`, `before`/`after`, `limit`).
  - `POST` event — idempotent **record** (client event id).
  - `POST { command: 'preview-version' | 'apply-version', mode: 'restore' |
    'merge' }` — **restore** and **review-and-combine**, with
    `expectedHeadId` concurrency, `operationId` idempotency, `choices`, and a
    `conflicts` count rather than an overwrite (`versions.ts`).
  - `POST { command: 'create-branch' | 'advance-branch' }` — variations
    (`branches.ts`).
- Genuinely remaining for M3: **named/pinned** versions, the truthful
  saved-on-this-device → synced → needs-review projection the concept shows,
  export/delete coverage for history, and confirming the semantic capability
  versions on both manifests and `apiDocs.ts` describe the above.
- Storage class, retention defaults and quota accounting are owner decisions
  (see the baseline's open questions; `docs/unified-timeline.md` already
  settles part of it).

## Delivery shape

1. M0 — design concept (this item's first slice, delivered).
2. M1 — persist the editor journal locally; reload restores it.
3. M2 — `history` verb + contextual panel with preview, restore, undo.
4. M3 — audit the merged `timeline-event` Things, `/api/v1/timeline` and sync
   queue; add named/pinned versions, truthful sync pills, export/delete cover.
5. M4 — `/history` timeline browser on the notifications list engine.
6. M5 — the friendly vocabulary (Try a variation, Get latest changes, Send
   changes, Review and combine) over the merged branch/version primitives.
7. M6 — non-editor writers emit events; retention/storage settings; hand-off
   to collaboration.

## Done when

- Reload, crash, offline work and account switch never lose a recorded
  branch; private history never appears to another account on the same device.
- Every persisted Thing offers History from its ⋯ menu; the editor Changes
  control and card chips open the same scoped panel.
- Restore and undo append versions, never remove rows; undo reports conflicts
  instead of overwriting later edits.
- `/history` filters live in the URL, paint from cache, page with a cursor, and
  work with keyboard and screen reader at desktop and 390px.
- The Evolution view renders every version of a Thing as of that version,
  keeps true time positions readable, and its compare is read-only.
- Two-device offline edits to one property produce "needs review" rows and a
  merge that keeps both branches.
- History joins export, per-entry/by-date/clear-all deletion, and storage
  settings; both capability manifests and client negotiation cover the new
  features; `TESTING.md` checklists pass.

## Existing anchors

- `remix/app/components/Editor/editorHistory.ts`, `EditorHistoryControls.tsx`
  — the in-memory branching journal and Changes modal to make durable.
- `remix/app/components/Notifications/NotificationsPage.tsx`,
  `notificationCore.ts` — the cursor-paged, URL-filtered, cache-first list
  engine to reuse for `/history`.
- `remix/app/schemas/thingActions.ts`, `remix/app/components/Thingtime/ContextMenu/`
  — base verbs and menus for the `history` entry point.
- `remix/app/hooks/localCache.ts`, `remix/app/Providers/latestRevisionAutosave.ts`
  — first-paint cache tier and page-hide flush discipline.
- `remix/app/api/utils/things/things.ts` — canonical write path where
  settled server-side changes would emit events.
- `docs/design/thingtime-history-timeline/index.html` — the concept to match.
