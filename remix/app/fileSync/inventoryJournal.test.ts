import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { INVENTORY_PAGE_ENTRIES, INVENTORY_PAGE_BYTES, type InventoryIdentity, type InventoryCursor } from './inventoryJournal';
import { syncScopeKey, type SyncEntry, type SyncScope } from './reconcile';
const scope: SyncScope = { origin: 'https://inventory.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const capture: InventoryIdentity = { id: 'capture', source: 'local', generation: 'generation-1' };
const file = (path: string, id = path): SyncEntry => ({ path, id, version: '1', kind: 'file', size: 2, sha256: 'a'.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'folder', size: 0, sha256: null });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'inventory-test', IDBKeyRange);
	let current = { ...scope };
	return { factory, journal, inventory: journal.inventory({ scope, currentScope: () => current }), switchTo: (value: SyncScope) => { current = value; } };
}

test('bounded inventory pages validate siblings with one parent lookup per page and no entry cursors', async t => {
	const f = await fixture(), rows = [folder('parent'), ...Array.from({ length: 257 }, (_, i) => file(`parent/${String(i).padStart(3, '0')}`))];
	await f.inventory.begin(capture);
	for (let offset = 0; offset < rows.length; offset += 128) await f.inventory.append(capture, {
		ordinal: offset / 128, entries: rows.slice(offset, offset + 128), ...(offset + 128 >= rows.length ? { totalEntries: rows.length } : {})
	});
	let parentReads = 0, batches = 0;
	const get = IDBObjectStore.prototype.get, getAll = IDBObjectStore.prototype.getAll, cursor = IDBObjectStore.prototype.openCursor;
	t.mock.method(IDBObjectStore.prototype, 'get', function (this: IDBObjectStore, ...args: Parameters<typeof get>) {
		if (this.name === 'inventory-entries') parentReads++; return get.apply(this, args);
	});
	t.mock.method(IDBObjectStore.prototype, 'getAll', function (this: IDBObjectStore, ...args: Parameters<typeof getAll>) {
		if (this.name === 'inventory-entries') { batches++; assert.equal(args[1], 129); } return getAll.apply(this, args);
	});
	t.mock.method(IDBObjectStore.prototype, 'openCursor', function (this: IDBObjectStore, ...args: Parameters<typeof cursor>) {
		assert.notEqual(this.name, 'inventory-entries'); return cursor.apply(this, args);
	});
	await f.inventory.seal(capture);
	assert.equal(parentReads, 3); assert.equal(batches, 3);
	let next: InventoryCursor | undefined, seen = 0;
	do { const page = await f.inventory.read(capture, next); seen += page.entries.length; next = page.next ?? undefined; } while (next);
	assert.equal(seen, rows.length); assert.equal(batches, 6); f.journal.close();
});

test('bulk inventory reads retain byte pagination for long Unicode paths', async () => {
	const f = await fixture(), parts = Array.from({ length: 15 }, (_, i) => `${i}-${'界'.repeat(240)}`);
	const rows = parts.map((_, i) => ({ ...folder(parts.slice(0, i + 1).join('/')), id: `parent-${i}` }));
	for (let i = 0; i < 150; i++) rows.push(file(`${parts.join('/')}/${i}`, `id-${i}`));
	await f.inventory.begin(capture);
	for (let offset = 0; offset < rows.length; offset += 32) await f.inventory.append(capture, {
		ordinal: offset / 32, entries: rows.slice(offset, offset + 32), ...(offset + 32 >= rows.length ? { totalEntries: rows.length } : {})
	});
	await f.inventory.seal(capture);
	let next: InventoryCursor | undefined; const seen = new Set<string>(); let byteBoundPage = false;
	do {
		const page = await f.inventory.read(capture, next);
		assert.ok(Buffer.byteLength(JSON.stringify(page.entries)) <= INVENTORY_PAGE_BYTES);
		if (page.next && page.entries.length < INVENTORY_PAGE_ENTRIES) byteBoundPage = true;
		for (const row of page.entries) { assert.ok(!seen.has(row.path)); seen.add(row.path); }
		next = page.next ?? undefined;
	} while (next);
	assert.ok(byteBoundPage); assert.equal(seen.size, rows.length); f.journal.close();
});

