# 🦄 Handoff: Schema browser / builder / search-by-schema

**For the next chat.** A previous session (Fable 5 → Opus 4.8) started this and
had to hand off. Everything below is current as of 2026-07-12. Read this, then
`git checkout claude/schema-browser-builder` to continue on the WIP branch.

---

## 0. TL;DR

The owner (Lopu) wants **Schemas** to be a first-class platform feature. Two
prior features already shipped (both PRs open, green, mergeable, awaiting Lopu's
review):

- **PR #63** — the `/search` page (Commander-style MongoDB query builder +
  ranked text + search-by-schema prefill). Branch
  `claude/search-page-mongodb-query-154eb4`.
- **PR #65** — "everything is a thing": users, feed algorithms, themes,
  waitlist, and the schema catalogue all collapsed into the `things` collection
  (dual-era reads + admin migrations). Branch
  `claude/everything-is-a-thing-collections`, **stacked on** the search branch.

This new work is on **`claude/schema-browser-builder`**, **stacked on**
`claude/everything-is-a-thing-collections`. One commit so far: **`99c313f`**
(the "foundation" — see §3). No PR opened yet.

Branch topology (each stacked on the previous; ultimate base = `main`):
```
main
 └─ claude/search-page-mongodb-query-154eb4        (PR #63)
     └─ claude/everything-is-a-thing-collections   (PR #65)
         └─ claude/schema-browser-builder          (this work, no PR yet)
```

The **full design + plan lives in `claude-todo/13-schema-browser-builder.md`**
(committed on `claude/schema-browser-builder`). This file is the pointer; that
file is the spec.

> A recurring `/loop` cron drove earlier iterations but has been **cancelled** —
> do NOT expect a loop. If Lopu wants autonomous iterations again they'll re-run
> `/loop`. Work interactively unless told otherwise.

---

## 1. What Lopu asked for (verbatim intent)

1. **Dedicated `/schemas` browser path.** Today `/schemas` renders schema DOCS
   (`SchemasPage.tsx`). Move the docs to **`/docs/schemas`** (keep them intact),
   and make `/schemas` a **browser** page (UI feel ≈ `/search`). It should:
   - Fetch ALL platform schemas (system + UGC schema things, `thingtime:['schema']`).
   - Toggle between a **feed** (list/cards) view with pagination + infinite
     scroll, and a **grid** view (card-based, like the one-thing-at-a-time /
     "Focus" view) which itself toggles between **column** and **grid** layout.
   - For each schema that has a `render:` component / associated system-or-UGC
     kind viewer, show a **sample rendered view** populated with sample data.
   - Per-schema action buttons: **add to my library, create thing using this
     schema, search for things adhering to this schema, fork this schema, react
     to this schema**.
   - A **"Create a Schema" builder UI** — build arbitrarily complex + nested
     schemas, all field datatypes, with min/max on numbers, max char length,
     required, type constraints, text-field dropdown limited values, max array
     lengths, etc. (Use a Thingtime Schema validator — already built, see §3 —
     or Mongoose.)

2. **Add a simple version of the schema lookup/browser to `/search`.** Browse
   schemas in the same paginated system (top/recent/popular), select a schema,
   fill out a minimalist **Thingtime-component-like form** for property +
   **nested-property** value-refinement queries, then search all things adhering
   to that schema by those properties. Modern, minimalist, sleek, intuitive.

Style: Lopu loves minimalist, sleek, rainbow/unicorn-flavoured, optimistic UI.
Match the `/search` page's look (it's the reference).

---

## 2. Grounding (where things live — verified this session)

- **Schema thing model:** `thingtime:['schema']`, `crystal:{ name, description,
  fields }`. `schema` is NOT a protected kind, so anyone can publish one via the
  generic `POST /api/v1/things`. Reactions already work on schema things (they're
  things) via `POST /api/v1/things/react`.
- **Schema field model + validator:** `remix/app/schemas/registry.ts` —
  `SchemaThingField`, `SCHEMA_FIELD_TYPES`, `sanitizeSchemaCrystal`. **Extended
  this session** (§3) to support nesting + all constraints.
- **Render system:** `remix/app/components/Kinds/kindRegistry.tsx` — `RenderThing`,
  `getKindRenderers()` (categorized: Social/Media/Commerce/Planning/Knowledge),
  `resolveKindRenderer()`, render sizes `card`/`full`/`compact`. A schema whose
  id/kind resolves a renderer can show a sample render. Renderers register via
  `registerCoreKinds()` etc. (deferred, NOT side-effect imports — the app package
  is `sideEffects:false`, so side-effect registration ships empty to Vercel; see
  the comment in kindRegistry.tsx and the `sideeffects-false-registry` memory).
