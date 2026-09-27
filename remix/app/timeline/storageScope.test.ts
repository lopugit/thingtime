import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { TimelineConnectionPool } from './connectionPool.ts';
import { IndexedDbTimelineBackend } from './indexedDb.ts';
import { TimelineLocalStore } from './localStore.ts';
import { TimelineBranchStore } from './branchStore.ts';
import { TimelineSync } from './sync.ts';
import { entryFixture, eventFixture } from './testFixtures.ts';
import { historyStorageForThing, timelineFolderHref, timelineRequestScope } from './storageScope.ts';

const home = { ownerId: 'user-1', apiOrigin: 'https://thingtime.test', dataPlane: 'home' };

test('home routing is explicit without changing canonical scope, and managed history keeps its folder location', () => {
	assert.deepEqual(timelineRequestScope(home), { ownerId: 'user-1', dataPlane: 'home', storage: 'home' });
	assert.deepEqual(timelineRequestScope({ ...home, dataPlane: 'custom-one' }), { ownerId: 'user-1', dataPlane: 'custom-one' });
	for (const kind of ['theme', 'feed-algorithm', 'custom-emoji', 'chat-archive', 'attachment']) assert.equal(historyStorageForThing([kind]), 'home');
	for (const kinds of [undefined, [], ['component'], ['data'], ['timeline-event'], ['timeline-branch'], ['theme', 'data']]) assert.equal(historyStorageForThing(kinds), 'selected');
	assert.equal(timelineFolderHref('timeline-folder-user-1', 'home'), '/things?folder=timeline-folder-user-1&historyStorage=home');
	assert.equal(timelineFolderHref('timeline-folder-user-1', 'selected'), '/things?folder=timeline-folder-user-1');
});

test('shared home sessions upload once and releasing selected history cannot stop the home queue', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory());
	let pushes = 0;
	let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
	const pool = new TimelineConnectionPool((scope, folderId) => {
		const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend);
		const sync = new TimelineSync(store, { push: async event => { pushes++; await gate; return entryFixture(event); }, page: async () => ({ entries: [], nextBefore: null, nextAfter: null }) }, branches);
		return { scope, folderId, store, branches, sync };
	});
	const selected = pool.acquire(home, 'folder'); const account = pool.acquire({ ...home }, 'folder');
	assert.equal(selected.connection.sync, account.connection.sync);
	assert.throws(() => pool.acquire(home, 'wrong-folder'), /folder changed/);
	await account.connection.store.enqueue(eventFixture());
	const a = selected.connection.sync.pushPending(); const b = account.connection.sync.pushPending();
	assert.equal(a, b);
	selected.release(); selected.release(); finish();
	await Promise.all([a, b]); assert.equal(pushes, 1); assert.equal((await account.connection.store.pending()).length, 0);
	account.release(); await assert.rejects(account.connection.sync.pushPending(), /stopped/);
	const reopened = pool.acquire(home, 'folder');
	assert.notEqual(reopened.connection.sync, account.connection.sync);
	assert.equal((await reopened.connection.store.forThing('page-1')).length, 1);
	reopened.release(); await backend.close();
});

test('identical event ids in different databases remain separate through pending replay and cache eviction', async () => {
	const backend = new IndexedDbTimelineBackend(new IDBFactory());
	const uploads: string[] = [];
	const pool = new TimelineConnectionPool((scope, folderId) => {
		const store = new TimelineLocalStore(scope, backend); const branches = new TimelineBranchStore(scope, backend);
		return { scope, folderId, store, branches, sync: new TimelineSync(store, { push: async event => { uploads.push(`${scope.dataPlane}:${event.label}`); return entryFixture(event); }, page: async () => ({ entries: [], nextBefore: null, nextAfter: null }) }, branches) };
	});
	const account = pool.acquire(home, 'folder'); const custom = pool.acquire({ ...home, dataPlane: 'custom-one' }, 'folder');
	await account.connection.store.enqueue(eventFixture('same-id', { label: 'Home edit' }));
	await custom.connection.store.enqueue(eventFixture('same-id', { label: 'Custom edit' }));
	await account.connection.sync.pushPending(); account.release();
	assert.equal((await custom.connection.store.pending())[0].label, 'Custom edit');
	await custom.connection.store.prune(0, 0); await custom.connection.sync.pushPending();
	assert.deepEqual(uploads, ['home:Home edit', 'custom-one:Custom edit']);
	const another = pool.acquire({ ...home, ownerId: 'another' }, 'another-folder');
	assert.equal((await another.connection.store.forThing('page-1')).length, 0);
	another.release(); custom.release(); await backend.close();
});
