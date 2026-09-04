# PR #578 — App suites: Pokeworld + StarsAlign on Thingtime

Branch `claude/builder-demo-library` → `develop`. This note covers the
apps-on-Thingtime round layered on the demo library: two real apps
(pokeworld.center, starsalign.today) rebuilt as installable **app suites** —
schema things + component things + action things + data things + builder
pages — and the platform pieces that were missing to make a composed page
behave like an app.

## What an "app" is here

An app suite is a behaviour suite with `pages[]` and `app` metadata
(`remix/app/schemas/appSuites/*.ts`, registered in `appSuites/index.ts`).

- **Install model.** The seeded system copy is look-but-don't-touch. A
  signed-in viewer installs the suite — `POST /api/v1/webpages/suites/install
  { key }` upserts every part into their own things by stable key (schema by
  name, component by componentKey, action by actionKey, page by pageKey,
  sample data by stamp), so re-installing after a catalog change updates in
  place and never duplicates. Their data things are theirs; nothing runs as
  anyone else.
- **Pages resolve by key.** `/p/<pageKey>` answers with the viewer's own twin
  ahead of the seeded copy (`resolveWebpage` in `api/utils/webpages/webpages.ts`).
  App pages are keyed `<suiteKey>` (entry) and `<suiteKey>-<page>`, so
  `/p/pokeworld` and `/p/pokeworld-pokedex` are the same URLs for everyone,
  before and after install.
- **Slugs.** App suites slug as `app-<suite>-<key>` (`suiteSlug`), demo suites
  keep `demo-`. Seeded ids: `schema-app-pokeworld-trainer`,
  `component-app-starsalign-today`, `action-app-pokeworld-move`,
  `webpage-pokeworld`, `webpage-starsalign-school`.
- **Public content.** Seeding (`POST /api/v1/admin/webpages/seed-demos`) also
  writes the app content as public system data things — 418 StarsAlign school
  entries (`data-app-starsalign-entry-<id>`) and 386 Pokeworld species
  (`data-app-pokeworld-species-<id>`). Installs never copy them; programs read
  them in public scope.

## Platform pieces added

### Page runtime (`components/Builder/webpageRuntime.tsx`)

- A component block may carry `source: { action, inputs?, refresh? }` (server
  gate in `sanitizeWebpageBlock`). The runtime runs it AS THE VIEWER (delegated,
  owner-only — exactly a ttAction click with no click) on load and again after
  any control run on the page reports, and the template sees `result`,
  `state` (`signed-out | not-installed | loading | ok | error | inert`),
  `error`, `last` (the most recent control run), `viewer`, `query` (URL
  params, `{query.id}`).
- Identical sources on one page share ONE request per version
  (`runtime.load`); the last result paints from `localStorage`
  (`tt-page-source:<page>:<block>`) before the fetch lands.
- ttAction clicks gather named form fields inside the same component root
  into the run inputs (a component with `<input name>` + a button IS a form),
  report the outcome, and honour result `message` / `title` / `silent` for the
  toast. Pseudo-actions `$refresh` (bump the runtime) and `$install`.
- `/p/:id` wraps pages in the runtime; seeded suite/app pages (crystal
  `suiteKey`) are live for signed-in viewers with install-then-run
  (`onUnowned`), and the not-installed state renders the app's own Install CTA.

### Templates (`componentTemplate.ts`, `HtmlThingRenderer.tsx`)

- Nested scope with dotted-path tokens (`{result.trainer.name}`,
  `{result.sky.0.signName}`), `ttEach` (per element, ≤160, scope `item` /
  `index` / `count` / `first` / `last`, `empty` fallback), `ttIf` ops
  (`eq ne gt gte lt lte in includes empty notEmpty`), `ttFormat`.
- Renderer allowlists form-field props (`name min max step maxLength required
  htmlFor selected …`) and svg `text/tspan/g/ellipse` + presentation props;
  fields render UNCONTROLLED (`value` → `defaultValue`) so people can type.

