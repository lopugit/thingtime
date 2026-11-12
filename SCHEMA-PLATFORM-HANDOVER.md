# 🦄 Handover: Schema platform (browse + build + search-by-schema)

**For the next chat (Fable 5, fresh account with usage).** Written 2026-07-13 by
Fable 5 → handed to Opus 4.8 for this doc after the Fable account hit its usage
limit mid-review. This **supersedes** the older `SCHEMA-FEATURE-HANDOFF.md`
(that one was written *before* the work started; this one is *after* build +
first review).

---

## 0. TL;DR — where things stand

The whole feature Lopu asked for is **built, live-verified, committed, and
pushed**. A high-effort code review then ran and surfaced **12 real findings**
(all CONFIRMED except one PLAUSIBLE race). **None are fixed yet** — the Fable
account ran out of credits during the review's verify phase. Your job: **work
through §4 (the fix list), re-verify live, re-review until clean, push.**

- **Branch (push target, do NOT create a new one):** `claude/search-page-mongodb-query-154eb4`
- **HEAD when handed off:** `de43a1e` — *"Refresh graphify outputs after merge"*
- **Working tree:** clean, in sync with `origin`. All code is pushed. Nothing lost.
- **Loop:** the `/loop` (every 10 min) cron from the original session was
  **cancelled** at handover (it was session-only and the account is out of
  credits). If you want autonomous iteration again, Lopu can re-run
  `/loop 10m …` — otherwise just work the fix list interactively.

Branch topology (each stacked on the previous; ultimate base = `main`):
```
main
 └─ claude/search-page-mongodb-query-154eb4   ← WE ARE HERE (PR #63). PR #65
    already merged in (everything-is-a-thing). Push here.
```

---

## 1. What Lopu asked for (verbatim intent) — all delivered

1. **Dedicated `/schemas` browse path.** ✅ `/schemas` is now a standalone
   browse/build page (feel ≈ `/search`). Schema *reference docs* moved to
   **`/docs/schemas`** (intact); old `/schemas#schema-<id>` deep links redirect
   there. Feed / Grid / Columns views, Newest/Popular/Oldest sorts,
   All/Mine/Library scopes, infinite scroll + Load more, optimistic first paint
   from the `tt-schemas` localCache. Platform (registry) + community schema
   things side by side. Each card: field chips, a **sample render** via the kind
   renderer registry (`RenderThing` + generated sample data), reactions (emoji
   picker), and **Add to library / Create a thing / Search things / Fork / Docs**
   actions.
2. **"Create a Schema" builder.** ✅ Arbitrarily nested field trees (object
   children, typed array items), all datatypes, per-type constraints (number
   min/max + unit, string maxLength, required, enum dropdown values, array
   min/maxItems). Live client validation mirroring the server, sample preview,
   fork prefill with `crystal.forkOf` provenance.
3. **Schema lookup/query on `/search`.** ✅ A paginated schema rail (find-a-schema
   input, Recent/Popular, more…) on the same `/api/v1/schemas/browse` system;
   selecting a schema prefills a **minimalist refinement form** (labeled rows,
   type-appropriate inputs, enum chips, ranges, nested dotted paths like
   `engine.thrust`) and runs a scoped property/nested-property search.
   `/schemas` deep-links in via `?schema=<shareId|builtin:kind>`.

Style Lopu loves: minimalist, sleek, rainbow/unicorn, **optimistic** (never
flash a spinner when cache exists). `/search` is the visual reference.

---

## 2. What was built (file inventory)

**New files:**
- `remix/app/schemas/tools.ts` — pure helpers (no react/mongo): `flattenSchemaFields`
  (field tree → dotted crystal paths), `describeSchemaField` (chip labels),
  `generateSampleFromFields` (deterministic sample data), `countSchemaFieldNodes`.
- `remix/app/api/utils/schemas/browse.ts` — `browseSchemas(viewer, query)`:
  newest/oldest (via `searchThings`), popular ($lookup reaction ranking),
  library (saved), mine (own); cursor pagination; `decorate()` adds
  reactionCounts/viewerReactions/saved/usageCount per entry.
