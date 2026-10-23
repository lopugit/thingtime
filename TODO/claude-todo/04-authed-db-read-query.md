# 04 — Authed DB Read + Query 🔴

**Status:** Not started (depends on #02 seeding and #03 auth).

## Goal
Authenticated reading and querying of `things` through the Thingtime API. Only a
logged-in user can read, and (eventually) only the things they're allowed to see.

## What exists (to build on)
- `remix/app/routes/api/v1/mongodb/raw-results/_raw-results.tsx` — currently
  returns `things.find().toArray()` with **no auth** and no query filtering.
- `remix/app/components/MongoDB/{Raw,RawResult,RawResults}.tsx` — render results.
- `useApi().v1.mongodb.rawResults({query})` posts to
  `/api/v1/mongodb/raw-results` (query is accepted but currently ignored).

## Plan
- [ ] Add `getCurrentUser({request})` gate (from #03) to the read endpoints;
      return 401 when unauthenticated.
- [ ] Implement real query support: accept a `query` filter (whitelisted fields
      / safe operators only — do **not** pass arbitrary user input straight to
      Mongo) plus pagination (`limit`, `skip`) and sort.
- [ ] Add `GET/POST /api/v1/mongodb/query` (or extend raw-results) returning
      `{ results, total, page }`.
- [ ] Optional ownership scoping: filter by `ownerId == currentUser._id`.
- [ ] Wire the UI (`RawResults`) to pass a real query and show auth errors.

## Security notes
- Sanitise/whitelist query input to avoid NoSQL injection (no raw `$where`,
  no operator injection from the client).
- Never return password hashes / session tokens in read results.

## Acceptance criteria
- Unauthenticated read → 401.
- Authenticated read returns seeded things, filtered by the provided query.
- Pagination works; sensitive fields are projected out.
