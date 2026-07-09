# PR 59 — Everything is a thing: crystal payloads, thingtime schemas, /schemas browser, admin migrations

Branch: `claude/unified-thing-crystal-schemas` · https://github.com/lopugit/thingtime/pull/59

## The model

Every doc in `thingtime.things` follows one root **Thing** schema:

```jsonc
{
  "shareId": "uuid",            // public id — the only id clients see
  "schemaVersion": 2,            // root schema version stored per doc (absent = v1)
  "thingtime": ["post"],        // Thingtime Schema ids applied to this thing
  "crystal": { "type": "text", "text": "…" }, // sub-schema payload
  "ownerId": "…",
  "visibility": "public",       // + 'inherit' for target-attached things
  "targetId": null,              // comment → post, reaction → post, share → root post
  "tags": [],
  "createdAt": "…", "updatedAt": "…"
}
```

- Comments: `thingtime ['comment']`, `crystal { text }`, `visibility 'inherit'`.
- Reactions: `thingtime ['reaction']`, `crystal { emoji }`, one per user per target (toggle semantics preserved).
- Shares: `thingtime ['post','share']` — they ARE posts (feed-visible caption) targeting the ROOT shared post; share counts computed live from these docs.
- The registry (`remix/app/schemas/registry.ts`) is pure/client-safe and is the single source for API validation, `GET /api/v1/schemas`, and the `/schemas` page. Collection schemas (users, sessions, themes, …) are registered there too, and every write path stamps `schemaVersion` from `COLLECTION_SCHEMA_VERSIONS`.

## Era compatibility (the important design call)

Writes are always v2. **Reads merge v1 embedded residue** (embedded `comments` arrays, `reactions` maps, `shareOfId` docs) **with v2 standalone things**, so production works before, during, and after migration. Mutations clean residue as they go (a reaction toggle `$pull`s the user's embedded entry). The migration finishes the job; after it, merge-reads see only standalone things.

## Migrations (admin)

- Admin = `THINGTIME_PRIVATE_ADMIN_USERNAMES` env allowlist (name must keep `PRIVATE` — `root-data.server.ts` ships all other `THINGTIME_*` vars to the browser). `requireAdmin` in `getCurrentUser.ts`; computed `isAdmin` on `PublicUser` (+ hand-synced `CurrentUser` in `useCurrentUser.tsx`).
- `GET /api/v1/admin/migrations` — census: per-collection totals + docs per schemaVersion + pending migrations.
- `POST /api/v1/admin/migrations/run` `{ migration, dryRun? }` — idempotent runs. `things-v1-to-v2` explodes embedded comments (uuid preserved as the new thing's shareId) and reactions (deterministic `react-<post>-<user>-<emojiHex>` ids) into standalone things, converts share posts, moves payloads under `crystal`, `$unset`s legacy fields. Stray non-post docs in `things` (legacy prototypes: an old `tt.session` doc, a prototype user doc, `kind:'record'` experiments with an `extended` prop from another branch) are deliberately untouched and counted in the report notes.
- UI: `/schemas` bottom panel (admins only) — census table + per-migration Dry run / Run (inline confirm), Lopu-toast reports.

## Verification log

- CRUD + social via real API with service-account Bearer: legacy create, unified create, GET read/list-by-target, update (crystal merge revalidation), react toggle → clear → replace, comment, share (tags copied, `['post','share']`), delete cascade (comments/reactions die, share survives with `shareOf: null` placeholder), 400s for unknown schema / orphan comment, admin 401 for non-admins.
- Migration: mongodump of local db restored into a throwaway mongod (port 27567) + isolated Nitro (27801). Census before: things 43 docs all v1. Dry run predicted 29 matched / 34 creates. Run: 29 migrated, 34 created, 0 skipped. Census after: 63 v2 + 14 untouched strays; all stamp migrations green. Feed diff before/after: identical (only JSON reaction-map key order). Re-run: matched 0. Shared dev DB was only dry-run.
- Browser: /schemas desktop + 390px (fields tables scroll inside cards, no page overflow), admin panel dry-run toast, /docs/api entries incl. new `admin`/`schemas` groups, /feed rendering mixed v1+v2 data via merge-reads.
- The "blank feed" scare during verification was SPA scroll persistence across route changes (pressing End on /docs carried scrollY to /feed) — pre-existing behaviour, not this PR. Documented here for future archaeology.

## Consumer compat surface checked

- **Magic vault** (server/utils/thingtime.ts on Magic's redesign branch): `POST /api/v1/things` legacy body, `GET /api/v1/things/user` returning the owner's private posts with verbatim tags, `POST /api/v1/things/delete` by shareId, `GET /api/v1/auth/me` envelope — all unchanged (`isAdmin` additive).
- **iOS**: only calls `GET /api/v1/vercel/deployments` — untouched.
- **Seeds**: `POST /api/v1/mongodb/populate` still works (fixed shareIds pass through `sanitizeShareId`; fresh seeds are born v2).

## Security fixes riding along

- `POST /api/v1/mongodb/raw-results` was unauthenticated and dumped every private doc (incl. Magic's vault chunks); now admin-only, docs + tests updated.
- Client-supplied `shareId` on create (needed for seed idempotency) is now validated (string, ≤128 chars, no `$`/`.`/whitespace) instead of storing arbitrary JSON values.

## Follow-ups worth considering

- `POST /api/v1/auth/service-account` and `POST /api/v1/mongodb/populate` remain unauthenticated (pre-existing; populate is 200-smoke-tested deliberately).
- Comment pagination beyond the latest-20 window (unified `GET /api/v1/things?target=` already supports cursors).
- The `kind:'record'` + `extended` experimental docs from the parallel branch could migrate into `thingtime`/`crystal` once that branch's intent lands.
