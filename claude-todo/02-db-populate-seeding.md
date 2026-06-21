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

## Plan
- [ ] Decide canonical db/collection model (blocks this + #03).
- [ ] Rewrite seed users with bcrypt-hashed passwords.
- [ ] Make `setup.ts` write users to the canonical users collection via a shared
      connection helper.
- [ ] Return `{ inserted, collection, db }` from the populate action.
- [ ] Add a couple more seed users for query testing.

## Acceptance criteria
- POST `/api/v1/mongodb/populate` inserts seed users into the canonical
  collection and returns the inserted count.
- `/mongodb-status` shows `collections >= 1` afterward.
- A seeded user can be validated by `userValidatePassword` (bcrypt match).
