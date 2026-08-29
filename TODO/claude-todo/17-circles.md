# 17 — Circles become real 💞

> **Status: 🟡 Half shipped.** The **friends** circle is built and live — a real
> friend graph resolves `tt:userFriends` end to end. The **family** circle is
> still decorative: `tt:userFamily` resolves to the owner only. What remains is
> scoped below.
>
> Graduated from the claude-todo/10 idea bank per its own rule ("each idea
> graduates to its own `claude-todo/NN-*.md` when picked up"). Numbered 17
> because 14–16 were taken on in-flight branches when it was written.
>
> **Paths below are relative to `remix/app/`** unless stated otherwise, and
> cite **symbol names rather than line numbers** — the first revision of this
> spec pinned line numbers and every one of them had rotted before it merged.

## What it's for

Posts can target `friends`/`family` circles, `FeedFilters` exposes them, and
`CIRCLE_META` labels them. Half of that is now real. This document is the
remaining half plus the record of how the shipped half was built, so the family
circle is implemented **the same way** instead of growing a second, divergent
membership model.

## ✅ What already shipped — the friends circle (verified against this head)

A real, mutual, consent-based friend graph landed in `b216e837` ("Followers +
friends, notifications, public post view stats…"), *after* the first revision of
this spec was written. It is the pattern to copy.

- **Model** — a `friend` **thing**, one doc per unordered pair
  (`schemas/registry.ts`, `friendThingSchema`): `ownerId` = requester,
  `targetId` = recipient, `crystal.status` `pending` → `accepted`,
  `crystal.friendKey` = `'<minId>~<maxId>'`. Uniqueness rides the server-only
  root `uniqueKeys` namespace via `relationshipUniqueKeys('friend', …)`
  (`api/utils/messenger/shared.ts`), so crossed or duplicate requests die
  structurally; `things_friend_key_lookup` (`api/utils/mongodb/collections.ts`)
  is the lookup index only. The generic things CRUD refuses the kind.
- **Consent is mandatory** — `friendAction` (`api/utils/users/social.ts`) drives
  intents `request | cancel | accept | decline | unfriend`
  (`FRIEND_INTENTS`), capped at `MAX_FRIENDS_PER_USER` (2000).
- **Pinned to the home DB** — social edges load through
  `getHomeThingsCollection`, deliberately: they gate notifications and the
  `tt:userFriends` circle, so a data-plane endpoint override must never be able
  to fake or hide a relationship.
- **API** — `POST /api/v1/users/friend { userId | username, intent }`
  (`routes/api/v1/users/friend/_friend.tsx`), a `useApi` client method,
  apiDocs entry, and an apiTests case covering the 401/404 shapes. Sibling
  routes: `users/{connections,follow,profile,relationships,search}`.
- **acl resolution** — `friendIdsOf(userId)` returns the accepted set from
  *both* directions of the pair doc; `withFriendIds(viewer)`
  (`api/utils/things/things.ts`) memoises it onto `Viewer.friendIds` once per
  request path; `aclEntryMatches` (`schemas/registry.ts`) then answers
  `tt:userFriends` as `viewer.id === ownerId || viewer.friendIds.has(ownerId)`.
  Because friendship is **mutual**, the viewer's own set answers for every
  owner — no reverse lookup, no extra index.
- **Query side** — `visibilityQueryFor` adds
  `{ ownerId: { $in: [...viewer.friendIds] } }` AND `circleClause('friends')`.
- **Notifications** — `friend-request`, `friend-accepted`, `post-from-friend`
  are live `NOTIFICATION_TYPES`.
- **UI** — `components/Profile/RelationshipControls.tsx` (rendered from
  `ProfilePage.tsx`): follower/following/friend counts, friend actions, the
  pending-request inbox on your own profile, and a second-click confirm on
  unfriend.

## 🔴 What's left — the family circle

`aclEntryMatches` still returns owner-only for `ACL_FAMILY`, and
`visibilityQueryFor` has no family clause. `circleClause('family')` already
exists and is correct, so family-visibility posts are stored and filterable —
they are simply invisible to everyone but their author.

### Design: mirror the friend pair doc exactly

Add a `family` thing alongside `friend`, not a new mechanism:

- `schemas/registry.ts` — `familyThingSchema`: `requiresTarget: true`,
  `crystal.status` `pending | accepted`, `crystal.familyKey`
  `'<minId>~<maxId>'`, `createdVia: 'POST /api/v1/users/family'`, protected from
  the generic CRUD.
- `RELATIONSHIP_UNIQUE_CRYSTAL_KEYS.family = 'familyKey'` +
  `things_family_key_lookup` via `createIndexReplacing`.
- `api/utils/users/social.ts` — `familyAction` and `familyIdsOf` mirroring their
  friend twins, same home-DB pinning, same intent vocabulary. Cap
  `MAX_FAMILY_PER_USER` well below the friend cap (200 is generous for the
  semantics) — it bounds the `$in`.
- `routes/api/v1/users/family/_family.tsx` + dispatcher key + apiDocs entry +
  `useApi` method, session-authed, Fail-union results, `enforceRateLimit` on
  the mutating path.
- `NOTIFICATION_TYPES` — add `family-request`, `family-accepted` (reads always
  filter by the recipient's prefs, so the pref must exist before the emitter).

### Rejected: the `crystal.circles` array model

The first revision of this spec proposed storing membership as
`crystal.circles: { friends: string[], family: string[] }` on the owner's user
thing, asymmetric, with **no consent handshake** and consent listed as
out-of-scope. Do not build that. It was written before the friend graph
existed, and shipping it now would be a regression on five counts:

1. **Two sources of truth** for `tt:userFriends`, in the app's most
   security-sensitive query path.
2. **It removes consent.** Friends require `accept`; a parallel model that
   grants circle read access unilaterally silently downgrades that guarantee.
3. **Asymmetry forces a reverse lookup.** "A lists B" cannot be answered from
   B's own document, so it needed a reverse query plus two new indexes. The
   symmetric pair doc needs neither.
4. **Unbounded array on a hot document** — accumulating per-user state is
   relational here (FUNDAMENTALS: appended/child data is relational, never an
   unbounded embedded array).
5. **`crystal` is the public-profile side.** Membership stored there is
   world-readable by anyone who can project the user thing.

### Visibility resolution — the security-critical part

Two places must agree (test == live):

1. **Exact check** — `aclEntryMatches`: `ACL_FAMILY` becomes
   `viewer.id === ownerId || viewer.familyIds?.has(ownerId) === true`, exactly
   parallel to `ACL_FRIENDS`. **Most-specific-wins ordering is unchanged** —
   `-tt:user/<x>` still beats a circle grant, and exclusions still win ties.
2. **DB clauses** — `visibilityQueryFor`: add the family twin of the friends
   clause. The exact evaluator stays the authority; the DB match is a
   **superset prefilter** and `canView`/`canViewInherited` must still gate every
   returned doc. Do not switch to post-filter-only: it breaks pagination
   (short pages).
3. **Enrichment completeness is the real failure mode.** `Viewer` gains
   `familyIds`, and every path that currently calls `withFriendIds` must load
   it too — extend that helper (`withCircleIds`) rather than adding a second
   one, so a path cannot enrich one circle and forget the other. That covers
   its **6 call sites, all inside `api/utils/things/things.ts`** — no other
   file calls the helper.

   **Extending the helper is not sufficient.** Two paths bypass it and call
   `friendIdsOf` directly, so they will keep compiling and keep resolving
   family to owner-only unless the family set is threaded by hand:

   - `routes/api/v1/things/views/_views.tsx` loads the set itself and passes
     it as the `friendIds` argument of `recordPostViews`, which assembles its
     own `AclViewer` literal (`api/utils/things/views.ts`). Miss it and views
     on family-only posts silently stop counting.
   - the notification fan-out in `things.ts` (`friendIdsOf(actor.id)`), which
     gates `post-from-friend`. Whether family-only posts fan out at all is a
     product decision — make it deliberately rather than by omission.

   A missed site fails *closed* (owner-only), which is safe but silent — hence
   the live proof below.

**Index caution:** `acl` and `thingtime` are both arrays on every things-era
doc, so they cannot be keys in the same compound index — Mongo rejects every
insert with code 171 (hit for real on #134). Any new index supporting
circle-filtered queries has to respect that.

## Tests & verification (the bar for the implementing session)

- Unit: acl evaluation table tests for the family grant + exclusion interplay —
  `['-tt:all','tt:userFamily']` visible to a member, invisible to a stranger,
  and invisible to an **excluded** member (`-tt:user/<b>`). Add the friends
  equivalents if they are still missing.
- apiTests: `users/family` guarded (401 anon, 404 unknown target), intent
  validation shapes, idempotence on repeated intents.
- **Live two-user proof** (register A + B through the real API): B cannot see
  A's family-only post → A requests, B accepts → B sees it in feed, direct
  fetch, and search → A removes B → gone again; owner always sees own; a third
  user C never sees it; a *pending* request grants nothing. Verify in ranked
  mode and via `/search` (both share `visibilityQueryFor`).
- Perf: confirm the family lookup index exists in `ensureIndexes` and the feed
  query plan stays indexed with the new clause.

## Explicitly out of scope (v1)

Custom (non friends/family) circles — the acl grammar is fixed; adding circles
means new `tt:user<Name>` tokens and a registry change, a separate decision.

## Origin

claude-todo/10 → "Circles become real (L)". First specced by session 4 of the
2026-07-21 parallel batch (PRs #92, #130–#139 are the rest of the bank).
**Revised 2026-08-29** by Lopu: the friends half shipped in the interim, so the
original design section described a model the codebase had already solved a
different — and better — way.