test('bulk inventory pages reject a valid row moved under a different primary key', async () => {
	for (const sealed of [false, true]) {
		const f = await fixture(); await f.inventory.begin(capture);
		await f.inventory.append(capture, { ordinal: 0, entries: [file('a')], totalEntries: 1 });
		if (sealed) await f.inventory.seal(capture);
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = f.factory.open('inventory-test'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('inventory-entries', 'readwrite');
			tx.objectStore('inventory-entries').put({ scope: syncScopeKey(scope), capture: capture.id, path: 'b', identity: 'b', entry: file('b') }, [syncScopeKey(scope), capture.id, 'a']);
			tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error);
		}); db.close();
		await assert.rejects(sealed ? f.inventory.read(capture) : f.inventory.seal(capture), /identity changed/);
		f.journal.close();
	}
});

test('100,000 paths survive bounded pages and reopening without treating a partial scan as complete', async () => {
	let f = await fixture();
	await f.inventory.begin(capture);
	const count = 100_000;
	for (let start = 0, ordinal = 0; start < count; start += INVENTORY_PAGE_ENTRIES, ordinal++) {
		const length = Math.min(INVENTORY_PAGE_ENTRIES, count - start);
		const entries = Array.from({ length }, (_, i) => file('file-' + String(start + i).padStart(6, '0')));
		await f.inventory.append(capture, { ordinal, entries, ...(start + length === count ? { totalEntries: count } : {}) });
		if (ordinal === 40) {
			f.journal.close(); f = await fixture(f.factory);
			assert.equal((await f.inventory.begin(capture)).pages, 41);
			await assert.rejects(f.inventory.read(capture), /incomplete/);
			await assert.rejects(f.inventory.seal(capture), /terminal/);
		}
	}
	await assert.rejects(f.inventory.read(capture), /incomplete/);
	assert.equal((await f.inventory.seal(capture)).entries, count);
	f.journal.close(); f = await fixture(f.factory);
	let next: InventoryCursor | undefined, seen = 0, pages = 0;
	do {
		const result = await f.inventory.read(capture, next);
		assert.ok(result.entries.length <= INVENTORY_PAGE_ENTRIES);
		assert.equal(result.totalEntries, count);
		for (const row of result.entries) assert.equal(row.path, 'file-' + String(seen++).padStart(6, '0'));
		next = result.next ?? undefined; pages++;
	} while (next);
	assert.equal(seen, count); assert.ok(pages > 700);
	await f.inventory.discard(capture);
	await assert.rejects(f.inventory.read(capture), /unavailable/);
	f.journal.close();
});

test('continuations cannot cross captures, generations or scopes, and skipped pages cannot finish', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	await f.inventory.append(capture, { ordinal: 0, entries: Array.from({ length: 128 }, (_, i) => file('a-' + String(i).padStart(3, '0'))) });
	await f.inventory.append(capture, { ordinal: 1, entries: [file('z')], totalEntries: 129 }); await f.inventory.seal(capture);
	const token = (await f.inventory.read(capture)).next!;
	for (const changed of [{ ...token, id: 'other' }, { ...token, generation: 'other' }, { ...token, source: 'remote' as const },
		{ ...token, scope: { ...scope, ownerId: 'other' } }]) await assert.rejects(f.inventory.read(capture, changed), /continuation/);
	await assert.rejects(f.inventory.read(capture, { ...token, after: 'zz' }), /ended/);
	assert.equal((await f.inventory.read(capture, token)).entries[0].path, 'z');
	f.journal.close();
});

test('validation resumes from its committed page after cancellation and reopening', async () => {
	let f = await fixture();
	await f.inventory.begin(capture);
	const count = INVENTORY_PAGE_ENTRIES * 2 + 1;
	for (let start = 0, ordinal = 0; start < count; start += INVENTORY_PAGE_ENTRIES, ordinal++) {
		const entries = Array.from({ length: Math.min(INVENTORY_PAGE_ENTRIES, count - start) },
			(_, i) => file('file-' + String(start + i).padStart(4, '0')));
		await f.inventory.append(capture, { ordinal, entries, ...(start + entries.length === count ? { totalEntries: count } : {}) });
	}
	const controller = new AbortController();
	const interruptible = f.journal.inventory({ scope, currentScope: () => scope, signal: controller.signal });
	await assert.rejects(interruptible.seal(capture, value => {
		assert.equal(value.phase, 'captured');
		assert.equal(value.validatedEntries, INVENTORY_PAGE_ENTRIES);
		controller.abort();
	}), { name: 'AbortError' });
	f.journal.close(); f = await fixture(f.factory);
	assert.equal((await f.inventory.begin(capture)).validatedEntries, INVENTORY_PAGE_ENTRIES);
	await assert.rejects(f.inventory.read(capture), /incomplete/);
	const validated: number[] = [];
	assert.equal((await f.inventory.seal(capture, value => validated.push(value.validatedEntries))).phase, 'complete');
	assert.deepEqual(validated, [INVENTORY_PAGE_ENTRIES * 2, count]);
	assert.equal((await f.inventory.read(capture)).totalEntries, count);
	f.journal.close();
});

