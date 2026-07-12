# 13 — Schema browser, builder, and search-by-schema

Owner request (2026-07-12): make Schemas a first-class platform feature.
Branch `claude/schema-browser-builder`, stacked on
`claude/everything-is-a-thing-collections` (schema things from PR #65 + /search
from PR #63). Loop runs until fully implemented + reviews addressed recursively.

## Foundation (what already exists)

- Schema things: `thingtime: ['schema']`, crystal `{ name, description, fields }`.
  `fields` are FLAT today: `{ name, type, description?, values?, min?, max?, unit? }`
  where type ∈ string|number|boolean|date|enum|string[] — validated by
  `sanitizeSchemaCrystal` (registry.ts).
- Render system: `kindRegistry.tsx` — `RenderThing`, `getKindRenderers()`
  (categorized: Social/Media/Commerce/Planning/Knowledge), `resolveKindRenderer`,
  sizes `card`/`full`/`compact`. A schema whose id/kind matches a renderer can
  show a SAMPLE render populated with generated data.
- Schema things are searchable via `POST /api/v1/things/search {thingtime:['schema']}`;
  reactions already work on any thing (schemas included) via toggleReaction.
- `/schemas` currently renders schema DOCS (`SchemasPage.tsx`, sections
  root/crystal/collection). `/search` has schema prefill (`builtinSchemaSources`,
  `applySchema`).

## Plan

### Backend foundation (the spine — do first)
1. **Extend the schema field model** (registry.ts), backward-compatible:
   add types `object` (nested `fields`) + `array` (`itemType`/`itemFields`);
   add `required`, `maxLength`/`minLength` (string), `maxItems`/`minItems`
   (array), keep `min`/`max`/`unit` (number), `values` (enum). Extend
   `sanitizeSchemaCrystal` to recurse (depth-bounded, total-field-bounded).
2. **`schemas.ts` util module**: `validateAgainstSchema(schema, crystal)`
   (runtime adherence check — the Thingtime Schema validator), `sampleForSchema`
   (generate representative sample values per field for the render preview),
   `schemaFieldPaths` (flatten to dotted crystal paths for the search builder).
3. **Browse endpoint**: schema listing with sort `recent|popular|top` + search,
   paginated (reuse searchThings thingtime:['schema'] + a popularity signal =
   reaction/usage count). "Things adhering to a schema" = things whose crystal
   carries the schema's field paths (+ optional `crystal.schema == name`).
4. **Library (bookmark) + fork**: `library` relation thing
   (thingtime ['library-entry'], targetId = schema shareId, owner-private) with
   toggle + list endpoints; fork = create a schema thing copying crystal with
   `crystal.forkedFrom`.

### Routing
5. Move schema DOCS to `/docs/schemas` (keep intact); repoint `/schemas` to a
   new **SchemasBrowser** page. Update routes.tsx + nav links.

### UI (leaf components — fan out once the spine + shared types land)
6. **SchemasBrowser** (`/schemas`, feel ≈ /search): fetch all schemas paginated
   + infinite scroll; view toggle feed(list/cards) ↔ grid(Focus-style) with a
   column/grid sub-toggle; per-schema sample render (RenderThing + sampleForSchema
   when a renderer resolves); action buttons add-to-library / create-thing /
   search-things / fork / react.
7. **SchemaBuilder**: build arbitrarily nested schemas, all datatypes + all
   constraints (min/max, maxLength, required, enum dropdown values, maxItems…),
   live preview, publish via the API.
8. **/search schema query**: browse schemas (top/recent/popular) inline, select
   one, fill a minimalist Thingtime-component form for property + nested-property
   value-refinement, search adhering things. Sleek, minimalist.

### Ship
9. Live-verify all flows, FUNDAMENTALS/apiDocs/CHANGELOG, stacked PR, recursive
   self-review + fixes.

## Status
- [x] Grounding (schema model, kind renderers, routes, /search prefill)
- [ ] Extended schema field model + validator (IN PROGRESS)
- [ ] schemas.ts (validate/sample/paths) + browse/library/fork endpoints
- [ ] Routing move
- [ ] SchemasBrowser · SchemaBuilder · /search schema query
- [ ] Verify + PR + recursive review
