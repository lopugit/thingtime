import assert from 'node:assert/strict';
import test from 'node:test';
import { countPendingSubspaceMessaging, provisionSubspaceMessagingMigration } from './subspaceMessaging';
import { subspaceMessagingIds } from '../messenger/subspaceAccess';

test('pending spaces are inspected in bounded cursor batches, including partial and colliding container pairs', async () => {
  const sources = Array.from({ length: 401 }, (_, index) => ({ shareId: `s${index}` }));
  const containers = sources.flatMap(source => {
    const ids = subspaceMessagingIds(source.shareId);
    return [
      { shareId: ids.communityId, thingtime: ['community'], targetId: source.shareId, crystal: { subspaceId: source.shareId } },
      { shareId: ids.chatId, thingtime: ['chat'], targetId: ids.communityId, crystal: { communityId: ids.communityId, subspaceDefault: true } }
    ];
  }).filter(doc => doc.shareId !== subspaceMessagingIds('s1').chatId);
  containers.find(doc => doc.shareId === subspaceMessagingIds('s400').communityId)!.targetId = 'wrong-parent';
  let scans = 0; let batches = 0; let closed = false;
  const things = { find: (filter: any) => {
    if (filter.thingtime === 'subspace') {
      scans++;
      return { batchSize: (size: number) => { assert.equal(size, 200); return {
        async *[Symbol.asyncIterator]() { yield* sources; }, close: async () => { closed = true; }
      }; } };
    }
    batches++;
    assert.ok(filter.shareId.$in.length <= 400);
    return { toArray: async () => containers.filter(doc => filter.shareId.$in.includes(doc.shareId)) };
  } };
  assert.equal(await countPendingSubspaceMessaging(things), 2);
  assert.equal(scans, 1); assert.equal(batches, 3); assert.equal(closed, true);
});

test('backfill writes an accounted monotonic parent fence before creating children and stops after deletion wins', async () => {
  const session = { transaction: true };
  const source = { _id: 'mongo-id', shareId: 's1' };
  const calls: string[] = [];
  let live = true; let matched = true;
  const things = { findOne: async (filter: any, options: any) => {
    assert.equal(filter.subspaceMediaDeleting.$ne, true); assert.equal(options.session, session);
    calls.push('read'); return live ? source : null;
  } };
  const dependencies: any = {
    transaction: async (work: any) => work(session),
    update: async (collection: any, filter: any, update: any, options: any) => {
      assert.equal(collection, things); assert.equal(filter._id, source._id);
      assert.equal(filter.subspaceMediaDeleting.$ne, true); assert.equal(options.session, session);
      assert.deepEqual(update.$inc, { subspaceMessagingRevision: 1 });
      calls.push('fence'); return { matchedCount: matched ? 1 : 0 };
    },
    ensure: async (subspace: any, activeSession: any) => { assert.equal(subspace, source); assert.equal(activeSession, session); calls.push('children'); }
  };
  assert.equal(await provisionSubspaceMessagingMigration(things, 's1', dependencies), true);
  assert.deepEqual(calls, ['read', 'fence', 'children']);
  calls.length = 0; matched = false;
  assert.equal(await provisionSubspaceMessagingMigration(things, 's1', dependencies), false);
  assert.deepEqual(calls, ['read', 'fence']);
  calls.length = 0; live = false;
  assert.equal(await provisionSubspaceMessagingMigration(things, 's1', dependencies), false);
  assert.deepEqual(calls, ['read']);
});
