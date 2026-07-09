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

**Auth**
- Model: **httpOnly cookie carrying a signed JWT** (`sub`/`jti`/`exp`) **+ a
  Mongo `sessions` record for revocation**, with `Authorization: Bearer` also
  supported for API clients. Wanted JWT *and* revocability — Mongo is the source
  of truth for whether a token is still live.
- Service-account provisioning is **admin-only** and service bearer tokens are
  **expiring JWTs** backed by revocable Mongo sessions. The admin allowlist lives
  in server env (`THINGTIME_ADMIN_USER_IDS` / `THINGTIME_ADMIN_USERNAMES` /
  `THINGTIME_ADMIN_EMAILS`) so anonymous callers cannot mint durable backend
  credentials.
- **Email required from signup** (anti-spam + user validation), with an **email
  verification flow**. Initially considered email-optional + a localStorage/JWT
  password-reset; reversed it — emails matter from the get-go.
- **Email delivery:** console/dev stub for now, pluggable to a real provider
  later (flow built either way).
- **Signup UI:** a dedicated `/register` form (username, password, then email),
  separate from `/login`.
- **Unverified login:** allowed — `emailVerified` is just flagged; gate
  sensitive actions later. Prioritises smooth onboarding over hard gating.

_Add new entries as decisions are made. Keep the "why" — that's the valuable part._
