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
| `subspace-member` | `targetId` = subspace, `ownerId` = user, `crystal { memberKey, role owner\|moderator\|member, approved, banned, banReason, banUntil, left, pending (join request), approvalRequested (posting request) }` | `uniqueKeys` `subspaceMemberKey:<subspaceId>:<userId>`; control-plane storage (unbilled) |
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
  approve/pin/unpin/lock/unlock/nsfw/spoiler/flair)/modlog/feed, plus the
  owner-only lifecycle: `transferSubspace` (target must be an ACTIVE member;
  they become owner, the caller steps down to moderator, the subspace doc
  changes hands through `updateAccountedThing` so its bytes move ledgers in
  the same transaction; every write in that transaction is guarded by the
  ownership/membership the gate saw and `requireOwner` also checks the doc's
  `ownerId`, so two racing transfers commit at most once — the loser 409s;
  modlog `owner.transfer`) and `deleteSubspace` (`confirmSlug` must equal
  the slug; every post-shaped thing pointing at the subspace — plain posts
  AND rich `['post','comment']` things — is released in bounded accounted
  batches: `$unset` of `crystal.subspaceId` / `crystal.flairId` /
  `subspaceMod` / `subspacePrivate`, and posts of a PRIVATE subspace or
  posts the mods REMOVED additionally get `acl: ['tt:user']` so the owner's
  click never publishes them (`releaseKindFor` / `privatizedPostUpdate` in
  `subspaceCore.ts`); a batch that trips the accounted updater's
  `storage_conflict` is retried, and while any post still points at the
  subspace the call answers 409 with the doc intact (safe to retry). Then
  the subspace doc goes via `deleteAccountedThing` together with a
  `subspace-tombstone` row that keeps the slug's uniqueKey (previous owner
  may re-found at once, others after `SUBSPACE_SLUG_HOLD_DAYS` = 30 → 409
  "held"; `/s/<slug>` stays 404), then member + modlog (+ report) rows;
  returns `{ releasedPosts, privatePosts, removedMembers }`). Contracts:
  `subspaces-transfer` 1.0.1, `subspaces-delete` 1.1.0.
- Notifications (round 2): six `subspace-*` types in `NOTIFICATION_TYPES`
  (`subspace-join-request`, `-join-accepted`, `-post-removed`, `-report`,
  `-role`, `-ban`) with prefs rows, bell copy, email copy and CTA. Subspace-
  scoped rows carry the subspace shareId in `targetId` and lead their
  `preview` with `s/<slug> · …` (`subspaceNotificationPreview` /
  `subspaceSlugFromNotificationPreview` in `registry.ts`) so the bell and the
  email deep-link to `/s/<slug>`; post-scoped rows set `postId`. Emitted so
  far: `subspace-role` on promote/demote/transfer/deletion (former mods, bulk
  ≤200), `subspace-ban` on ban/unban. `subspace-join-request` and
  `subspace-report` default email OFF (mod-queue firehose).
- Join requests + posting-approval requests (round 2, S2): the member row
  carries two flags. `pending` = a join request to a PRIVATE subspace —
  `/join` on a private subspace files it (200, `{ joined: false, pending:
  true }`) instead of 403; it is NOT a membership (`isActiveMember` = row
  && !left && !banned && !pending, so the private feed, posting, `mine=1`,
  member counts and transfer-eligibility all exclude it); `/leave` cancels
  it; the mods are notified (`subspace-join-request` · "wants to join 🙋");
  `members?pending=1` (mods) lists requests newest first (a re-request
  restarts the row's clock); member actions `accept` (→ active, notifies
  `subspace-join-accepted`, modlog `member.accept`) and `deny` (row dropped,
  optional reason, modlog `member.deny`); a mod's `add` on a pending row
  accepts it too (same notification); banning a pending requester removes
  the request; promoting one lets them in as a mod. `approvalRequested` =
  an active, unapproved member of a RESTRICTED subspace who asked to post:
  self action `request-approval` (400 unless restricted / already able to
  post, 403 for non-members or someone else; idempotent; notifies the mods
  "wants to post ✋"; no modlog — not a mod action); `members?
  approvalRequests=1` lists them; `approve` grants + clears, `unapprove` /
  `deny` clear. Projection: `viewer.pending`, `viewer.approvalRequested`,
  `member.pending`, `member.approvalRequested`, and for moderators
  `pendingCount` + `approvalRequestCount` on the detail (one `$group`).
  Pure helpers `isActiveMembershipState` / `canPostIn` / `requestKindOf`
  in `subspaceCore.ts` are unit-tested. Contracts: `subspaces-join`,
  `-leave`, `-get`, `subspaces` → 1.1.0, `subspaces-members` → 1.2.0.
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
  `/members` (GET/POST), `/moderate`, `/modlog`, `/feed`, `/transfer`,
  `/delete`, `/api/v1/things/updown`. Rate-limit keys `subspaces.write`,
  `things.updown`; PAT scope `things.updown`. Contracts `api.things`,
  `api.things-feed`, `api.things-comment`, `api.things-user` → 1.2.0
  (additive fields); `api.subspaces-members`, `api.notifications-list`,
  `api.notifications-settings` → 1.1.0 (member actions notify; the
  notification type enum grew).

