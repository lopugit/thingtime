# 24 — Migration-safe continuous availability

Owner request (2026-09-02): deploying code to `develop`, production, or any
other running shared branch must not make existing Thingtime functionality
depend on an operator having already run a storage migration. A pending or
partially completed migration must never prevent users or integrations from
creating, commenting on, updating, reacting to, saving, or otherwise writing
data through an established capability.

This is a **P0 compatibility invariant** for every future storage migration,
not an optional enhancement.

## User-visible contract

- A deployment that introduces a new storage generation, shape, index, ledger,
  relationship, or derived field continues to serve all previously supported
  reads and writes before, during, and after its migration.
- Existing operations must not return a migration-required error merely because
  an administrative migration has not run yet.
- New functionality may remain hidden or disabled until its prerequisites are
  ready, but that feature gate must not disable or narrow an existing capability.
- If an old write cannot be represented safely while a migration is pending,
  the new code is not deployable to a shared running branch. Compatibility must
  be implemented first; the failure belongs in CI or release validation, not in
  a user's request.

## Required rollout pattern

Use an **expand → coexist → migrate → verify → contract** sequence:

1. **Expand additively.** Deploy readers and writers that understand both the
   current and next storage states. Add new optional fields, collections, or
   indexes without removing the old path.
2. **Keep a compatibility path.** Use an explicit migration-status check only
   to choose the correct implementation: legacy write, new write, dual-write,
   compatibility adapter, or lazy per-record upgrade. Never use it as a reason
   to reject an otherwise valid existing operation.
3. **Reconcile durably.** When immediate dual-write is unsafe or unavailable,
   accept the established write through the authoritative compatible path and
   record enough idempotent reconciliation state to bring the new representation
   current later.
4. **Migrate in the background.** Migrations are resumable, idempotent, bounded,
   observable, and safe while normal traffic continues.
5. **Verify authority before switching.** Promote the new representation only
   after an authoritative census proves that backfill and reconciliation are
   complete and live shadow-read/write checks show no drift.
6. **Contract separately.** Remove the legacy path only in a later deployment,
   after the supported rollback window closes and production evidence confirms
   that no compatible records or callers still depend on it.

Feature flags are appropriate for exposing a new feature. They are not a
substitute for storage compatibility and must never become a kill switch for
pre-existing user actions.

## Engineering requirements

- Centralize storage-generation and migration-state decisions in one tested
  compatibility policy rather than scattering checks through route handlers.
- Every mutation route declares its compatible write path for each supported
  storage state. Route code should not hand-roll migration branching.
- Reads tolerate mixed-generation datasets and return one stable public
  contract throughout the rollout.
- Writes racing with a migration remain atomic or idempotently reconcilable;
  retries cannot duplicate, drop, or orphan user data.
- Rollback remains possible until the contract phase. Code rollback must not
  require rolling user data backward.
- Migration status and compatibility-path usage are observable to operators,
  with alerts for rejected writes, reconciliation lag, drift, and fallback use.
- Capability-manifest versions and API documentation change whenever a public
  request, response, permission, side effect, pagination, or streaming contract
  changes; storage rollout state alone must not silently change that contract.

## Acceptance criteria

- [ ] CI restores a representative pre-migration database snapshot, starts the
      new server without running migrations, and proves every established
      create/update/delete/comment/react/save/share workflow still succeeds and
      is immediately readable.
- [ ] The same contract suite passes against an unmigrated, partially migrated,
      fully migrated, and mixed-generation dataset.
- [ ] Concurrency tests overlap normal writes with migration batches and prove
      there are no lost, duplicated, invisible, or orphaned records.
- [ ] Migration interruption and restart are tested; resuming is idempotent and
      does not require downtime.
- [ ] A rollback test runs the previous compatible server version after partial
      migration and confirms established functionality still works.
- [ ] New-feature gates are tested both on and off while all legacy capability
      tests remain green.
- [ ] No established API or UI action emits a migration-required failure in any
      supported rollout state.
- [ ] Production promotion is blocked when compatibility tests fail, while a
      pending migration by itself is never allowed to block live user writes.

## Motivating failure class

A comment write was rejected because account content required a storage
migration before a ledger could be reconciled. The specific write is recoverable;
the architectural bug is allowing migration readiness to sit on an established
user-data creation path. This TODO closes that entire failure class rather than
special-casing one endpoint.
