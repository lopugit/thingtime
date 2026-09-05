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

## Follow-ups (not in this PR)
- Join-request queue for private subspaces; user flairs; subspace transfer /
  archive; per-subspace wiki + sidebar widgets; crossposting; a "popular
  subspaces" board on /explore; notifications for mod actions and for a
  post's first upvotes; API-level "all subspaces I moderate" digest.
