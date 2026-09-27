# PR #947 — History timeline / events browser design concept

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