- `remix/app/routes/api/v1/schemas/browse/_browse.tsx` — `GET /api/v1/schemas/browse`.
- `remix/app/routes/api/v1/things/save/_save.tsx` — `POST /api/v1/things/save`.
- `remix/app/components/Schemas/SchemasBrowsePage.tsx` — the `/schemas` page.
- `remix/app/components/Schemas/SchemaBuilder.tsx` — "Create a Schema" builder.
- `remix/app/components/Schemas/SchemaThingForm.tsx` — "Create a thing using this schema" modal form.
- `remix/app/components/Schemas/schemaBrowseTypes.ts` — client mirrors + card-source adapters.
- `remix/app/routes/docs/schemas.tsx` — the re-homed reference docs route.

**Modified files:**
- `remix/app/schemas/registry.ts` — **schema crystal v2**: recursive
  `sanitizeSchemaField` / `sanitizeSchemaFieldList` (depth cap
  `MAX_SCHEMA_FIELD_DEPTH=6`, total-node cap `MAX_SCHEMA_FIELDS=40`), new
  `object`/`array` field types + constraints (`required`, `maxLength`,
  `minItems`/`maxItems`, `children`, `items`), `forkOf`; new pure
  `validateValueAgainstFields`; new zero-field **`save`** crystal schema; local
  `isFail` helper.
- `remix/app/api/utils/things/things.ts` — `toggleSave`, `savedTargetIds`;
  `createThing` acl special-case (`save` → `['tt:user']` private); `deleteThing`
  cascade now includes `save` children.
- `remix/app/api/utils/rateLimit/config.ts` — added `things.save`, `schemas.browse`.
- `remix/app/hooks/useApi.tsx` — `v1.things.save`, `v1.schemas.browse`.
- `remix/app/routes.tsx` — `/schemas` → `SchemasBrowsePage`; `/docs/schemas` → docs.
- `remix/app/routes/docs/DocsLayout.tsx`, `remix/app/routes/docs/index.tsx` —
  nav/index links `/schemas` → `/docs/schemas`.
- `remix/app/docs/apiDocs.ts` — endpoint docs for `things-save` + `schemas-browse`
  (**this file is load-bearing for Nitro route registration** — see §5).
- `remix/server/routes/api/[...].ts` — routeModules keys for both new endpoints.
- `remix/app/components/Search/SearchPage.tsx`, `searchTypes.ts` — schema rail
  (paginated browse), `?schema=` deep link, refinement form, `flattenSchemaFields`.
- `remix/app/tests/api/apiTests.ts` — tests: `schemas-browse-newest/popular/library-guarded`,
  `things-save-guarded`.

---

## 3. Live verification already done (so you know the happy paths work)

Registered a throwaway user via the real API and drove the flows in the in-app
Browser (desktop + mobile 375px):
- Builder publish (via the actual UI form) → Lopu success toast. ✅
- API round-trip: publish nested schema (object children + typed array items +
  all constraints) → save/unsave toggle → react → mine/library filters →
  create a data thing with nested values → **nested-property search**
  (`engine.thrust ≥ 500 AND decks.label = bridge` → exact 1 hit) → usageCount=1. ✅
- Constraint rejections return 400 (min>max, array without items, over-deep). ✅
- Feed/Grid/Columns views, centering, mobile wrap, title not clipped. ✅
- `/docs/schemas#schema-post` anchor resolves; legacy `/schemas#…` redirects. ✅

**Seeded test account (created via `POST /api/v1/auth/register`):**
`schema.tester.940450` / `Rainbow-Unicorn-42!` — it owns the "Coffee Table" and
"Spaceship 47395" schemas already in local Mongo. (Note the memory: the local
`users` collection gets wiped by fixture runs; if you 401, just re-register a
throwaway user — never write Mongo directly.)

---

## 4. 🔧 THE FIX LIST — 12 review findings (do these next)

From a high-effort review (8 finder angles). Deduped below into **9 distinct
fixes** (findings 2≡11, 8≡10 are the same root). Ordered by severity. Line
numbers are approximate — re-locate before editing.

