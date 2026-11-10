import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { createSyncActivityObservation } from './syncActivityJournal';
import type { SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://sync.example', ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'config' };

test('observed payload preserves zero for verified reuse and null for unknown or opaque bytes', () => {
 let now = 100;
 const observation = createSyncActivityObservation('attempt', () => now);
 now += 5;
 observation.transfer({ direction: 'upload', bytes: 0 });
 assert.deepEqual(observation.snapshot(), { startedAt: 100, lastActivityAt: 105, sentBytes: 0, receivedBytes: null });
 observation.transfer({ direction: 'download', bytes: 5 });
 observation.transfer({ direction: 'download', bytes: 2 });
 assert.equal(observation.snapshot().receivedBytes, 7);
 observation.transfer({ direction: 'download', bytes: null });
 observation.transfer({ direction: 'download', bytes: 10 });
 now += 3;
 assert.deepEqual(observation.finish('waiting'), { id: 'attempt', startedAt: 100, endedAt: 108,
  lastActivityAt: 105, sentBytes: 0, receivedBytes: null, status: 'waiting' });
});

test('sync attempts page through the existing history store after reopen without leaking rate samples or other configs', async () => {
 const factory = new IDBFactory();
 const open = () => openSyncJournal(factory, 'activity', IDBKeyRange);
 const deviceScope = { origin: scope.origin, ownerId: scope.ownerId, deviceId: scope.deviceId, dataPlane: scope.dataPlane };
 const other = { ...scope, rootId: 'other-config' };
 let journal = await open();
 let activity = journal.syncActivity({ scope, currentScope: () => scope });
 const record = (id: string) => createSyncActivityObservation(id, () => 100).finish('complete');
 await activity.append(record('a'));
 await activity.append(record('b'));
 await journal.syncActivity({ scope: other, currentScope: () => other }).append(record('other'));
 await journal.deviceHistory({ scope: deviceScope, assertCurrent() {} }).append({
  at: 100, status: 'running', uploadMbps: 8, downloadMbps: null, scanMbps: null, memoryBytes: null, cpuPercent: null
 });
 journal.close(); journal = await open();
 activity = journal.syncActivity({ scope, currentScope: () => scope });
 const first = await activity.read({ limit: 1 });
 assert.deepEqual(first.records, [record('b')]);
 assert.deepEqual(await activity.read({ limit: 1, before: first.next! }), { records: [record('a')], next: null });
 for (const changed of [{ ...scope, ownerId: 'other' }, { ...scope, origin: 'https://other.example' }, { ...scope, deviceId: 'other' }])
  assert.deepEqual((await journal.syncActivity({ scope: changed, currentScope: () => changed }).read()).records, []);
 assert.throws(() => journal.syncActivity({ scope, currentScope: () => other }).read(), /account or root changed/);
 journal.close();
});
