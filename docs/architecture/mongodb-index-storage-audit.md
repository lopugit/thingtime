# Thingtime production MongoDB: index storage audit and restructure

**Date:** 2026-09-02 · **Cluster:** Atlas `thingtime` (MongoDB 8.0.29, 3-member
replica set, Sydney) · **Database:** `thingtime` · **Method:** read-only probes
through the production app user (`$collStats`, `listIndexes`, aggregation);
nothing was written to production.

## 1. The question

The Atlas dashboard shows roughly **3 GB of index storage** against roughly
**300 MB of documents** on the `things` collection. Why, and what should the
database look like instead?

## 2. What production actually holds

| Measure (things_v2)                      | Value           |
| ---------------------------------------- | --------------- |
| Documents                                | **1,824,527**   |
| Uncompressed document bytes (`size`)     | 1,177 MB        |
| On-disk document bytes (`storageSize`)   | 322 MB (snappy) |
| Average document                         | 676 bytes       |
| Indexes                                  | **64** (the MongoDB hard cap) |
| Total index bytes                        | **3,147 MB**    |
| Whole database on disk                   | 3,483 MB        |

The "300 MB of documents" is the compressed on-disk figure; the logical data
is 1.18 GB. Index entries are not block-compressed (prefix compression only),
so every full-collection index costs roughly one entry of key bytes per
document, and `things_v2` has nineteen of those.

### 2.1 Who wrote 1.8 million things

| Kind (`thingtime[0]`)  | Docs          | Share    | Owner    | storageClass |
| ---------------------- | ------------- | -------- | -------- | ------------ |
| `ci-event`             | **1,369,476** | 75.1%    | system   | control      |
| `ci-workflow-run`      | **433,924**   | 23.8%    | system   | control      |
| `ci-deployment`        | 9,514         | 0.5%     | system   | control      |
| `ci-preview`           | 7,100         | 0.4%     | system   | control      |
| `component` (seeded)   | 2,800         | 0.15%    | system   | control      |
| everything users made  | **≈ 600**     | 0.03%    | 49 users | content      |

**99.75 % of the collection is CI control-plane telemetry**, all created since
August (13 docs in June, 397 in July, 1,521,782 in August, 302,951 in the
first two days of September). Ingest on 2026-09-01 alone: **202,744
`ci-event` + 68,780 `ci-workflow-run` rows** — about 270k documents a day,
and accelerating with the all-branch automation.

Where it comes from (`api/utils/ciControl/webhooks.ts`):

- every GitHub delivery first upserts the `ci-repository` row **and records a
  `ci-event` for that upsert** — 672,052 events (49 % of all events) are
  "active → active" no-ops parented by the single repository row;
- 715,190 of 1,369,914 events have `statusFrom == statusTo`;
- every `workflow_job` delivery creates its own `ci-workflow-run` row
  (`externalId: job:<id>`): 399,296 of 433,924 "runs" are jobs, 354,140 of
  them with status `skipped`;
- nothing ever expired: no TTL, no retention, no cap.

### 2.2 Where the 3.1 GB goes

| Index                                                        | Bytes      | Note |
| ------------------------------------------------------------ | ---------- | ---- |
| `things_text_search` (wildcard `$**` text)                   | 582 MB     | tokenises every string of every CI row |
| `thingtime_1_parentId_1_createdAt_-1_shareId_1`              | 169 MB     | CI-only (events per parent) |
| `shareId_1`                                                  | 150 MB     | CI ids are 51 bytes (`ci-` + 48 hex) |
| `kind_1_createdAt_-1_shareId_1` and 4 more `kind_*`          | 5 × ~130 MB | **`kind` exists on 0 documents** — null entries only |
| `kind_1_typeId_*` ×4, `kind_1_deletedAt_*`                   | 5 × ~137 MB | fields no code has ever written (**≈ 685 MB of nothing**) |
| `things_ci_repository_updated`                               | 124 MB     | CI-only (dashboard sort) |
| 11 other general (thingtime/tags/acl/owner/target…) indexes  | 11 × ~125 MB | one 51-byte `shareId` suffix per CI row each |
| `sandboxExpiresAt_1` (TTL)                                   | 11 MB      | field exists on 0 documents |
| everything else (partial / sparse indexes)                   | < 60 MB    | correctly sized |

Two separate problems compound: **a firehose of machine telemetry sitting in
the user-content collection**, and **an index plan carrying dead weight** (five
indexes for a pre-Things data model, five v1-era `kind` indexes that index
nothing but nulls, and the collection parked at the 64-index cap so any new
index makes the boot ensure fail).

At the current ingest rate the index footprint would have grown by roughly
**1.7 GB per month**, and the collection would have crossed 10 million rows
in October.

## 3. What changed

