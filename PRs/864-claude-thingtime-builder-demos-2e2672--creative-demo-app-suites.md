# PR #864 — Five creative builder demo app suites

- PR: https://github.com/lopugit/thingtime/pull/864
- Branch: `claude/thingtime-builder-demos-2e2672` → `develop` (from `main` 9c0f4ea17)
- Date: 2026-09-21; author: Claude (AI), on a `/loop` request from the owner:
  "build a suite of demo apps for Thingtime using the builder, demonstrating
  all builder features … a todo app is fine, but try some other more creative
  demos like a pokemon clone with unique png creatures".

## What shipped

Five installable app suites in `remix/app/schemas/appSuites/`, registered
in `appSuites/index.ts` and listed on the 📱 Apps tab of `/builder/demos`:

| Key | App | Pages |
| --- | --- | --- |
| `dusted` | ✅ Done & Dusted — todo | `/p/dusted`, `-done`, `-task` |
| `thingmon` | 🔮 Thingmon — creature collector | `/p/thingmon`, `-team`, `-dex`, `-species`, `-shop`, `-keeper` |
| `snapquest` | 📸 Snapquest — photo scavenger hunt | `/p/snapquest`, `-challenge`, `-gallery` |
| `branchwood` | 📖 Branchwood — choose-your-own-adventure | `/p/branchwood`, `-journal` |
| `garden` | 🌱 Pixel Garden — time-based garden | `/p/garden`, `-shed` |

Builder features covered, by app:

- **Forms and uploads** — Done & Dusted's composer (text, select, date,
  textarea, `tt-upload` → `file` + `fileAttachmentId`) and Snapquest's claim
  form (`photo` + `photoAttachmentId`, refused without a file).
- **Source bindings** — every page binds components to actions; Pixel Garden
  uses `refresh: interval` (15 s) so growth ticks without a click; Done &
  Dusted's stats + board share one request.
- **Deep links** — `?filter=` / `?project=` / `?edit=` (todo), `?page=` /
  `?id=` (Thingmon dex + species), `?category=` / `?key=` (Snapquest) flow
  through `{query.*}` into source inputs and link chips.
- **Action grammar** — `things.search` with `where`/`match`/`sort`/`scope`
  (`own` and `system`), `things.get`/`create`/`update`/`delete`, `each` over
  child actions (clear done, rest the team, start over), `when`-guarded fails
  as branching (Branchwood), `compute` chains, `$now`, `$viewer`, and the
  expression catalogue (math, list lambdas, `pick`/`set`/`merge`, `dateDiff`
  / `dateAdd` / `isoDate` / `formatDate`, `seededInt`).
- **Domain packs** — the new `thingmon` pack (17 functions) behind `ttExpr`.
- **System content** — `BehaviourSuite.content` seeds public data things
  (60 species, 24 challenges, 22 scenes) that installed programs read in
  `system` scope.
- **Templates** — `ttEach` (grids, rows, move buttons with `{index}`),
  `ttIf` (`equals`/`op`), `ttMap` (type colours), `ttFormat`, `{last.*}`
  narration (the todo finder), per-row `fieldset` groups.
- **Media** — 60 generated PNG sprites served from `public/demos/thingmon/`
  and rendered `image-rendering: pixelated`, silhouetted until seen.
- **Install / fork model** — seeded copies are look-only; Install copies the
  bundle into the viewer's things; pages resolve the viewer's twin by key.

## Platform changes

- `schemas/appSuites/kit.ts`: shared theme/render/step/page helpers.
- `schemas/behaviourSuites.ts`: `SuiteContentDef` + optional
  `BehaviourSuite.content`; `api/utils/webpages/seed.ts` seeds it generically
  (`data-app-<suite>-<id>`, tagged `app`, `<suite>`, `content`, `<schema>`).
- `api/utils/actions/packs/thingmon/{rules,index}.ts` + `data/species.ts`,
  `packs/index.ts`, `packs.test.ts`, `schemas/actionExpressions.ts`
  (17 `thingmon.*` entries), `package.json` `test:action-packs`.
- `scripts/generate-thingmon-sprites.mjs`: deterministic 48×48 pixel-art
  generator (eight body archetypes, per-type palettes, stage features,
  outline + shading pass) → `public/demos/thingmon/<id>-<slug>.png` and the
  catalogue module. Re-running is a no-op unless the tables change;
  `--sheet <png>` writes a 3× contact sheet for review.
- `scripts/verify-demo-apps.mjs`: live e2e verifier (151 checks).
- `kit.gates` key the sign-in card on `viewer.signedIn`.

## Gotchas recorded

1. **Rolldown + JSON in this import graph.** A `.json` import from the pack
   produced `var init_species = __esmMin(...)` with no caller anywhere in
   the Nitro dev bundle, so `species_default.map` threw at first use and
   every API request 500'd. Pokeworld's JSON is wired correctly; the
   difference was never isolated. Emitting the catalogue as a `.ts` module
   fixed it; the generator now writes `data/species.ts`.
2. **Nested expression lambdas rebind `$item`.** `find`/`filter`/`map`
   inside another lambda cannot reference the outer element — three suites
   hit it (a challenge → capture lookup, a path → scene lookup, a bed →
   seed lookup). Index the list first (`pluck` + `indexOf` / `includes`) or
   `get` from a literal map.
3. **Seeded app pages are live for anonymous visitors** through the shared
   read-only runtime (`state: ok`, nothing of theirs), so a template gate on
   `state` alone renders the "start" form to someone who cannot write;
   gate on `viewer.signedIn` too.
4. **Object schema fields need `children`** (`Schema fields must be a list
   (fields.children)`); arrays need `items`.
5. A function named `useItem` in a pack trips `react-hooks/rules-of-hooks`
   when called from a non-hook — renamed `applyItem`.
6. The shared local `thingtime` DB sits at the 64-index cap; the live checks
   ran on a private replica set (`mongod --port 27119 --replSet rsdemos`) with
   `MONGODB_CONNECTION_STRING` on the PM2 worktree stack (web 17000, HMR
   17001, Nitro 17002) and `ADMIN_USERNAMES` for seeding.

## Verification

- Unit: `test:schemas` 196, `test:action-packs` 135, `test:webpages` 102
  (2 environment skips), `test:actions`, `test:components` — see the
  "unit groups" note below.
- Live: `TT_VERIFY_ADMIN_USER=… TT_VERIFY_ADMIN_PASS=… node
  scripts/verify-demo-apps.mjs http://127.0.0.1:17002` — 28 (dusted) + 48
  (thingmon) + 26 (snapquest) + 21 (branchwood) + 28 (garden) = 151 checks.
- Browser (in-app pane, 1280×1500 and default): Thingmon signed-out →
  sign-in card; signed-in seeded page → Install card → starter picker →
  Begin → zones → Explore → battle arena (sprites, HP bars, log, typed move
  buttons) → Leaf Nip turn → Shard crystal catch ("Gotcha!"); Team page
  (two party cards) and Dex page (silhouettes + revealed Sproutle); Pixel
  Garden install. No console errors from the app pages (the CSP noise is
  another worktree's `account-hints` origin).
- Lint: changed-file ESLint clean. Typecheck: the three new errors were
  fixed; the remaining count matches the base.

## Not done (owner scoped the task down mid-way)

Trivia arena, a builder feature-tour page and a Google-geocoding "map pins"
app were planned and not started. The `lookup` op and the site edit mode /
native blocks are therefore not exercised by these demos.
