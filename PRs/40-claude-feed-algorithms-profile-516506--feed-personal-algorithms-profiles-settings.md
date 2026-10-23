# PR #40 — Feed with personal doomscroll algorithms, full profiles + dedicated settings

- **Branch:** `claude/feed-algorithms-profile-516506`
- **PR:** https://github.com/lopugit/thingtime/pull/40
- **Author:** Claude (AI), 2026-07-08

## Summary

Adds the Facebook-style `/feed` (text / image / marketplace posts with
reactions, comments, shares), per-user doomscroll-trained **feed algorithms**
(multiple, branched, sessioned, switchable), a full `/profile` page (banner,
bio, avatar, posts feed, public view at `/profile/:username`) and a dedicated
`/settings` page.

## Data model

| Piece | Where | Notes |
| --- | --- | --- |
| Feed posts | `things` collection, `kind: 'post'` | `shareId` is the only exposed id; types `text` / `image` / `marketplace`; circle visibility `public/friends/family/private`; embedded reactions map + comments array; `shareOfId` always points at the **root** post |
| Algorithms | new `feedAlgorithms` collection | `weights: { types, tags, authors }`, `parentId` lineage for branches, `eventCount`, `lastTrainedAt` |
| Active algorithm | `users.meta.activeFeedAlgorithmId` | same pattern as `meta.activeThemeId`; `null` = Latest (chronological) |
| Profile fields | `users` top level | `bio`, `avatarUrl`, `bannerUrl` (http(s)/data:image only); new stripped `toPublicProfile` projection for other-user reads (never email) |

## API surface

- `/api/v1/things` (POST create) + `/feed` `/user` `/react` `/comment`
  `/share` `/delete`
- `/api/v1/algorithms` (GET list / POST create with `branchFrom` + seed
  `events`) + `/update` `/delete` `/active` `/track`
- `/api/v1/users/profile` (GET public profile / POST update own)
- Registered in all three places: route files, `server/routes/api/[...].ts`
  import map, `nitro.config.ts` `apiRoutes`.

## Ranking + training (deterministic, `api/utils/things/feedRanking.ts`)

- Signals: view 0.5, dwell `min(ms/4000, 3)`, expand 1.5, react 2, comment 3,
  share 4; batch decay ×0.995; weights clamped ±50.
- Score: `(1 + max(0, interest)) / (1 + ageHours/24)`; ties broken by
  createdAt desc then shareId. Ranked feeds page by offset over the newest
  400 filter-matching posts (lean projection, full docs fetched per page).

## Seeding (FUNDAMENTALS §2)

`POST /api/v1/mongodb/populate` → `setup.ts` seeds 8 personas, profiles,
24 posts, 18 reactions, 10 comments and 2 demo algorithms for rick.deckard
("Brick by brick 🧱", "Tinfoil times 👁️") **through the same utils the routes
call**. Idempotent: fixed post `shareId`s (409 → skip), interactions only on
newly created posts, profiles only when unset, algorithms skipped by name.

## Adversarial review (24 agents: 4 lenses → refuters per finding)

20 findings confirmed, 0 refuted, all fixed in-branch before the PR:

1. Compound indexes now include the `shareId` sort tiebreak (index-provided page sort).
2. Ranked/training paths use a lean feature projection; page slice re-fetched by id.
3. `algorithms.remove` chains root-data refresh (deleting the active algorithm no longer strands `/feed`).
4. Share-of-share resolves to the root post; nested shares always carry content.
5. Streamed `readJsonBody` 413 caps on all seven previously-unguarded mutation routes.
6. Feed author embeds slimmed to `FeedAuthor` (id/username/displayName/avatarUrl) — no bio/banner data-URIs per post/comment.
7. Algorithm list labels authors with one batched users query (was N+1).
8. Engagement queue lives in refs (`sessionEventCount` + `getSessionEvents()`); PostCard memoised.
9. Engagement observer prunes disconnected card nodes.
10. Reactions use targeted `$pull`/`$addToSet` (never rewrites other users' arrays).
11. `isShare` flag + "Original post unavailable 🌫️" placeholder for deleted originals.
12. Composer allows $0 (free) listings.
13. `[null]` entries in event batches are sanitized (400, not a raw 500).
14. Deleting a share decrements the original's `shareCount` (floor 0).
15. Seed re-runs never clobber profile edits.
16. (dup of 12 via second lens)
17. Sharing a non-public original never inherits its tags.
18. `listUserPosts` counts only on the first page.
19. Profile route uses `countPublicPosts` util (no direct collection access from routes).
20. Save-session toast reports the server-applied event count.

## Verification

- Live desktop + 375px mobile walkthroughs (worktree dev stack, seeded db):
  filters, algorithm switching (feed visibly re-ranks between "Brick by
  brick" and "Tinfoil times"), reactions/comments/shares/composer round
  trips, track flushes on an 8s cadence + sendBeacon on hide, 413/400 guards.
- 20 new in-app API tests under `things` / `algorithms` / `profile` groups —
  16 non-mutating ones executed against the live server (all pass), mutating
  ones exercised manually via curl.
- `tsc --noEmit` clean for all new/changed files. ESLint remains broken
  repo-wide (pre-existing `@remix-run/eslint-config` / pnpm `eslint-scope`
  packaging failure — occurs on untouched files too).

## Known scope edges

- No relationship graph yet: friends/family/private posts of other users are
  hidden from everyone but the owner (enforced server-side, documented).
- Images are URL-based (no upload storage layer); seeds use picsum/pravatar.
- Marketplace "message seller" is future work.