test('missing, reordered, changed retry and changed-generation pages never publish completion', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	await assert.rejects(f.inventory.append(capture, { ordinal: 1, entries: [file('later')], totalEntries: 1 }), /order/);
	const first = { ordinal: 0, entries: [file('a')] };
	assert.equal((await f.inventory.append(capture, first)).entries, 1);
	assert.equal((await f.inventory.append(capture, first)).entries, 1);
	await assert.rejects(f.inventory.append(capture, { ...first, entries: [file('changed')] }), /retry changed/);
	await assert.rejects(f.inventory.append({ ...capture, generation: 'other' }, { ordinal: 1, entries: [], totalEntries: 1 }), /generation/);
	await assert.rejects(f.inventory.append(capture, { ordinal: 1, entries: [], totalEntries: 2 }), /count/);
	await assert.rejects(f.inventory.seal(capture), /terminal/);
	await f.inventory.append(capture, { ordinal: 1, entries: [], totalEntries: 1 });
	await f.inventory.seal(capture);
	assert.equal((await f.inventory.append(capture, first)).entries, 1);
	await assert.rejects(f.inventory.append(capture, { ordinal: 2, entries: [file('b')] }), /order/);
	f.journal.close();
});

test('case, Unicode and identity collisions across pages roll back the whole new page', async () => {
	for (const [a, b] of [[file('Name'), file('name')], [file('caf\u00e9'), file('cafe\u0301')], [file('a', 'same'), file('b', 'same')]]) {
		const f = await fixture(); await f.inventory.begin(capture);
		await f.inventory.append(capture, { ordinal: 0, entries: [a] });
		await assert.rejects(f.inventory.append(capture, { ordinal: 1, entries: [file('unrelated'), b], totalEntries: 3 }));
		assert.deepEqual(await f.inventory.begin(capture), { phase: 'collecting', pages: 1, entries: 1, validatedEntries: 0 });
		await f.inventory.append(capture, { ordinal: 1, entries: [], totalEntries: 1 });
		await f.inventory.seal(capture);
		assert.deepEqual((await f.inventory.read(capture)).entries, [a]);
		f.journal.close();
	}
});

test('parents may arrive on later pages, but missing, aliased and file ancestors refuse sealing', async () => {
	for (const parent of [null, file('parent'), folder('Parent'), folder('parent')]) {
		const f = await fixture(); await f.inventory.begin(capture);
		await f.inventory.append(capture, { ordinal: 0, entries: [file('parent/child')] });
		await f.inventory.append(capture, { ordinal: 1, entries: parent ? [parent] : [], totalEntries: parent ? 2 : 1 });
		if (parent?.kind === 'folder' && parent.path === 'parent') assert.equal((await f.inventory.seal(capture)).phase, 'complete');
		else { await assert.rejects(f.inventory.seal(capture), /ancestor/); await assert.rejects(f.inventory.read(capture), /incomplete/); }
		f.journal.close();
	}
});

test('an invalid ancestor on a later validation page never exposes the valid prefix', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	await f.inventory.append(capture, { ordinal: 0, entries: Array.from({ length: INVENTORY_PAGE_ENTRIES },
		(_, i) => file('a-' + String(i).padStart(3, '0'))) });
	await f.inventory.append(capture, { ordinal: 1, entries: [file('missing/child')], totalEntries: INVENTORY_PAGE_ENTRIES + 1 });
	await assert.rejects(f.inventory.seal(capture), /ancestor/);
	assert.equal((await f.inventory.begin(capture)).validatedEntries, INVENTORY_PAGE_ENTRIES);
	await assert.rejects(f.inventory.read(capture), /incomplete/);
	await assert.rejects(f.inventory.seal(capture), /ancestor/);
	await f.inventory.discard(capture);
	f.journal.close();
});

