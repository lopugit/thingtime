# 25 — Subspaces 🪐 (Reddit-style communities) + up/down votes 🔼

**Status:** 🟢 Built (PR `claude/subspace-communities` → develop), live-walked
by `remix/scripts/verify-subspaces.mjs`; browser-checked desktop + 375px.

## Goal
User-created communities with branding, rules, post flairs, joining, an
access mode (public / restricted / private), full moderation (remove /
approve / pin / lock / nsfw / spoiler / flair, bans, roles, mod log) and a
per-subspace feed with Reddit's sorts — plus **upvote/downvote as a separate,
deliberately limited reaction kind** that leaves the native multi-emoji
reactions untouched.

## ✅ Decisions (locked)
- Everything is a thing: `subspace`, relational `subspace-member` (one doc per
  (subspace, user) carrying role/approval/ban), `subspace-modlog`, and `updown`
  votes (one doc per (user, target)). Uniqueness rides the root `uniqueKeys`
  namespace; exactly ONE new `things` index (`things_subspace_posts`).
- Posts join a subspace through `crystal.subspaceId` (+ `title`, `flairId`),
  validated on every write by `api/utils/subspaces/gate.ts`; moderation state
  is the server-owned root `subspaceMod`, never client-writable.
- Removed posts are REDACTED for everyone but the author + mods (never
  vanish mid-thread) and leave every feed; private-subspace posts are fenced
  to active members through `Viewer.subspaceRoles` + `canView` and the feed
  clauses (defense in depth on every read surface).
- Sorts rank the relational tallies over a bounded newest window — the
  ranked home-feed pattern — so no denormalized score column exists.
- Votes are a different kind from `reaction` (and from poll `vote`): the UI
  shows the ▲ score ▼ pill beside the react button; Settings → Subspaces can
  hide the pills and set the default sort (per-browser, sync cache tier).

## Round 2 (in progress on the same branch)
- ✅ S1 — six `subspace-*` notification types (role/ban emitted; the rest
  wired for later slices), `POST /api/v1/subspaces/transfer` (owner → active
  member; old owner becomes moderator and may leave), `POST
  /api/v1/subspaces/delete` (confirmSlug; posts survive as plain posts via
  the accounted bulk `$unset` — private-subspace posts and mod-removed posts
  leave author-only, rich post+comment things included; the slug is held by
  a `subspace-tombstone` for 30 days / re-foundable by the previous owner;
  409 instead of stranding posts behind a missing doc; members/modlog rows
  removed; former mods notified), transfer writes guarded against racing
  transfers (409), mod-page **Danger zone** with Chakra modals that stay
  mounted through an in-flight transfer; verify section M.
- ✅ S2 — join requests for private subspaces (`/join` → pending row, not a
  membership; `/leave` cancels; `members?pending=1`; actions `accept` /
  `deny`; `add` accepts; ban removes the request) + posting-approval
  requests in restricted ones (`request-approval` self action;
  `members?approvalRequests=1`; `approve` grants + clears, `unapprove`/`deny`
  clear); `viewer.pending` / `viewer.approvalRequested`, mods' `pendingCount`
  + `approvalRequestCount`; mod notifications (`subspace-join-request`
  "wants to join / wants to post") + `subspace-join-accepted`; subspace page
  "Request to join 🔒 → Requested ✓ · cancel" + "Request posting approval ✋",
  mod page **Requests** tab with badges; verify section N. Review fixes:
  the posting gate consumes `canPostIn` (kicked/pending rows never post;
  `remove` clears `approved`), pending rows take only decisions (400/404),
  guarded accept/deny/add (409 on a withdrawn request), access flips resolve
  the queues, expired bans heal on `request-approval`, deduped mod bells +
  a `subspaces.join` rate key.

- ✅ S3 — user flairs: `userFlairs` templates + `userFlairSelfAssign` /
  `allowCustomUserFlair` on `/update` (mods), member action `userFlair`
  (self under the two switches, mods dress anyone — the owner included;
  modlog `member.userFlair` only for someone else's; kick / ban strip the
  pick, a demotion strips a mod-only one), `authorFlair` on posts +
  comments from ONE batched member-row lookup per page (live template
  resolution, active members only), `viewer.userFlair` / `member.userFlair`;
  chip after the author name everywhere inside subspaces, sidebar **Your
  flair** card, mod page **User flairs** editor + **Set flair** modal;
  verify section O.
