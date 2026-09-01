# PR #485 — Design system alignment + block-based Thingtime builder

Branch `claude/thingtime-design-system-01d6ee` → `develop` ·
https://github.com/lopugit/thingtime/pull/485

One PR, three connected deliverables, built by a coordinated fleet (2 mapping
workflows totalling 7 reader agents, a 13-slice restyle workflow, and a
2-agent docs/tests workflow) with live-browser QA at every stage.

## 1 · Design system alignment

The audit (5-reader mapping workflow) found the canonical page idiom —
surface wash, safe-area + `--tt-nav-clearance` top padding, centred column,
mono eyebrow + animated rainbow h1 — hand-copied across ~15 conforming pages
with **no shared component**, and five distinct drifted top-clearance
variants (`py={24}`, `pt={{base:28,md:32}}`, `pt="90px"`, legacy 108px
`TopSpacing`, `marginY="200px"`) marking the off-system pages.

- `PageShell` / `PageHeader` primitives —
  `remix/app/components/Layout/PageShell.tsx` (+ `PAGE_TOP_CLEARANCE`).
- 13 restyle slices, each behavior-preserving and lint-clean: status,
  mongodb-status, tests (fixed a real desktop nav underlap), vercel, crypto,
  migrations, apps data, raw, ode, reset-password, branding_old cleanup, the
  catch-all tree-viewer shell (+ the phantom `--tt-positive-tint` →
  `--tt-positive-soft` fix), admin dashboard (segmented-control tabs) and all
  sub-panels (TierManager 939 lines / IntegrationManager / ModerationTab /
  AdminPanel / CIControlDashboard), plus the nit sweep (90px clearances,
  Chakra-gray fallback hexes, pink/teal colorScheme overrides).
- `/docs/design-system`: 1 → 5 entries (foundations, page-scaffold,
  brutal-button, thing-context-menu, builder-blocks); `/design-system`
  redirects there. All stories render offline from live `--tt-*` vars.

## 2 · The Thingtime builder

Everything-is-a-thing: a page is a `webpage` thing whose crystal embeds a
BOUNDED ordered block tree (component refs + per-block scalar args,
containers, text, native app-screen slots; caps 120 / depth 8 / 48KB — the
component precedent for bounded replace-on-write docs, deliberately NOT the
relational child-doc shape since blocks never accumulate). Composition
happens at the block layer: the client resolves each referenced component
thing through the existing arg-template DSL and draws it through the
sanitising allowlist renderers with one 600-node budget per block — the
component caps, the DSL, and its external components-db resolver twin are
untouched.

- Registry: `webpageSchema` + `sanitizeWebpageCrystal` + crystalSanitizers
  entry; `WEBPAGE_RESERVED_ID_PREFIX` in sanitizeShareId; projection pin
  test updated (59 passing).
- API (3-place registration + docs twins + rate-limit keys):
  - `GET /api/v1/webpages/resolve` — one page (by `id`, `path`, or
    `global=1`) + every referenced component in one batched query; per-ref
    priority exact-visible-shareId → seeded `component-<ref>` → viewer's own
    latest componentKey; viewer-owned site docs outrank system defaults.
  - `POST /api/v1/admin/webpages/seed` — deterministic server-side table:
    25 `webpage-route-<key>` docs (locked native block each) + the empty
    `webpage-site-global` doc; idempotent, genuineness-fenced upserts.
- Client (`remix/app/components/Builder/`): pure tree ops
  (`webpageBlocks.ts`, unit-tested 6/6), `WebpageBlocksRenderer` (same render
  path with and without builder chrome), `useWebpageDraft` (resolve + draft +
  save-or-fork + reset + save events for cache invalidation),
  `useBuilderChrome` (hover/select/insert/move shared by both surfaces),
  `BlockInsertMenu` (viewport-aware positioning; quick blocks + debounced
  `/api/v1/components/browse` search), `BuilderDrawer` (right-side, flush
  top/right/bottom, collapsible — Inspector pill reopens; per-type inspector
  with arg fields derived from component specs, ↑/↓ move, delete, page
  settings, public toggle), `BuilderPage` (/builder list incl. Global blocks
  entry + canvas), `SiteBlocksHost` (root-mounted; global blocks fetched once
  and memoised so navigation never re-renders them; per-route blocks split
  around the native block; injected-above pages get their subtree
  `--tt-nav-clearance` shrunk so the seam is a normal gap), `/p/:id` route,
  ✏️ edit pill.
