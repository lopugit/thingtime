import assert from 'node:assert/strict';
import { mock } from 'node:test';
import Module from 'node:module';
import { normalizeNotificationPrefs } from '~/schemas/registry';
import { buildNotificationListFilters, resolveNotificationListQuery } from '../notifications/listQuery';

const original = Module._load;
Module._load = function (name, ...args) {
 if (name === 'node:sqlite' || String(name).includes('nativeNotifications')) throw new Error('Unexpected native notification import');
 return Reflect.apply(original, this, [name, ...args]);
};
const calls: any[] = [];
const row = { ownerId: 'owner', crystal: { type: 'system-message' } };
const collection = {
 async insertOne(document: unknown) { calls.push(['insertOne', document]); },
 async insertMany(documents: unknown, options: unknown) { calls.push(['insertMany', documents, options]); },
 find(filter: unknown) {
  calls.push(['find', filter]);
  const cursor = {
   project(value: unknown) { calls.push(['project', value]); return cursor; },
   sort(value: unknown) { calls.push(['sort', value]); return cursor; },
   limit(value: unknown) { calls.push(['limit', value]); return cursor; },
   async toArray() { return [row]; }
  }; return cursor;
 },
 async countDocuments(filter: unknown) { calls.push(['countDocuments', filter]); return 7; },
 async updateMany(filter: unknown, update: unknown) { calls.push(['updateMany', filter, update]); return { modifiedCount: 3 }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => collection } });
const { currentNotificationRepository } = await import('../notifications/repository.ts');
const repository = currentNotificationRepository(); assert.equal(repository.kind, 'mongo-home');
await repository.insertOne({ shareId: 'one' });
await repository.insertMany([{ shareId: 'two' }]);
assert.deepEqual(calls.splice(0), [['insertOne', { shareId: 'one' }], ['insertMany', [{ shareId: 'two' }], { ordered: false }]]);
assert.deepEqual(await repository.findUnreadDuplicates({ recipients: [{ recipientId: 'owner', type: 'system-message' }], actorId: 'actor', targetId: null, preview: 'exact' }), [{ ownerId: 'owner', type: 'system-message' }]);
assert.deepEqual(calls.splice(0), [
 ['find', { thingtime: 'notification', ownerId: { $in: ['owner'] }, readAt: null, targetId: null, 'crystal.actorId': 'actor', 'crystal.type': { $in: ['system-message'] }, 'crystal.preview': 'exact' }],
 ['project', { ownerId: 1, 'crystal.type': 1 }]
]);
const query = resolveNotificationListQuery({ history: true, limit: 2 }), prefs = normalizeNotificationPrefs({});
const cursor = { createdAt: new Date(30), shareId: 'cursor' }, from = new Date(10), to = new Date(40);
assert.deepEqual(await repository.readPage({ userId: 'owner', prefs, query, cursor, from, to, withTotal: true }), { documents: [row], unreadCount: 7, total: 7, historyUnreadCount: 7 });
const base = { thingtime: 'notification', ownerId: 'owner' }, range = { createdAt: { $gte: from, $lt: to } };
assert.deepEqual(calls.splice(0), [
 ['find', { $and: [base, range, { $or: [{ createdAt: { $lt: cursor.createdAt } }, { createdAt: cursor.createdAt, shareId: { $gt: 'cursor' } }] }] }],
 ['sort', { createdAt: -1, shareId: 1 }], ['limit', 2],
 ['countDocuments', buildNotificationListFilters('owner', prefs, resolveNotificationListQuery({ unread: '1' }))!.base],
 ['countDocuments', { $and: [base, range] }],
 ['countDocuments', { thingtime: 'notification', ownerId: 'owner', readAt: null }]
]);
assert.equal(await repository.markRead('owner', ['one'], from, to), 3);
assert.deepEqual(calls.splice(0), [['updateMany', { thingtime: 'notification', ownerId: 'owner', readAt: null, shareId: { $in: ['one'] } }, { $set: { readAt: from, updatedAt: to } }]]);
console.log('hosted-notification-contract-ok');