- **Current `/schemas` route:** `remix/app/routes/schemas.tsx` → `SchemasPage`
  (`remix/app/components/Schemas/SchemasPage.tsx`, the DOCS page — 3 sections:
  root / crystal / collection). Routing table: `remix/app/routes.tsx`.
- **`/search` page + schema prefill:** `remix/app/components/Search/SearchPage.tsx`
  (`builtinSchemaSources`, `applySchema`, `rowFromSchemaField`, `searchableField`).
  Search API: `remix/app/api/utils/things/search.ts` +
  `remix/app/routes/api/v1/things/search/_search.tsx`. It already accepts
  `thingtime:['schema']` to list schema things.
- **API conventions (IMPORTANT — see `AI_ALL.md`):** every new `/api/v1/...`
  endpoint must be registered in THREE places: the route file
  (`remix/app/routes/api/v1/.../_name.tsx` exporting `loader`/`action`), the
  import map in `remix/server/routes/api/[...].ts`, and an `apiEndpointDocs`
  entry in `remix/app/docs/apiDocs.ts` (documenting IS registering; also
  auto-generates two `-docs` smoke tests). Utils return
  `{ ok:false,status,error } | { ok:true,... }` unions; auth via
  `getCurrentUser(request)`; use `viewerOf` from `things.ts`.
- **Reusable exports in `remix/app/api/utils/things/things.ts`:** `toPublicThings`,
  `visibilityQueryFor`, `withMatch`, `asViewer`, `parseChronoCursor`,
  `chronoCursorClause`, `oldestCursorClause`, `viewerOf`, `Fail`/`fail`/`isFail`,
  `PROTECTED_THINGTIME`.
- **Read FIRST:** `AI_ALL.md`, `FUNDAMENTALS.md`. Repo rule: run
  `graphify query "<question>"` before grepping/reading source (there's a
  pre-tool hook enforcing it).

## Dev environment

- Local web app: PM2 app for this worktree on **port 13710** (Vite) / proxying
  Nitro. Start/restart with `npm run web-pms` from the repo root (NOT raw
  `pm2 restart`). `npm run web-ports` shows this checkout's ports. Mongo at
  `mongodb://localhost:27017/thingtime`. If two PM2 apps end up fighting the
  port (empty API responses), `npm run web-pms-stop` then `npm run web-pms`.
- Seeded test account: **`search.demo` / `SearchDemo!2026`** (register others via
  `POST /api/v1/auth/register`). NOTE: things-era users store credentials as a
  BinData `secure` blob; if you hand-poke Mongo, use the app's API, not raw writes.
- After code changes run `graphify update .` from the repo root to refresh the
  tracked graph. `remix/graphify-out` + root `graphify-out` are tracked; on merge
  conflicts under `graphify-out/` take ONE side then regenerate (see AI_ALL.md).

---

## 3. What's DONE (committed on `claude/schema-browser-builder`, `99c313f`)

**The "spine" foundation — compiles (esbuild-checked), backward compatible:**

1. **Extended schema field model** (`remix/app/schemas/registry.ts`):
   - `SCHEMA_FIELD_TYPES` now includes `object` (nested `fields`) and `array`
     (element described by `items`), alongside string/number/boolean/date/enum/
     string[].
   - `SchemaThingField` gained `required`, `minLength`/`maxLength` (string),
     `minItems`/`maxItems` (array/string[]), `fields` (object nesting), `items`
     (array element), keeping `values` (enum), `min`/`max`/`unit` (number).
   - `sanitizeSchemaCrystal` is now a **recursive, depth-bounded** validator
     (`MAX_SCHEMA_FIELD_DEPTH=5`, `MAX_SCHEMA_TOTAL_FIELDS=200`) via
     `sanitizeSchemaFieldDef`; preserves a `forkedFrom` lineage pointer. Added a
     local `isFail` helper.
2. **`remix/app/schemas/schemaTools.ts`** (NEW, pure — importable by client +
   server + docs):
   - `validateAgainstSchema(fields, crystal)` — runtime datatype-adherence check
     (the "Thingtime Schema" validator; validates real datatypes, never gates
     storage). Returns `{ok:true} | {ok:false, errors:[]}`.
   - `sampleForField` / `sampleForFields` / `sampleThingForSchema` —
     **deterministic** sample-data generators (no Date.now/random, so SSR +
     hydration agree) for the render previews.
   - `schemaFieldPaths(fields)` — flattens nested object fields to dotted crystal
     paths (`crystal.<a>.<b>`) for the search builder.

