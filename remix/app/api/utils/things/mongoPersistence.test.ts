import assert from 'node:assert/strict';
import test from 'node:test';
import { createMongoThingsPersistence } from './mongoPersistence';
import { getThingsTransactionBinding } from './persistence';

test('Mongo adapter preserves selected collection, actual session, chronological cursor and CAS fields', async () => {
 const calls: any[] = [], session = { inTransaction: () => true };
 const row = { _id: 'physical', shareId: 'a', ownerId: 'owner', createdAt: new Date(10), updatedAt: new Date(10), thingtime: ['data'], crystal: {} };
 const collection = {
  findOne: async (...args: any[]) => { calls.push(['findOne', ...args]); return row; },
  find: (...args: any[]) => { calls.push(['find', ...args]); return {
   sort(value: any) { calls.push(['sort', value]); return this; }, limit(value: any) { calls.push(['limit', value]); return this; }, toArray: async () => [row, { ...row, shareId: 'b' }]
  }; },
  insertOne: async (...args: any[]) => { calls.push(['insertOne', ...args]); return { insertedId: 'generated' }; },
  replaceOne: async (...args: any[]) => { calls.push(['replaceOne', ...args]); return { matchedCount: 1 }; },
  findOneAndDelete: async (...args: any[]) => { calls.push(['findOneAndDelete', ...args]); return row; }
 };
 const repository = await createMongoThingsPersistence({ ownerId: 'owner', homePlaneId: 'home', contentPlaneId: 'home', providerId: 'mongo-fixture' }, {
  collection: async () => collection, transaction: async work => work(session)
 });
 const selection = { ownerId: 'owner', kinds: ['data'], folder: { kind: 'root' as const }, limit: 1 };
 const page = await repository.readWindow(selection); assert.equal(page.documents.length, 1); assert.ok(page.nextCursor);
 await repository.readWindow({ ...selection, cursor: page.nextCursor });
 assert.deepEqual(calls.filter(call => call[0] === 'sort')[0][1], { createdAt: -1, shareId: 1 });
 assert.deepEqual(calls.filter(call => call[0] === 'find')[1][1].$and.at(-1), { $or: [{ createdAt: { $lt: new Date(10) } }, { createdAt: new Date(10), shareId: { $gt: 'a' } }] });
 const effects: string[] = [];
 await repository.transaction('write', async tx => {
  const binding = getThingsTransactionBinding(tx, 'owner'); assert.equal(binding.kind, 'mongo');
  if (binding.kind === 'mongo') { assert.equal(binding.collection, collection); assert.equal(binding.session, session); }
  await tx.readExact('a');
  await tx.insert({ ...row, _id: undefined, shareId: 'new' });
  assert.equal(await tx.compareAndSwap({ id: row.shareId, identity: row._id, updatedAt: row.updatedAt, headId: null, sizeBytes: 1, folderId: null }, row), true);
  assert.deepEqual(await tx.remove({ id: 'a', identity: 'physical', updatedAt: row.updatedAt }), row);
  tx.afterCommit(async () => { effects.push('after'); }); assert.deepEqual(effects, []);
 });
 assert.deepEqual(effects, ['after']);
 for (const call of calls.filter(call => ['insertOne', 'replaceOne', 'findOneAndDelete'].includes(call[0]))) assert.equal(call.at(-1).session, session);
 assert.deepEqual(calls.find(call => call[0] === 'replaceOne')[1], { shareId: 'a', _id: 'physical', ownerId: 'owner', updatedAt: row.updatedAt, timelineHeadId: null, sizeBytes: 1, folderId: null });
 await assert.rejects(repository.transaction('write', async tx => { try { await tx.insert({ ...row, ownerId: 'foreign' }); } catch {} }), /owner mismatch/);
});