### Action grammar v2 (`schemas/registry.ts`, `api/utils/actions/execute.ts`)

- Ops: `compute` (bind a value), `things.delete` (own data things, new
  `things.delete` capability), `each` (child action per element, `$item` /
  `$index`, ≤20), `fail` (authored refusal). Any step takes `when`; a guarded
  `return` is an early exit.
- Values: `{ ttExpr: [fn, …args] }` over the closed catalogue in
  `schemas/actionExpressions.ts` — math, random (seeded too), logic
  (`if`/`and`/`or`/`coalesce` short-circuit), text, list with lambdas, object,
  date — plus the domain packs `astro.*` and `pokeworld.*`
  (`api/utils/actions/packs/`), which count as operations. Per-run
  expression budget (20k), list/string caps.
- Refs: `$viewer.id|username`, `$item`, `$index`. `id`/`values`/`list`/
  `message` may be refs or expressions.
- `things.search`: `scope: 'own' | 'public'` (public requires a schema),
  `where` (equality), `match` (case-insensitive substring), `sort`, `offset`.
  Seeded system schemas resolve by name.
- Caps: 40 steps, value depth 16, 100 ops ceiling (default 40); stored render
  templates 2000 nodes / 48KB / depth 48 (style keys count as nodes);
  `actions.run` 240/min (a D-pad press is one run).
- Inspector: new ops described; "No deletes" only when `things.delete` is not
  declared.

## The two apps

### StarsAlign (`schemas/appSuites/starsalign.ts`, pack `packs/astro/`)

Schemas `profile`, `entry`. Actions `today` (profile → `astro.today`: sky,
natal chart, transits written for you, whole-sign houses, the wheel geometry),
`save-profile` (create-or-update, refuses future dates), `set-place`,
`pick-city` (316 cities), `erase` (`each` → `things.delete`), `school`,
`school-section` (paginated), `school-search` (scored), `school-entry`
(public entry data things by `entryId`), `combos` (pairs + triple heading),
`combos-meta`. Pages `starsalign`, `-settings`, `-school`, `-school-section`,
`-entry`, `-combos`. The astro pack is a verbatim port of the original engine
on `astronomy-engine` (47 tests).

### Pokeworld (`schemas/appSuites/pokeworld.ts`, pack `packs/pokeworld/`)

Turn-based rebuild: every D-pad press is a `move` run (collisions, ledges,
surfing, field items, signs, the 12%/10% encounter roll); battles are one
action per turn (`battle-move`, `battle-ball`, `battle-run`, `battle-item`)
over the ported Gen III formulas (damage/STAB/crit/status/accuracy, the
four-shake catch formula, run odds). Schemas `trainer`, `pokemon`, `battle`,
`species`. Other actions: `state` (the screen), `start`, `add-pokemon`,
`interact` (surf), `heal`/`heal-one`, `set-lead`, `deposit`, `withdraw`,
`box`, `use-item`, `settings`, `set-location` (real lat/lng → the original's
Mercator block; legendary geofences apply), `toggle-badge`, `pokedex`. The
world is deterministic and procedural (no map API): seam portals keep
adjacent blocks consistent; tiles and sprites load from pokeworld.center.
Deviations: no real-time canvas/AR, no admin spawn-rule editor, no design
studio.

## Verification

- Unit: `npm run test:schemas` (138), `test:actions` (48), `test:webpages`
  (29), `test:components` (16), `test:api-capabilities` (4), packs (120):
  `node --import tsx --test app/api/utils/actions/packs/**/*.test.ts`.
- Live: `node scripts/verify-app-suites.mjs http://127.0.0.1:<web>` — 52
  checks (register → seed as admin → install both → play: start, wander into
  an encounter, battle turn, balls, run; pokédex, heal, party/box, teleport,
  badges, options; StarsAlign: today, save/update profile, city, place,
  search, section, entry, combos, erase).