---

## 4. What's NEXT (not started)

In dependency order (spine → leaves). Detailed in `claude-todo/13`.

### Backend
- **Browse endpoint** `GET /api/v1/schemas?sort=recent|popular&q=&cursor=&limit=`
  (new `remix/app/api/utils/schemas/schemas.ts` util + route). List schema things
  (public + own), paginated, with per-schema `reactionCount` + `usageCount`
  (things adhering) + `viewerReacted` + `inLibrary`. Popular = sort by
  reaction/usage (candidate-window approach like the ranked feed). Register in
  the 3 places. **Was about to start this when the session ended** — the design
  is in claude-todo/13; reuse `toPublicThings`/`visibilityQueryFor`/`withMatch`/
  cursor helpers from things.ts.
- **Library (bookmark) + fork:** `library-entry` relation thing
  (`thingtime:['library-entry']`, `targetId`=schema shareId, owner-private) with
  toggle + list endpoints. Fork = client copies the schema's crystal, sets
  `crystal.forkedFrom`, and `POST /api/v1/things` with `thingtime:['schema']`
  (works today — schema isn't protected). React = existing `/api/v1/things/react`.
  "Search adhering things" = navigate to `/search` with the schema selected.

### Routing
- Move docs `SchemasPage` → **`/docs/schemas`** (add to the `/docs` route tree),
  repoint `/schemas` → new `SchemasBrowser`. Update `routes.tsx` + nav links
  (check `DrawerContent.tsx` / nav for `/schemas` links). Keep `/docs/schemas`
  in the docs nav.

### UI (independent leaves — safe to fan out to subagents once the browse
### endpoint + shared types + `useApi` additions land)
- **`SchemasBrowser`** (`/schemas`): feed(list/cards) ↔ grid(Focus-style,
  column/grid sub-toggle) toggle; infinite scroll + pagination; per-schema
  sample render (`RenderThing` + `sampleThingForSchema` when a renderer
  resolves, else a clean field-list preview); action buttons (library / create /
  search / fork / react). Reuse `CARD_STYLES` from `~/theme/card`, `useLopu` for
  toasts, `useApi`, `readLocalCache`/`writeLocalCache` (optimistic first paint —
  house rule: never flash a spinner when cache exists).
- **`SchemaBuilder`** ("Create a Schema"): recursive nested-field editor for all
  datatypes + all constraints (min/max, maxLength, required, enum dropdown
  values, maxItems…), a live preview (validateAgainstSchema + sample render),
  publish via `POST /api/v1/things {thingtime:['schema'], crystal:{name,description,fields}}`.
- **`/search` schema query:** inline browsable schema list (top/recent/popular),
  select a schema → minimalist Thingtime-component form for property +
  nested-property value refinement (use `schemaFieldPaths` for the nested paths)
  → compiles to the existing search `conditions` grammar and runs against
  adhering things.

### Ship
- Live-verify every flow in the browser (Lopu cares a lot about live UI
  verification — use the in-app Browser at `localhost:13710`). Update
  FUNDAMENTALS/apiDocs/CHANGELOG. `graphify update .`. Open a **stacked PR** on
  `claude/everything-is-a-thing-collections`. Then recursive self-review
  (the pattern used on #63/#65: fan out finder subagents, verify, fix, repeat) +
  a `PRs/<n>-...md` note.

---

## 5. House rules that bit us before (don't relearn the hard way)

- **Optimistic rendering always** — never flash a loading spinner when cached
  state exists (`~/hooks/localCache`, keys `tt-<domain>`). The `/search` page is
  the reference implementation.
- **All notifications via Lopu toast** (`~/components/Lopu/useLopu` — `useLopu()`),
  never raw Chakra `useToast`/`alert`.
- **All data access through the API + utils layer** — UI never touches Mongo.
- **`sideEffects:false` gotcha:** register renderers/anything via explicit
  deferred calls, never side-effect-only imports (ships empty to Vercel; dev
  looks fine). Verify with a client build + bundle grep if unsure.
- **Search text-index safety:** the `$**` wildcard text index tokenizes string
  fields — never let secrets become searchable. (Relevant if you touch search.)
- Standalone `tsc`/`eslint` have a broken baseline in this repo — use esbuild
  syntax-checks + the live Vite/Nitro app + browser as the real gates.
