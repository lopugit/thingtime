# 🧠 Thingtime × Claude — Feature To-Do

This folder is our shared roadmap. Each file is one feature: what it's for, what
already exists in the code, what's missing/broken, the plan, and how we'll know
it's done.

Keep these updated as we build — they double as living docs and as context for
future Claude sessions (use alongside `graphify-out/` for codebase orientation).

## Status board

| # | Feature | Status | File |
| - | ------- | ------ | ---- |
| 01 | MongoDB connection status (footer + `/mongodb-status`) | ✅ Done | [01-mongodb-connection-status.md](./01-mongodb-connection-status.md) |
| 02 | DB populate / seeding | 🟡 Partial (broken) | [02-db-populate-seeding.md](./02-db-populate-seeding.md) |
| 03 | Auth — login / register / sessions / JWT | 🟡 Partial (inconsistent) | [03-auth-login-register.md](./03-auth-login-register.md) |
| 04 | Authed DB read + query | 🔴 Not started | [04-authed-db-read-query.md](./04-authed-db-read-query.md) |
| 05 | Authed DB write (create/update/delete) | 🔴 Not started | [05-authed-db-write.md](./05-authed-db-write.md) |

## Conventions we're settling on

- **All DB access goes through the Thingtime API** (`remix/app/routes/api/v1/...`)
  and the API utils layer (`remix/app/api/utils/mongodb/...`). UI never touches
  Mongo directly.
- **Single source of truth for the Mongo connection string:** `getMongoUri()` in
  `remix/app/api/utils/mongodb/status.ts` (resolves `MONGODB_CONNECTION_STRING`
  + `MONGO_PASS`). Other connection helpers should converge on this.
- **Databases & collections** (needs a decision — see #03): currently split
  across `auth.users` and `thingtime.things` inconsistently.

## ⚠️ Cross-cutting issue: which DB/collection?

The auth utils are inconsistent about where data lives:
- `userCheckExists` / `userValidatePassword` → `db('auth').collection('users')`
- `getUser` / `userCreateSession` → `db('thingtime').collection('things')`

Pick one model before building #02–#05. Recommendation: users in
`thingtime.users`, sessions in `thingtime.sessions`, things in `thingtime.things`
— all in one `thingtime` db, resolved via `getMongoUri()`.
