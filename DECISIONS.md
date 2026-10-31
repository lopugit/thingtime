# Decisions

A living log of engineering decisions and the thinking behind them. The point is
not just *what* was decided but *how* — so anyone (human or Claude) picking up
this codebase can predict the call that fits.

---

## Nikolaj Frey — Engineer Decisions

### Recurring principles (the thinking method)

These patterns show up again and again — default to them when unsure:

1. **Single source of truth, no fallbacks.** One way to do a thing. Unified the
   Mongo connection to exactly `MONGODB_CONNECTION_STRING` + `MONGO_PASS` and
   removed the legacy fallback vars — "I don't want multiple var fallbacks."
2. **Determinism over convenience.** Commit lockfiles; pin versions; no floating
   drift between local / CI / prod. (Tracked down a global-gitignore that was
   hiding `pnpm-lock.yaml` and fixed it.)
3. **Functionality cohesion: test == live == direct API.** Seed and test data by
   calling the *real* API (e.g. seed users via the register endpoint), never by
   writing to the DB directly — so a seeded entity and a real one can never
   drift. This is a top-level value (see `FUNDAMENTALS.md` §2).
4. **Consistency across the codebase.** One `thingtime` db, consistent
   collections; no `auth.users` here / `thingtime.things` there.
5. **Security-conscious by reflex.** Caught a connection string with password
   leaking out of the status endpoint; wants secrets stripped, tokens revocable.
6. **Clean git history.** Dislikes squash merges — prefers **merge commits** that
   preserve the individual commits. (We rewrote a squash into a merge commit.)
7. **Wants to be consulted on real forks, with a recommendation.** Likes being
   given clear options + a recommended default, then moves fast.
8. **Verify before declaring done.** Values builds passing and behaviour checked
   live (e.g. confirmed the Mongo status + `.data` endpoints on the real deploy).

### Decision log

**Git / process**
- Merge strategy: **merge commits, not squash** (preserve individual commits).
  A repo *ruleset* was silently blocking merge commits — found and disabled it.
- Lockfiles: **committed** (`pnpm-lock.yaml` tracked), versions pinned to avoid
  skew. Root cause of a `v3_singleFetch` type error was a stale local
  `@remix-run/dev`; floor bumped to `^2.13.1` + lockfile tracked.

**Data layer**
- **One `thingtime` database**, collections `users` / `sessions` / `things`.
- **One Mongo connection source:** `mongodb/config.ts` `getMongoUri()`
  (`MONGODB_CONNECTION_STRING` + `MONGO_PASS`), no fallbacks.
