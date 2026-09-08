# PR #692 — Thing index consolidation

Branch: `codex/thing-index-consolidation`, base `develop`.
PR: https://github.com/lopugit/thingtime/pull/692

The owner authorized production/develop migrations and merge-commit releases
to both branches. `ai-merge-paused` keeps unfinished consolidation out of the
automatic merge path. This PR is independent of Watch PR #665.

## 2026-09-08 — baseline and migration preparation

- Full [architecture audit](../docs/architecture/thing-index-consolidation.md)
  accounts for every baseline index and records rollout gates.
- Production has 60 indexes; develop has 61, including the still-needed Watch
  recording due index. Both origins have zero root `kind` documents.
- The source plan is now introspectable without a database connection.
  Ordinary-prefix deduplication finds zero automatically safe candidates.
- Stop creating and retire the unused non-unique emoji lookup on home only.
  Preserve shared protected uniqueness and any older unique ancestor.
- Repair the relationship migration before switching readers: add missing
  individual keys, preserve existing keys, compare source identity, terminate
  on finite duplicate batches, and report actual writes and conflicts.
- Tests cover partial keys, reruns, data-kind isolation, empty optional keys,
  1,001 duplicate rows, concurrent edits, lease loss, and database failure.
  Migration capability patches and compatibility tests accompany the change.

## Outstanding release proof

The production workbench rejected `$indexStats` with MongoDB Location40602:
its privacy projection preceded a stage that must run first. A narrow fix
keeps the exact empty `$indexStats` stage first and retains the strip before
all subsequent document ingress. Tests retain protected-field probe rejection
and `$unionWith` stripping. Shared-key document queries remain blocked by the
workbench; this fix does not relax that restriction.

The initial preview is reachable at
https://pr-692.previews.dev.thingtime.com/migrations (first verified SHA
`8f83161868f1d9e2a8f4f34f8108feda9cd71ab8`). Its new origin requires an admin
login; the user has been asked to sign in. Full local unit/build/output checks
and the 108-error typecheck ratchet passed for migration repair `96cbd6bd3`.
That does not constitute native MongoDB or deployed migration proof.

No production/develop migration or merge is claimed yet. The source count of
47 is the intended post-migration home plan, not completion of the owner's request. The
deployed shared-key reader cutover, remaining index-family benchmarks, real API and
Mongo query-plan acceptance, deployed manifests, exact-head CI, and final
before/after production/develop inventory remain required.

## Shared relationship lookups — implementation checkpoint

Five more point/batch lookup indexes now share `uniqueKeys_1`, without adding
an index. Attachment ACL and AI/device import paths participate; original
identity/kind/owner/target/state guards remain. Custom data planes keep their
legacy plan, and home-pinned identity paths do not follow custom overrides.

The first draft's cold-start backfill was removed: requests now read a cached
indexed home-settings readiness marker. An explicit, leased, confirmation-gated
`consolidate-relationship-lookup-indexes` migration repairs/validates, activates,
then retires exact known non-unique definitions. Before that migration, the
home plan remains 59. Every origin sharing the database must be considered
before retirement. Existing Watch `lopu_recording_due` is never touched.

Local checks cover no-write dry runs, required leases, duplicate/lease failure,
activation ordering, custom routing, source-plan count and manifest contracts.
Full unit/build/output checks pass; the typecheck ratchet remains at its
pre-existing 108 errors.

Native disposable replica-set proof also passed: 59 indexes before activation,
54 afterward, with all six sampled relationship kinds returning one document
while examining one key and one document, without an index hint. The fixture
adds 250 unrelated data Things through the real creation utility. It verifies
before/after relationship and batched reads, unauthorized chat exclusion,
invite redemption, four concurrent DM creates deduping to one conversation,
and repeated AI-import membership upserts. The migration dry-run writes
nothing and reports zero pending work after completion. The reproducible
`verify:relationship-indexes` script accepts only its explicitly opted-in
disposable loopback replica set; it never inserts data through a raw Mongo
handle. This is local sampled-plan proof, not production workload/latency proof.

## Canonical legacy readers and cache-drain safety

The next candidate retires eight legacy indexes while adding one shared
schema/owner/update-order index: 47 steady-state, 60 during compatibility
rollout. Feed/search/related/cascade and embed readers switch together; custom
data planes retain old behavior. The active embed writer no longer requires
root `kind` after readiness. Incompatible legacy rows block migration; only
canonical embed metadata may be cleaned, with no Thing deletion.

Both migrations now require two real leased runs. The first activates readers;
old indexes stay for at least one minute before retirement. Early retries do
not extend the deadline. This closes the cached-reader/full-scan window in the
initial relationship checkpoint. Compatible code on every DB consumer is still
a prerequisite; a timer cannot repair an undeployed old preview.

Native regression now also exercises private embed ACL/version CAS, feed and
profile exclusion of rich comments, engagement search, comment deletion,
profile/embed unhinted sort plans, and zero-pending reruns. Live migration and
main/develop merge remain outstanding.

The expanded native MongoDB 8.0.1 run passed **60 → 47**, including the real
61-second drain and both leased completion runs. All six relationship samples
examined one key/document; profile posts examined two (excluding the rich
comment) and returned one, while the embed list examined/returned one, both
without blocking sorts. Engagement search passed before activation, during
drain, and after retirement. Both final migration dry-runs reported zero.
