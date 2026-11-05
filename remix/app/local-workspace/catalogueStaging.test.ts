import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { readCatalogueStream, writeCatalogueStream, type CatalogueSink, type CatalogueIdentity } from '../catalogue/catalogueStream';
import { AccountThemeSync, type AccountThemeSnapshot } from './accountThemes';
import { AccountAlgorithmSync, type AccountAlgorithmSnapshot } from './accountAlgorithms';
import { WorkspaceDatabase, WorkspaceError } from './storage';
import { createQuotaFactory } from './storageTestFixture';

const scope = { kind: 'account', origin: 'https://catalogue.test', ownerId: 'owner', dataPlane: 'home' } as const;
const stamp = '2026-10-26T00:00:00.000Z';
const key = (i: number) => `profile-${String(i).padStart(5, '0')}`;
function saved(domain: CatalogueIdentity['domain'], i: number): AccountThemeSnapshot | AccountAlgorithmSnapshot {
	const common = { id: key(i), folderId: null, createdAt: stamp, updatedAt: stamp };
	return domain === 'themes'
		? { ...common, name: 'Peach', title: null, theme: {}, visibility: 'private', version: 'theme-state-v1:' + 'a'.repeat(64) }
		: { ...common, version: 'algorithm-state-v1:' + 'a'.repeat(64), content: { name: 'Reading', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null }, description: '', parentId: null, shared: false, listed: false, legacy: false };
}
function fixture(domain: CatalogueIdentity['domain'], factory = new IDBFactory()) {
	let live = true; const listeners = new Set<() => void>();
	const lease = { assertCurrent() { if (!live) throw new WorkspaceError('WORKSPACE_CHANGED', 'Retired'); },
		onInvalidate(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
	const db = new WorkspaceDatabase(factory), sync = domain === 'themes' ? new AccountThemeSync(db, scope, lease) : new AccountAlgorithmSync(db, scope, lease);
	return { db, sync, lease, retire() { live = false; listeners.forEach(fn => fn()); } };
}
function transport(domain: CatalogueIdentity['domain'], rows: Array<AccountThemeSnapshot | AccountAlgorithmSnapshot>, afterEntry?: (id: string) => Promise<void>) {
	return {
		snapshot: async (): Promise<never> => { throw new Error('Legacy snapshot must not be called'); },
		write: async (): Promise<never> => { throw new Error('No writes in catalogue read'); },
		catalogue: async (sink: CatalogueSink, signal: AbortSignal) => {
			const identity = { domain, origin: scope.origin, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home' } as const;
			const pipe = new TransformStream<Uint8Array, Uint8Array>(), writer = pipe.writable.getWriter();
			const produced = writeCatalogueStream({ ...identity, version: 1, generation: randomUUID() }, (async function* () {
				for (const row of rows) yield { id: row.id, value: row };
			})(), bytes => writer.write(bytes), { signal }).then(() => writer.close()).catch(error => writer.abort(error).catch(() => {}));
			try { return await readCatalogueStream(pipe.readable, identity, { entry: async (id, value, current) => {
				await sink.entry(id, value, current); await afterEntry?.(id);
			}, complete: (receipt, current) => sink.complete(receipt, current) }, { signal }); }
			finally { await produced; }
		}
	};
}

for (const domain of ['themes', 'algorithms'] as const) {
	test(`${domain}: native stream stages beyond old catalogue limits without getAll, then admits and cleans atomically`, async t => {
		const f = fixture(domain); t.after(() => f.db.close());
		const rows = Array.from({ length: domain === 'themes' ? 145 : 60 }, (_, i) => saved(domain, i));
		if (domain === 'algorithms') {
			const tags = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [`tag-${i}-${'x'.repeat(250)}`, 1]));
			for (const row of rows) (row as AccountAlgorithmSnapshot).content.weights.tags = tags;
			assert.ok(new TextEncoder().encode(JSON.stringify(rows)).length > 8 * 1024 * 1024);
		}
		const getAll = IDBObjectStore.prototype.getAll;
		IDBObjectStore.prototype.getAll = () => { throw new Error('Full-library getAll is forbidden'); };
		try { assert.equal(await f.sync.refresh(transport(domain, rows)), true); }
		finally { IDBObjectStore.prototype.getAll = getAll; }
		const retained = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ states: await tx.list(`account-${domain === 'themes' ? 'theme' : 'algorithm'}-sync`), staging: await tx.list('catalogue-staging'), row: await tx.get<any>('things', key(0)) }));
		assert.equal(retained.states.length, rows.length); assert.deepEqual(retained.staging, []);
		assert.equal(retained.row.crystal.name, domain === 'themes' ? 'Peach' : 'Reading');
		if (domain === 'algorithms') assert.deepEqual(retained.row.crystal.weights, (rows[0] as AccountAlgorithmSnapshot).content.weights);
	});

	test(`${domain}: failed or malformed stream preserves prior catalogue and leaves no staging bytes`, async t => {
		const f = fixture(domain); t.after(() => f.db.close());
		await f.sync.refresh(transport(domain, [saved(domain, 1)]));
		const before = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ things: await tx.list('things'), usage: await tx.usage() }));
		await assert.rejects(f.sync.refresh(transport(domain, [saved(domain, 2)], async () => { throw new Error('Network interrupted'); })));
		const malformed = { ...saved(domain, 3), version: 'invalid' };
		await assert.rejects(f.sync.refresh(transport(domain, [saved(domain, 2), malformed])));
		const after = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ things: await tx.list('things'), usage: await tx.usage(), stages: await tx.list('catalogue-staging') }));
		assert.deepEqual(after.things, before.things); assert.deepEqual(after.usage, before.usage); assert.deepEqual(after.stages, []);
	});

	test(`${domain}: a newer read and a local edit during receiving cannot be overwritten by late admission`, async t => {
		const f = fixture(domain); t.after(() => f.db.close());
		await f.sync.refresh(transport(domain, [saved(domain, 1)]));
		await assert.rejects(f.sync.refresh(transport(domain, [saved(domain, 2)], async () => {
			await f.sync.refresh(transport(domain, [saved(domain, 3)]));
		})), /superseded/);
		assert.equal((await f.db.transaction(scope, 'readonly', f.lease, tx => tx.list('things')))[0].id, key(3));
		await assert.rejects(f.sync.refresh(transport(domain, [saved(domain, 4)], async () => {
			if (f.sync instanceof AccountThemeSync) await f.sync.save({ id: key(3), name: 'Device edit', theme: {} });
			else await f.sync.algorithms.update({ id: key(3), name: 'Device edit' });
		})), /superseded/);
		const kept = await f.db.transaction(scope, 'readonly', f.lease, tx => tx.get<any>('things', key(3)));
		assert.equal(kept.crystal.name, 'Device edit');
	});

	test(`${domain}: missing rows with device dependents are retained for review; clean missing rows are removed`, async t => {
		const f = fixture(domain); t.after(() => f.db.close());
		await f.sync.refresh(transport(domain, [saved(domain, 1), saved(domain, 2)]));
		await f.db.transaction(scope, 'readwrite', f.lease, tx => tx.put('things', 'dependent', { id: 'dependent', targetId: key(1), thingtime: ['bookmark'], crystal: {} }));
		await f.sync.refresh(transport(domain, []));
		const states = await f.db.transaction(scope, 'readonly', f.lease, tx => tx.list<any>(`account-${domain === 'themes' ? 'theme' : 'algorithm'}-sync`));
		assert.equal(states.length, 1); assert.equal(states[0].id, key(1)); assert.equal(states[0].value.state, 'conflict');
	});
}