### 3.1 CI telemetry moved to its own collection (`ciControl`)

Everything-is-a-thing stays true at the document level: a `ci-*` row keeps the
Thing envelope and its deterministic `shareId`. What changed is the physical
home. `COLLECTION_SCHEMA_VERSIONS.ciControl = 1` registers a home-pinned
satellite (`ciControl_v1`) reached through `getCiControlCollection()`, and
every reader and writer in `api/utils/ciControl/` uses it. Nothing outside
that module ever read a CI row (verified by search), so no other query changed.

Its index plan is sized for its two readers:

| Index                              | Serves                                             |
| ---------------------------------- | -------------------------------------------------- |
| `ci_control_share_id_unique`       | idempotent upserts by deterministic id             |
| `ci_control_repository_updated`    | dashboard: one kind for one repository, newest first |
| `ci_control_repository_status`     | dashboard stats: exact status counts (index-only)  |
| `ci_control_repository_external_id`| automation-policy / dispatch / stack lookups        |
| `ci_control_parent_created`        | per-parent history drawer                           |
| `ci_control_expires_at` (TTL)      | retention                                           |

No text index: CI rows are never searched.

### 3.2 Retention

`ciControl/retentionCore.ts` stamps root `expiresAt` on every retained row,
measured from its latest accepted update:

| Class                                             | Default | Env override                          |
| ------------------------------------------------- | ------- | ------------------------------------- |
| `ci-event`                                        | 14 days | `THINGTIME_CI_EVENT_RETENTION_DAYS`   |
| `ci-workflow-run` with a `job:` external id       | 30 days | `THINGTIME_CI_JOB_RETENTION_DAYS`     |
| top-level runs, `ci-deployment`, `ci-preview`     | 90 days | `THINGTIME_CI_ACTIVITY_RETENTION_DAYS`|
| repository, feature, branch, PR, policies, dispatch, feature stacks | never | `0` keeps any class forever |

### 3.3 Ingest de-noising

The repository row is upserted by every delivery but now records an event only
on an insert or an `active`/`archived` transition
(`ciControl/ingestPolicyCore.ts`, policy `on-change`). Entity events stay
`always` because a same-status delivery can still carry new data (a PR
`synchronize` keeps status `clean` while its head SHA moves). Measured on the
production distribution this removes ~49 % of event volume.

### 3.4 The `things` index plan

- **Retired by name at boot** (`RETIRED_THINGS_INDEXES`): the five dead
  pre-Things indexes and the two CI indexes. ≈ 980 MB in production.
- **Partial on `kind`'s existence**: the five v1-era `kind_*` indexes are
  swapped in place (create the replacement, then drop the old name, so no
  query ever sees neither) for `things_v1_kind_*`. Every predicate that uses
  them (`{kind:'post'}`, `$in`) implies the filter, so coverage is identical
  wherever v1 docs exist; on production they become empty. ≈ 650 MB.
- **Partial TTL** `things_sandbox_expires_at` replaces the unfiltered
  `sandboxExpiresAt_1`.
- The swap degrades to drop-then-create only when the collection has no free
  slot at all (error 67), so a database parked at the cap still converges.
- Boot also clears any `__rebuild` twins an interrupted index rebuild left
  behind (see 3.5), because the migration runner bootstraps indexes before a
  migration can run.

Steady state on production: 57 indexes on `things_v2`, 7 on `ciControl_v1`.

### 3.5 Two admin migrations (`/migrations`)

1. **`relocate-ci-control-telemetry`** (destructive, `confirm: true`): moves
   `ci-*` rows out of `things` into `ciControl`, applying retention as it goes
   — a row whose window has already closed is deleted without being copied
   (on production that is the vast majority: 1.37 M events of which only the
   last 14 days survive, and only ~30 days of job rows). Copies are
   insert-if-absent by `shareId`, so rows the live writers already re-created
   on the satellite keep their newer state. Each run works inside a time
   budget (`THINGTIME_CI_RELOCATION_BUDGET_MS`, default 120 s) and reports
   whether it drained; re-run until pending reads 0.
2. **`rebuild-things-indexes`** (destructive, `confirm: true`): deleting 1.8 M
   rows leaves every index file at its old size (WiredTiger keeps freed pages
   inside the file and only `dropIndex` releases them), so this drops and
   recreates every plan-owned index **one at a time**. Each unique index is
   protected by a same-key twin with an equivalent partial filter for the
   duration (MongoDB allows same-key indexes that differ by
   `partialFilterExpression`), so no duplicate can slip in; non-unique
   indexes are briefly absent; indexes the plan does not own are listed and
   left alone. `pending()` reports work while any plan-owned index is larger
   than 8× the collection's document bytes.

