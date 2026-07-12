# PR #67 — Profile composer + Thingtime posts 🌀 + Filters ▸ Advanced search

- **Branch**: `claude/profile-feed-advanced-filters-5878aa`
- **Base**: `claude/search-page-mongodb-query-154eb4` (PR #63 — stacked; merge #63 first)
- **PR**: https://github.com/lopugit/thingtime/pull/67

## What shipped

1. **Profile composer** — `ProfilePage` renders the feed `PostComposer` in self mode,
   optimistic prepend + header post-count increment (`handlePosted`).
2. **Thingtime post type** — fourth `PostType` beside text/image/marketplace.
   - Composer tab mounts the real `<Thingtime>` editor over the global store branch
     `composerDraft` (localforage-persisted → drafts survive reloads). Seeded with
     `{ name: '' }` post-hydration only, so a persisted draft is never clobbered.
   - Server: `sanitizePostCrystal` validates `input.thing` through `sanitizeDataValue`
     (the bounded data-crystal walker, starting at depth 1) and stores it under the
     reserved `crystal.thing` key. `["post","data"]` stays forbidden — the namespaced
     key is what keeps the post whitelist closed (registry.ts comment explains).
   - `PublicPost.thing` projected in `toPublicPosts`; `PostCard` renders a read-only
     `ThingBlock` (flatten → indented rows, capped 24 rows / 4 levels).
3. **Filters ▸ Advanced** — `FeedFilters` grows an optional Advanced menu entry;
   `AdvancedFilters` panel renders between controls and composer on `/feed`, and behind
   an Advanced button on profiles (author-locked, user shortcut hidden).
   - Query-builder core extracted from `SearchPage` into
     `components/Search/searchBuilder.tsx` (`OPERATORS`, `compileRows`,
     `invalidNumberField`, `ConditionRowsEditor`) — SearchPage now imports it.
   - Applied searches call `POST /api/v1/things/search`; results are the API's full
     post projections rendered through the normal `PostList` pipeline. Simple filters
     (types/circles/date) pass through and keep narrowing.
4. **Search API shortcut params** (`app/api/utils/things/search.ts`):
   - `types` (era-aware `typeClause`, exported from things.ts), `circles`
     (`visibilityQueryFor`), `author` (username → ownerId; unknown → empty result),
     `minTextChars`/`maxTextChars` (`$strLenCP` over `crystal.text` falling back to v1
     root `text`, `$type`-guarded), `minReactions`/`minComments`.
   - Engagement thresholds use a **bounded candidate window** (400 newest/best-matching
     docs; embedded-era counts projected in the window aggregate; one `$group` per era
     for standalone + interim child docs; filter; offset-paginate). Mirrors
     `RANKED_CANDIDATE_WINDOW` determinism trade-off. Counts sum raw docs across eras,
     so a mid-migration duplicate can transiently over-count a *filter verdict*; the
     projected cards always show exact deduped numbers.

## Debugging log

- **Infinite re-render on profile**: `loadPage` depended on `api.v1.things.search`,
  which is memoized on `useAsyncFetcher()`'s identity → new identity per render →
  pager effect loop ("Maximum update depth exceeded", post list never rendered).
  Fixed with the Feed page's latest-ref idiom (`searchThingsRef`). The feed page never
  had the bug because it already routed all calls through `apiRef.current`.
- **Local dev DB churn**: the shared local `thingtime` db's `users` collection is
  periodically wiped/recreated by fixture runs (`ttx-*`, `fix-a-*` accounts). Mid-test
  our registered user vanished → "Unauthorized" on post + account switcher fell over to
  a surviving roster account. Not a code bug; worth knowing when browser-testing here.
- Verified live on the worktree stack (ports 12670/12671/12672), desktop + 375px mobile.