test('every account/root dimension is isolated and a live scope change fences unfinished operations', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	await f.inventory.append(capture, { ordinal: 0, entries: [file('private')], totalEntries: 1 });
	await f.inventory.seal(capture);
	for (const field of ['origin', 'ownerId', 'dataPlane', 'rootId', 'deviceId'] as const) {
		const other = { ...scope, [field]: field === 'origin' ? 'https://other.test' : 'other' };
		const inventory = f.journal.inventory({ scope: other, currentScope: () => other });
		await assert.rejects(inventory.read(capture), /unavailable/);
		await inventory.begin(capture);
		await inventory.append(capture, { ordinal: 0, entries: [], totalEntries: 0 });
		await inventory.seal(capture);
		assert.deepEqual((await inventory.read(capture)).entries, []);
		await inventory.discard(capture);
	}
	f.switchTo({ ...scope, ownerId: 'changed' });
	await assert.rejects(f.inventory.read(capture), /changed/);
	await assert.rejects(f.inventory.discard(capture), /changed/);
	f.switchTo(scope);
	assert.equal((await f.inventory.read(capture)).entries[0].path, 'private');
	f.journal.close();
});

test('pending/new scans preserve prior sealed observations, and multipart identities retain their exact format', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	const original = { ...file('multipart'), sha256: null, fingerprint: { algorithm: 'sha256-parts-v1' as const, partSizeBytes: 8 * 1024 * 1024, partCount: 1, sha256: 'b'.repeat(64) } };
	await f.inventory.append(capture, { ordinal: 0, entries: [original], totalEntries: 1 });
	await f.inventory.seal(capture);
	const pending = { ...capture, id: 'next', generation: 'next-generation' };
	await f.inventory.begin(pending);
	await f.inventory.append(pending, { ordinal: 0, entries: [file('new')] });
	await assert.rejects(f.inventory.seal(pending), /terminal/);
	assert.deepEqual((await f.inventory.read(capture)).entries, [original]);
	await f.inventory.discard(pending);
	assert.deepEqual((await f.inventory.read(capture)).entries, [original]);
	f.journal.close();
});

test('schema upgrade preserves existing runs and checkpoints', async () => {
	const factory = new IDBFactory();
	const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = factory.open('inventory-test', 2);
		request.onupgradeneeded = () => { request.result.createObjectStore('runs'); request.result.createObjectStore('checkpoints'); };
		request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
	});
	const run = { version: 1 as const, id: 'original-run', scope, operations: [] };
	const checkpoint = { version: 1 as const, runId: run.id, localRootId: 'local', remoteFolderId: 'remote', baseline: { scope, entries: [] } };
	await new Promise<void>((resolve, reject) => {
		const tx = legacy.transaction(['runs', 'checkpoints'], 'readwrite');
		tx.objectStore('runs').put(run, syncScopeKey(scope)); tx.objectStore('checkpoints').put(checkpoint, syncScopeKey(scope));
		tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(tx.error);
	});
	legacy.close();
	const f = await fixture(factory);
	assert.deepEqual(await f.journal.read(scope), run); assert.deepEqual(await f.journal.checkpoint(scope), checkpoint);
	await f.inventory.begin(capture);
	f.journal.close();
});

test('concurrent exact retries commit once, while cancellation and a scope change cannot publish a page', async () => {
	const f = await fixture(); await f.inventory.begin(capture);
	const page = { ordinal: 0, entries: [file('a')] };
	const results = await Promise.all([f.inventory.append(capture, page), f.inventory.append(capture, page)]);
	assert.ok(results.every(result => result.entries === 1 && result.pages === 1));
	const controller = new AbortController();
	const cancelling = f.journal.inventory({ scope, currentScope: () => scope, signal: controller.signal });
	const cancelled = cancelling.append(capture, { ordinal: 1, entries: [file('b')], totalEntries: 2 });
	controller.abort(); await assert.rejects(cancelled, { name: 'AbortError' });
	const switched = f.inventory.append(capture, { ordinal: 1, entries: [file('c')], totalEntries: 2 });
	f.switchTo({ ...scope, ownerId: 'other' }); await assert.rejects(switched, /changed/); f.switchTo(scope);
	assert.deepEqual(await f.inventory.begin(capture), { phase: 'collecting', pages: 1, entries: 1, validatedEntries: 0 });
	f.journal.close();
});
