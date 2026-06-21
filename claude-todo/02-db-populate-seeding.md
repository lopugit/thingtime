# 02 — DB Populate / Seeding 🟡

**Status:** Partial — wiring exists but is broken/inconsistent.

## Goal
A reliable way to seed the database (starting with users) through the Thingtime
API, so we have data to read/query/auth against. Hitting the populate endpoint
should make `collections` go from 0 → N and insert known seed docs.

## What exists
- `remix/app/routes/api/v1/mongodb/populate/_populate.tsx` — POST action that
  calls `setup()` and returns success/failure.
- `remix/app/scripts/mongodb/setup.ts` — `saveUsers()` → for each seed user,
  `deleteMany({_id})` then `insertOne(user)` into `getCollection()`.
- `remix/app/scripts/mongodb/data/users.ts` — `rickDeckard` seed user +
  `getUsers()`.
- `remix/app/api/utils/mongodb/collection.ts` → `db('thingtime').collection('things')`.

## Problems to fix
1. **Wrong collection for users.** `setup.ts` writes users into
   `thingtime.things` (via `getCollection`), but auth reads users from
   `auth.users`. Seeded users are therefore invisible to login. → Decide the
   canonical location (see README; recommend `thingtime.users`) and make seed +
   auth agree.
2. **Plaintext password.** `rickDeckard.password = 'password'` is not hashed,
   but `userValidatePassword` does `bcrypt.compare`. Seed must store a
   **bcrypt hash** (e.g. `bcrypt.hash('password', 10)`).
3. **Connection consistency.** `setup.ts` → `connection.ts.getConnection()`,
   which depends on the fragile `get-connection` HTTP-ping route. Point it at
   the `getMongoUri()` source instead.
4. **No verification/output.** Return inserted counts + collection name so the
   API response is useful.

## Decisions (locked — see FUNDAMENTALS.md)
- **One `thingtime` db**; users live in `thingtime.users`.
- **Seed by calling the real register API** (`POST /api/v1/auth/register`), NOT
  by direct `insertOne`. The seed user schema is therefore identical to a real
  signup — password hashing, validation, and metadata all come from one path.
  This means register (#03) lands first; populate then just calls it.

## Plan
- [ ] Build `POST /api/v1/auth/register` first (#03) — bcrypt hash, schema,
      duplicate rejection, writes to `thingtime.users`.
- [ ] Rewrite `setup.ts` to seed by POSTing each seed user to the register
      endpoint (server-side fetch / direct action call), not `insertOne`.
- [ ] Define seed users as plain `{username, password, ...metadata}` (no
      pre-hashing — the register endpoint hashes).
- [ ] Return `{ inserted, skipped, collection }` from the populate action.
- [ ] Add a few seed users for query testing.

## Acceptance criteria
- POST `/api/v1/mongodb/populate` creates seed users **via the register
  endpoint** and reports counts.
- `/mongodb-status` shows `collections >= 1` afterward.
- A seeded user logs in successfully through the normal login flow (proves seed
  == signup cohesion).
