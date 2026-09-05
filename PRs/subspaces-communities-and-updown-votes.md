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
| `subspace-report` | `targetId` = subspace, `ownerId` = reporter, `crystal { postId (root post), commentId, reason (≤120), note (≤500), status open\|resolved, resolution removed\|approved\|dismissed\|null, resolvedById, resolvedAt, reportKey }` | `uniqueKeys` `subspaceReportKey:<postId>:<reporterId>` (one row per (post, reporter)); control-plane storage; deleted with the subspace and with the post |
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
- S2 review fixes (same branch): `gate.ts`'s `assertSubspacePosting` now
  consumes `canPostIn` — the same predicate the detail advertises as
  `viewer.canPost` — so a kicked (`left`) or pending row can never post
  whatever its `approved` flag says; `remove` clears `approved`, a private
  re-request resets it, and the post projection's `subspace.viewerRole`
  uses `isActiveMember`. A pending row takes only accept / deny / add / ban
  / role moderator (approve, unapprove, role member → 400; remove → 404).
  accept / deny / add-on-pending are guarded writes (`PENDING_REQUEST_MATCH`
  / `APPROVAL_REQUEST_MATCH` in the filter) → 409 "withdrawn — reload the
  queue" when the requester cancelled or re-filed between the read and the
  write, and the mod log / 🎉 bell never fire for a non-member (the Requests
  tab refreshes on 409 instead of restoring the row). `updateSubspace`
  resolves the queues on an access change: leaving private activates every
  pending row (`subspace-join-accepted` "opened up", first 200 notified;
  modlog detail `acceptedRequests`), leaving restricted clears
  `approvalRequested` (`clearedApprovalRequests`). `request-approval` heals
  an expired temporary ban on the row so the request reaches the queue.
  `emitNotificationsBulk` gained `{ dedupeUnread }` (one query on the
  partial unread index): the mods' `subspace-join-request` bell rings once
  per (actor, subspace, preview) until read, so `/join` → `/leave` →
  `/join` is not an amplifier; `/join` moved to its own rate key
  `subspaces.join` (20/min). Contracts: `subspaces-join` 1.1.1,
  `subspaces-members` 1.2.1, `subspaces-update` 1.1.0.
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
  `/delete`, `/report`, `/reports` (GET/POST), `/api/v1/things/updown`.
  Rate-limit keys `subspaces.write`, `subspaces.join`, `subspaces.report`,
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
  **Reports** — reported posts grouped with reasons + reporters, Remove 🧹
  (RemoveModal) / Dismiss ✓, an Open / Resolved toggle, a badge on the tab
  and folded into Mod tools 🎩 — Members, Banned, Settings + the owner's **Danger zone** — Transfer
  ownership with a confirm modal, Delete subspace with a retype-the-slug
  modal that navigates to `/s` — Rules, Flairs, Log).
- Subspace page + directory cards: a private subspace's button reads
  "Request to join 🔒" → "Requested ✓ · cancel" (optimistic, count
  untouched); a restricted subspace's ✋ hint gains "Request posting
  approval ✋" → "Approval requested ✓".
- Bell + Settings → Notifications carry the six subspace types; subspace
  rows click through to `/s/<slug>`.
- `PostCard`: `🪐 s/<slug>` chip + flair chip + 📌/🔒/18+/⚠️ badges (+ the
  mods' `🚩 N` open-report badge), **Report to moderators 🚩** in the ···
  menu for logged-in non-mods (comment rows: a flag icon) → the
  ReportModal, title h2,
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
  approve / unapprove clearing, manifest versions, then the S2 review fixes:
  a kicked approved poster → post 403 + `viewerRole` null + rejoin not
  approved, an expired ban's approval request reaching the queue, leaving
  restricted clearing approval requests, pending-row walls (400/400/400/404,
  no stray bell), bell dedupe across cancel → re-request (and ringing again
  once read), a withdrawn request refusing accept / deny with no log / bell,
  and private → public activating the request (member, `pendingCount` 0,
  "opened up" bell, modlog `acceptedRequests` 1); cleanup delete).
