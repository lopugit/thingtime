# PR #63 — /search: MongoDB-grammar query builder + ranked text search + search-by-schema

- **Branch:** `claude/search-page-mongodb-query-154eb4`
- **PR:** https://github.com/lopugit/thingtime/pull/63
- **Author:** Claude (AI), 2026-07-12

## What shipped

The Commander search bar expanded into a full `/search` page: search any thing
by its real structured data (developer datatypes, not schema-gated), compose
complex multi-condition queries through a minimalist GUI, run Google-style
ranked text searches, and browse schemas whose fields prefill the builder.

### API

`POST/GET /api/v1/things/search` (`remix/app/api/utils/things/search.ts` +
`remix/app/routes/api/v1/things/search/_search.tsx`):

- Whitelisted operator grammar: `eq, ne, gt, gte, lt, lte, in, nin, exists,
  type, contains, startsWith, endsWith`; nested `all`/`any` groups (depth ≤ 3,
  ≤ 32 conditions).
- Injection-proof by construction: field paths validated segment-by-segment
  (no `$`; bare names auto-prefix to `crystal.<name>`; root whitelist `tags,
  thingtime, createdAt, updatedAt, shareId, targetId`), values must be bounded
  primitives (objects rejected → no operator smuggling), text operators escape
  to literal case-insensitive regex (raw user regex deliberately unsupported).
- Ranked text mode via the new weighted wildcard text index
  `things_text_search` (`ensureIndexes()`), `language_override: 'ttTextLanguage'`
  so user crystals containing a `language` key can never fail inserts. `q` and
  `conditions` compose.
- Audience model identical to the feed: DB superset (public + own) + exact
  per-doc acl check (`canViewInherited`) before projection; `tt:inherit`
  attached things only surface for their owner.
- Rate-limited via new `things.search` window (120/min default; anonymous
  keyed by hashed IP). Chrono cursors both directions; ranked mode pages by
  bounded offset (≤ 500). `total` count capped at 1000 with `maxTimeMS`.

### Data model

- New `data` crystal schema (`remix/app/schemas/registry.ts`): free-form
  bounded JSON crystals (key grammar = search grammar; depth ≤ 6, ≤ 400 nodes,
  arrays ≤ 100, strings ≤ 5000). Sanitizes FIRST when combined with typed
  schemas so e.g. `["post","data"]` can widen a crystal but never weaken the
  post sanitizer's invariants.
- New `schema` crystal schema: user-authored shapes (name, description, ≤ 40
  field defs with type/enum values/min/max/unit), published through the normal
  things API.

### UI

- `/search` (`remix/app/components/Search/SearchPage.tsx`): rainbow Commander
  -style input, builder rows (field w/ suggestions → operator → value widgets:
  enum chips, between ranges with unit hints, datatype select, exists/type
  pickers), match all/any, kind + sort selects, capped total readout, load
  more, optimistic first paint from the `tt-search` localCache tier, shareable
  `?q=` URLs (a new `?q=` resets stale filters), Lopu toasts.
- Search-by-schema panel: builtin crystal schemas + community schema things
  (fetched via the search API itself); picking prefills rows from field defs,
  community picks pin `schema is <Name>`.
- Commander (`CommanderV2.tsx`): pinned `🔍 Search things for "…"` row at the
  top of the suggestion dropdown (row 0; arrow/enter indices shifted by one).
- Drawer nav: top-level Search group + a Search entry under Things.

## Verification (live worktree stack, :13710)

- Structured example from the feature request: `legs ≥ 3 ∧ material ∈ {wood,
  concrete} ∧ height 60–130` → exactly the 2 matching seeded tables.
- Ranked `standing desk` → post + data things relevance-ordered; text +
  structure composed → exactly the walnut sit/stand desk.
- `heightAdjustable has type boolean ∧ is true` → the 2 `true` things;
  any-of groups verified; `$where` injection → 400 grammar error.
- Schema browse → Table prefill → chips/ranges → correct results; desktop +
  mobile (375px) screenshots taken; seeding done exclusively through the real
  API (FUNDAMENTALS §2).

## Debugging trail

- Fixed a TDZ crash introduced mid-build: naming `closeCommander` in
  `selectSuggestion`'s dep array evaluates before its declaration (it's fine
  inside the closure body). Console errors that persisted afterwards were a
  stale HMR module; a hard reload confirmed the fix.
- Browser-automation note: the Commander's key handling matches `e.code`,
  which synthetic automation keys leave empty — keyboard-row selection can't
  be driven by the in-app browser tools (real keyboards are unaffected); the
  click path verifies the row end-to-end.