### Client

- `/s` directory (search, Mine, create modal), `/s/:slug` (banner/icon/join,
  sort tabs + range, subspace-locked composer with title + flair, sidebar
  About/Rules/Flairs/Moderators, private wall; a 404 evicts the cached copy),
  `/s/:slug/mod` (Queue, **Requests** — join requests + posting-approval
  requests with Accept/Approve ✓ / Deny per row, optimistic removal + badge
  counts on the tab and on the subspace page's "Mod tools 🎩" button —
  Members, Banned, Settings + the owner's **Danger zone** — Transfer
  ownership with a confirm modal, Delete subspace with a retype-the-slug
  modal that navigates to `/s` — Rules, Flairs, Log).
- Subspace page + directory cards: a private subspace's button reads
  "Request to join 🔒" → "Requested ✓ · cancel" (optimistic, count
  untouched); a restricted subspace's ✋ hint gains "Request posting
  approval ✋" → "Approval requested ✓".
- Bell + Settings → Notifications carry the six subspace types; subspace
  rows click through to `/s/<slug>`.
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
  capability manifest, cascade, and — round 2 section M — the lifecycle:
  role/ban notifications, transfer walls (401/403/400/404, banned target
  403) + success (ownerId flips, old owner demoted and may leave, modlog
  `owner.transfer`, new-owner notification), delete walls (401/403/400) +
  success on a public subspace (get/feed/members 404, posts readable as
  plain public posts, a post removed at deletion time 404s for non-authors
  and reads as a private post for its author, memberships gone, former-mod
  notification), the slug hold (409 "held" for a stranger, 201 for the
  previous owner, 404 meanwhile), a private-subspace deletion (every post
  incl. a rich post+comment thing leaves author-only: 404 for outsiders,
  ex-members and anonymous; never back on a home feed) and two concurrent
  transfers from one owner (exactly one 200, the other 409/403, one crown
  on the roster, `ownerId` agrees)); section N — join requests + posting
  approval: request/no-op/cancel, "not a membership" walls (feed 403,
  mine=1, post 403, transfer 404), mod notifications, mod-only queues +
  counts, accept/deny walls (403/404) and success, re-request after deny,
  `add` accepting, ban removing a request, unban → request → accept,
  request-approval walls (401/403/403/400/400/400) and success, deny /
  approve / unapprove clearing, manifest versions, cleanup delete).
- S1 review fixes (same branch): `NotificationsBell` keys its verb off
  `subspaceNotificationDetail` (slug head stripped) so `s/deleted_scenes` /
  `s/uplifted_minds` never mislabel a row; the mod page keeps the Danger
  zone mounted through an in-flight transfer (`transferPending`) so the
  optimistic crown flip dims it instead of unmounting the open confirm
  modal, and a failed transfer lands back with the username intact.
- Browser: see the run log in the PR description / TESTING.md checklists.

## Known limits (stated, not hidden)

- Owners can't leave while they own the subspace — transfer first (the
  previous owner may leave right after).
- No user flairs (post flairs only); no per-subspace wiki/sidebar widgets
  beyond About/Rules/Flairs/Mods.
- Deny (join or posting request) does not notify the requester (Reddit
  parity — they simply may ask again).
- Removal reasons are collected with a browser prompt in the card menu (the
  mod page has proper inputs for bans).