- Round 2 S3 — user flairs 🏷️: subspace `crystal.userFlairs` (templates,
  the post-flair sanitizer), `userFlairSelfAssign` (default true),
  `allowCustomUserFlair` (default false, custom text ≤40) via `/update`
  (any moderator); member row `crystal.userFlair { id | null, text, emoji,
  color }` via `POST /api/v1/subspaces/members action: 'userFlair'` —
  self (active member; template not modOnly while self-assign is on, custom
  text while allowed, clearing always) or, as a moderator, anyone — the
  owner included, who can always override it (any template incl. modOnly,
  custom text, bound by neither switch; `member.userFlair` mod-log only when
  dressing someone else). Projection:
  `authorFlair` on posts AND comments (the root post's subspace) from ONE
  `uniqueKeys $in` over the page's (subspace, author) pairs — page docs,
  shared originals, every shipped comment level — resolved against the live
  templates (rename follows, delete keeps the snapshot), hidden unless the
  wearer is an active member; the fresh comment `POST /things/comment`
  answers with carries it too. `viewer.userFlair`, `member.userFlair`, the
  three settings on every subspace projection. UI: `AuthorFlairChip` after
  the author name (cards, comment rows, shared sub-card, mod member rows),
  the `/s/<slug>` sidebar **Your flair** card (template pills / custom text
  / take it off; optimistic across the page's own posts + comments), mod
  page Flairs → **User flairs** editor + the two switches, Members → **Set
  flair** modal. Capabilities: subspaces / get / update 1.2.0, members
  1.3.0 (→ 1.3.1 with the review fixes), subspaces-feed 1.1.0, join / leave
  1.2.0, transfer 1.1.0, moderate 1.1.0 (their response shapes grew the
  flair fields), things / things-comment / things-feed / things-user feature
  1.3.0 · contract 1.2.0 — the shared post projection is versioned on those
  four things ids only; things-search / -trending / -rss / -saved ride the
  same projection unbumped (the round-1 precedent for title / subspace /
  votes). Verify section O (defaults, every 4xx wall, template + custom +
  clear, batched authorFlair on posts / fresh comments / nested replies /
  home + subspace feeds, live template rename, mod dressing + mod-log rule,
  self-assign off, kicked / banned wearers stripped, manifest).
- S3 review fixes (same branch): comment-as-root reads
  (`GET /api/v1/things?id=<comment>`, thread drill-downs) load the ROOT
  subspace's embed, so a renamed template follows the wearer there too;
  `addComment` reuses the root the interaction gate already resolved
  (`createThing` answers `rootSubspaceId`) instead of walking the reply
  chain twice; kick and ban `$set crystal.userFlair: null` and a demotion
  strips a mod-only pick (`userFlairSurvivesDemotion`; mod-log detail
  `userFlairCleared: true`) so no badge walks back in un-granted; the owner
  wall on `userFlair` is gone (spec: mods dress anyone — the owner overrides
  at will; the mod page shows Set flair on the owner's row); the Set-flair
  modal's custom sentinel sits outside the flair-id grammar (`~custom`), a
  worn-but-deleted template opens as editable custom text with a hint, Save
  waits while another member action is in flight (the busy guard rejects
  instead of resolving silently) and the modal stays open when the API
  refuses; join / leave 1.2.0, transfer 1.1.0, moderate 1.1.0, members 1.3.1.
- Round 2 S4 — removal reasons + moderation modals 🧹: subspace
  `crystal.removalReasons { id, title (≤80), message (≤500) }[]` (≤20, ids
  minted from titles with the flair-id grammar, deduped) via `/update` (any
  moderator; public on every subspace projection like the rules they
  extend). `POST /api/v1/subspaces/moderate action: 'remove'` takes
  `reason` (free text) and/or `reasonId` — a canned reason composes the
  stored reason `title — message · note` (`resolveRemovalReason`, bounded by
  `MAX_SUBSPACE_POST_REMOVAL_REASON_CHARS`; unknown id → 400, the post stays
  up), lands on `subspaceMod.reason` (+ root `subspaceMod.reasonId`, cleared
  by approve) and in the `post.remove` mod-log entry (`detail.reasonId`);
  the AUTHOR is notified (`subspace-post-removed`, preview
  "s/<slug> · <reason>", `postId` = the post so the bell opens `/post/:id`;
  a mod removing their own post rings nobody; approve notifies nothing).
  Ban (`members action: 'ban'`) takes an optional private `note` (≤300) that
  lands in the `member.ban` mod-log detail only — never in `banReason`, the
  row or the user's bell. UI: `ModerationModals.tsx` — **RemoveModal** (the
  card menu's Remove 🧹: radio list of the subspace's removal reasons, then
  its rules, then Custom; note; "Also lock comments"; "Also ban @author" +
  days, hidden on your own post) sequences moderate(remove) [+ lock]
  [+ members ban], paints removed + the reason optimistically and reverts
  when the REMOVE is refused (follow-ups that fail keep the removal and
  toast); it lazy-loads the subspace through ONE cached loader
  (`loadModerationSubspace`, 60s TTL, shared with the card menu's Flair
  submenu; the mod page's rules / reasons / flairs saves invalidate it).
  **BanModal** (reason / days / private note) replaces every
  `window.prompt` on the mod page (member rows + Banned → "Ban someone");
  a banned row leaves the Members list on confirm and comes back on a
  refusal with the modal still open. Mod page Rules tab gains a **Removal
  reasons** card (title + message editor, reorder / remove, ids on save).
  No `window.prompt`/`confirm` remains in the subspace UI. Capabilities:
  subspaces / get / update / join / leave 1.3.0, feed / transfer 1.2.0
  (their subspace block grew `removalReasons`), moderate 1.2.0 (reasonId +
  the author notification), members 1.4.0 (ban note). Verify section P.
  S4 review fixes: `moderate remove` is idempotent — an already-removed post
  answers 200 as it is (no rewrite of removedById / removedAt / reason, no
  second `post.remove` mod-log row, no second bell; approve first to
  re-remove); `remove` also takes `ruleIndex` (0-based; the server composes
  `Rule N: title — text · note` through `resolveRemovalReason`, bounded at
  900 like a canned reason — out of range / both with reasonId → 400;
  `subspaceMod.ruleIndex` + `detail.ruleIndex`), so the client never guesses
  what got stored and the RemoveModal's note counter shrinks to what fits
  (`noteMaxFor`); the author's `subspace-post-removed` bell and the
  `subspace-ban` rows come from the SUBSPACE'S MOD TEAM
  (`subspaceModTeamActor`: actorId = the subspace shareId, actorName
  "s/<slug> mods", actorUsername null — the projection hides `removedById`
  from the author and the bell no longer hands them the name; role / accept
  rows still name the acting mod; the own-post skip is explicit) with the
  reason's HEADLINE as preview (canned title / rule citation / free text —
  previews clamp at 140 chars); the RemoveModal's lazy default pick only
  lands while the form is untouched (`touchedRef`); "Also ban" sends the
  short `banReason` (title / citation / custom text), never the composed
  removal text; `slugifyFlairId` falls back to a stable hashed
  `reason-…` / `flair-…` id when a title has no Latin letters or digits
  (CJK / Cyrillic / Arabic / emoji titles save from the id-less editors);
  the Removal reasons row wraps at 375px (id on its own truncating line).
  Capabilities: moderate 1.3.0 (ruleIndex, additive), members 1.4.1
  (mod-team ban bell, correction), notifications-list 1.2.0 (mod-team actor
  rows, additive). Verify section P extended (idempotent remove, ruleIndex +
  walls, mod-team actors on removal / ban / unban rows, headline previews,
  CJK reason ids)
  (settings walls 403 / 400 ×6 + a moderator's save with minted ids and a
  sliced title, public / anonymous / directory reads, the mod-log fields,
  moderate walls 401 / 403 / 400 unknown reasonId — post stays up — / 404
  outside a subspace, canned reason + note → the composed reason the author
  and mods see and the stranger doesn't, mod-log reason + `detail.reasonId`,
  the author's bell row with `postId` and the reason, approve clearing it
  and ringing nobody, free text alone, no reason at all, a mod removing
  their own post ringing nobody, a renamed / deleted reason never rewriting
  a removed post's stored reason (deleted id → 400 afterwards), the ban
  note in the mod log only, the manifest).
- Round 2 S5 — reports + the Reports queue 🚩: kind `subspace-report`
  (above). `POST /api/v1/subspaces/report { id (post or comment), reason,
  note }` — any logged-in viewer who can SEE the target (`canViewInherited`;
  unknown and invisible both 404, existence never disclosed) and is not
  banned in its subspace; a comment resolves to its ROOT post
  (`resolveRootPost`; `commentId` remembers the comment); one row per
  (post, reporter) on the root `uniqueKeys` namespace — a repeat refreshes
  the reason / note (`updated: true`) and re-opens a settled row (its
  `createdAt` restarts); only a new / re-opened report rings the mods
  (`subspace-report`, actor = the reporter, `targetId` + `postId` = the
  post, preview `s/<slug> · <reason>`, `dedupeUnread`). Rate key
  `subspaces.report` 30/min. `GET /api/v1/subspaces/reports?slug&status=
  open|resolved&cursor&limit` (mods): the rows grouped by post in ONE
  aggregate over a bounded newest-first window of 2,000 rows (`$sort` →
  `$limit` → `$group` → offset paging — the ranked-feed pattern) → `{
  postId, post (PublicPost as the mod sees it — removed content included;
  null when the post is gone / left the subspace), reportCount, reasons
  [{ reason, count }] most-cited first (`tallyReportReasons`), reporters
  [{ userId, profile, reason, note, commentId, createdAt }] newest first
  (≤ `MAX_SUBSPACE_REPORT_REPORTERS_LISTED` = 20), latestAt, status,
  resolution }` + `openReportCount`. `POST /api/v1/subspaces/reports {
  postId, action: 'dismiss', id|slug? }` settles every open report on the
  post (`dismissed`; modlog `report.dismiss` `detail.count`; nothing open →
  404; the subspace is the post's, else the reports' own `targetId`, an
  explicit slug wins). `moderate remove` / `approve` settle open reports
  implicitly (`resolveOpenReports` → `removed` / `approved`; the idempotent
  remove path settles too; `post.remove` / `post.approve` detail
  `resolvedReports`). Projection: `subspaceMod.reportCount` for the
  post's moderators ONLY (`loadOpenReportCounts` — ONE `$group` per page
  over the (subspace, post) pairs the viewer can moderate; everyone else
  never touches the report rows and gets no key), `openReportCount` on the
  detail for mods. Deleting a post `deleteMany`s its reports (they hang off
  `crystal.postId`, so the `targetId` cascade never sees them); deleting
  the subspace already dropped the kind. UI: PostCard ··· menu **Report to
  moderators 🚩** for logged-in non-author non-mods on subspace posts
  (comment rows: a flag icon beside react/vote, `SubspaceReportContext`
  hands them the root subspace) → **ReportModal** (`ModerationModals.tsx`:
  rules + Other + note, first rule preselected while untouched; the same
  cached subspace loader) — optimistic: close + toast "Reported — thanks,
  the mods will look 🚩", a refusal toasts; mods see a `🚩 N` badge in the
  subspace line linking to the Reports tab; mod page **Reports** tab
  (Open · N / Resolved toggle; each group = the PostCard + reasons chips +
  reporters + Remove 🧹 through the RemoveModal [+ lock] [+ ban] / Dismiss
  ✓; optimistic with put-back on failure, a 404 refreshes), badge on the
  tab and on Mod tools 🎩 (`modQueueCount` = requests + reports; the
  button opens whichever queue has work). Capabilities: `subspaces-report`
  + `subspaces-reports` 1.0.0, get 1.4.0, moderate 1.4.0, feed 1.3.0,
  things / things-comment / things-feed / things-user feature 1.4.0 ·
  contract 1.3.0. Verify section Q.
- S1 review fixes (same branch): `NotificationsBell` keys its verb off
  `subspaceNotificationDetail` (slug head stripped) so `s/deleted_scenes` /
  `s/uplifted_minds` never mislabel a row; the mod page keeps the Danger
  zone mounted through an in-flight transfer (`transferPending`) so the
  optimistic crown flip dims it instead of unmounting the open confirm
  modal, and a failed transfer lands back with the username intact.
- Round 2 S5 — verify section Q: reports — defaults (mods' `reportCount` 0
  / `openReportCount` 0, no keys for members), every report wall (401, no
  reason 400, 501-char note 400, no id 400, unknown 404, invisible private
  post 404, outside a subspace 400, banned 403 → unban), queue walls (GET
  401 / 403 / 404, dismiss 401 / 403 / 400 / 404), the happy path (row shape,
  the mods' deduped bell — never the reporter's or the author's, a repeat
  refreshing the row without a second bell, a nested reply landing on the
  root post with `commentId`, the grouped queue with reasons tally +
  reporters + the projected post, mods-only `reportCount` on the post read
  / subspace feed / home feed and `openReportCount` on the detail), dismiss
  (+ `report.dismiss` mod log, resolved queue, 404 again), re-report after
  a dismissal re-opening + ringing again, remove / approve settling open
  reports (`resolvedReports`), a foreign-subspace dismiss 404, the author's
  delete clearing the reports, the generic-things wall, docs routes and
  the manifest.
- S5 review fixes (same branch): `reportPost` refuses a post the mods
  already removed (409 "already removed by the moderators" — no row
  re-opened, no bell; the redacted card is public so nothing is disclosed)
  and PostCard hides the 🚩 on such a card and on its comment rows
  (`SubspaceReportContext` null); a repeat report carries
  `targetId: subspaceId` and counts as re-opened when the post MOVED, so it
  re-files in the new subspace and rings its mods; `mutateReports` without
  `id | slug` resolves the queue from the open rows' own `targetId`
  (`pickReportQueueSubspace`, pure + unit-tested: the post's current
  subspace only when open rows sit there) so a moved post's old rows stay
  dismissable as the docs promised; `deleteThing` clears the rows that
  flagged a deleted COMMENT (and its cascaded replies — `commentId $in`,
  `clearSubspaceReportsFor`), not only a deleted post's; the registry text
  no longer claims "only the moderator endpoints read it" — `tt:user` is
  the OWNER acl, so the reporter can read their own row through the
  generic single read and nobody else can (verified live, pinned in
  section Q). Reports tab: `takeOut` / `putBack` move the badge by the
  group's `reportCount` (rows, not groups — `openReportCountWithout`),
  Remove 🧹 reconciles the list + count from the server (`moderate`
  answers no `openReportCount`), a removal / approval through the card's
  own ··· menu drops the group (`reportsSettledByCard`: the server's
  re-projection reads `reportCount 0`) and reconciles, and the panel keeps
  the Open and Resolved lists side by side with per-list request
  sequencing — flipping paints the known list at once and a slow response
  can never land under the other heading (`data-status` on
  `mod-reports`). Contracts: `subspaces-report` + `subspaces-reports`
  1.0.1 (compatible corrections) in the docs and both pin files.
- Browser: see the run log in the PR description / TESTING.md checklists.

## Known limits (stated, not hidden)

- Owners can't leave while they own the subspace — transfer first (the
  previous owner may leave right after).
- No per-subspace wiki/sidebar widgets beyond About/Rules/Flairs/Your
  flair/Mods.
- Deny (join or posting request) does not notify the requester (Reddit
  parity — they simply may ask again).
