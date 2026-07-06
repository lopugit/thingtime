# 05 — Authed DB Write (Create / Update / Delete) 🔴

**Status:** Not started (depends on #03 auth, complements #04).

## Goal
Authenticated writes to `things` through the Thingtime API: a logged-in user can
create, update, and delete their own things, with validation and ownership
checks.

## What exists (to build on)
- `remix/app/api/utils/mongodb/collection.ts` (`things` collection),
  `objectId.ts` (`getObjectId`), and the API route pattern under
  `remix/app/routes/api/v1/mongodb/...`.
- The external API server (`api/src/index.js`) already has a `/v1/thing`
  get/save endpoint backed by the `thingtime` package — decide whether authed
  writes go through the Remix API (preferred, consistent with the rest) or that
  Express server.

## Plan
- [ ] `POST /api/v1/mongodb/things` — create: require auth, validate body, stamp
      `ownerId`, `created`, `updated`, insert, return the created thing.
- [ ] `PATCH /api/v1/mongodb/things/:id` — update: require auth + ownership,
      validate, `updated` bump, return updated thing.
- [ ] `DELETE /api/v1/mongodb/things/:id` — delete: require auth + ownership.
- [ ] Shared `requireUser({request})` helper (401 if not logged in) and
      `assertOwnership(thing, user)` (403 if not owner).
- [ ] Input validation (shape, max sizes) before writing.

## Security notes
- Always derive `ownerId` from the authenticated session, never trust a client
  -supplied owner.
- Validate `:id` is a real ObjectId before querying.
- Ownership check on every update/delete.

## Acceptance criteria
- Unauthenticated write → 401; writing/deleting someone else's thing → 403.
- Create returns the new thing with server-stamped `ownerId`/timestamps.
- Update/delete only affect the owner's own things; round-trips via #04 read.
