# 17 — Circles become real 💞

> **Status: 📐 Specced (2026-07-22), ready to implement.** Graduated from the
> claude-todo/10 idea bank per its own rule ("each idea graduates to its own
> `claude-todo/NN-*.md` when picked up"). Numbered 17 because 14–16 are taken
> on in-flight branches (editor drag/drop, schema vocabulary,
> everything-is-a-thing). Implementation is deliberately left for a
> fresh-context session: this touches the acl visibility layer — the most
> security-sensitive query path in the app — and deserves undivided attention.

## What it's for

Posts can already target `friends`/`family` circles and `FeedFilters` exposes
them — but **no UI or API adds anyone to a circle**, so non-public circles are
decorative: `visibilityQueryFor`'s DB clauses and the exact `canView`
evaluation both resolve `tt:userFriends`/`tt:userFamily` to the owner only
("until a relationship graph exists" — `schemas/registry.ts`). This spec adds
that relationship graph. It is the missing social layer everything else
(circle posts, circle feed filters, `CIRCLE_META` labels) already anticipates.

## What already exists (verified against origin/main 0a9b2df)

- **acl grammar** (`schemas/registry.ts` L84–103, `acl` field doc L275):
  `tt:all`, `tt:user` (owner), `tt:userFriends`, `tt:userFamily`,
  `tt:user/<username>`, each optionally `-` prefixed to exclude; `tt:inherit`
  on target-attached things. Most specific matching entry decides; owners
  always view. `['-tt:all','tt:userFriends','tt:user']` is friends-only.
- **Query side** (`api/utils/things/things.ts`): `visibilityQueryFor(viewer,
  circles)` builds DB clauses (public containment + viewer's own things);
  `canView`/`canViewInherited` then do exact per-doc evaluation (exclusions,
  specific-user grants). Circle entries currently grant nobody but the owner.
- **UI**: `CIRCLE_META` (`components/Feed/feedTypes.ts`) labels
  public/friends/family; the composer can post to circles; `FeedFilters`
  filters by them; `ProfilePage` renders other users (wornTheme chip pattern
  from PR #132 shows where profile actions live).
- **Storage doctrine**: users and their state are dual-era things
  (`api/utils/auth/users.ts`); new persistent state belongs in the things
  store via the API layer — never direct Mongo from UI/tests (FUNDAMENTALS).

## Design

### Model: membership lives on the OWNER's user thing

One document decision (single source of truth, no fan-out): each user's
circles are a field on their own user thing's **crystal** (public-profile side,
NOT the secure blob — usernames aren't secrets, and the visibility resolver
must read them cheaply):

```
crystal.circles: {
  friends: string[]   // member userIds (users' shareIds), deduped, capped
  family:  string[]
}
```

- **Caps**: 500 per circle (MAX_CIRCLE_MEMBERS) — bounds the `$in` clauses.
- **Asymmetric by design** (v1): "A adds B to A's friends" means B can see A's
  friends-circle posts. No consent handshake in v1 — being granted read access
  to more content is not something B needs to approve (it mirrors how
  `tt:user/<username>` grants already work). A optional follow-up can add
  notifications ("@a added you to their friends 💞" via Lopu) and a block
  list. Blocking/exclusions already exist at the acl level (`-tt:user/<b>`).

### API (all through the API layer, per FUNDAMENTALS)

New route family `api/v1/users/circles` (+ dispatcher keys + apiDocs entries +
`useApi` client methods), all session-authed, Fail-union results, rate-limited
with `enforceRateLimit` where mutating:

- `GET  /api/v1/users/circles` — the caller's circles, usernames resolved
  (`{ friends: [{id, username}], family: [...] }`).
- `POST /api/v1/users/circles` — `{ circle: 'friends'|'family', username }` —
  add by username (resolve via `findUserByUsername`; 404 unknown; 400 self or
  cap; idempotent on repeat).
- `POST /api/v1/users/circles/remove` — same body — remove (idempotent).

Membership writes go through the users utils (`mutateUserThing…` family) so
both storage eras stay coherent, mirroring `setUserActiveTheme`.

### Visibility resolution — the security-critical part

Two places must agree (test == live):

1. **Exact check** (`canView`): when the acl entry under evaluation is
   `tt:userFriends`/`tt:userFamily`, the viewer matches iff
   `owner.crystal.circles[circle]` contains the viewer id. Owner doc is
   already loaded in the inherited path; where it is not, fetch via the same
   dual-era user lookup the reaction path uses. **Most-specific-wins ordering
   is unchanged** — `-tt:user/<x>` still beats a circle grant.
2. **DB clauses** (`visibilityQueryFor`): add, for a logged-in viewer,
   a clause for docs whose owner has the viewer in the matching circle. Two
   options; **pick (a)** unless profiling says otherwise:
   - (a) *Reverse lookup first*: one indexed query for owner ids that list the
     viewer (`things` where `thingtime:'user'` and
     `crystal.circles.friends: viewerId` — needs two new indexes), then
     `{ ownerId: { $in: ownerIds }, acl: 'tt:userFriends' }` (same for
     family). Bounded by how many people list the viewer; cache per request.
   - (b) Post-filter only: DB returns candidates, exact `canView` trims. Risky
     for pagination (short pages), rejected.
   The exact evaluator remains the authority — DB clauses may over-fetch,
   `canView` must still gate every returned doc (this is already the
   feed's structure: "exact acl evaluation — the DB match is a prefilter").

### UI

- **ProfilePage** (other users): an "Add to circle 💞" button beside the worn
  theme chip → menu Friends 💛 / Family 🏡 (labels from `CIRCLE_META`), state
  reflects current membership, remove inline. Lopu confirms both directions.
- **Settings**: a small "My circles" manager (list + remove) — mirror
  AlgorithmManager's row pattern.
- **Composer/FeedFilters**: no changes — they already speak circles.

### Tests & verification (the bar for the implementing session)

- Unit: membership normalization (dedup/cap/self-rejection) if a pure seam is
  extracted; acl evaluation table tests for circle grant + exclusion
  interplay (`['-tt:all','tt:userFriends']` visible to member, invisible to
  stranger, invisible to EXCLUDED member `-tt:user/<b>`).
- apiTests: circles endpoints guarded (401 anon), validation shapes.
- **Live two-user proof** (register A + B via the real API): B cannot see A's
  friends-only post → A adds B → B sees it in feed + direct fetch + search;
  A removes B → gone again; owner always sees own; a third user C never sees
  it. Verify the same in ranked mode and via `/search` (both share
  `visibilityQueryFor`).
- Perf: confirm the reverse-lookup indexes exist (`ensureIndexes`) and the
  feed query plan stays indexed with the new clauses.

## Explicitly out of scope (v1)

Consent handshakes, circle-membership notifications, custom (non
friends/family) circles — the acl grammar is fixed; adding circles means new
`tt:user<Name>` tokens and a registry change, a separate decision.

## Origin

claude-todo/10 → "Circles become real (L)". Specced by session 4 of the
2026-07-21 parallel batch (PRs #92, #130–#139 are the rest of the bank).
