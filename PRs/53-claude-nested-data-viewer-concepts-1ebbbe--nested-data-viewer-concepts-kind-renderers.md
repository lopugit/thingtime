# PR #53 — Nested data viewer concepts + kind renderers with live /docs/concepts section

- PR: https://github.com/lopugit/thingtime/pull/53
- Branch: `claude/nested-data-viewer-concepts-1ebbbe`
- Base: `main`

## Goal

Make nested JSON friendly for laypeople without losing the nested/reference
power of JS/JSON: explore alternative viewer/editor shapes, and build the
kind-renderer pipeline (store plain JSON things in Mongo → fetch via the API →
resolve a template by `kind` or shape → render). Everything is real Thingtime
code so any concept can be adopted by wiring `onThingChange` to `setThingtime`.

## What was built

### Viewer concepts — `remix/app/components/Thingtime/concepts/`

Controlled components over plain JSON (`thing` + `onThingChange`), with
container-measured desktop/mobile presentations and inline editing through the
live tree's editors (MagicInput, exported NumberValueInput, Switch):

- `FocusCardsViewer.tsx` — 🎯 one thing at a time; children as cards; breadcrumbs.
- `MillerColumnsViewer.tsx` — 🗂️ Finder columns; mobile = push navigation.
- `OutlineDocViewer.tsx` — 📖 document typography; uniform arrays → tables
  (stacked cards on mobile); arrays of leaves → chips.
- `FormSheetViewer.tsx` — 📋 settings-page sheet; typed controls per leaf.
- `OrbitCanvasViewer.tsx` — 🪐 orbital canvas; tap moon to refocus; leaf bottom sheet.
- Shared: `conceptData.ts` (immutable path get/set/delete/add/rename, type
  helpers, `useThingMutations`), `conceptBits.tsx` (LeafValueEditor, crumbs,
  KindFlip ✨/🔍, container-width hooks), `sampleThings.ts`.

### Kind renderers — `remix/app/components/Kinds/`

- `kindRegistry.tsx` — `registerKindRenderer`, `resolveKindRenderer`
  (explicit kind → alias → structural `match()`), `adapt()` polymorphism,
  `<RenderThing/>` dispatcher with graceful fallback.
- `kindRenderers.tsx` — 📝 post, 🎥 video, 🏪 listing, 📊 dashboard,
  📍 place, 🗞️ news-analysis, ⚖️ comparison, 📈 chart, 👤 profile, 🍳 recipe,
  🧱 element.
- `HtmlThingRenderer.tsx` — html/css as pure JSON (`tag`/`props`/`children`)
  behind a sanitising gate: tag/prop/style whitelists, no `on*` handlers, no
  `javascript:`/`data:text/html` URLs, node-count + depth caps,
  `target="_blank"` forced to `noopener noreferrer`.
- `sampleKindThings.ts` — seed-ready sample documents for each kind.

### Docs — `remix/app/routes/docs/concepts/` (+ nav wiring)

- `entries.tsx` — 7 entries (5 concepts, kind gallery, pipeline architecture)
  with why/desktop/mobile/editing/adoption notes.
- `ConceptStories.tsx` — device frame (🖥️/📱 + 👀/🎨), all live stories,
  JSON→page playground, registry table.
- `index.tsx` — the docs page; drawer list + nav item in `DocsLayout.tsx`;
  overview card + reference-map row in `docs/index.tsx`; route in `routes.tsx`.

## Verification

- Live browser (worktree foreground stack on :19620, Claude Preview):
  walked all 7 entries at 1280px and 375px; drill-down, columns walk, orbit
  refocus, kind flips, form editing, JSON playground all exercised.
  No console errors; no horizontal overflow at 375px.
- Fixed during verification: branch values inside Document tables rendered
  "Imagine.." — now render a muted summary; DeviceFrame desktop canvas passes
  `variant="auto"` so the docs page itself degrades on narrow screens.
- `graphify update .` + `graphify export html` (aggregated) run; refreshed
  tracked outputs committed with the change.

## Debugging notes

- Worktree `remix/node_modules` was stale-linked (missing `rolldown`):
  `corepack pnpm --dir remix install` reported done in <1s; `--force` fixed it
  (documented failure mode in AGENTS.md).
- `graphify hook install` (global runbook) appended graphify hooks to the
  shared tracked `.githooks/` in the **main checkout** (via absolute
  `core.hooksPath`) — left uncommitted there deliberately: the hook pins a
  machine-specific Python path, so committing is a separate decision.

## Follow-ups (ideas)

- Mount FocusCardsViewer as the mobile presentation of /things; Columns as a
  desktop editor mode; Form as the Edit presentation.
- Feed integration: `<RenderThing thing={post} fallback={<PostCard/>}/>`.
- "Turn into…" kind stamping in the Thing Context Menu; user-defined templates
  stored as `element` things.
