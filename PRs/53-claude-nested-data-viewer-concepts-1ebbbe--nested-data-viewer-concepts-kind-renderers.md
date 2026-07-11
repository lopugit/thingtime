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

## Round 5 — safe full customisation (🎨 Style tune)

- User ask: "complete customisation with font colours, custom sizes,
  etc — safely?" Answer shipped: style as validated DATA, never raw CSS.
- `components/Editor/styleTokens.ts`: the validators — hex or exact
  theme-var allowlist colours, 10–72px clamped sizes, curated font
  stacks (body/serif/mono/rounded), align enums; tokens compile to React
  style objects only.
- `components/Editor/StyleTune.ts`: Editor.js block tune in every
  block's ⋮ settings menu (10 swatches / 6 sizes / 4 fonts / 3 aligns +
  reset); data at `block.tunes.style`; live editor styling via wrap();
  14th `blockTypes` toggle.
- Gotcha found live: editor.js's settings popover **clones** custom tune
  HTML, silently dropping addEventListener bindings (panel visible,
  clicks dead). Fix: attribute-driven event delegation — one global
  capture listener + blockId→tune registry; active states repaint on
  whichever panel copy was clicked.
- Rich-text kind re-validates tokens at render, so hostile stored docs
  (color:'red;position:fixed', size:9999, font:'comic-sans') come out
  neutralised — proven in the new docs story's seed and live checks
  (default colour, static position, clamped 72px).
- Editor instances now register in the `window.meta` debug db
  (Thingtime.tsx convention) so tests/devtools can drive editor.js APIs.
- Verified end-to-end in browser: settings popover → purple + 2XL +
  center → editor block styled inline → saved → rendered panel purple
  32px centered. Production bundle carries the tune.
- Design note: font-family/size/colour deliberately did NOT ship as
  inline marks (span-level) — block-level tokens keep serialization
  honest and the sanitizer closed; inline colour spans remain a possible
  future custom inline tool.

## Round 6 — stable String ↔ Editor.js datatype toggle

- Removed the live `>160 characters || contains newline` renderer heuristic
  that remounted the input while a person typed. Primitive strings now always
  use the plain inline editor, so Enter/focus/save cannot produce the recorded
  layout and caret jump.
- Added **Editor.js** under Change type → Custom types. String → Editor.js
  converts the current text into `{ kind: 'rich-text', blocks }`; Editor.js →
  string uses the existing deterministic block-to-text conversion. Both rows
  use the menu's radio state to show the active representation.
- Native block documents are atomic values in the Thingtime tree and all five
  viewer concepts: sanitized rich blocks in view mode, Editor.js in edit mode.
  JSON-stringified native Editor.js documents are detected by shape and
  promoted to native block data on edit; ordinary long/multi-line strings are
  deliberately not content-classified.
- Added focused Node regression tests for native/stringified document
  detection, ordinary multi-line strings, malformed lookalikes, and empty
  documents. Browser QA covers both conversion directions and the original
  Enter reproduction at desktop/mobile sizes.
- Same-representation external replacements (Paste/template/undo/remote sync)
  now remount Editor.js without treating rapid parent echoes as replacements,
  preventing stale blocks from overwriting newly applied data.
- Rich-text SSR and browser rendering now share one deterministic inline-markup
  allowlist. Executable/local URL schemes, unsafe element contents, double
  decoding, excessive nesting, non-string payloads, oversized auto-detection,
  deep lists, huge tables, and unbounded previews are rejected or capped while
  leaving the stored value intact.
- Final validation: 25 focused tests, targeted ESLint with zero errors, the
  full Vercel-output build, and live desktop/mobile browser passes for Enter,
  both datatype conversions, JSON-string detection, rich view hydration,
  Editor.js toolbox interaction, full-page scroll, and horizontal overflow.

## Round 7 — Editor.js chrome + heading rendering

- Removed the Editor.js document path from `.atomicValue`'s computed two-axis
  scroll container. Toolboxes, block settings and nested conversion popovers
  can now extend beyond the value row instead of being cut off at its 96px
  height.
- Wide editors reserve and align a 58px in-card action gutter, so both the `+`
  toolbox button and six-dot block-settings button stay inside page clipping
  boundaries. Editor.js narrow mode remains untouched and continues to show
  both buttons above its mobile bottom sheet.