### FIX 1 — `crystal: { schema, ...value }` spread lets a field named "schema" clobber the scope tag  *(CONFIRMED; findings #2, #11)*
`remix/app/components/Schemas/SchemaThingForm.tsx:~299`. A schema field literally
named `schema` is legal (`SCHEMA_FIELD_NAME_PATTERN` allows it), and
`{ schema: source.name, ...value }` lets the user's value win → the created data
thing is invisible to schema-scoped `/search` and to `usageCount`, while the
toast claims success.
**Fix:** flip the spread to `{ ...value, schema: source.name }` so the scope tag
always wins. (Consider also reserving/omitting a field named `schema` in the
form, or renaming the tag key to something unwritable like the reaction-token
approach.)

### FIX 2 — applySchema forces an invalid/guaranteed-empty `kind` for builtins  *(CONFIRMED; findings #5, #7)*
`remix/app/components/Search/SearchPage.tsx:~652`. `applySchema` does
`setKind(source.key.replace(/^builtin-/, ''))`. For builtins `share`/`save` that
value isn't in the kind `<Select>` options → the dropdown shows "any kind" but
searches secretly filter `thingtime='share'`. For **protected** thingtimes
(`user`/`theme`/`feed-algorithm`/`waitlist`) `searchThings` `$nin`-excludes them
→ **guaranteed zero results** with a hidden stuck filter. `Clear filters`
doesn't reset `kind`.
**Fix:** only offer/scope builtin schema chips for *searchable* crystal kinds
(`post`/`data`/`comment`/`reaction`/`schema`); for those set kind, otherwise
don't force kind (or don't show the chip). Make `Clear filters` also reset
`kind`. Simplest: restrict `builtinSchemaSources()` to that searchable set, and
guard `setKind` to only values present in the Select.

### FIX 3 — schema-scope "locked chip" logic too broad  *(CONFIRMED; finding #9)*
`remix/app/components/Search/SearchPage.tsx:~958`. Any row with `field==='schema'
&& op==='eq'` renders as the immutable "shape · X" chip **whenever any schema
source is active**, including builtins (which never pin a schema row). So a
manually-typed `schema eq Table` row becomes uneditable and its X wrongly clears
the active builtin schema.
**Fix:** only render the locked chip when `activeSchemaSource?.origin ===
'community'` **and** this is the pinned row (track the pinned row's id, don't
match by field/op heuristic).

### FIX 4 — dotted field names blow past the search grammar's depth cap  *(CONFIRMED; findings #8, #10)*
`remix/app/schemas/registry.ts` `SCHEMA_FIELD_NAME_PATTERN` (~L834/869) allows
**dots inside a single field name** (`a.b.c`). Combined with 6 nesting levels,
`flattenSchemaFields` (`remix/app/schemas/tools.ts:~23`) can emit a path with
>6 dot-segments. The search grammar (`search.ts` `sanitizeFieldPath`,
`MAX_FIELD_DEPTH=6`) then 400s the **entire** prefilled search, and SearchPage
renders that row as a non-editable label so the user can't fix it. Same dotted
names can push `SchemaThingForm` crystals past `MAX_DATA_CRYSTAL_DEPTH=6` (400 on
create). The claimed "a schema can never describe a shape deeper than what can
be searched/stored" invariant does **not** hold.
**Fix (pick one, prefer the first):** disallow dots inside schema field-name
*segments* at author time (change `SCHEMA_FIELD_NAME_PATTERN` for schema fields
to `^[A-Za-z0-9_-]+$` per segment — nesting is expressed via `children`, not
dotted names), which restores the invariant everywhere. If dotted names must
stay, cap total segments in `flattenSchemaFields` output and make over-limit
prefilled rows editable (drop the locked-label branch for them) with a visible
hint.

