import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { createQuotaFactory } from './storageTestFixture';
const scope = { kind: 'anonymous' } as const;
const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
const database = (factory = new IDBFactory()) => new WorkspaceDatabase(factory, crypto.randomUUID(), 10_000, IDBKeyRange);

test('scan uses exact compound scope/collection and pages Unicode IDs without getAll', async () => {
	const db = database();
	const ids = [...Array.from({ length: 130 }, (_, i) => `row-${String(i).padStart(3, '0')}`), 'é', '🦄', '\uffff', '\ufffftail'];
	const other = { kind: 'account', origin: 'https://example.test', ownerId: 'other', dataPlane: 'home' } as const;
	const storeGetAll = IDBObjectStore.prototype.getAll, indexGetAll = IDBIndex.prototype.getAll;
	try {
		await db.transaction(other, 'readwrite', lease, tx => tx.put('rows', 'foreign', {}));
		await db.transaction(scope, 'readwrite', lease, async tx => {
			for (const id of [...ids].reverse()) await tx.put('rows', id, { id });
			await tx.put('rows-extra', 'foreign', {}); await tx.put('row', 'foreign', {});
		});
		IDBObjectStore.prototype.getAll = IDBIndex.prototype.getAll = () => { throw Error('getAll forbidden'); };
		await db.transaction(scope, 'readwrite', lease, async tx => {
			const seen: string[] = []; let after: string | undefined;
			for (;;) {
				const page = await tx.scan<{ id: string }>('rows', { after });
				if (!page.length) break;
				assert.equal(page.length, Math.min(64, ids.length - seen.length));
				for (const row of page) { assert.equal(row.value.id, row.id); seen.push(row.id); }
				after = page.at(-1)!.id; await tx.put('progress', 'last', { after });
			}
			assert.deepEqual(seen, [...ids].sort()); assert.equal((await tx.usage()).records, ids.length + 3);
		});
	} finally { IDBObjectStore.prototype.getAll = storeGetAll; IDBIndex.prototype.getAll = indexGetAll; await db.close(); }
});

test('scan validates page inputs and bounds processing pages without limiting traversal', async () => {
	const db = database();
	try {
		await db.transaction(scope, 'readwrite', lease, async tx => {
			for (let n = 0; n < 1025; n++) await tx.put('rows', String(n).padStart(4, '0'), n);
		});
		for (const limit of [0, -1, 1.5, NaN, Infinity])
			await assert.rejects(db.transaction(scope, 'readonly', lease, tx => tx.scan('rows', { limit })), /positive safe integer/);
		await assert.rejects(db.transaction(scope, 'readonly', lease, tx => tx.scan('rows', { after: '' })), /Invalid local record key/);
		await assert.rejects(db.transaction(scope, 'readonly', lease, tx => tx.scan('@bytes')), /binary storage/);
		await db.transaction(scope, 'readonly', lease, async tx => {
			const page = await tx.scan('rows', { limit: 100_000 }); assert.equal(page.length, 1024);
			assert.deepEqual(await tx.scan('rows', { after: page.at(-1)!.id, limit: 1 }), [{ id: '1024', value: 1024 }]);
		});
	} finally { await db.close(); }
});

test('lease retirement during cursor traversal cancels writes and usage atomically', async () => {
	const db = database();
	try {
		await db.transaction(scope, 'readwrite', lease, async tx => { for (let i = 0; i < 20; i++) await tx.put('rows', String(i), i); });
		const before = await db.transaction(scope, 'readonly', lease, tx => tx.usage());
		let scanning = false, checks = 0, active = true; const listeners = new Set<() => void>();
		const retired: WorkspaceLease = {
			assertCurrent() {
				if (scanning && ++checks === 5) { active = false; listeners.forEach(callback => callback()); }
				if (!active) throw Error('Retired during scan');
			},
			onInvalidate(callback) { listeners.add(callback); return () => listeners.delete(callback); }
		};
		await assert.rejects(db.transaction(scope, 'readwrite', retired, async tx => {
			await tx.put('rows', 'uncommitted', {}); scanning = true; await tx.scan('rows');
		}), /Retired during scan/);
		await db.transaction(scope, 'readonly', lease, async tx => {
			assert.equal(await tx.get('rows', 'uncommitted'), undefined); assert.deepEqual(await tx.usage(), before);
		});
		assert.equal(listeners.size, 0);
	} finally { await db.close(); }
});

test('quota failure after page mutations rolls back all content and accounting', async () => {
	const db = database(createQuotaFactory({ bytes: 100 }));
	try {
		await db.transaction(scope, 'readwrite', lease, tx => tx.put('rows', 'a', { saved: true }));
		const before = await db.transaction(scope, 'readonly', lease, tx => tx.usage());
		await assert.rejects(db.transaction(scope, 'readwrite', lease, async tx => {
			const [first] = await tx.scan('rows', { limit: 1 }); await tx.delete('rows', first.id); await tx.put('rows', 'b', {});
			assert.deepEqual(await tx.scan('rows', { after: first.id }), [{ id: 'b', value: {} }]);
			await tx.put('rows', 'overflow', 'x'.repeat(100));
		}), (error: any) => error.code === 'LOCAL_QUOTA');
		await db.transaction(scope, 'readonly', lease, async tx => {
			assert.deepEqual(await tx.scan('rows'), [{ id: 'a', value: { saved: true } }]); assert.deepEqual(await tx.usage(), before);
		});
	} finally { await db.close(); }
});

test('cursor request failure rejects and rolls back the transaction', async () => {
	const db = database(), original = IDBObjectStore.prototype.openCursor;
	try {
		await db.transaction(scope, 'readwrite', lease, tx => tx.put('rows', 'saved', {}));
		IDBObjectStore.prototype.openCursor = function () {
			const failed = { error: new DOMException('Synthetic cursor failure', 'UnknownError'), onerror: null } as unknown as IDBRequest<IDBCursorWithValue | null>;
			queueMicrotask(() => failed.onerror?.call(failed, new Event('error'))); return failed;
		};
		await assert.rejects(db.transaction(scope, 'readwrite', lease, async tx => {
			await tx.put('rows', 'uncommitted', {}); await tx.scan('rows');
		}), /Synthetic cursor failure/);
	} finally { IDBObjectStore.prototype.openCursor = original; }
	try {
		await db.transaction(scope, 'readonly', lease, async tx => {
			assert.deepEqual(await tx.scan('rows'), [{ id: 'saved', value: {} }]); assert.deepEqual(await tx.usage(), { records: 1, bytes: 2 });
		});
	} finally { await db.close(); }
});
