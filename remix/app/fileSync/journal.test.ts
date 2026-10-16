import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { createSyncRun, executeSyncRun, type SyncRun } from './execute';
import { planFileSync, type SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://thingtime.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'phone' };
const make = (id = 'run'): SyncRun => {
	let counter = 0;
	const source = { path: 'photo', id: 'photo', version: '1', kind: 'file' as const, size: 10, sha256: 'a'.repeat(64) };
	return createSyncRun(planFileSync({ scope, complete: true, entries: [source] }, { scope, complete: true, entries: [] },
		{ scope, entries: [] }, { mode: 'two-way', propagateDeletes: false }), () => `${id}-${++counter}`);
};

test('IndexedDB journal survives close/reopen with the original operation identity', async () => {
	const factory = new IDBFactory(); const first = await openSyncJournal(factory);
	const run = make(); await first.persist(run); first.close();
	const second = await openSyncJournal(factory);
	assert.deepEqual(await second.read(scope), run); second.close();
});

test('unfinished work cannot be replaced and confirmed state cannot regress', async () => {
	const journal = await openSyncJournal(new IDBFactory());
	const run = make(); await journal.persist(run);
	await assert.rejects(journal.persist(make('other')), /unfinished/);
	const changed = structuredClone(run); changed.operations[0].mutation.path = 'elsewhere';
	await assert.rejects(journal.persist(changed), /Invalid/);
	const completed = structuredClone(run); completed.operations[0].confirmed = true; await journal.persist(completed);
	await assert.rejects(journal.persist(run), /cannot change/);
	await journal.persist(make('next')); assert.equal((await journal.read(scope))?.id, 'next-1'); journal.close();
});

test('same identity never permits a changed immutable transfer payload', async () => {
	const journal = await openSyncJournal(new IDBFactory()); const run = make(); await journal.persist(run);
	const changed = structuredClone(run);
	if (changed.operations[0].mutation.kind === 'copy') changed.operations[0].mutation.source.sha256 = 'b'.repeat(64);
	await assert.rejects(journal.persist(changed), /cannot change/);
	assert.deepEqual(await journal.read(scope), run); journal.close();
});

test('account, origin, data plane, root and device each isolate the queue', async () => {
	const journal = await openSyncJournal(new IDBFactory()); await journal.persist(make());
	for (const field of ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'] as const) {
		const other = { ...scope, [field]: field === 'origin' ? 'https://other.test' : 'other' };
		assert.equal(await journal.read(other), null);
	}
	journal.close();
});

test('closed/unavailable durable storage prevents the first file mutation', async () => {
	const journal = await openSyncJournal(new IDBFactory()); journal.close(); let calls = 0;
	await assert.rejects(executeSyncRun(make(), {
		persist: journal.persist, currentScope: () => scope, read: async () => null,
		lookup: async () => { calls++; return { status: 'missing' }; }, apply: async () => { throw new Error('Must not execute'); }
	}));
	assert.equal(calls, 0);
});

test('concurrent journals cannot replace each other’s unfinished operation', async () => {
	const factory = new IDBFactory(), first = await openSyncJournal(factory), second = await openSyncJournal(factory);
	const results = await Promise.allSettled([first.persist(make('first')), second.persist(make('second'))]);
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	assert.ok(['first-1', 'second-1'].includes((await first.read(scope))!.id));
	first.close(); second.close();
});
