# PR #947 — History timeline / events browser + Evolution view design concepts

Date: 2026-09-27. Branch: `claude/thingtime-timeline-browser-5173ff`. Base: `develop`.
Owner request: "design a visual timeline/events browser with things cards/changes
contextual messages" for the unified history feature scoped in the shared
ChatGPT investigation *Investigate unified version history* (history durable
locally first, then synced to the account; **Try a variation · Get latest
changes · Review and combine · Send changes**). Driven by a cron-backed `/loop`
(`loop-timeline-browser-thingtime`) that re-checks this PR until it is merged or
closed.

## What shipped

- `docs/design/thingtime-history-timeline/index.html` — self-contained
  interactive concept (Prism tokens, fictional data): the `/history` browser
  (scope, filter chips, search, 30-day scrubber, day groups, event rows with the
  Thing card as of that version, property-change chips, contextual messages,
  sync pills), a detail panel / bottom sheet (before-after diff, restore, undo,
  variation, compare, notes, versions), entry points (⋯ menu `history` verb,
  editor Changes control, "Edited · N versions" chip), a versions lane graph
  with **Review and combine**, the local-first state simulation, and History
  settings.
- Gallery registration (`designEntries.ts`, first entry, kind App;
  `docs/design/README.md`).
- Evidence chain: `NOTES/unified-thing-history-timeline-baseline.md`,
  `PLAN/unified-thing-history-roadmap.md`,
  `TODO/claude-todo/50-unified-thing-history-and-timeline-browser.md`, index
  rows in all four trees, and a `TESTING.md` checklist section.

## Verification

- Owner's Chrome against the worktree dev stack (web 19280 / HMR 19281 /
  Nitro 19282): gallery page and bundle URL render; no page console errors.
- 1440px: split timeline + detail panel, scrolled top to bottom, no overflow.
- 390px: no horizontal scroll, detail opens as a bottom sheet (✕, backdrop and
  Escape close it), sections stack, the version graph scrolls inside its box.
- Interactions: select, Undo/Restore/Try a variation append rows and toast;
  scrubber jump and empty-day hint; who/kind chips; search empty state;
  Versions view; Send changes → merge card → Keep both; Offline → Make an edit →
  Reconnect & sync; message toggle; note saving; versions tab.
- `lint:files` on `designEntries.ts` passes. Graphify refreshed through
  `scripts/graphify` (structural update plus semantic extraction of the new
  documents via the local proxy — the semantic path was unavailable: every chunk returned HTTP 502 `codex_execution_failed` from the local Codex proxy, so the new documents are indexed structurally only).

## Boundaries

No storage, API, sync, or menu code changed. The concept's data model
(`history-event` protected Things linked by `targetId`, local IndexedDB log +
sync queue) is a proposal for the owner's M1 decision, not an implementation.
Tailscale Funnel URL not verified for this worktree. This PR does not
authorize a merge.

## Log

- 2026-09-27 — concept, docs and verification landed; PR opened.

## Evolution view follow-up — 2026-09-27

Owner asked for a left-to-right, scrollable view of one Thing's evolution as an
alternative history browser view, with its own docs design entry, referencing a
classic horizontal timeline (uicookies: nodes on one line, labels alternating
above and below, a quiet date axis).

- New entry `docs/design/thingtime-history-evolution/index.html` (registered in
  `designEntries.ts` second, and in `docs/design/README.md`): **Line** look
  (hollow verb-coloured nodes on one line that brightens toward *now*, labels
  alternating above/below, day ticks, small moment dots, a dashed variation
  lane with an elbow from its starting version, the branch-source label kept
  above the line) and **Frames** look (as-of renders: page structure, the
  Component's actual button, record fields, post text/audience; change chips
  and elapsed time on the connectors). Real-time spacing keeps true positions
  and spreads only colliding nodes (piecewise time→x mapping, min gaps); Even
  spacing is uniform. Thing picker, scrub slider, ←/→, Play, Compare A/B (also
  across the variation), restore/variation/review-and-combine append versions.
- The timeline concept's browser gained the same **Evolution** view in place
  (View → Evolution: Thing picker + line; node click opens the shared detail
  panel; link to the full concept).
- TODO 50, PLAN M0/M4, the NOTES ledger and `TESTING.md` describe the view.

Verification: owner's Chrome at 1440px (line + frames, Gear tracking and
Primary button with the variation lane, compare v1→v4 = 4 properties, restore
appends a node, even/real spacing positions) and the in-app pane at 375px
(no page horizontal scroll, strip scrolls inside the frame, labels 124px,
panels stack, frames 78vw); the timeline concept's in-place Evolution view at
desktop and 375px. Fixed during review: a `.below` panel class colliding with
the below labels (renamed `.panels`), filmstrip `.moment` styles leaking into
line-mode moments (scoped to `.lane`), lane labels overlapping the first
label, and the variation elbow crossing the branch-source label.