- Header levels share one clamped H1-H6 visual scale. Edit mode explicitly
  restores size and weight after Chakra's heading reset; read-only rich-text
  rendering now emits semantic `h1`-`h6` elements instead of paragraphs.
  The Header tool and Markdown conversion now retain all six levels rather
  than downgrading stored H5/H6 blocks when they are edited.
  Validated Style Tune font sizes are forwarded through a scoped CSS variable
  so a person's explicit custom size still wins over the level default.
- Regression coverage now checks hostile/default/clamped heading levels and
  descending font sizes. Live QA at 1560px and 390x844 exercised the `+`
  toolbox, six-dot settings, nested **Convert to** menu, the H1/H2/H4/H6 edit
  hierarchy, semantic H2/H6 view rendering, a 44px custom heading override,
  full-page mobile scrolling and zero horizontal overflow.

## Round 8 — multiline Editor.js textbox keyboard boundaries

- Traced the quote jump to Editor.js core decomposing multiline
  `contenteditable` fields into logical inputs. An empty internal line was then
  misidentified as the start or end of the whole block, so Backspace and arrow
  keys moved focus into another input or the previous Editor.js block.
- Added a field-level keyboard guard for Editor.js `cdx-input`
  contenteditables. Backspace/Delete retain browser editing, while arrow keys
  use the browser Selection API before the event reaches Editor.js's outer
  block-navigation listener. True field starts/ends still reach Editor.js, and
  the guard is intentionally narrower than all editables, leaving paragraph,
  header, list, checklist, table, and native textarea behavior under their
  existing owners.
- A MutationObserver binds the same behavior to dynamically inserted tool
  fields and removes listeners for deleted fields, covering quote, warning,
  image-caption, and embed-caption inputs without leaking detached blocks.
- Added focused regression tests for every protected deletion/navigation key,
  unaffected Editor.js keys, normal block editables, and invalid event targets.
  Live QA reproduced the recording at 1280px and 390x844: Enter created an
  empty quote line; Up, Down, and Left stayed in the quote; Backspace removed
  the line with focus still in the quote. Both viewports completed full-page
  scroll checks with no horizontal overflow or new console errors.

## Round 9 — ordered Editor.js autosave + fast persistence

- Removed the duplicate **Checklist** row by filtering only List v2's
  `style: 'checklist'` toolbox alias. The legacy Checklist tool stays registered
  as the direct insertion/conversion target, so existing block data and the
  current plain-text parser remain compatible.
- Editor.js saves now enter an ordered change queue: each requested snapshot
  starts immediately, resolves in request order, and suppresses only adjacent
  structural duplicates. Returning from `A` to an earlier `A` remains a real
  edit. Failed or teardown-time saves cannot stall later changes. Snapshot
  sequence numbers span keyed tool-config remounts, so a late old editor cannot
  overwrite a newer current-editor change; batched parent echoes also retire
  skipped signatures without swallowing a later real undo/external replacement.
- Split autosave into two lanes. Thingtime applies every distinct editor/input
  update and records its timeline event immediately, while a latest-revision
  coordinator defers whole-root `flatted.stringify()` and LocalForage work until
  350ms idle, with a 2s maximum wait. Writes are single-flight; an edit that
  arrives during a write drains as the newest revision afterward. Visibility
  and page-hide transitions flush pending work, failed writes remain dirty for
  retry, and the temporary pre-LocalForage hydration state is never saved.
  Storage read/parse failures stay in retrying hydration rather than exposing a
  session that silently cannot autosave.
- Moved the mutation queue from React state to a ref-backed microtask queue and
  removed full-root per-keystroke logs, MagicInput's unused global-context
  subscription/path work, and `useThingtime`'s unbounded browser debug snapshot
  retention. This removes the avoidable enqueue/dequeue renders and synchronous
  debugging work from ordinary text input without coalescing edit/history
  events.
- Regression coverage: 9 coordinator tests (debounce, max-wait, single-flight,
  lifecycle reuse, retry, newer-revision recovery, disposal), 3 evolving
  mutation-queue tests, 6 ordered-save tests (including baseline suppression
  and teardown draining), 4 parent-echo/cross-remount reconciliation tests, and
  3 toolbox filter tests. Live desktop/mobile QA confirmed one Checklist entry,
  durable reload after typing, 14–55ms automated key interactions, full-page
  scrolling, and no horizontal overflow at 390x844 or 1280px.

## Follow-ups (ideas)

- Mount FocusCardsViewer as the mobile presentation of /things; Columns as a
  desktop editor mode; Form as the Edit presentation.
- Feed integration: `<RenderThing thing={post} fallback={<PostCard/>}/>`.
- "Turn into…" kind stamping in the Thing Context Menu; user-defined templates
  stored as `element` things.
