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
5. **GitHub stopped synchronizing the PR head** after the graphify refresh commit: `scripts/graphify update .` pruned the 170 snapshot files develop tracks (1.4 GB, 37 M lines), and GitHub's compare API answered "this diff is taking too long to generate" — the PR sat at the docs commit with `commits: 2` for 40 minutes while the branch was three commits ahead. Restoring develop's `graphify-out` on the branch (`git checkout origin/develop -- graphify-out`, drop the branch-only snapshot) synchronized the PR in 10 seconds. This PR therefore carries no graphify-out changes; the graph refresh belongs to the merge-time hooks. The `api.admin-migrations` / `api.mongodb-raw-results` bumps also had to move from the unread `featureVersion` field to `contractVersion`, which is what the capabilities manifest publishes.

## Review round (Lopu, 2026-09-02) — two defects fixed in `ciControlRelocationCore.ts`

Both were reproduced against a real MongoDB 8.0.29 replica set before and after
the fix, and both are covered by new unit tests (the file goes 11 → 13 tests).

1. **`relocate-ci-control-telemetry` silently lost shareId-less rows.** `things`
   indexes `shareId` unique **sparse**, so a legacy `ci-*` row can legitimately
   carry none. The copy was keyed on `{ shareId: relocated.shareId }`, which for
   such a row serializes to `{ shareId: null }`: the first one upserted a
   `shareId: null` doc and every later one *matched* it, was counted as
   `copied`, and was then deleted from `things`. Repro: two shareId-less rows in
   → one row on the satellite, both deleted, `copied: 2`. Unrecoverable, and
   silent — the migration reported success. Fix: `relocationShareId()` falls
   back to a deterministic `ci-relocated-<_id>` key (cannot collide with a real
   `ci-` + 48-hex id, and re-runs still insert-if-absent — verified). Repro now
   gives 4 in → 4 out with a truthful count.
2. **The boot ensure could abort `rebuild-things-indexes` mid-run.** This PR's
   own `pruneRebuildTwins` runs inside `ensureIndexes`, which any bootstrap
   caller (a signup on a fresh serverless instance) can trigger during the
   multi-minute step-3 rebuild. It drops the live `__rebuild` twin, so the
   rebuild's own `dropIndex` raised `IndexNotFound` (27) and the run died
   partway — skipping the remaining indexes and the closing `ensurePlan()`.
   Repro: `THREW code=27`, 3 of 3 indexes not rebuilt. Fix: `dropIndexIfPresent`
   — every drop in the rebuild is "converge this name to absent", so an index
   already gone is the state it wanted. Repro now completes 3 of 3 while the
   pruner drops 2 twins underneath it.

Independently re-verified after the fixes (MongoDB 8.0.29): 7 plan indexes
rebuilt one at a time, 3 unique constraints held by twins, index name set
identical before/after, zero twins left, 79 concurrent duplicate-`shareId`
inserts **all** rejected (0 accepted), wildcard text index round-tripped with
identical weights and `$text` still working, TTL + partial filter preserved.

The partial-`kind` swap was also confirmed on 8.0.29: same-key indexes differing
only by `partialFilterExpression` coexist (so the create-then-drop swap really
is slot-safe), and both `{kind:'post'}` and `{kind:{$in:[…]}}` use the partial
index — the feed `$or` still plans `SORT_MERGE`, no blocking sort.

## Review round 2 (Lopu, 2026-09-02) — the text index now really is rebuilt last

`rebuild-things-indexes`'s operator-facing description promises "the wildcard
text index is rebuilt last, so ranked text search errors for the seconds it
takes to build". It did not: `rebuildPlanIndexes` walked `listIndexes` order,
which is creation order, and replaying the real plan against MongoDB 8.0 put
`things_text_search` **36th of 57**. That ordering matters more than it looks —
`$text` against a collection with no text index is a hard `IndexNotFound (27)`
("text index required for $text query", reproduced), so ranked
`/api/v1/things/search` (`things/search.ts:578`) *errors* for that window while
every other plan index's absence only costs a scan. So the one hard-failure
window landed at an unpredictable point in the middle of a multi-minute
destructive run instead of at the end, where the description says it is.

Fixed by ordering text indexes last (`sort()` is stable, so every other index
keeps creation order), with the `{_fts,_ftsx}` test extracted to
`isTextIndexDefinition` so the ordering and the recreate path cannot disagree
about what a text index is. Re-verified on 8.0: `things_text_search` is now
57 of 57, and the full 57-index rebuild still round-trips **every index spec
byte-identically** (name set and full `listIndexes` output equal before/after,
10 unique constraints twinned, zero leftover twins, `$text` working after).
One new unit test covers the order for both the real run and the dry-run
preview.

Also independently re-validated on 8.0 this round, all clean: `thingsIndexPlanNames()`
matches the names MongoDB actually assigns **exactly** (57/57, no index left
`skipped`, so the rebuild cannot silently miss one); the relocation cursor
(`{thingtime:$in}, _id:$gt`, sort `_id`) plans `LIMIT ← FETCH ← IXSCAN{_id_}`
with **no blocking sort** — 500 docs examined per batch, 60k rows drained in
11.4 s (≈350 s for production's 1.82 M, matching the "re-run until pending is 0"
design); `relocate-ci-control-telemetry`'s `pending()` is a pure index scan
(500k rows counted in 353 ms, 0 docs examined); and the unique+`partialFilterExpression`
twin coexists with, and enforces uniqueness in place of, both the sparse
(`shareId_1`) and partial (`things_reaction_unique`) originals.

Second fix: the `/migrations` storage table had adjacent numeric columns
**Docs** (a count) and **Documents** (bytes). Renamed to `Doc bytes` and
`Index bytes · count` — this table is where an operator decides to run a
destructive migration, so two near-identical numeric headers meaning different
things is worth one word.

## Verification

- Unit suites green: collections 34, ci-control 59, migrations 48, schemas 109, capabilities 4, migration UI 5; typecheck ratchet at baseline (108).
- Live local stack (MongoDB 8.0 replica set, real API): 20 signed deliveries → 0 CI rows in `things_v2`, satellite rows with 14/30/90-day stamps, 1 repository event; relocation fixture (2,307 rows) dry-run wrote nothing, confirmed run relocated 807 / deleted 2,307 / kept the live satellite row's newer state; rebuild of 57 indexes with 10 twins, index set identical, text search working, duplicate probe 20,423 rejected / 0 accepted.
- `/migrations` panel checked at desktop (1280) and mobile (375) widths.

## Production rollout

Deploy → `relocate-ci-control-telemetry` (dry run, confirm, repeat until drained) → `rebuild-things-indexes` (dry run, confirm) → optionally `drop-stale-collection-generations` and an Atlas compaction. Expected: `things_v2` ≈ 4.5 k docs / tens of MB of index / 57 indexes; `ciControl_v1` bounded by retention.
