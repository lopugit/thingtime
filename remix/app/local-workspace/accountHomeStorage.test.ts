import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { WorkspaceDatabase, WORKSPACE_LIMITS, type WorkspaceLease } from './storage';
const selected = { kind: 'account', ownerId: 'owner', origin: 'https://home.test', dataPlane: 'custom' } as const;
const home = { ...selected, dataPlane: 'home' };
const lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const database = (factory = new IDBFactory()) => new WorkspaceDatabase(factory, 'home-transaction', 1000, IDBKeyRange);
test('account partition discovery returns only exact current account and origin keys', async () => {
	const db = database();
	const otherPlane = { ...selected, dataPlane: 'custom-' + 'b'.repeat(64) };
	const unrelated = [
		{ ...home, ownerId: 'owner-extra' },
		{ ...home, ownerId: 'other' },
		{ ...home, origin: 'https://other.test' },
		{ kind: 'anonymous' }
	] as const;
	try {
		for (const scope of [home, selected, otherPlane, ...unrelated])
			await db.transaction(scope, 'readwrite', lease, (tx) => tx.put('things', 'private', { content: 'not returned' }));
		assert.deepEqual(
			(await db.accountScopes(selected, lease)).map((scope) => scope.dataPlane).sort(),
			[home.dataPlane, selected.dataPlane, otherPlane.dataPlane].sort()
		);
		assert.ok(!JSON.stringify(await db.accountScopes(selected, lease)).includes('content'));
		await assert.rejects(db.accountScopes({ kind: 'anonymous' } as any, lease), /Anonymous/);
		let calls = 0;
		await assert.rejects(
			db.accountScopes(selected, {
				assertCurrent() {
					if (++calls === 3) throw Error('Identity retired');
				},
				onInvalidate: () => () => {}
			}),
			/Identity retired/
		);
	} finally {
		await db.close();
	}
});
test('account discovery bounds retained partition counts without deleting any data', async () => {
	const db = database();
	try {
		for (let n = 0; n < 129; n++)
			await db.transaction({ ...selected, dataPlane: 'custom-' + n.toString(16).padStart(64, '0') }, 'readwrite', lease, (tx) =>
				tx.put('things', 'item', { n })
			);
		await assert.rejects(db.accountScopes(selected, lease), /Too many/);
		assert.deepEqual(
			await db.transaction({ ...selected, dataPlane: 'custom-' + (128).toString(16).padStart(64, '0') }, 'readonly', lease, (tx) =>
				tx.get('things', 'item')
			),
			{ n: 128 }
		);
	} finally {
		await db.close();
	}
});
test('home and selected-plane writes commit together without merging same-ID records or other identities', async () => {
	const db = database();
	const unrelated = [{ ...home, ownerId: 'another' }, { ...home, origin: 'https://another.test' }, { kind: 'anonymous' }] as const;
	try {
		for (const scope of unrelated) await db.transaction(scope, 'readwrite', lease, (tx) => tx.put('things', 'same', { kind: 'untouched' }));
		await db.accountHomeTransaction(selected, 'readwrite', lease, async ({ selected, home }) => {
			await Promise.all([
				selected.put('things', 'same', { kind: 'data' }),
				home.put('things', 'same', { kind: 'theme' }),
				home.put('theme-sync', 'same', { state: 'pending' })
			]);
			assert.deepEqual(await selected.get('things', 'same'), { kind: 'data' });
			assert.deepEqual(await home.get('things', 'same'), { kind: 'theme' });
		});
		assert.deepEqual(await db.transaction(home, 'readonly', lease, (tx) => tx.get('things', 'same')), { kind: 'theme' });
		assert.deepEqual(await db.transaction(selected, 'readonly', lease, (tx) => tx.get('things', 'same')), { kind: 'data' });
		for (const scope of unrelated)
			assert.deepEqual(await db.transaction(scope, 'readonly', lease, (tx) => tx.get('things', 'same')), { kind: 'untouched' });
		await db.accountHomeTransaction(home, 'readwrite', lease, async (views) => {
			assert.equal(views.home, views.selected);
			await Promise.all([views.home.put('things', 'first', {}), views.selected.put('things', 'second', {})]);
			assert.equal((await views.home.usage()).records, 4);
		});
	} finally {
		await db.close();
	}
});
test('a home quota or selected-plane error rolls back both content and both usage ledgers', async () => {
	const db = database();
	try {
		for (const failed of ['home', 'selected'] as const) {
			await assert.rejects(
				db.accountHomeTransaction(selected, 'readwrite', lease, async (views) => {
					await views.home.put('things', 'theme', {});
					await views.selected.put('things', 'data', {});
					await views[failed].put('things', 'oversize', 'x'.repeat(WORKSPACE_LIMITS.recordBytes));
				}),
				/exceeds/
			);
			for (const scope of [home, selected])
				assert.deepEqual(await db.transaction(scope, 'readonly', lease, (tx) => tx.usage()), { records: 0, bytes: 0 });
		}
		await assert.rejects(
			db.accountHomeTransaction({ kind: 'anonymous' } as any, 'readwrite', lease, async () => {}),
			/Anonymous/
		);
	} finally {
		await db.close();
	}
});
test('retiring the selected-account lease cancels home and selected writes atomically', async () => {
	const db = database();
	let active = true;
	const listeners = new Set<() => void>();
	const scopedLease: WorkspaceLease = {
		assertCurrent() {
			if (!active) throw Error('retired account');
		},
		onInvalidate(cb) {
			listeners.add(cb);
			return () => listeners.delete(cb);
		}
	};
	try {
		await assert.rejects(
			db.accountHomeTransaction(selected, 'readwrite', scopedLease, async (views) => {
				await views.home.put('things', 'theme', {});
				await views.selected.put('things', 'data', {});
				active = false;
				for (const cb of listeners) cb();
			}),
			/retired account/
		);
		for (const scope of [home, selected]) assert.deepEqual(await db.transaction(scope, 'readonly', lease, (tx) => tx.list('things')), []);
	} finally {
		await db.close();
	}
});
test('concurrent home work from different selected planes shares one serialized home ledger', async () => {
	const factory = new IDBFactory(),
		a = database(factory),
		b = database(factory);
	try {
		await Promise.all(
			Array.from({ length: 20 }, (_, i) =>
				(i % 2 ? a : b).accountHomeTransaction({ ...selected, dataPlane: 'custom-' + (i % 2) }, 'readwrite', lease, async (views) => {
					const n = (await views.home.get<number>('settings', 'count')) || 0;
					await views.home.put('settings', 'count', n + 1);
					await views.selected.put('things', 'local-' + i, {});
				})
			)
		);
		assert.equal(await a.transaction(home, 'readonly', lease, (tx) => tx.get('settings', 'count')), 20);
		assert.equal((await a.transaction(home, 'readonly', lease, (tx) => tx.usage())).records, 1);
	} finally {
		await a.close();
		await b.close();
	}
});