- Trust: `/p/` and site blocks are ttAction-interactive only for the page
  owner (PreviewModal rule); site personalisations are private forks; system
  seeds are never mutated; `webpage` kind card registered in
  `registerCoreKinds` (tree-shaking-safe).

## 3 · Catalog eviction

`components-db/` (2800 components) + `scripts/components-db/` extracted from
PR #291 (588c68b8) into the new PUBLIC repo
**https://github.com/lopugit/thingtime-components** with an awesome-style
README; pipeline validated standalone (generate --check 2800/2800 clean) and
seeding converges against a live deployment (census 2800, all unchanged on
re-run). This repo's README repoints the fork-safe seeding steps at the new
repo. #291 can now be slimmed to nothing / closed.

## Debugging log (bugs found via GUI QA, all fixed in-branch)

1. `MAX_WEBPAGE_ROUTE_CHARS` TDZ — schema used caps declared later in
   registry.ts; moved the constants above the schema (caught by the
   projection pin test).
2. Insert menu opened off-screen near the viewport top (open-up heuristic
   ignored actual space); now measures spaceAbove/spaceBelow and clamps
   maxHeight.
3. Public toggle silently ignored on the update path (acl only sent on
   create); update now sends acl when the toggle changed, and meta edits
   (name/visibility) mark the page saveable on their own.
4. Closing the builder drawer exited the canvas (fatal on mobile where the
   drawer overlays it); now collapses with an Inspector reopen pill (clear of
   the DevKit bubble), and selecting a block reopens it.
5. Injected site blocks above a native screen doubled the nav clearance
   (~150px gap; first fix attempt clipped card content with a negative
   margin, second was net-zero); final fix overrides `--tt-nav-clearance`
   for the page subtree when blocks render above it.
6. Global-blocks session cache went stale after saves (module-level
   fetch-once); saves now broadcast `thingtime:webpage-saved`, listened to
   both in the always-mounted host (cache clear) and mounted views (in-place
   refetch).

## Validation

- `verify-webpages.mjs` 25/25 live; apiTests `webpages` group 9/9 live
  (CI-safe: no seed dependency); docs-twin smoke tests auto-generated.
- Unit: projection 59/59, things 20/20, components 16/16, actions 42/42,
  schemas 85/85, webpageBlocks 6/6, typecheck-ratchet 3/3; Vite client build
  passes; every touched file lint-clean.
- Live browser (desktop + 375px mobile): full builder loop, site edit fork on
  /status, global blocks on /feed + /docs + /admin, restyled-page sweep.

## Notes / follow-ups

- Site pages currently support one personalised fork per viewer per route;
  sharing personalised site pages is deliberately out of scope.
- HTML5 drag/drop works with a real pointer; automation can't synthesise it,
  hence the deterministic ↑/↓ controls (also the accessibility story).
- graphify: this worktree's CAS alias is a non-symlink; `scripts/graphify`
  refuses to run here (hit by all mapping agents). Graph refresh left to the
  canonical environment, per the #291 practice.

## Round 2 — Limitless full-bleed builder (owner feedback, same day)

Feedback: the containered canvas wasn't the goal — builder mode must work on
every page with the page rendering as its normal full-width self; "+ add
block" was hover-only (empty canvases looked dead); global blocks weren't
tangible on the existing UI.

Changes (commits 2d2a7c2e1, e03939289):

- **Site edit mode is now the primary builder surface, full-bleed**: the page
  renders exactly as normal (no container), block chrome overlays it, the
  drawer sits beside it (collapsible — ✕ collapses, 🧱 Inspector reopens,
  ✕ Done exits). Root-level authored blocks center at a readable 960px via
  the renderer's new insetNonNative; the native screen spans the viewport.
- **Dual-region editing**: the 🌐 global region (site-global doc — labelled
  "renders on every page", editable in place even when empty, with a note
  that nav/drawer/footer are Thingtime chrome) sits above the page region.
  One drawer serves both: selection is coordinated across regions (the
  region label shows which owns the selected block) and Save persists every
  dirty draft as the viewer's own fork.
