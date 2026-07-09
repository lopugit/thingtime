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

## Second wave — 60 kinds + Editor.js (same branch)

- Kind renderers scaled 11 → **60**, modelled on widely-used internet data
  types, split into category files sharing `kindPrimitives.tsx`:
  Media 14 (incl. video + rich-text), Social 9, Commerce 11, Planning 10,
  Knowledge 8, Life 2, Data 3, World 1, Builder 1, plus the original core.
  Every kind has a seed doc in `sampleKindThings.ts`; the docs gallery and
  registry table group by category. Verified live: 60 cards render, grouped,
  no console errors, no horizontal overflow at 375px.
- **Editor.js across the board** — `components/Editor/LongTextEditor.tsx`:
  strings > ~160 chars (or multi-line) edit as block documents and serialise
  back to plain markdown-ish strings (deterministic round-trip:
  `## `/`- `/`1. `/`- [x]`/`> `/`---`); `{ blocks }` values edit natively
  (rich-text kind renders them). Wired into Thingtime.tsx (tree edit mode),
  concepts LeafValueEditor, and Feed PostComposer (replaces the textarea;
  posts still store plain strings). Debounced raw-input fallback save covers
  mutations editor.js change tracking misses.
- End-to-end verified in browser: checklist toggle in the docs story updated
  the serialised string; composed a post in the block editor on /feed with a
  freshly registered user (via the real /api/v1/auth/register) and the post
  landed in the feed with the Lopu "Posted ✨" toast.
- Deps added (pinned, lockfile committed): @editorjs/editorjs, header, list,
  quote, checklist, delimiter.
- Debug note: `delimiter` blocks warned "Tool not found" until
  @editorjs/delimiter was installed and registered; synthetic
  `execCommand`/`InputEvent` text does not trigger editor.js `onChange`
  (real interactions do) — the raw-input fallback save also makes automated
  testing possible.

## Round 3 — empty registry on Vercel (tree-shaking)

- Symptom (user report): the Vercel preview's kind gallery showed only the
  mono `kind: '…'` labels with no rendered cards, all grouped under
  "OTHER 60"; localhost dev was perfect.
- Root cause: `remix/package.json` sets `"sideEffects": false`. The kind
  renderers registered via side-effect imports (`import './kindRenderersX'`
  running `registerKindRenderer()` at module scope) — the production
  bundler (vite 8 / rolldown) dropped those modules AND skipped the
  index.ts barrel body (re-export glue), shipping an empty registry. Dev
  serves modules unbundled, hiding it. Confirmed by bundle grep: sample
  strings FOUND, renderer titles MISSING.
- First attempt (explicit `registerXKinds()` calls at index.ts top level)
  still got dropped — consumers' imports are rewired directly to source
  modules, so barrel bodies never execute under `sideEffects: false`.
- Fix: lazy `ensureBuiltinKinds()` inside `kindRegistry.tsx`, invoked on
  the read paths (`getKindRenderers` / `getKindRenderer` /
  `resolveKindRenderer`) and on `registerKindRenderer` (builtins first, so
  early custom kinds still override). The renderer-file ↔ registry import
  cycle is safe: register calls only run post-evaluation.
- Verified: `npm run build:client` bundle now contains "Text post",
  "Marketplace listing", "Boarding-pass style", "Plant care" (previously
  missing); dev gallery unchanged (60 cards, 9 categories, clean console);
  deployed preview re-verified after the Vercel rebuild.
- Repo lesson: never rely on module side effects for registries here —
  quick check is `npm --prefix remix run build:client` (~1s) + grep
  `remix/dist/assets/*.js` for a distinctive string.

## Round 4 — rich-text fidelity, read-only toggle, quote restyle, full suite

- View/Edit switch now drives Editor.js native read-only mode
  (`readonly` prop on LongTextEditor; init `readOnly` + live
  `editor.readOnly.toggle()`).
- Inline formatting (b/i/u/s/a/mark/code) renders through a parser-based
  allowlist sanitiser in RichTextBlocks (unknown tags unwrap, only safe-
  protocol hrefs survive, forced noopener). Adversarially verified in-
  browser: `<img onerror>`, `<script>`, `javascript:` links inert.
- List-tool v2 shapes ({ content, meta.checked, items } + style
  'checklist', nested) render as real checkboxes and serialise as
  "- [x]" lines.
- Quote blocks restyled (user report: giant bordered box + ~160px
  min-height are stock @editorjs/quote CSS) — now accent left rule,
  italic, natural height, quiet caption; code/table editor chrome themed.
- Full practical Editor.js suite installed and wired: + table, code,
  warning, embed, simple-image blocks; marker/inline-code/underline
  inline tools. String round-trip extended: ``` fences (parsed before
  paragraph splitting), pipe tables (+ heading separator), ![]() images,
  ⚠️ callouts. Rich-text kind renders all of them safely (embeds are
  link-out cards, never iframes; image URLs allowlisted).
- New `blockTypes` prop (13 tools, per-field enable/disable) with a live
  chip-toggle docs story; forwarded through concepts LeafValueEditor.
  Editor re-initialises with the exact toolset, content carried across.

## Follow-ups (ideas)

- Mount FocusCardsViewer as the mobile presentation of /things; Columns as a
  desktop editor mode; Form as the Edit presentation.
- Feed integration: `<RenderThing thing={post} fallback={<PostCard/>}/>`.
- "Turn into…" kind stamping in the Thing Context Menu; user-defined templates
  stored as `element` things.
