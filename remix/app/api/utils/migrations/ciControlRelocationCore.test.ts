import assert from 'node:assert/strict';
import test from 'node:test';

import {
  indexCreateSpecFromDefinition,
  rebuildPlanIndexes,
  rebuildTwinOptions,
  reconcileRebuildTwins,
  relocateCiControlRows,
  relocatedCiDoc
} from './ciControlRelocationCore.ts';
import { ciRetentionPolicy, DEFAULT_CI_RETENTION_DAYS } from '../ciControl/retentionCore.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-02T00:00:00.000Z');
const policy = ciRetentionPolicy({});

const row = (id: number, kind: string, ageDays: number, extra: Record<string, unknown> = {}) => ({
  _id: id,
  shareId: `ci-${kind}-${id}`,
  schemaVersion: 2,
  thingtime: [kind],
  crystal: { repository: 'lopugit/thingtime', ...((extra.crystal as Record<string, unknown>) ?? {}) },
  ownerId: 'system',
  storageClass: 'control',
  createdAt: new Date(NOW.getTime() - ageDays * DAY_MS),
  updatedAt: new Date(NOW.getTime() - ageDays * DAY_MS),
  ...extra,
  crystalExtra: undefined
});

const fakeSource = (docs: any[]) => {
  const deletes: unknown[][] = [];
  return {
    docs,
    deletes,
    find(filter: any) {
      let matched = docs.filter((doc) => filter.thingtime.$in.includes(doc.thingtime[0]));
      if (filter._id?.$gt !== undefined) matched = matched.filter((doc) => doc._id > filter._id.$gt);
      let limit = Infinity;
      const cursor = {
        sort: () => cursor,
        limit: (n: number) => {
          limit = n;
          return cursor;
        },
        toArray: async () => matched.sort((a, b) => a._id - b._id).slice(0, limit)
      };
      return cursor;
    },
    async deleteMany(filter: any) {
      const ids = new Set(filter._id.$in);
      deletes.push([...ids]);
      const before = docs.length;
      for (let index = docs.length - 1; index >= 0; index -= 1) if (ids.has(docs[index]._id)) docs.splice(index, 1);
      return { deletedCount: before - docs.length };
    }
  };
};

const fakeTarget = () => {
  const writes: any[] = [];
  return {
    writes,
    async bulkWrite(operations: any[]) {
      writes.push(...operations);
    }
  };
};

test('a fresh event keeps its window from its own timestamp; an already-expired one is not copied', () => {
  const fresh = relocatedCiDoc(row(1, 'ci-event', 1), { targetSchemaVersion: 1, policy, now: NOW });
  assert.ok(fresh);
  assert.equal(fresh!.schemaVersion, 1);
  assert.equal((fresh!.expiresAt as Date).getTime(), NOW.getTime() + (DEFAULT_CI_RETENTION_DAYS.event - 1) * DAY_MS);
  assert.equal('_id' in fresh!, false);
  assert.equal(relocatedCiDoc(row(2, 'ci-event', DEFAULT_CI_RETENTION_DAYS.event + 1), { targetSchemaVersion: 1, policy, now: NOW }), null);
});

test('permanent entities relocate without an expiry and drop any stale things-era stamp', () => {
  const pr = relocatedCiDoc(row(3, 'ci-pull-request', 400, { expiresAt: new Date(0) }), { targetSchemaVersion: 1, policy, now: NOW });
  assert.ok(pr);
  assert.equal('expiresAt' in pr!, false);
  const job = relocatedCiDoc(row(4, 'ci-workflow-run', 10, { crystal: { externalId: 'job:1' } }), { targetSchemaVersion: 1, policy, now: NOW });
  assert.equal((job!.expiresAt as Date).getTime(), NOW.getTime() + (DEFAULT_CI_RETENTION_DAYS.job - 10) * DAY_MS);
});

test('relocation copies live rows insert-if-absent, deletes every matched row, and drains in batches', async () => {
  const source = fakeSource([
    row(1, 'ci-event', 1),
    row(2, 'ci-event', 60), // expired: deleted, never copied
    row(3, 'ci-pull-request', 200),
    { _id: 4, shareId: 'post-1', thingtime: ['post'], createdAt: NOW, updatedAt: NOW }, // untouched
    row(5, 'ci-workflow-run', 5, { crystal: { externalId: 'job:9' } })
  ]);
  const target = fakeTarget();
  const report = await relocateCiControlRows({
    source,
    target,
    kinds: ['ci-event', 'ci-pull-request', 'ci-workflow-run'],
    targetSchemaVersion: 1,
    dryRun: false,
    policy,
    now: NOW,
    batchSize: 2
  });
  assert.equal(report.matched, 4);
  assert.equal(report.copied, 3);
  assert.equal(report.expired, 1);
  assert.equal(report.deleted, 4);
  assert.equal(report.drained, true);
  assert.deepEqual(report.byKind['ci-event'], { matched: 2, copied: 1, expired: 1 });
  assert.deepEqual(
    source.docs.map((doc) => doc.shareId),
    ['post-1']
  );
  assert.equal(target.writes.length, 3);
  for (const write of target.writes) {
    assert.equal(write.updateOne.upsert, true);
    assert.ok(write.updateOne.update.$setOnInsert);
    assert.equal(write.updateOne.filter.shareId, write.updateOne.update.$setOnInsert.shareId);
  }
  // two batches of two plus a final short batch
  assert.deepEqual(source.deletes.map((ids) => ids.length), [2, 2]);
});