### FIX 5 — `?schema=` deep-link resolution races the mount search  *(PLAUSIBLE; finding #1)*
`remix/app/components/Search/SearchPage.tsx:~668`. On landing at
`/search?schema=<shareId>`, both the mount `runSearch()` and the async deep-link
effect fire. If the search response lands first, `runSearch` replace-navigates
to `?q=…` (stripping `?schema`), which flips `urlSchema` memo to `''`, re-runs
the effect, and its cleanup sets `cancelled=true` — killing the in-flight
`things.get`, so the prefill silently never applies. Only community shareId
deep-links are affected (builtin branch is synchronous).
**Fix:** when `?schema` is present on mount, let the deep-link path own the first
search — gate/skip the mount `runSearch()` until the schema resolves; or resolve
the schema outside the cancellable effect (e.g. a ref-guarded one-shot that
doesn't re-run when `urlSchema` becomes `''`); or don't strip `?schema` in the
post-search navigate. `appliedUrlSchemaRef` is set before the await, so also add
a retry-on-resolve path.

### FIX 6 — Fork enum values with commas get split  *(CONFIRMED; finding #4)*
`remix/app/components/Schemas/SchemaBuilder.tsx:~78` joins enum `values` with
`', '` into one string; `compileDrafts` (~L127) re-splits on `,` with no
escaping. Server `sanitizeSchemaField` allows commas inside an enum value, so a
value `"wood, reclaimed"` becomes `["wood","reclaimed"]` on fork → silent enum
corruption.
**Fix:** store draft enum values as an array (chip editor / one-per-line
textarea), not a comma-joined string; stop round-tripping through `,`.

### FIX 7 — first schema-rail load never retries on failure  *(CONFIRMED; finding #6)*
`remix/app/components/Search/SearchPage.tsx:~633`. `schemasLoadedRef.current =
true` is set **before** the first `loadSchemas()` resolves and never reset; the
catch swallows failures. A rate-limited/failed first fetch → community schemas
stay empty forever (reopening the rail won't refetch).
**Fix:** set the ref to `true` only on success (inside the `resp.ok` path), or
reset it to `false` in the catch.

### FIX 8 — `browsePopular` runs (and discards) the count on every cursor page  *(CONFIRMED; finding #12)*
`remix/app/api/utils/schemas/browse.ts:~166`. The capped `countDocuments`
(`maxTimeMS:2000`) runs inside `Promise.all` on every page but the result is
discarded when a cursor is present (`total: cursor ? null : total`).
`browseMine` already skips it correctly.
**Fix:** skip the count query entirely when `cursor` is set (mirror
`browseMine`).

### FIX 9 — `usageCount` aggregates by non-unique schema *name*  *(CONFIRMED; finding #3)*
`remix/app/api/utils/schemas/browse.ts:~89`. `decorate()` groups data things by
`crystal.schema` (the display name), which isn't unique — two schemas both named
"Table" show each other's combined usage.
**Fix (choose):** (a) accept name-based semantics but relabel the UI as
`N things use "Name"` so it reads as name-scoped, and/or (b) stamp
`crystal.schemaId` (the schema thing's shareId) on data things at create time
(`SchemaThingForm`) and aggregate by that for precise per-schema counts. (b) is
the correct fix; it's a small data-model addition (the search-scope convention
can keep using the name for text search).

> After fixing, **re-run the review** (the workflow that produced these findings)
> and address any new survivors recursively, then commit + push. The review
> workflow script is at:
> `…/workflows/scripts/schema-platform-code-review-wf_40d682ac-4ba.js`
> (or just run `/code-review high` on the branch).

---

## 5. Grounding + gotchas (things that bit us — don't relearn the hard way)

**Dev environment (IMPORTANT — non-obvious):**
- This worktree's PM2 dev app + ports: **web 19140 / hmr 19141 / api 19142**,
  app name `tt-wt-sharp-lederberg-f361e8-19140-<time>`. Start/restart with
  **`npm run web-pms`** from the repo root — never raw `pm2 restart`.
  `npm run web-ports` shows this checkout's trio; `npm run web-pms-stop` stops it.
- **Node version:** Vite 8 (this branch) needs **Node ≥ 20.19 / 22.12** — I ran
  it under **v24.18.0**. The repo's default nvm is v12, and v20.18.0 fails with
  `ERR_REQUIRE_ESM` loading `vite.config.ts`. Prefix PATH:
  `export PATH="/Users/lopu/.nvm/versions/node/v24.18.0/bin:$PATH"` before
  `npm run web-pms` / any pnpm command.
- Mongo: `mongodb://localhost:27017/thingtime`.
- **Native binding gotcha:** a plain `pnpm install` left `rolldown`'s native
  binding missing (dev server crashed with `Cannot find module
  './rolldown-binding.darwin-universal.node'`). Fix was `corepack pnpm@10.12.1
  install --force`, then **restore the lockfile** (`git checkout` it) — see the
  pnpm-pinned-lockfile memory.
- **Lockfile:** `remix/` pins `pnpm@10.12.1` (lockfile v9). Use
  `corepack pnpm@10.12.1`, never bare pnpm — it downgrades the lockfile and
  breaks the Vercel build.

**Codebase rules (from AI_ALL.md / FUNDAMENTALS.md):**
- **API route triple-registration:** every `/api/v1/...` endpoint needs (1) the
  route file exporting `loader`/`action`, (2) a key in
  `remix/server/routes/api/[...].ts` `routeModules`, **and (3) an
  `apiEndpointDocs` entry in `remix/app/docs/apiDocs.ts`** — Nitro's prod route
  table is *derived from the docs*, so a missing docs entry = 404 in prod even
  though dev works. (Both new endpoints are registered in all three.)
- `withMatch(base, ...clauses)` in `things.ts` is **variadic** — pass clauses as
  separate args, NOT an array (an early bug in `browse.ts` did this and Mongo
  threw "the match filter must be an expression in an object"). Already fixed.
- All data access via the API + utils layer (UI never touches Mongo). Seed/test
  via the real API. Appended/child data is relational (own `things` doc, no
  unbounded embedded arrays) — that's why `save` is a child thing, not a field.
- All notifications via `useLopu()` (never Chakra `useToast`/`alert`).
- Optimistic rendering: seed first paint from `~/hooks/localCache` (`tt-<domain>`
  keys), never a cold spinner when cache exists.
- `sideEffects:false` trap: never register via side-effect imports (dev works,
  Vercel ships empty). The schema/kind registries use explicit named exports.
- After code changes run **`graphify update .`** from the repo root. On
  `graphify-out/` merge conflicts take ONE side then regenerate. Run
  `graphify query "<symbols>"` before broad greps (a pre-tool hook enforces it).
- **Verify live in the browser** before declaring done — Lopu cares about this;
  standalone `tsc`/`eslint` are unreliable here, Vite + the live browser are the
  gates. (Vite compiles a module on request: `curl
  http://127.0.0.1:19140/app/components/Schemas/SchemasBrowsePage.tsx` returns
  200 if it compiles, or the error text if not — handy quick syntax gate.)
- Long `git commit`/`gh pr` bodies: write to a file + `git commit -F file`
  (heredoc backticks can execute; the shell also aliases `cp` to an rsync
  wrapper — use `command cp`).

**Reusable exports** (`remix/app/api/utils/things/things.ts`): `toPublicThings`,
`visibilityQueryFor`, `withMatch`, `asViewer`, `viewerOf`, `parseChronoCursor`,
`chronoCursorClause`, `oldestCursorClause`, `savedTargetIds`, `Fail`/`fail`/`isFail`.

---

## 6. How to resume (checklist for the next chat)

1. `cd` into this worktree; `export PATH="/Users/lopu/.nvm/versions/node/v24.18.0/bin:$PATH"`.
2. `npm run web-pms` (from repo root) → dev on `http://127.0.0.1:19140`.
   (`npm run web-ports` if you need to confirm the trio.)
3. Read this doc + `AI_ALL.md`/`FUNDAMENTALS.md`. Run
   `graphify query "schemas browse SchemasBrowsePage SchemaBuilder search rail"`
   to orient.
4. Work **§4 fixes** top-down. After each cluster, verify live in the browser
   and hit the API from the browser console (`fetch(..., {credentials:'include'})`).
5. `graphify update .`, commit (merge-friendly messages), **push to
   `claude/search-page-mongodb-query-154eb4`** (never a new branch).
6. Re-run `/code-review high`; address survivors recursively until clean.
7. (Optional) delete this handover doc + the old `SCHEMA-FEATURE-HANDOFF.md`
   before the PR merges if Lopu doesn't want them in the diff.

Everything's in good shape — the feature works end-to-end; §4 is polish/edge-case
hardening. 🌈✨
