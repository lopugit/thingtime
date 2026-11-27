import assert from 'node:assert/strict';
import test from 'node:test';
import { monotonicThingMutationParameters, monotonicThingUpdate, withMonotonicThingTimestamps } from './thingMutationTimestamp';

const time = new Date('2026-11-13T00:00:00.000Z');
test('operator timestamps retain forward, backward and equal-time floors without changing content', () => {
  for (const offset of [-1000, 0, 1000]) {
    const updatedAt = new Date(time.getTime() + offset), filter = { shareId: 'root' }, options = { session: {} };
    const update = { $set: { updatedAt, 'crystal.when': updatedAt }, $inc: { count: 1 } };
    const parameters = monotonicThingMutationParameters('updateOne', [filter, update, options]);
    assert.equal(parameters[0], filter); assert.equal(parameters[2], options);
    assert.deepEqual(parameters[1].$inc, { count: 1 });
    assert.equal(parameters[1].$set['crystal.when'], updatedAt);
    const stored = new Date(Math.max(time.getTime(), parameters[1].$max.updatedAt.getTime()));
    assert.equal(stored.getTime(), Math.max(time.getTime(), updatedAt.getTime()));
    assert.equal(update.$set.updatedAt, updatedAt, 'caller before/after state is not mutated');
  }
  const later = new Date(time.getTime() + 1);
  assert.equal(monotonicThingUpdate({ $set: { updatedAt: time }, $max: { updatedAt: later, other: 5 } }).$max.updatedAt, later);
});

test('invalid/conflicting operators, pipelines, inserts and replacements retain Mongo semantics', () => {
  for (const update of [
    { $set: { updatedAt: new Date(NaN) } }, { $set: { updatedAt: 'past' } },
    { $set: { updatedAt: time }, $max: { updatedAt: 'bad' } },
    { $set: { updatedAt: time }, $unset: { updatedAt: '' } },
    { $set: { updatedAt: time }, $rename: { other: 'updatedAt' } },
    { $set: { updatedAt: time }, $setOnInsert: { updatedAt: time } },
    [{ $set: { updatedAt: time } }]
  ]) assert.equal(monotonicThingUpdate(update), update);
  for (const method of ['insertOne', 'replaceOne', 'findOneAndReplace']) {
    const parameters = [{ updatedAt: time }, { $set: { updatedAt: time } }];
    assert.equal(monotonicThingMutationParameters(method, parameters), parameters);
  }
});

test('canonical adapter covers single, multi, returning and bulk operator writes', async () => {
  const calls: any[] = [], collection: any = { collectionName: 'things_fixture' };
  for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate', 'bulkWrite']) collection[method] = (...args: any[]) => { calls.push([method, args]); return { ok: true }; };
  const guarded = withMonotonicThingTimestamps(collection), options = { session: {} };
  for (const method of ['updateOne', 'updateMany', 'findOneAndUpdate']) await guarded[method]({ shareId: 'root' }, { $set: { updatedAt: time } }, options);
  const replace = { replaceOne: { filter: {}, replacement: { updatedAt: time } } };
  await guarded.bulkWrite([{ updateOne: { filter: {}, update: { $set: { updatedAt: time } } } }, { updateMany: { filter: {}, update: { $set: { updatedAt: time } } } }, replace], options);
  assert.ok(calls.slice(0, 3).every(([, args]) => args[1].$max.updatedAt === time && args[2] === options));
  assert.ok(calls[3][1][0].slice(0, 2).every((operation: any) => (operation.updateOne || operation.updateMany).update.$max.updatedAt === time));
  assert.equal(calls[3][1][0][2], replace); assert.equal(calls[3][1][1], options);
  assert.equal(guarded.collectionName, collection.collectionName);
});