test('a dry run counts and classifies without writing or deleting anything', async () => {
  const source = fakeSource([row(1, 'ci-event', 1), row(2, 'ci-event', 90)]);
  const target = fakeTarget();
  const report = await relocateCiControlRows({
    source,
    target,
    kinds: ['ci-event'],
    targetSchemaVersion: 1,
    dryRun: true,
    policy,
    now: NOW
  });
  assert.deepEqual([report.matched, report.copied, report.expired, report.deleted, report.drained], [2, 1, 1, 0, true]);
  assert.equal(target.writes.length, 0);
  assert.equal(source.docs.length, 2);
});

test('the time budget stops a run early and reports it as not drained', async () => {
  const source = fakeSource([row(1, 'ci-event', 1), row(2, 'ci-event', 1), row(3, 'ci-event', 1)]);
  const target = fakeTarget();
  let leases = 0;
  const realNow = Date.now;
  const report = await relocateCiControlRows({
    source,
    target,
    kinds: ['ci-event'],
    targetSchemaVersion: 1,
    dryRun: false,
    policy,
    now: NOW,
    batchSize: 1,
    budgetMs: 1_000,
    assertLease: async () => {
      leases += 1;
      // the second lease check happens after the first batch; force the clock past the budget
      if (leases === 1) Date.now = () => realNow() + 5_000;
    }
  }).finally(() => {
    Date.now = realNow;
  });
  assert.equal(report.drained, false);
  assert.equal(report.deleted, 1);
  assert.equal(source.docs.length, 2);
});

test('rebuild twins keep uniqueness live and differ from the original by partial filter', () => {
  assert.deepEqual(rebuildTwinOptions({ name: 'shareId_1', key: { shareId: 1 }, unique: true, sparse: true }), {
    name: 'shareId_1__rebuild',
    unique: true,
    partialFilterExpression: { shareId: { $exists: true } }
  });
  const reaction = rebuildTwinOptions({
    name: 'things_reaction_unique',
    key: { targetId: 1, ownerId: 1, 'crystal.emoji': 1 },
    unique: true,
    partialFilterExpression: { targetId: { $type: 'string' } }
  });
  assert.deepEqual(reaction.partialFilterExpression, { $and: [{ targetId: { $type: 'string' } }, { _id: { $exists: true } }] });
  assert.deepEqual(rebuildTwinOptions({ name: 'plain_unique', key: { a: 1 }, unique: true }).partialFilterExpression, {
    _id: { $exists: true }
  });
});

test('rebuild goes one index at a time: twin, drop, recreate from the live definition, drop twin', async () => {
  const actions: string[] = [];
  let listed = 0;
  const collection = {
    async indexes() {
      listed += 1;
      return [
        { v: 2, name: '_id_', key: { _id: 1 } },
        { v: 2, name: 'shareId_1', key: { shareId: 1 }, unique: true, sparse: true },
        { v: 2, name: 'tags_1_createdAt_-1_shareId_1', key: { tags: 1, createdAt: -1, shareId: 1 } },
        { v: 2, name: 'someone_elses_index', key: { foo: 1 } }
      ];
    },
    async createIndex(keys: Record<string, unknown>, options: Record<string, unknown> = {}) {
      actions.push(`create:${options.name}:${JSON.stringify(keys)}:${options.unique ? 'unique' : ''}${options.sparse ? 'sparse' : ''}${options.partialFilterExpression ? 'partial' : ''}`);
    },
    async dropIndex(name: string) {
      actions.push(`drop:${name}`);
    }
  };
  const report = await rebuildPlanIndexes({
    collection,
    planNames: new Set(['shareId_1', 'tags_1_createdAt_-1_shareId_1']),
    ensurePlan: async () => {
      actions.push('ensure-plan');
    },
    dryRun: false
  });
  assert.deepEqual(report.rebuilt, ['shareId_1', 'tags_1_createdAt_-1_shareId_1']);
  assert.deepEqual(report.skipped, ['someone_elses_index']);
  assert.deepEqual(report.twins, ['shareId_1__rebuild']);
  assert.deepEqual(report.unprotected, []);
  assert.deepEqual(report.recovered, []);
  assert.deepEqual(actions, [
    'create:shareId_1__rebuild:{"shareId":1}:uniquepartial',
    'drop:shareId_1',
    'create:shareId_1:{"shareId":1}:uniquesparse',
    'drop:shareId_1__rebuild',
    'drop:tags_1_createdAt_-1_shareId_1',
    'create:tags_1_createdAt_-1_shareId_1:{"tags":1,"createdAt":-1,"shareId":1}:',
    'ensure-plan'
  ]);
  const dry = await rebuildPlanIndexes({ collection, planNames: new Set(['shareId_1']), ensurePlan: async () => {}, dryRun: true });
  assert.deepEqual(dry, {
    rebuilt: ['shareId_1'],
    skipped: ['tags_1_createdAt_-1_shareId_1', 'someone_elses_index'],
    twins: ['shareId_1__rebuild'],
    unprotected: [],
    recovered: []
  });
});

