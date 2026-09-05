# Subspaces 🪐 — Reddit-style communities + up/down votes 🔼

Branch `claude/subspace-communities` → `develop`. Requested by Lopu on
2026-09-05: "a duplicate of all reddit subreddit features with moderation,
flairs, post titles, content, subspace creation by users, subspace branding,
subspace joining… upvote/downvoting but keep all native Thingtime post
interaction types like reactions/multi reactions — add upvote/downvoting as a
separate focused limited reactions type."

## What shipped

### Data model (everything is a thing — FUNDAMENTALS §3)

| kind | doc | uniqueness / index |
| ---- | --- | ------------------ |
| `subspace` | `crystal { slug, name, description, access: public\|restricted\|private, nsfw, rules[], flairs[], branding{icon,iconUrl,bannerUrl,accent} }`, `acl ['tt:all']`, owner = creator | root `uniqueKeys` `subspaceSlug:<slug>` (no new index) |
| `subspace-member` | `targetId` = subspace, `ownerId` = user, `crystal { memberKey, role owner\|moderator\|member, approved, banned, banReason, banUntil, left }` | `uniqueKeys` `subspaceMemberKey:<subspaceId>:<userId>`; control-plane storage (unbilled) |
| `subspace-modlog` | `targetId` = subspace, `ownerId` = acting mod, `crystal { action, postId, userId, reason, detail }` | control-plane storage |
| `updown` | `targetId` = post **or comment**, `crystal { direction up\|down, updownKey }`, `acl ['tt:inherit']` | `uniqueKeys` `updownKey:<targetId>~<userId>`; cascades with its target |
| post | `crystal.title` (≤300), `crystal.subspaceId`, `crystal.flairId`; root `subspaceMod { status, removedById, removedAt, reason, pinned, locked, nsfw, spoiler }` (server-only) and root `subspacePrivate` fence | **one** new partial index `things_subspace_posts` on `{ 'crystal.subspaceId', createdAt, shareId }` |

None of the new kinds has a generic crystal sanitizer → `/api/v1/things`
refuses them (403); they're excluded from own-things listings and generic
DELETE like the messenger family. Rankings use the relational tallies over a
bounded newest-first window (the ranked home-feed pattern) — no denormalized
score field.

### Server

- `api/utils/subspaces/subspaceCore.ts` — pure sanitizers (slug/rules/flairs/
  branding), ranking (`hot`/`top`/`rising`/`controversial`/`new` with pins
  leading hot+new), unit-tested.
- `api/utils/subspaces/gate.ts` — things.ts-safe half: membership lookups,
  `assertSubspacePosting` (run on every post create AND PATCH touching
  subspaceId/flairId), `assertSubspaceInteraction` (bans block comments +
  votes; locked posts 423 comments for non-mods, nested replies included via
  a root-post walk), feed clauses (removed + private fences), lean embeds.
- `api/utils/subspaces/subspaces.ts` — create/list/get/update/join/leave/
  members (add/remove/approve/unapprove/ban/unban/role)/moderate (remove/
  approve/pin/unpin/lock/unlock/nsfw/spoiler/flair)/modlog/feed.
- `api/utils/things/updownCore.ts` + `updown.ts` — tally + vote toggle
  (same/other-direction/clear semantics as poll votes), batched tallies.
- `things.ts` — `Viewer.subspaceRoles` loaded beside `friendIds`; `canView`
  fences `subspacePrivate` posts to active members/mods; `resolveRelated`
  aggregates `updown` for posts and every comment level; projection adds
  `title`, `subspace`, `flair`, `subspaceMod`, `votes` and REDACTS removed
  posts for non-authors/non-mods; `createThing`/`createPost`/`updateThing`
  run the gate; `getFeed`, `listUserPosts`, search, trending and RSS carry
  the fences.
- Endpoints (route + Nitro map + `apiDocs` + capability manifest):
  `/api/v1/subspaces` (GET/POST), `/get`, `/update`, `/join`, `/leave`,
  `/members` (GET/POST), `/moderate`, `/modlog`, `/feed`,
  `/api/v1/things/updown`. Rate-limit keys `subspaces.write`,
  `things.updown`; PAT scope `things.updown`. Contracts `api.things`,
  `api.things-feed`, `api.things-comment`, `api.things-user` → 1.2.0
  (additive fields).

### Client

- `/s` directory (search, Mine, create modal), `/s/:slug` (banner/icon/join,
  sort tabs + range, subspace-locked composer with title + flair, sidebar
  About/Rules/Flairs/Moderators, private wall), `/s/:slug/mod` (Queue,
  Members, Banned, Settings, Rules, Flairs, Log).
- `PostCard`: `🪐 s/<slug>` chip + flair chip + 📌/🔒/18+/⚠️ badges, title h2,
  "Removed by moderators" notice, the ▲ score ▼ `UpdownControl` beside the
  react button on posts and (compact) comments with optimistic
  `applyUpdownVote`, moderator menu group + flair submenu.
- `PostComposer`: `subspace` prop (locked chip) or a joined-subspaces select,
  title input, flair select; edit mode round-trips title/subspace/flair.
- Drawer: Feed ▸ Subspaces + a top-level Subspaces group; Settings →
  Subspaces 🪐 (vote pills on posts/comments, default sort) via the sync
  localCache tier.

## Verification

- `corepack pnpm --dir remix run test:subspaces` (pure ranking/sanitizer
  math), `test:schemas`, `test:things`, `test:messenger`, `test:collections`,
  `test:storage`, `test:pat-scopes`, `test:rate-limit`, `test:feed`,
  `test:feed-contract`, `test:client-errors`, `test:api-capabilities`, `test:nav`
  green.
- `node remix/scripts/verify-subspaces.mjs` — live walk through the real API
  (auth walls, create/dup/reserved slug, generic-CRUD refusal, join/leave,
  roles + roster visibility, title/flair posting rules, votes on posts +
  comments incl. flip/clear/one-per-user, all five sorts, remove → redaction
  → approve, pin, lock (423 incl. nested), flair by mod/author, mod log, bans
  (post/vote/comment/join blocked, pre-emptive, unban), restricted +
  private access (feed/home/direct-read fences, mod-added members), settings,
  capability manifest, cascade).
- Browser: see the run log in the PR description / TESTING.md checklists.

## Known limits (stated, not hidden)

- Subspaces can't be deleted or transferred yet (Reddit doesn't allow
  deletion either); owners can't leave.
- No join-request queue for private subspaces — mods add members by
  username; no user flairs (post flairs only); no per-subspace wiki/sidebar
  widgets beyond About/Rules/Flairs/Mods.
- Removal reasons are collected with a browser prompt in the card menu (the
  mod page has proper inputs for bans).