test('platform quota exhaustion during final admission rolls back all catalogue changes and clears staging', async t => {
	const factory = createQuotaFactory({ records: 1000 }), f = fixture('themes', factory); t.after(() => f.db.close());
	await f.sync.refresh(transport('themes', [saved('themes', 1)]));
	const original = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ things: await tx.list('things'), usage: await tx.usage() }));
	await assert.rejects(f.sync.refresh(transport('themes', [saved('themes', 2)], async () => {
		const usage = await f.db.transaction(scope, 'readonly', f.lease, tx => tx.usage());
		factory.capacity.records = usage.records + 1; // allow a Thing but refuse its atomic sync record
	})), /storage|capacity/i);
	factory.capacity.records = 1000;
	const after = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ things: await tx.list('things'), usage: await tx.usage(), stages: await tx.list('catalogue-staging') }));
	assert.deepEqual(after.things, original.things); assert.deepEqual(after.usage, original.usage); assert.deepEqual(after.stages, []);
});

test('cancellation inside the final native storage transaction rolls back earlier writes', async t => {
	const f = fixture('themes'); t.after(() => f.db.close());
	await f.sync.refresh(transport('themes', [saved('themes', 1)]));
	const before = await f.db.transaction(scope, 'readonly', f.lease, tx => tx.list('things'));
	const controller = new AbortController(), originalPut = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.put = function (value: any, key?: IDBValidKey) {
		const request = originalPut.call(this, value, key);
		if (this.name === 'records' && value.collection === 'things' && value.id === 'profile-00002') controller.abort();
		return request;
	};
	try { await assert.rejects(f.sync.refresh(transport('themes', [saved('themes', 2)]), controller.signal)); }
	finally { IDBObjectStore.prototype.put = originalPut; }
	const after = await f.db.transaction(scope, 'readonly', f.lease, async tx => ({ things: await tx.list('things'), staging: await tx.list('catalogue-staging') }));
	assert.deepEqual(after.things, before); assert.deepEqual(after.staging, []);
});

test('a new authorized refresh cleans a retired stream staging area without reading another scope', async t => {
	const factory = new IDBFactory(), f = fixture('themes', factory); t.after(() => f.db.close());
	await f.sync.refresh(transport('themes', [saved('themes', 1)]));
	await assert.rejects(f.sync.refresh(transport('themes', [saved('themes', 2)], async () => { f.retire(); })), /Retired/);
	const next = fixture('themes', factory); t.after(() => next.db.close());
	assert.equal((await next.db.transaction(scope, 'readonly', next.lease, tx => tx.list('catalogue-staging'))).length, 1);
	await next.sync.refresh(transport('themes', [saved('themes', 3)]));
	const result = await next.db.transaction(scope, 'readonly', next.lease, async tx => ({ things: await tx.list('things'), staging: await tx.list('catalogue-staging'), usage: await tx.usage() }));
	assert.deepEqual(result.things.map(row => row.id), [key(3)]); assert.deepEqual(result.staging, []);
	assert.equal(result.usage.records, 3); // Thing, sync state, catalogue settings; no orphan staging rows
});