The admin migrations page now shows a **storage census per physical
collection** (document bytes, on-disk bytes, index bytes, index count, and an
orange `N× docs` badge when index bytes exceed 8× document bytes), and the
read-only query workbench can inspect `ciControl`.

## 4. Verification

Unit tests (`node --test`, all green): retention policy (8), ingest policy,
index budget incl. the new ciControl plan, partial swaps, the cap fallback and
twin pruning (8), relocation + rebuild cores with fake collections (10),
migrations (48), CI control (59), schemas (109), capabilities (4). Typecheck
ratchet: at baseline (108, unchanged).

Live on a local MongoDB 8.0 replica set through the real API:

- 20 signed synthetic GitHub deliveries (2 pings, 5 jobs × 3 transitions, 1
  run, 2 PR synchronize) → `things_v2` gained **0** CI rows; `ciControl_v1`
  gained 21 events (repository: **1**, the insert), 6 run rows, 1 repository,
  1 feature, 1 PR. Expiry stamps: event 14.0 d, job 30.0 d, run 90.0 d;
  entities none.
- Relocation fixture (2,307 pre-satellite rows seeded into `things_v2`,
  including 1,500 already past retention and a repository row sharing its
  `shareId` with the live satellite row): dry run reported 807 to relocate /
  1,500 past retention and wrote nothing; the confirmed run relocated 807,
  deleted all 2,307, left the one non-CI fixture post untouched, and the live
  repository row kept its newer state (`active`, not the stale `archived`).
- Index rebuild: 57 plan-owned indexes rebuilt one at a time, 10 unique
  constraints held by twins, one foreign residue index left alone, index name
  set identical before/after, zero twins left, wildcard text index rebuilt
  with identical weights and `$text` working. A concurrent probe inserting a
  duplicate `shareId` every few milliseconds for the whole run: **20,423
  rejected (E11000), 0 accepted**.
- The first rebuild design (all twins up front) was caught by this live run:
  it tripped the 64-index cap mid-run. The one-at-a-time design and the
  boot-time twin pruning are the fix.

## 5. Production rollout (owner runbook)

1. Deploy. Boot ensure prunes the seven retired indexes (≈ 980 MB released
   immediately — dropped index files are freed at once), swaps the six
   partial replacements, and creates `ciControl_v1` with its plan. New CI
   deliveries land on the satellite from the first request.
2. `/migrations` → `relocate-ci-control-telemetry`: dry-run, then run with
   confirm until it no longer reports "more rows remain" (expect several
   120-second runs for 1.8 M rows; each is idempotent).
3. `/migrations` → `rebuild-things-indexes`: dry-run, then run with confirm.
   Expected result on `things_v2`: ≈ 4.5 k documents, index bytes in the low
   tens of MB, 57 indexes.
4. `drop-stale-collection-generations` can also retire the empty legacy
   `things` (19 indexes, 0 docs) and the other empty unversioned collections
   the adoption pass left behind.
5. Optional: the `things_v2` collection file itself keeps ~322 MB of reusable
   pages after the deletes; Atlas reclaims that only through a compaction
   (an Atlas admin action, not available to the app user). Not required for
   correctness or performance.

Projected steady state: `ciControl_v1` bounded by retention (≈ 14 days of
de-noised events + 30 days of job rows ≈ 1–2 M rows at today's rate, on a
six-index plan without a text index), `things_v2` holding only user content.

## 6. Follow-ups worth considering

- **Ingest volume itself.** The all-branch automation generates ~70 k
  `workflow_job` rows a day, 80 % `skipped`. Recording jobs only for
  non-skipped conclusions, or only top-level runs, would cut the satellite's
  volume by an order of magnitude; that is a product decision about what the
  dashboard should show.
- **`shareId` as the tiebreaker suffix on every `things` index** costs 51
  bytes per CI id and ~20–40 per content id; a 12-byte `_id` suffix would be
  cheaper, but the chrono cursor grammar (`<ms>_<shareId>`) is public API.
- **Wildcard text index on `things`.** Now proportional to real content. A
  partial filter on `storageClass: 'content'` was verified to work on 8.0
  (the planner uses it when the query carries the predicate; an unscoped
  `$text` then errors), but it would exclude seeded system components and
  schemas from search, so it was not adopted.
- **Atlas tier.** The database is 3.48 GB on disk today and will be a few
  hundred MB after the rollout; check whether the current tier was sized for
  the bloat.
- **Graphify snapshots in git.** `develop` tracks 170 snapshot files
  (1.4 GB); a branch that runs `scripts/graphify update .` prunes them all
  and GitHub can no longer compute the pull request diff (it stopped
  synchronizing this PR's head until develop's snapshot set was restored).
  Either the wrapper should stop pruning on feature branches, or snapshots
  should leave git for a content-addressed store.
