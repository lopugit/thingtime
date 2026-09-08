# PR #291 — Components library: /components page, component thing kind, 1000-component catalog

Branch: `claude/schema-drawer-components-lib-441b3b` → `develop`
PR: https://github.com/lopugit/thingtime/pull/291

> **Status note (kept for archaeology).** This document describes the PR as
> originally shaped, when the catalog was committed into this repo. Since then
> the split below happened, so read it with that in mind:
>
> - The **runtime** (component kind, `/components` + `/components/:key`, browse
>   and admin-seed APIs, kind renderer, drawer entries, docs) landed on
>   `develop` in `34096584`, explicitly *without* the catalog.
> - The **catalog and its generator/validator/seeder** (`components-db/`,
>   `scripts/components-db/`) moved to the public repo
>   [lopugit/thingtime-components](https://github.com/lopugit/thingtime-components)
>   (`3f7af2af` pointed the docs there). It has since grown past the
>   1000 components in this title to 70 archetypes / 350 families / 2800
>   components; that repo's `components-db/index.json` is the source of truth.
> - What remains unique to this PR is the resolver hardening described under
>   the expansion budgets: `MAX_RESOLVED_NODES` **and** `MAX_RESOLVED_CHARS` in
>   `componentTemplate.ts`, plus its regression tests.

## Shape of the change

Three layers, one new first-class thing kind:

1. **`component` kind** (`remix/app/schemas/registry.ts`): crystal grammar
   `{ name, description, library (enum incl. custom), category, componentKey
   (slug), version, forkOf, previewBg, args[], savedArgs{}, render }`.
   - `render` reuses `sanitizeSchemaRender` (32KB / 600 nodes / 24 depth, no
     `$`-prefixed keys) — which is exactly why the template DSL uses
     `ttArg`/`ttMap`/`ttIf`/`ttMerge`/`ttRepeat` keys instead of `$`-forms.
   - `args` are bounded descriptors (≤16, types string/text/number/boolean/
     enum/color, defaults required by the generator, enum values capped).
   - NOT in PROTECTED_THINGTIME/MESSENGER_THINGTIME: user-creatable via the
     unified `POST /api/v1/things`, searchable, deletable, folderable.
   - `component-` joins the reserved shareId prefixes in
     `things.ts sanitizeShareId` (anti-squat for seeded ids).
   - Pin test entry in `builtinSchemaProjection.test.ts` (records drop:
     args/savedArgs/render).

2. **API family**:
   - `GET /api/v1/components/browse` — clone of schemas/browse with
     `thingtime:'component'`; extras: `lib=`/`category=` exact crystal filters
     on the no-q direct-query paths (superset-then-exact visibility, chrono
     cursors); decoration = reactionCounts/viewerReactions/saved/usageCount
     where usage = visible things sharing `crystal.componentKey` minus self.
   - `POST/GET /api/v1/admin/components/seed` — migration-grade system
     envelope (NOT createThing): `ownerId 'system'`, `storageClass 'control'`,
     `acl ['tt:all']`, `uniqueKeys [toBin('component:<slug>')]`, `$setOnInsert`
     upsert + genuine-doc refresh + foreign-doc skip. Fail-closed
     `components.seed` rate limit (30/min). GET = census `{ totalSeeded }`.
   - Registered in all 3 places (route files, `[...].ts` import map,
     `apiEndpointDocs` — which derives the Nitro route table + `-docs` twins +
     4 auto smoke tests).

3. **Client**:
   - `remix/app/components/ComponentsLibrary/` — `componentTemplate.ts` (the
     DSL resolver; canonical twin: `scripts/components-db/lib/resolve.mjs` —
     keep semantics identical), `componentBrowseTypes.ts`,
     `ComponentsBrowsePage.tsx` (grid default, library filter pills, feed/
     columns views, sort + all/mine/library scopes, per-user `tt-components-`
     cache, infinite scroll, optimistic react/save, Save-version panel).
   - Kind renderer `component` in `kindRenderers.tsx` (savedArgs over arg
     defaults → resolve → Html/Chakra renderer).
   - Drawer: `drawerMenu.tsx` — Schemas top-level (Browse + Reference docs),
     Components top-level (Browse + Schemas cross-link). The schemas→
     components cross-link was deliberately DROPPED because the drawer's
     pathname-sync scans items in order and an earlier exact child match
     would mis-highlight Schemas on direct /components loads.

## The catalog + generation pipeline

- `scripts/components-db/lib/tokens.mjs`: 8 library token sets (authentic
  palettes/radii/shadows/type/controls: antd, bootstrap, mui, shadcn,
  untitled, daisyui, reactflow, thingtime).
- 25 archetype builders (`lib/archetypes/*.mjs`), each `build(lib)` → exactly
  5 variants; slugs `<library>-<archetype>-<variant>`; 25 × 8 × 5 = 1000.
- `generate.mjs` validates (slug/name/description/tags/args caps, DSL shape,
  undeclared-arg refs, resolved-tree tag/prop allowlists, byte cap, AND the
  server's raw-JSON node accounting ≤580) and writes
  `components-db/components/<library>/<slug>.json` + `index.json` manifest.
- `seed.mjs` reads the folder db, logs in from untracked
  `scripts/components-db/.seed-env` (gitignored), batches 100/call.

## Debugging history worth keeping

- **Server node-cap semantics**: `checkSchemaRenderTree` counts EVERY raw JSON
  value (each style property value is a node), not just elements. The
  timeline-tracking variants hit 1201 nodes → seed skipped 8/1000. Fixes:
  (a) fixed success accent instead of a 6-tone `ttMap` nested inside every
  4-stage `ttMap`; (b) `perStage` compression (most-frequent value becomes the
  ttMap default, only differing stages listed) → 1201 → 731 → clean; (c) the
  validator now mirrors server accounting so this class is caught pre-seed.
- **Seed idempotency verified live**: first run 992 created/8 skipped; after
  the fix, re-run = 8 created/992 unchanged; final census 1000. Foreign-doc
  squat protection is in the update filter itself (`ownerId:'system'`).
- **Mobile pane quirk**: browser-pane touch emulation timed out on taps while
  JS interaction worked — layout verified via JS scroll + scrollWidth checks
  (no horizontal overflow at 375px). Not a page bug.
- **graphify**: local `graphify update` produced ~854k-line version-drift
  churn → discarded, source-only commit (established practice).

## Validation

- `node remix/scripts/verify-components.mjs http://127.0.0.1:16802` — 23/23.
- `node --import tsx --test app/schemas/builtinSchemaProjection.test.ts` — 54/54.
- `npm run test:things` — 6/6. Targeted lint clean.
- Live browser desktop + mobile: TESTING.md "Components" checklist run.

## Follow-on

A 10-minute loop continues catalog growth beyond 1000 (tranche 2: +5000
varied components target, stopping if the weekly usage quota exhausts), using
the same generate → validate → seed pipeline; each run is idempotent and
converges via the seed census.

## Round 2 (owner feedback): families + deep links

Owner feedback mid-session: the 8 library renditions of one component read as
duplicates, and components deserved their own pages.

- **familyKey** (`<archetype>-<variant>`) stamped on every component (crystal
  grammar + registry field + pin test + generator); the self-healing seed
  refreshed all pre-existing docs in place (1480 refreshed / 120 created in
  one run — the drift-refresh path did the migration for free).
- **Grouping**: `group=family` aggregation ($group on familyKey over the
  visibility superset, exact-check on representatives, designs roster with
  house-style-first ordering) + `family=` roster fetch that also resolves a
  componentKey slug by expanding to its family. Plain catalog groups
  server-side; q-search collapses client-side (`collapseEntriesByFamily`);
  lib-filtered/popular/mine/library views stay per-design.
- **Cards**: designs pill row swaps the active rendition in place (args tweaks
  survive the switch via defaults-merge); Docs button →
  `/components/<key>/docs`.
- **Detail pages**: `/components/:key` (+ `/docs` twin scrolled to Docs) —
  design switcher with `?design=` deep links, big preview, args tester,
  copyable deep links, args reference, create-via-API snippet, definition.
  `:key` resolves familyKey | componentKey | `component-<slug>` shareId.
  (The requested `/things/<slug>/docs` shape was landed as
  `/components/<key>/docs` instead — deeper `/things/*` paths belong to the
  ThingtimeUrl tree viewer, and fighting that catch-all for component pages
  would have special-cased the things namespace.)
- **Debugging**: a blank /components with `NotFoundError: removeChild` React
  crashes after the edit storm turned out to be stale-HMR corruption — real
  loads crashed while the module graph settled, then both full loads and SPA
  navs rendered clean; the templates themselves were exonerated via the
  detail pages. Also: `family=` by componentKey originally returned just that
  one design (caught by the extended verify suite, now 30 checks).