- Local Mongo note: the shared dev `thingtime` DB sits at MongoDB's 64-index
  cap (other worktrees resurrect legacy `kind` indexes), which 500s
  registration. The e2e ran on a private single-node replica set
  (`mongod --port 27117 --replSet rsapps`) via `MONGODB_CONNECTION_STRING`.

## Round 3 — every card opens a dedicated live page

Request: "make all components / snippets / webpages etc. clickable so they
open a dedicated page which loads up their preview and a live interactable
version". There is no separate "snippets" surface; the card surfaces are the
components library, the builder demo library (sections, pages, component
compositions, behaviour suites, apps), schemas, `/things` tiles and
`/actions` cards.

### One live path

- `remix/app/components/Builder/liveComponent.tsx` — `useThingSource`
  (the data binding: runs `source.action` as the viewer on load, after every
  control run, and on an interval; localStorage-first paint; identical sources
  share one request per runtime version) and `LiveTemplate` (resolve + draw
  through the sanitising renderers + arm `onClickCapture` ONLY when
  `interactive`). `useBlockSource` in `WebpageBlocksRenderer` is now a thin
  alias, so a component renders live the same way inside a page, on
  `/components/:key`, on `/thing/:id`, and in the demo library.
- `useTtActionClicks({ onUnowned, confirm })` — the optional confirm gate
  runs before the delegated run. `useActionRunConfirm`
  (`components/Actions/ActionRunConfirm.tsx`) is the shared dialog: it names
  the action reference and inputs (the button label is never the source of
  truth), offers a per-action skip that lasts one page session, and lets
  pseudo-actions (`$refresh`, `$install`) through.
- Trust ladder (unchanged, now written down in one place): interactivity comes
  from ownership or platform curation, never from markup. Own thing → live,
  no confirm. Seeded platform/demo/app thing (reserved-prefix id, suite in
  `ALL_SUITES`) → live for a signed-in viewer with confirm + run-or-install.
  Stranger's thing → inert with a label. Browse cards and `/things` tiles are
  links, never armed; `UNTRUSTED_SAFE_KINDS` and the renderer allowlists are
  untouched.

### Surfaces

| Surface | Card → page | Dedicated page |
| --- | --- | --- |
| `/components` | whole card links to `/components/<deepLinkKey>`; card buttons stop propagation; previews inert | `/components/:key` gains a live pane (runtime provider, trust ladder, run-or-install for suite components, `?source=` data binding for source-driven components) beside preview + args tester + docs |
| `/builder/demos` | demo / suite / app cards link to `/builder/demos/<slug|key>`; Preview modal wrapped in the runtime provider (live for signed-in viewers); 🧮 Interactive chip | NEW `/builder/demos/:slug` — catalog-first paint, PREVIEW (inert + metadata rail) and LIVE panes over one block tree, app pages as tabs, Install / Open /p/ / Use template / Open in builder |
| `/schemas` | cards link to `/schemas/<builtin:id | shareId>` (`schemaDetailKeyFor`) | NEW `/schemas/:key` — header, field tree, on-create shape, render preview, INLINE create-a-thing (extracted from `SchemaThingForm`), "your things with this shape" |
| `/things` | `openThing` + `thingLink` route each kind to its page (`/p/`, `/thing/`, `/schemas/`, `/actions/`, `/post/`); tile titles are keyboard links; PreviewModal stays the quick-look | `/thing/:id` is the universal live page: component via `LiveTemplate`, webpage inline via `/api/v1/webpages/resolve`, action/schema link out, data through its schema render; back link honours `?from=` |
| `/actions` | cards are real links | (existing `/actions/:id`) |

### Verification

See the "Dedicated live pages" checklist in `TESTING.md`; unit groups
`test:components`, `test:webpages`, `test:schemas`, `test:things`,
`test:actions`; browser pass on desktop + 375px against the local stack.