- **Persistent insert zones**: empty containers and the end of the root list
  keep their "+ add block" visible — an empty canvas invites instead of
  looking inert.
- **Develop-environment seeding**: per the owner's go-ahead, a temporary
  ADMIN_USERNAMES bootstrap (Vercel env oWtLayuDiUUXc588, scoped to the
  develop custom environment only) lets the QA user run
  POST /api/v1/admin/webpages/seed on the shared develop DB; the env var is
  deleted right after seeding. Note: the pr-485 alias's /api is the SHARED
  develop environment — other deployments repoint it, so branch-endpoint
  probes must gate any preview API work (the seeded docs persist in the DB
  regardless).

## Round 3 — Squarespace-grade UX + pixel-identical native sections (owner feedback, next morning)

Feedback: nested add-block buttons untappable on mobile (overlapping zones +
iOS text selection); the add/block UI needed Squarespace-level friendliness;
native blocks should decompose into pixel-identical builder sections; QA 3h+
like a human QA'er.

### Touch/UX overhaul (commit a1da58cb5)
- Builder chrome is unselectable (user-select/touch-callout none, transparent
  tap highlight, touch-action manipulation) — no more iOS long-press
  selecting "+ add block".
- Insert zones are whole-strip tap targets (44px visible; always visible on
  coarse pointers); empty containers render a tall dashed DROPWELL that
  cannot collide with sibling zones (the screenshot bug); container frames
  ignore capture-clicks on nested chrome (found live: tapping a nested well
  selected the container instead of opening the menu).
- The insert menu is a bottom sheet under 640px (scrim, notch, safe-area,
  enlarged rows, no keyboard auto-pop).

### Native SECTION registry (commits ee5599fd6 → 6ad68f728)
The real answer to "convert everything inside native blocks": a registered
page declares its shell + an ordered list of standalone section components
(lazy-loaded; data via shared module-cached hooks). The ROUTE renders that
same list, the seed table seeds the same keys, the builder edits them — one
source of truth, pixel-identical by construction. Fully sectioned docs render
doc-driven in view mode (fork ordering/insertions/removals apply; the route
element is not mounted); full-bleed pages register their page-owned Shell so
doc renders keep their chrome.

