import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, WORKSPACE_LIMITS, workspaceScopeKey, type WorkspaceLease } from './storage';

export const testLease = () => {
	let active = true; const listeners = new Set<() => void>();
	const lease: WorkspaceLease = {
		assertCurrent: () => { if (!active) throw new Error('Workspace changed'); },
		onInvalidate: callback => { listeners.add(callback); return () => listeners.delete(callback); }
	};
	return { lease, invalidate: () => { active = false; listeners.forEach(listener => listener()); } };
};
const anonymous = { kind: 'anonymous' } as const;

test('anonymous, account, origin and selected data plane are distinct storage scopes', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()); const { lease } = testLease();
	const scopes = [anonymous,
		{ kind: 'account', origin: 'https://thingtime.com', ownerId: 'a', dataPlane: 'home' },
		{ kind: 'account', origin: 'https://thingtime.com', ownerId: 'b', dataPlane: 'home' },
		{ kind: 'account', origin: 'https://other.example', ownerId: 'a', dataPlane: 'home' },
		{ kind: 'account', origin: 'https://thingtime.com', ownerId: 'a', dataPlane: 'custom-x' }
	] as const;
	assert.equal(new Set(scopes.map(workspaceScopeKey)).size, scopes.length);
	for (let i = 0; i < scopes.length; i++) await db.transaction(scopes[i], 'readwrite', lease, tx => tx.put('things', 'same-id', { i }));
	for (let i = 0; i < scopes.length; i++) assert.deepEqual(await db.transaction(scopes[i], 'readonly', lease, tx => tx.get('things', 'same-id')), { i });
	await db.close();
});

test('quota failure rolls back every write and usage accounting in a transaction', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()); const { lease } = testLease();
	await assert.rejects(db.transaction(anonymous, 'readwrite', lease, async tx => {
		await tx.put('things', 'first', { value: 'keep atomic' });
		await tx.put('things', 'too-large', 'x'.repeat(WORKSPACE_LIMITS.recordBytes));
	}), /exceeds 1 MB/);
	assert.deepEqual(await db.transaction(anonymous, 'readonly', lease, tx => tx.list('things')), []);
	await db.transaction(anonymous, 'readwrite', lease, tx => tx.put('things', 'first', { value: 'retry' }));
	assert.deepEqual(await db.transaction(anonymous, 'readonly', lease, tx => tx.get('things', 'first')), { value: 'retry' });
	await db.close();
});

test('identity invalidation aborts an already running write', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()); const { lease, invalidate } = testLease();
	await assert.rejects(db.transaction(anonymous, 'readwrite', lease, async tx => {
		await tx.put('things', 'old-editor', { secret: 'not committed' }); invalidate();
	}), /Workspace changed/);
	assert.deepEqual(await db.transaction(anonymous, 'readonly', testLease().lease, tx => tx.list('things')), []);
	await db.close();
});

test('separate tabs serialize read-modify-write transactions without lost updates', async () => {
	const factory = new IDBFactory(); const a = new WorkspaceDatabase(factory); const b = new WorkspaceDatabase(factory);
	const { lease } = testLease();
	await Promise.all(Array.from({ length: 20 }, (_, index) => (index % 2 ? a : b).transaction(anonymous, 'readwrite', lease, async tx => {
		const value = await tx.get<number>('settings', 'count') || 0;
		await tx.put('settings', 'count', value + 1);
	})));
	assert.equal(await a.transaction(anonymous, 'readonly', lease, tx => tx.get('settings', 'count')), 20);
	await a.close(); await b.close();
});

test('committed local records survive closing and reopening the database', async () => {
	const factory = new IDBFactory(); const db = new WorkspaceDatabase(factory); const { lease } = testLease();
	await db.transaction(anonymous, 'readwrite', lease, tx => tx.put('drafts', 'draft', { text: 'offline' })); await db.close();
	const reopened = new WorkspaceDatabase(factory);
	assert.deepEqual(await reopened.transaction(anonymous, 'readonly', lease, tx => tx.get('drafts', 'draft')), { text: 'offline' }); await reopened.close();
});

for (const failure of ['blocked', 'timeout', 'error', 'close'] as const) {
	test(`a ${failure} opening fails clearly, closes late connections and permits retry`, async () => {
		const real = new IDBFactory();
		let opened = 0, lateCloses = 0, lateUpgrades = 0;
		const stalled = { result: { close: () => { lateCloses++; } }, transaction: { abort: () => { lateUpgrades++; } } } as unknown as IDBOpenDBRequest;
		const factory = { open: (name: string, version: number) => opened++ ? real.open(name, version) : stalled } as IDBFactory;
		const db = new WorkspaceDatabase(factory, `open-${failure}`, 10);
		const { lease } = testLease();
		const pending = db.transaction(anonymous, 'readwrite', lease, tx => tx.put('things', 'first', { text: 'abandoned' }));
		const rejected = assert.rejects(pending, (error: any) => error.code === `LOCAL_STORAGE_${failure === 'error' ? 'UNAVAILABLE' : failure === 'close' ? 'CLOSED' : failure.toUpperCase()}`);
		if (failure === 'blocked') stalled.onblocked!.call(stalled, new Event('blocked') as IDBVersionChangeEvent);
		if (failure === 'error') stalled.onerror!.call(stalled, new Event('error'));
		if (failure === 'close') await db.close();
		await rejected;
		// A late old request must neither create stores nor clear a newer open.
		stalled.onupgradeneeded!.call(stalled, new Event('upgradeneeded') as IDBVersionChangeEvent);
		const retry = db.transaction(anonymous, 'readwrite', lease, tx => tx.put('things', 'retry', { text: 'saved' }));
		stalled.onsuccess!.call(stalled, new Event('success'));
		await retry;
		assert.equal(lateCloses, 1); assert.ok(lateUpgrades >= 1);
		assert.deepEqual(await db.transaction(anonymous, 'readonly', lease, tx => tx.list('things')), [{ id: 'retry', value: { text: 'saved' } }]);
		await db.close();
	});
}
