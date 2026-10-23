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

## Round 2 — ACL permissions + full CRUD on one endpoint (2026-07-10, same PR)

- **`acl` replaces the stored visibility enum** on the root Thing schema: tt: grants plus `-`-prefixed exclusions (`tt:all`, `tt:user` owner, `tt:userFriends`, `tt:userFamily`, `tt:user/<username>`, `tt:inherit` on attached things). Evaluation is most-specific-entry-wins with exclusions winning ties, owners always view; circles resolve to owner-only until a relationship graph exists. Legacy visibility names map in (`private` → `['tt:user']`, `friends` → `['-tt:all','tt:userFriends','tt:user']`, …) and derive back out on the wire, so the frontend composer, Magic, and seeds keep working unchanged. DB queries are a coarse superset (`acl`/legacy-visibility clauses) with exact in-memory `canView` filtering per page; new standalone multikey index `{acl, createdAt, shareId}` (acl+thingtime can't share a compound index — parallel arrays).
- **`/api/v1/things` now does all of CRUD**: GET (read/list), POST (create), PUT (upsert by caller id — 201 create / 200 replace-crystal-whole, thingtime immutable), PATCH (merge update), DELETE (`?id=` or body). Sub-routes stay as sugar; useApi speaks the unified verbs now. Docs `ApiHttpMethod` widened (badge colors + Net::HTTP class mapping updated); 11 request examples on the things entry covering every verb + acl shapes.
- Migration `things-v1-to-v2` now writes `acl` (mapped from each doc's visibility) and `$unset`s the enum; exploded comments/reactions carry `['tt:inherit']`.
- Verified live: two service accounts + anon — friends-only post invisible to non-owners (404 + feed-filtered), public-except-B post visible to anon but 404/feed-filtered for the excluded user (who also can't comment on it), PUT create→replace→cross-owner-steal-404, PATCH crystal+acl retarget, malformed acl → 400, legacy visibility input mapping. Migration re-verified on a fresh dump-restore: 31 posts + 38 exploded things, feed before/after diff EMPTY (sorted-key normalization), re-run no-op, migrated docs carry acl with zero visibility residue.

## Post-merge adversarial security review (2026-07-10)

After merging main, a 4-dimension adversarial review (each finding verified by an independent skeptic) confirmed 5 issues, all now fixed and re-verified live:

- **HIGH — `listThings` target-mode ACL leak.** `GET /api/v1/things?target=<viewable post>` returned every attached thing without a per-doc audience check. Comments/reactions (`tt:inherit`) were fine, but a private *share* carries its own acl (`['post','share']` + targetId) — its secret caption/author leaked to anyone (incl. anon). Fix: filter the page through `canViewInherited` before projecting (things.ts:listThings). Verified: anon gets 0, owner still sees own, inherit comments still list.
- **HIGH — reaction-cap bypass (DoS).** Caps lived only in `toggleReaction`; `POST /api/v1/things {thingtime:['reaction']}` minted uncapped reaction things → unbounded feed-payload/memory growth. Fix: `enforceReactionCaps` helper applied inside `createThing` (single source across both eras). Verified: 25 distinct reactions via the generic path → 20 accepted, 5 rejected.
- **MED — generic `/things` had no rate limit**, bypassing main's per-op limits. Fix: route each op to its key (`things.react`/`things.comment`/new `things.write`); service accounts (bulk sync like Magic vault) exempt from the general write throttle. Verified: human 65 rapid creates → 60 ok + 5×429; service account exempt.
- **MED + LOW — migration id-squat data loss.** The relational-conversion loop deleted the source doc unconditionally after a no-op `$setOnInsert`, and the embedded loop `$unset` cleared data even when a foreign doc squatted a deterministic destination id. Fix: verify the destination is a genuine counterpart (owner+target) before deleting; leave a collided post at v1 (reads fold it) for a safe re-run; reserve the `react-` id prefix in `sanitizeShareId`; exclude skipped ids from re-batching. Verified on a squat-injected throwaway: embedded comment preserved, squatter not hijacked, re-run after removal completes the migration.

The fixes were themselves adversarially re-verified (two more rounds), which surfaced and closed three residuals: the rate-limit **service exemption** was trivially bypassable (unauthenticated service-account provisioning ⇒ accountKind confers no trust) so it became a bounded higher ceiling instead; comment/reaction ops created via **PUT upsert** (not just POST) were routed to their universal caps; and the dedicated **`/things/share`** route (which mints a post per call) was unthrottled ⇒ now rate-limited like the generic write path. `things/update` and `things/delete` stay unthrottled by design — bounded to the caller's own existing content, and limiting delete would break Magic's bulk snapshot prune.

## Follow-ups worth considering

- `POST /api/v1/auth/service-account` and `POST /api/v1/mongodb/populate` remain unauthenticated (pre-existing; populate is 200-smoke-tested deliberately).
- Comment pagination beyond the latest-20 window (unified `GET /api/v1/things?target=` already supports cursors).
- A relationship graph so `tt:userFriends` / `tt:userFamily` grant beyond the owner; group acls (`tt:group/<id>`) parse already but match nothing.
- Themes still use their own private/public enum — could adopt acls later.
- The `kind:'record'` + `extended` experimental docs from the parallel branch could migrate into `thingtime`/`crystal` once that branch's intent lands.
