# PR #583 — feat(mongodb): move CI telemetry to a ciControl satellite and reclaim things index storage

- **Branch:** `claude/thingtime-mongodb-index-storage-dffe19` → `develop`
- **PR:** https://github.com/lopugit/thingtime/pull/583
- **Report:** `docs/architecture/mongodb-index-storage-audit.md` (production measurements + rollout runbook)

## Problem

Production `things_v2` (measured read-only on 2026-09-02): 1,824,527 docs, 1,177 MB logical / 322 MB on disk, 64 indexes = 3,147 MB. 99.75 % of the rows were `ci-*` webhook telemetry written since August (~270 k rows/day by 2026-09-01), every row paying an entry in every index plus the wildcard text index. Seven indexes served nothing (five for a pre-Things model, two CI-only), five `kind_*` indexes held only nulls, and the collection sat at the 64-index cap so any new index failed the boot ensure.

## Change

| Area | What |
| --- | --- |
| Registry | `COLLECTION_SCHEMA_VERSIONS.ciControl = 1`; CI schema descriptions name the satellite + retention |
| Collections | `getCiControlCollection()`, `createCiControlIndexes()` (6 indexes, TTL on `expiresAt`), 7 names added to `RETIRED_THINGS_INDEXES`, `kind_*` + sandbox TTL → partial swaps, `createIndexReplacing` cap fallback (code 67), `pruneRebuildTwins`, `ensureHomeThingsIndexPlan` + `thingsIndexPlanNames` |
| CI store | `store.ts` / `featureStackStore.ts` / `featureStackProgress.ts` on the satellite; `expiresAt` stamped from `retentionCore.ts`; `upsertCiEntity` `eventPolicy` ('on-change' for the repository row in `webhooks.ts`) |
| Migrations | `relocate-ci-control-telemetry`, `rebuild-things-indexes` (core in `ciControlRelocationCore.ts`), storage census on `getMigrationStatus` |
| Admin UI/API | `/migrations` panel storage columns + bloat badge (`migrationUiCore.ts` helpers); `api.admin-migrations` 1.1.0; `ciControl` in the query workbench allowlist, `api.mongodb-raw-results` 1.1.0 |
| Docs | FUNDAMENTALS §3, README (CI retention env + storage hygiene), TESTING checklist, DECISIONS, apiDocs |

## Debugging rounds

1. **Local boot ensure hit the 64 cap** on the shared worktree mongod while swapping `sandboxExpiresAt_1` (six parallel create-then-drop swaps need six free slots). Fix: `createIndexReplacing` degrades to drop-then-create on error 67 when it has legacy names to make room with; the retired-name prune runs first and frees seven slots on production.
2. **First index rebuild design tripped the cap mid-run**: it created all ten unique twins up front, then the plan re-create needed 57 more slots (69 > 64). The twins did hold uniqueness (probe: 12,753 E11000, 0 accepted) but the run aborted with `CannotCreateIndex`. Fix: one index at a time (twin → drop → recreate from the live definition → drop twin), text index recreated from its `weights` map.
3. **The migration runner could not start the repair**: `acquireMigrationLease` awaits `ensureIndexes()`, and the leftover twins kept the collection at the cap, so `ensureIndexes` failed before the migration ran ("rejected"). Fix: the boot ensure prunes `__rebuild` twins first.
4. The migrations panel is at `/migrations` (docs previously pointed at `/docs/schemas`); an env-allowlisted admin username cannot be registered, so bootstrap a local admin by registering first or via `POST /api/v1/admin/set-admin`.

## Verification

- Unit suites green: collections 34, ci-control 59, migrations 48, schemas 109, capabilities 4, migration UI 5; typecheck ratchet at baseline (108).
- Live local stack (MongoDB 8.0 replica set, real API): 20 signed deliveries → 0 CI rows in `things_v2`, satellite rows with 14/30/90-day stamps, 1 repository event; relocation fixture (2,307 rows) dry-run wrote nothing, confirmed run relocated 807 / deleted 2,307 / kept the live satellite row's newer state; rebuild of 57 indexes with 10 twins, index set identical, text search working, duplicate probe 20,423 rejected / 0 accepted.
- `/migrations` panel checked at desktop (1280) and mobile (375) widths.

## Production rollout

Deploy → `relocate-ci-control-telemetry` (dry run, confirm, repeat until drained) → `rebuild-things-indexes` (dry run, confirm) → optionally `drop-stale-collection-generations` and an Atlas compaction. Expected: `things_v2` ≈ 4.5 k docs / tens of MB of index / 57 indexes; `ciControl_v1` bounded by retention.
