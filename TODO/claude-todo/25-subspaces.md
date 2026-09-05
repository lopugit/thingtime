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
  mod page **Requests** tab with badges; verify section N.

## Follow-ups (not in this PR)
- User flairs; per-subspace wiki +
  sidebar widgets; crossposting; a "popular subspaces" board on /explore;
  notifications for a post's first upvotes; API-level "all subspaces I
  moderate" digest; subspace archive (read-only freeze, distinct from delete).