Converted so far: **status** (4 sections), **home landing** (8 sections incl.
hero/demo/faq/footer — confetti + waitlist intact via a module store),
**welcome** (2 + WelcomeShell), **ode** (1 atomic Thingtime-tree section),
**mongodb-status** (3; blocking loader replaced by a shared hook that bridges
MongoEndpointConfig's revalidator signal). Remaining pages keep the
whole-page native path and convert incrementally with the same recipe.

### QA-found fixes this round
1. Container frames swallowed nested-chrome taps (capture-phase select).
2. Region-ambiguous zone testids (global vs page) — now prefixed.
3. Native sections were wrapped in width-100% Boxes in view mode, defeating
   page-owned centering (/welcome card hugged the left edge).
4. Sectioned compositions rendered inside the renderer's root column Flex,
   blocking shell layout — view mode now renders BARE inside shells.
5. Dropwell/zone flicker during draft resolve — the live page renders
   untouched until the draft lands.
6. Insert menu autofocus popped the mobile keyboard over the sheet.

Regression after each step: webpageBlocks 6/6, verify-webpages 25/25 (native
assertion updated for sections), apiTests webpages 9/9, client build ✓.

## Round 4 — Figma-layer styling + WYSIWYG + the "grid ×2" class of layout bugs (2026-08-31)

Owner QA on the pr-485 preview surfaced four bugs and three feature asks; this
round lands all of them.

### Fixes (QA-found)
1. **Nested blocks were unclickable** — `onClickCapture` runs OUTERMOST-first
   in React's capture phase, so an ancestor container always selected itself
   and stopped propagation before the clicked child's frame ever saw the
   event. Now the innermost frame containing the click handles it; ancestors
   let the event keep capturing down. Every nested block opens its inspector.
2. **Grid children landed in the wrong cells** ("grid ×2 + heading shows on
   the right; two blocks side-by-side impossible") — interleaved insert zones
   were rendered as SIBLINGS inside the container, so in a grid each zone
   consumed a cell (zone in cell 1 → first real block in cell 2). Grids now
   render blocks as direct cells with one trailing compact add-tile in the
   next free cell; the empty-grid dropwell spans all columns.
3. **Row children stacked vertically** — every block frame forced
   `width: 100%`, wrapping each row child onto its own line. Row children now
   flex (`1 1 0`, min-width 0) and row insert zones turned into slim vertical
   strips.
4. **Cramped/ghost whitespace** — the 🌐 Global strip sat flush against the
   navbar (+14px breathing room now, view + edit) and a white body bar showed
   between the global strip and the page region (collapsed transparent insert
   zones + shrunk nav clearance over the white body). The edit canvas now
   paints the surface wash.

### Features
- **Figma-style inspector for every block**: bounded per-block `css` record
  (kebab property → value) with dedicated Layout (width/height/padding/
  margin), Appearance (background/radius/border/shadow/opacity), Typography
  (size/weight/line-height/letter-spacing/color/align/family) panels and a
  raw `property: value` Custom CSS editor. Write gate bounds keys/values and
  rejects `expression()`, `@import`, `javascript:`, and non-https/relative
  `url()` targets (`webpageBlockGate.test.ts` + 12-check live-API script).
- **Inline WYSIWYG text editing**: click a text block and it edits in place
  (contentEditable, caret preserved across draft commits — the editor element
  stays a constant div because swapping the rendered tag mid-edit replaces
  the DOM node under the mount-only init effect and eats the text). Enter and
  Shift+Enter insert soft breaks; rich paste is kept; selecting text floats a
  B/I/U/S/link/clear toolbar (`styleWithCSS` so output is span styles). Rich
  text stores as `html` + plain-text fallback and renders ONLY through
  `htmlToNode` → `HtmlThingRenderer` (allowlist gained b/i/u/s/mark/sub/sup).
- **Media + HTML blocks**: `media` (image/video/audio; https or site-relative
  src; alt) and `html` (raw markup ≤ 20KB, sanitised at render — scripts,
  iframes, event handlers, and unsafe URLs never survive). Insert menu grew
  🖼 Media and 🧬 HTML quick blocks. Dropping OS files on any insert zone or
  dropwell uploads through the attachments multipart API and lands media
  blocks at the drop position (`/api/v1/attachments/content?id=…`).
- **Selection model**: re-clicking a selected block no longer toggles it off
  (clicking into text to edit must keep selection); Escape deselects.
- Editor.js remains the long-form editor elsewhere in the app; the builder's
  inline editing intentionally uses direct contentEditable (the request
  allowed either) — an Editor.js popup for long-form text blocks is a clean
  follow-up since the deps already ship.

### Component catalog seeding (dev DB)
The preview's component searcher showed "no components matched" because the
dev DB behind `*.previews.dev.thingtime.com` had zero seeded components. The
2800-component catalog (lopugit/thingtime-components) is seeded through the
real admin API (`POST /api/v1/admin/components/seed`, batches of 100) using a
throwaway `seedbot485` admin enabled by a branch-scoped `ADMIN_USERNAMES`
Vercel preview env var (scoped to `claude/thingtime-design-system-01d6ee`
only).

## Round 5 — media everywhere, Figma-parity controls, resizable drawer (2026-08-31)

Owner QA asks, all landed:
1. **Dropping an image on a media block opened it in the browser** — block
   frames had no file-drop handling outside grids, and nothing guarded the
   window. Now EVERY frame accepts file drops (media = replace src in place,
   container = into, other = after), and edit-mode window listeners
   preventDefault all file drags — unhandled drops upload + append to the
   page. ⌘/Ctrl+V with clipboard files uploads at the selection (only when
   files are present, so text paste into inputs/the inline editor is never
   hijacked; defaultPrevented pastes are skipped).
2. **Media inspector**: ⬆️ Upload file button (hidden file input →
   uploadToBlock) OR a URL field.
3. **Cut-off "imag/e" selects** — paired drawer fields sat in a rigid flex
   row that crushed selects below min-content; FieldPair wraps with a sane
   flex-basis/min-width.
4. **Drag-resizable drawer** — left-edge handle, width persisted in
   localStorage and broadcast via a custom event so the canvas padding
   follows live (useBuilderDrawerWidth), 280–720px clamp.
5. **Figma-parity property controls** — SidesControl (▢ uniform / ⬍⬌ axes /
   ⛶ independent writing the css shorthand), CornersControl (per-corner
   radius), BorderControl (style/width/color), ShadowControl
   (X/Y/blur/spread/color), SegmentedControl text-align, min-width/height.
   Pure shorthand math in figmaControlValues.ts with node tests
   (expand/collapse round-trips, rgba-preserving shadow parse).
6. **Align center did nothing** — align-self is invisible on a 100%-wide
   block and the wrong axis in grid cells. selfPlacement now shrinks aligned
   blocks to fit-content, adds justify-self for grids, keeps rows on flex.
7. **Editor.js rich editing** (second ask): 📝 Rich editor modal on text
   blocks (headers/lists/checklists/quotes/tables/code/images + inline
   marker/underline/code), doc↔html via editorJsHtml.ts — html remains the
   stored form and renders ONLY through the allowlist renderer; code blocks
   escape their contents. Double-click text inside a COMPONENT block edits
   the matching string arg in an inline popover (exact-match on the rendered
   text; drawer args remain the fallback).
8. **Double border on padded selected text** — the inline editor drew its own
   outline inside the already-outlined frame; removed.
9. **Muted placeholders** across all inspector inputs.

### Round 5 adversarial review (44-agent workflow) + fixes
A find→verify workflow (4 dimensions × 2-skeptic majority verification per
finding) confirmed 10 defects; all are fixed in 995a00f96 + 27dbc3231 except
one accepted low (double-click arg editing binds the FIRST arg whose value
matches the clicked text — ambiguous only when two args hold identical
values; the drawer remains the precise fallback). Highlights: inline editor
now syncs EXTERNAL html changes without eating the caret (rich-modal Apply
was silently reverted before); upload dedupe no longer swallows re-drops of
the same OS file (fresh lastModified clones + retiring consumed uploads +
15-min pending-target expiry); paste never steals from form fields/the
Editor.js modal; window drop guards respect claimed drops (Editor.js
preventDefaults but never stops propagation); Sides/Corners controls are
keyed per block and show raw shorthands in uniform mode (no hidden-value
destruction); calc()/rgb() survive the shorthand tokenizer; the drawer
resize handle stays reachable (content scrolls, not the shell). QA on
pr-485 via emulated input: drop-replace/paste-replace/window-append upload
E2E (real attachments, image decodes), align-center + padding persisted
through a save (source:user fork), component dblclick arg edit persisted.

## Round 6 — true-WYSIWYG canvas, inline Editor.js, wrap-with-block (2026-09-01)

Owner asks, all landed:
1. **Editor.js formatting now RENDERS** — the bug was not the pipeline but
   Chakra's global reset flattening native h1-h6/ul/blockquote/table to body
   text. RichHtmlView + richHtmlStyles.ts give rendered rich markup a real
   document scale (heading sizes identical to the Editor.js editing scale)
   and memoise htmlToNode per html string.
2. **Inline Editor.js everywhere text is edited** — selecting a text block
   mounts the full Editor.js editor in place (headings, lists, checklists,
   quotes, tables, code, inline formatting). Doc→html conversion runs per
   edit behind a lastEmitted echo guard; external html changes re-seed.
   The popup stays as the ADVANCED surface: drawer 📝 button + the new block
   right-click menu (shared RichTextModal). Component text args keep the
   simple double-click inline input.
3. **Wrap with block** — chip ⊞ shortcut and right-click → "Wrap with block"
   open a searchable drill-down (Column/Row/Grid). wrapBlock swaps the block
   for a container holding it, in place; duplicateBlock deep-clones with
   fresh ids. Containers are the only block kind with a children slot — the
   menu says so; a component "slot" arg is the future path for
   wrap-with-component.
4. **TRUE WYSIWYG** — every insert affordance became an absolutely
   positioned overlay strip on block seams (hover/drag to reveal, click to
   insert, drop to move/upload). Nothing edit-only participates in layout:
   measured block top/left/size are IDENTICAL across the edit/view toggle.
   The 🌐 Global label floats in the nav breathing band, the region
   separator is a zero-height line, the grid add-tile is gone (a cell's
   right seam appends), and the root's trailing affordance is a spacious
   dashed well (28px clear).
5. **Typing no longer fights the inspector** — ClampedNumberInput commits
   clamps on blur/Enter (max width/gap/columns), and uniform sides/corners
   inputs stopped trimming per keystroke.
