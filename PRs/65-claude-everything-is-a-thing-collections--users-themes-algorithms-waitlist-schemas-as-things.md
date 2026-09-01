# PR #65 — Everything is a thing: satellite collections collapse into things

- **Branch:** `claude/everything-is-a-thing-collections` (stacked on
  `claude/search-page-mongodb-query-154eb4`, PR #63)
- **PR:** https://github.com/lopugit/thingtime/pull/65
- **Author:** Claude (AI), 2026-07-12
- **Design:** TODO/claude-todo/22-everything-is-a-thing-collections.md

## Shape

Users, themes, feed algorithms, waitlist entries, and the builtin schema
catalogue are things (`thingtime: ['user'|'theme'|'feed-algorithm'|'waitlist'|'schema']`).
Two new root mechanisms on ThingDoc: `uniqueKeys[]` (multikey unique sparse,
all elements BinData, PII hashed) and `secure{}` (never projected, secrets as
BinData — the `$**` text index tokenizes strings only). System kinds are
protected from the generic /api/v1/things CRUD. Reads are dual-era (things
first, frozen legacy collections fallback); five admin migrations convert
legacy docs idempotently (census + dryRun; source deleted only after its
destination twin is verified).

Key invariant: **user ids never change shape.** Migrated users keep their
legacy `_id` hex as the thing shareId; new users mint ObjectId-shaped ids.
sessions.userId, roster entries, ownerId joins, and active theme/algorithm
pointers all survive untouched, and `users.ts` adapts things back to the
legacy UserDoc shape so the entire auth web (loginUser, getCurrentUser,
admin.ts, service accounts, routes) is unchanged.

## Verification highlights (all live against the dev stack)

- Register/login/me/profile/post/people-search for things-era users; legacy
  users keep working; THEN the users migration converted all 88 legacy users
  and those same accounts still log in with their data intact.
- Themes: era-merged listing, acl-gated share links, 100-cap across eras,
  active-pointer clears in both user eras.
- Algorithms: ranked feed via migrated + things-era algorithms, training
  writes, 50-cap, mixed-era author labels; hot path kept ≤2 indexed reads
  (IXSCAN-verified).
- Waitlist: idempotent joins across eras; email exists only as BinData.
- Security: canary tokens present only in passwords/emails return zero search
  results; `q=email`/`q=username`/`q=waitlist-email` enumeration clean; zero
  plain-string uniqueKeys/secure values in Mongo; generic CRUD refuses system
  kinds (403/404 verified).
- Every migration re-run converts 0.

## Self-review round 1 (8-finder pass, commit 4b56c57)

An 8-angle adversarial review found + fixed (all live-verified):
- **Security (live-proven):** the `$**` text index tokenized string fields
  inside `secure`, so non-BinData fields (service metadata, active-* pointers)
  were an unauthenticated `q=<secret>` oracle. Fix: `secure` is now a single
  opaque BinData blob (nothing inside can tokenize); `admin` moved to a root
  boolean `secureAdmin` (partial-indexed). User things excluded from generic
  search (were a scrapeable directory + count oracle); raw-results projects out
  secrets; migration notes no longer echo doc content.
- **Correctness (multi-finder):** listUserPosts dual-era (profiles 404'd for
  migrated users); delete-from-both-stores (twin resurrection); migration
  data-loss window closed (re-read + updatedAt-guarded delete); mergeUserDocs
  sort-before-cap (legacy users starved); algorithm pointer-clear moved off a
  dotted secure path the blob broke; `schema-` shareId prefix reserved
  (squat/impersonation); fromBin Buffer ordering.
- **Efficiency/quality:** projected + parallelized dual-era reads; removed dead
  SystemThingOptions (system kinds never go through createThing → unconditional
  guards); buildUserSecure shared by insert + migration; registry constants
  deduped; docs reconciled.

## Self-review round 2 (regression pass on round-1 fixes, commit 49c73ae)

A focused round-2 review of the round-1 fix diff (the large secure-blob rework)
found exactly one regression and confirmed everything else correct (live-tested):
- **Fixed:** `mutateUserThingSecure` was a non-atomic read-modify-write of the
  opaque blob, so two concurrent mutations of different secure fields clobbered
  each other (proven live: a racing reaction write reverted a just-set
  emailVerified). Now guarded by an optimistic `secureVersion` CAS + retry with
  jittered backoff; `insertUser`/migration stamp `secureVersion:0`. Verified: a
  theme-pointer write concurrent with reactions keeps both; realistic 3-way
  concurrency loses nothing.
- **Confirmed correct (live):** `$nin` still matches field-missing v1 posts
  (legacy posts stay in search; schema browser unaffected); the
  emailVerificationRequiredBy Date round-trips through the blob with ms fidelity
  so the service-account gate holds; secureAdmin promote/demote is atomic; the
  migration data-loss guard converges (no infinite loop); the reaction-MRU
  dedupe is equivalent to the old $pull/$push.

Merged `main` (PR #62) into the search branch and this stacked branch; both PRs
are conflict-free, green, and mergeable.

## Implementation trail

Built across loop iterations by a 6-domain touchpoint-mapping workflow, then
per-domain subagents (themes/algorithms/waitlist) on the committed users
pattern, then a migrations agent — each live-verifying its own slice, with
integration smoke passes between commits (d5740be core+users, cc88bae domains,
642e43e migrations+docs).
