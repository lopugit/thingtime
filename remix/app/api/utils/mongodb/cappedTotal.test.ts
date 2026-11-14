import assert from 'node:assert/strict';
import test from 'node:test';

// @ts-ignore Node 24 executes TypeScript directly and requires the extension.
import { COUNT_LIMIT, COUNT_MAX_TIME_MS, fetchCappedTotal, fetchCappedAggregateTotal } from './cappedTotal.ts';

// A mongo-faithful countDocuments stub: countDocuments({ limit }) never returns
// more than `limit`, so `matches` beyond the requested limit are truncated —
// exactly what lets fetchCappedTotal detect "more than COUNT_LIMIT" from a
// COUNT_LIMIT + 1 probe. Records the options it was called with (or throws to
// simulate a maxTimeMS timeout).
const stubCollection = (matches: number | 'throw') => {
  const calls: { filter: unknown; options: any }[] = [];
  return {
    calls,
    countDocuments: async (filter: unknown, options: any) => {
      calls.push({ filter, options });
      if (matches === 'throw') throw new Error('operation exceeded time limit');
      const limit = typeof options?.limit === 'number' ? options.limit : Infinity;
      return Math.min(matches, limit);
    }
  };
};

test('cursor pages skip the count entirely (keep the total the client already has)', async () => {
  const collection = stubCollection(42);
  const result = await fetchCappedTotal(collection, { thingtime: 'schema' }, '1720000000000_abc');
  assert.deepEqual(result, { total: null, totalCapped: false });
  assert.equal(collection.calls.length, 0, 'countDocuments must not run on cursor pages');
});

test('below the cap reports the exact total, not capped', async () => {
  const collection = stubCollection(5);
  const result = await fetchCappedTotal(collection, {}, undefined);
  assert.deepEqual(result, { total: 5, totalCapped: false });
});

test('EXACTLY COUNT_LIMIT matches is an exact total, NOT capped', async () => {
  // The reconciled semantic: browse's old cappedCount inferred capped via
  // `total === COUNT_LIMIT`, which mislabels an exact 1000 as capped. The probe
  // asks for COUNT_LIMIT + 1 and only 1000 come back → totalCapped stays false.
  const collection = stubCollection(COUNT_LIMIT);
  const result = await fetchCappedTotal(collection, {}, undefined);
  assert.deepEqual(result, { total: COUNT_LIMIT, totalCapped: false });
});

test('strictly more than COUNT_LIMIT is clamped and flagged capped', async () => {
  const collection = stubCollection(COUNT_LIMIT + 1);
  const result = await fetchCappedTotal(collection, {}, undefined);
  assert.deepEqual(result, { total: COUNT_LIMIT, totalCapped: true });

  const many = stubCollection(50_000);
  assert.deepEqual(await fetchCappedTotal(many, {}, undefined), { total: COUNT_LIMIT, totalCapped: true });
});

test('a count timeout / failure degrades to unknown, never throws', async () => {
  const collection = stubCollection('throw');
  const result = await fetchCappedTotal(collection, {}, undefined);
  assert.deepEqual(result, { total: null, totalCapped: false });
});

test('probes with COUNT_LIMIT + 1 and the shared maxTime deadline', async () => {
  const collection = stubCollection(3);
  await fetchCappedTotal(collection, { thingtime: 'schema' }, undefined);
  assert.equal(collection.calls.length, 1);
  assert.deepEqual(collection.calls[0].options, { limit: COUNT_LIMIT + 1, maxTimeMS: COUNT_MAX_TIME_MS });
  assert.deepEqual(collection.calls[0].filter, { thingtime: 'schema' });
});

// Relational audience joins must run before the same bounded count and keep
// later pages/count failures non-blocking.

test('aggregate totals preserve joined ACL stages and bounded count semantics', async () => {
  const stages = [{ $match: { thingtime: 'post' } }, { $lookup: { as: '_aclCandidate' } }];
  let calls = 0;
  const collection = { aggregate(pipeline: any[], options: any) {
    calls++;
    assert.deepEqual(pipeline.slice(0, 2), stages);
    assert.deepEqual(pipeline.slice(2), [{ $limit: COUNT_LIMIT + 1 }, { $count: 'total' }]);
    assert.equal(options.maxTimeMS, COUNT_MAX_TIME_MS);
    return { toArray: async () => [{ total: COUNT_LIMIT + 1 }] };
  } };
  assert.deepEqual(await fetchCappedAggregateTotal(collection, stages, null), { total: COUNT_LIMIT, totalCapped: true });
  assert.deepEqual(await fetchCappedAggregateTotal(collection, stages, 'cursor'), { total: null, totalCapped: false });
  assert.equal(calls, 1);
  assert.deepEqual(await fetchCappedAggregateTotal({ aggregate() { throw new Error('timeout'); } }, stages, null), { total: null, totalCapped: false });
});