test('at the 64-index cap a unique index is rebuilt without a twin and reported as unprotected', async () => {
  const actions: string[] = [];
  const definitions = [{ name: '_id_', key: { _id: 1 } }, { name: 'shareId_1', key: { shareId: 1 }, unique: true }];
  for (let i = 0; i < 62; i += 1) definitions.push({ name: `filler_${i}`, key: { [`f${i}`]: 1 } });
  const collection = {
    async indexes() {
      return definitions;
    },
    async createIndex(_keys: Record<string, unknown>, options: Record<string, unknown> = {}) {
      actions.push(`create:${options.name}`);
    },
    async dropIndex(name: string) {
      actions.push(`drop:${name}`);
    }
  };
  const report = await rebuildPlanIndexes({ collection, planNames: new Set(['shareId_1']), ensurePlan: async () => {}, dryRun: false });
  assert.deepEqual(report.unprotected, ['shareId_1']);
  assert.deepEqual(report.twins, []);
  assert.deepEqual(actions, ['drop:shareId_1', 'create:shareId_1']);
});

test('an interrupted run is recovered first: twins are dropped and orphaned originals come back from the plan', async () => {
  const actions: string[] = [];
  const collection = {
    async indexes() {
      return [
        { name: '_id_', key: { _id: 1 } },
        { name: 'shareId_1__rebuild', key: { shareId: 1 }, unique: true, partialFilterExpression: { shareId: { $exists: true } } },
        { name: 'uniqueKeys_1', key: { uniqueKeys: 1 }, unique: true, sparse: true },
        { name: 'uniqueKeys_1__rebuild', key: { uniqueKeys: 1 }, unique: true, partialFilterExpression: { uniqueKeys: { $exists: true } } }
      ];
    },
    async createIndex(_keys: Record<string, unknown>, options: Record<string, unknown> = {}) {
      actions.push(`create:${options.name}`);
    },
    async dropIndex(name: string) {
      actions.push(`drop:${name}`);
    }
  };
  const recovered = await reconcileRebuildTwins({
    collection,
    ensurePlan: async () => {
      actions.push('ensure-plan');
    }
  });
  assert.deepEqual(recovered, ['shareId_1__rebuild', 'uniqueKeys_1__rebuild']);
  assert.deepEqual(actions, ['drop:shareId_1__rebuild', 'drop:uniqueKeys_1__rebuild', 'ensure-plan']);
});

test('a text index is recreated from its weights, and server-managed fields are dropped', () => {
  assert.deepEqual(
    indexCreateSpecFromDefinition({
      v: 2,
      key: { _fts: 'text', _ftsx: 1 },
      name: 'things_text_search',
      weights: { '$**': 1, 'crystal.name': 10, tags: 6 },
      default_language: 'english',
      language_override: 'tt:textLanguage',
      textIndexVersion: 3
    }),
    {
      keys: { '$**': 'text', 'crystal.name': 'text', tags: 'text' },
      options: { name: 'things_text_search', weights: { '$**': 1, 'crystal.name': 10, tags: 6 }, default_language: 'english', language_override: 'tt:textLanguage' }
    }
  );
  assert.deepEqual(
    indexCreateSpecFromDefinition({ v: 2, key: { expiresAt: 1 }, name: 'ttl', expireAfterSeconds: 0, partialFilterExpression: { a: 1 }, background: true }),
    { keys: { expiresAt: 1 }, options: { name: 'ttl', expireAfterSeconds: 0, partialFilterExpression: { a: 1 } } }
  );
});