- ✅ S4 — removal reasons + moderation modals: `removalReasons { id, title,
  message }[]` (≤20) on `/update` (mods) + every subspace projection;
  `moderate remove` takes `reason` and/or `reasonId` (a canned reason →
  `title — message · note` stored on `subspaceMod.reason`, `detail.reasonId`
  in the mod log; unknown → 400) and notifies the author
  (`subspace-post-removed`, `postId` deep link; own posts ring nobody;
  approve notifies nothing); ban takes a private mod-log `note`.
  `ModerationModals.tsx`: **RemoveModal** (reasons + rules + Custom, note,
  also-lock, also-ban + days; optimistic, one cached subspace load shared
  with the card menu's flair list) in the PostCard menu, **BanModal**
  (reason / days / note) on the mod page's member rows + Banned tab, Rules
  tab **Removal reasons** card. No `window.prompt`/`confirm` left in the
  subspace UI. Verify section P. Review fixes: idempotent remove (no second
  mod-log row / bell), `ruleIndex` composed + bounded server-side, removal
  and ban bells from "s/<slug> mods" with the reason's headline, untouched-
  only default pick, short ban reason, hashed ids for non-Latin titles,
  375px-safe reasons row (moderate 1.3.0, members 1.4.1, notifications-list
  1.2.0).
- ✅ S5 — reports + the Reports queue: kind `subspace-report` (one row per
  (post, reporter) on the root `uniqueKeys` namespace, control-plane
  storage, deleted with the subspace and the post), `POST
  /api/v1/subspaces/report` (any visible viewer, not banned; comments
  resolve to the root post; a repeat refreshes / re-opens the row; mods
  ring `subspace-report`, deduped), `GET /api/v1/subspaces/reports`
  (grouped by post over a bounded window: reasons tally + reporters + the
  post) and `POST … { action: 'dismiss' }`; `moderate remove` / `approve`
  settle open reports; `subspaceMod.reportCount` (mods only, one `$group`
  per page) + `openReportCount` on the detail; PostCard **Report to
  moderators 🚩** + ReportModal (comment rows too), the mods' `🚩 N` badge,
  mod page **Reports** tab (Remove via RemoveModal / Dismiss, Open /
  Resolved), badges on the tab and Mod tools 🎩; verify section Q.
  Review fixes: a removed post takes no report (409, no 🚩 offered), a
  repeat after a move re-files in the new subspace, dismiss without a slug
  follows the open rows' own targetId, a deleted comment takes the rows
  that flagged it, the Reports tab counts rows (not groups), reconciles
  after Remove / card-menu verdicts and sequences its two lists
  (report + reports 1.0.1).

- ✅ S6 — discovery + home integration: `GET /api/v1/things/feed?scope=
  subspaces` (only posts from the viewer's ACTIVE subspaces, every existing
  fence intact, empty for guests / non-members, unknown scope → 400, the
  response echoes `scope`; things-feed 1.4.0) + the `/feed` **🪐 My
  subspaces** chip beside the algorithm menu (persisted in the sync tier
  under `tt-feed-scope`, eyebrow "Your subspaces 🪐", guest login nudge,
  resting under Advanced search); `GET /api/v1/subspaces?sort=new|members|
  active` (`members` / `active` ranked in memory over the newest 200
  matching subspaces — one `$group` each, `recentPostCount` on `active`
  rows, offset paging, unknown sort → 400, the response echoes `sort`;
  subspaces 1.4.0) + `/s` sort chips **New / Most members / Most active**;
  `/explore` **Popular subspaces 🪐** strip (top 8 by members, compact
  cards, self-scrolling at 375px); `/search` **Subspaces 🪐** section (first
  6 slug/name matches, client-side, `search.ts` untouched). Profile pages
  show no member-of line by design (member lists are private). Verify
  section R. S6 review: the directory GET is rate-limited
  (`subspaces.list`, 120/min), takes `anon=1` (edge-cacheable logged-out
  view, sent by the three guest-visible callers) and fences a private
  subspace's activity to its ACTIVE members (`canSeeSubspaceActivity` —
  ranked at zero, no `recentPostCount`, for everyone else); subspaces
  1.5.0.

## Follow-ups (not in this PR)
- Per-subspace wiki +
  sidebar widgets; crossposting;
  notifications for a post's first upvotes; API-level "all subspaces I
  moderate" digest; subspace archive (read-only freeze, distinct from delete).