- **Seed via the real API**, not direct DB writes (cohesion, principle #3).
- **Machine telemetry gets a satellite, not a seat in `things`** (2026-09-02).
  The CI control plane (`ci-*` Things, incl. the append-only `ci-event`
  history) had become 99.75% of `things_v2` — 1.82M rows since August, growing
  ~270k/day — and every one paid an entry in each of the collection's 64
  indexes (3.15 GB of index for ~4.5k real content docs, at the 64-index cap,
  wildcard text index tokenizing CI payloads). Decision: keep
  everything-is-a-thing at the DOCUMENT level (same envelope, same
  deterministic shareIds), but give high-volume, short-lived, never-searched
  control-plane rows their own home-pinned physical collection (`ciControl`)
  with a purpose-sized index plan and TTL retention (`expiresAt`: events 14d,
  job rows 30d, runs/deployments/previews 90d, entities never). Storage
  history that is not a transition is not history: a delivery that changes
  nothing on the repository row records no event (it was half of all events).
  `things` keeps only what users read and search. Audit + measurements:
  `docs/architecture/mongodb-index-storage-audit.md`.
- **Indexes are a budget, and dead ones are retired by name.** Five indexes on
  production served fields no code has ever written (a pre-Things data model);
  they are pruned at boot via `RETIRED_THINGS_INDEXES`, v1-era `kind_*` indexes
  are partial on `kind`'s existence, and index files are reclaimed after mass
  deletes by an explicit rebuild migration (unique constraints held by a twin
  throughout) — never by hoping WiredTiger shrinks a file.

**Auth**
- Model: **httpOnly cookie carrying a signed JWT** (`sub`/`jti`/`exp`) **+ a
  Mongo `sessions` record for revocation**, with `Authorization: Bearer` also
  supported for API clients. Wanted JWT *and* revocability — Mongo is the source
  of truth for whether a token is still live.
- **Email required from signup** (anti-spam + user validation), with an **email
  verification flow**. Initially considered email-optional + a localStorage/JWT
  password-reset; reversed it — emails matter from the get-go.
- **Email delivery:** console/dev stub for now, pluggable to a real provider
  later (flow built either way).
- **Signup UI:** a dedicated `/register` form (username, password, then email),
  separate from `/login`.
- **Unverified login:** allowed — `emailVerified` is just flagged; gate
  sensitive actions later. Prioritises smooth onboarding over hard gating.

**App platform (full-power app namespaces — `TODO/claude-todo/16-full-power-app-namespaces.md`, 2026-07-29)**
- **Namespace = server-stamped scalar root `appId`, NOT the acl.** Users can
  already hand-write `tt:app/<x>` acl entries through the site API
  (`sanitizeAcl` accepts them), so an acl-derived namespace is spoofable INTO
  an app's view — a confused deputy. Private app-data carries no app acl entry
  anyway, so acl-contains was never the membership predicate. And `acl` is
  multikey: a scalar `appId` can share a compound index with other fields
  where two multikey paths can't. The acl keeps its PR #150 meaning untouched:
  it is the AUDIENCE among the app's users; the namespace is `appId`.
- **Byte allowances replace doc counts, at both scopes.** The 200-key / 50-key
  caps bounded the wrong resource (an entry count says nothing about bytes).
  Every registered app Thing owns a server-controlled aggregate allowance and
  usage counter; each (user, app) also rides a service-quota-pattern counter
  Thing. A write reserves aggregate then user with guarded conditional
  `findOneAndUpdate` admission, race-safe and FAIL-CLOSED; user refusal
  compensates aggregate. Updates charge deltas, deletes refund both, and crash
  ambiguity can only over-count until the `$sum` reconcile pass. App developer
  update routes never accept allowance fields.
- **App plans and app-user sub-tiers have different homes.** The app's tier,
  optional administrator override, aggregate allowance, and aggregate usage
  live together on the app Thing, so a plan update and the hot admission
  ledger are one atomic document. Owners and linked co-managers change the
  tier/default through `/api/v1/apps/storage`; administrator-custom plans lock
  self-service tier changes. The default user cap starts at 50 MiB. Individual
  overrides live on protected relational `app-storage` Things rather than an
  unbounded map on the app, can be assigned in bulk, and are effective only up
  to the current whole-app ceiling. The normal `/apps/update` route still never
  accepts quota fields.
- **Consent surface deliberately unchanged.** `app-data` already covers
  namespace CRUD — richer querying just moves filtering server-side over bytes
  the app could already read, so no new scope is invented for the things
  surface; `app-data.shared` stays the EXACT cross-user gate (never implied by
  an ancestor). A future `app-data.public` would be its own consent line.
- **App responses never use the PublicPost aggregation.** That projection
  batch-embeds comments/reactions across ALL viewers (scope-blind children) —
  fine first-party, a leak under an app lens. Apps get generic thing
  projections and read children relationally inside the namespace; authors are
  shaped by each author's own grant (the /oauth/userinfo model everywhere).
- **Feed/social surfaces stay closed to apps** (`feed`, `things/user`, `save`,
  `share`, `reactions-recent`, `quota`): they expose the user's social graph,
  which no app-data grant covers. An app "feed" is a namespace search.

_Add new entries as decisions are made. Keep the "why" — that's the valuable part._
