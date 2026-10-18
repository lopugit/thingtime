import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { syncScopeKey, type SyncEntry } from './reconcile';
import { INVENTORY_PAGE_ENTRIES, type InventoryIdentity } from './inventoryJournal';
import { JOURNAL_RETENTION_STORE } from './journalRetention';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { foregroundFixture, scope, saved } from './foregroundSync.fixture';
import { retentionFixture, scope as retainScope } from './conflictRetention.fixture';
import type { JournalAccess } from './journalScope';
import type { PagedPlanSpec } from './pagedPlanJournal';

const name = 'thingtime-file-sync-v1', signal = () => new AbortController().signal;
const access = (current = scope): JournalAccess => ({ scope: current, currentScope: () => current, cleanup: 'foreground' });
const identity = (id: string, source: 'local' | 'remote' = 'local'): InventoryIdentity => ({ id, source, generation: 'one' });
const entries = (count: number): SyncEntry[] => Array.from({ length: count }, (_, i) => ({ path: 'file-' + String(i).padStart(5, '0'), id: 'file-' + i,
	version: 'one', kind: 'file', size: 2, sha256: 'a'.repeat(64) }));
async function connect(factory: IDBFactory) {
	return new Promise<IDBDatabase>((resolve, reject) => { const r = factory.open(name); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}
async function counts(factory: IDBFactory) {
	const db = await connect(factory), names = [...db.objectStoreNames], result: Record<string, number> = {};
	await new Promise<void>((resolve, reject) => { const tx = db.transaction(names, 'readonly');
		for (const store of names) { const r = tx.objectStore(store).count(); r.onsuccess = () => { result[store] = r.result; }; }
		tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
	}); db.close(); return result;
}
async function fixture(factory = new IDBFactory(), a = access()) {
	const journal = await openSyncJournal(factory, name, IDBKeyRange);
	return { factory, journal, access: a, inventory: journal.inventory(a), plans: journal.plans(a), maintenance: journal.maintenance(a) };
}
async function capture(f: Awaited<ReturnType<typeof fixture>>, id: InventoryIdentity, rows = entries(270)) {
	await f.inventory.begin(id);
	for (let ordinal = 0, offset = 0; offset < rows.length || !ordinal; ordinal++, offset += 128) {
		const page = rows.slice(offset, offset + 128); await f.inventory.append(id, { ordinal, entries: page,
			...(offset + page.length === rows.length ? { totalEntries: rows.length } : {}) });
	}
	await f.inventory.seal(id);
}

test('cleanup is bounded and restartable, prevents ID reuse while retiring, and preserves other scopes and unmanaged captures', async () => {
	let f = await fixture(); const id = identity('managed'); await capture(f, id);
	const unmanaged = await fixture(f.factory, { ...access(), cleanup: undefined }); await capture(unmanaged, identity('unmanaged'), entries(1));
	const foreign = await fixture(f.factory, access({ ...scope, ownerId: 'other-owner' })); await capture(foreign, id, entries(1));
	const first = await f.maintenance.step(); assert.equal(first.deleted, 128); assert.equal(first.retired, 1); assert.equal(first.done, false);
	await assert.rejects(f.inventory.read(id), /unavailable/); await assert.rejects(f.inventory.begin(id), /unavailable/);
	await assert.rejects(f.inventory.begin({ ...id, generation: 'new' }), /unavailable/);
	assert.equal((await unmanaged.inventory.read(identity('unmanaged'))).totalEntries, 1);
	assert.equal((await foreign.inventory.read(id)).totalEntries, 1);
	f.journal.close(); f = await fixture(f.factory); const pages: number[] = [];
	await f.maintenance.collect(p => pages.push(p.deleted)); assert.ok(pages.every(n => n <= INVENTORY_PAGE_ENTRIES));
	assert.equal((await counts(f.factory))[JOURNAL_RETENTION_STORE], 1); // only the foreign capture
	await capture(f, { ...id, generation: 'new' }, entries(1)); assert.equal((await f.inventory.read({ ...id, generation: 'new' })).totalEntries, 1);
	f.journal.close(); unmanaged.journal.close(); foreign.journal.close();
});

test('another reader pins managed inventory and a late reader cannot acquire partially retired inputs', async () => {
	const f = await fixture(), reader = await fixture(f.factory, { ...access(), cleanup: undefined });
	const inputs = [identity('a'), identity('b', 'remote'), identity('c'), identity('d', 'remote')];
	for (const id of inputs) await capture(f, id, id.id === 'a' ? entries(270) : []);
	const plan: PagedPlanSpec = { id: 'reader', local: inputs[0], remote: inputs[1], baseline: { local: inputs[2], remote: inputs[3] },
		policy: { mode: 'backup', propagateDeletes: false }, excludedPaths: [] };
	await reader.plans.begin(plan); assert.equal((await f.maintenance.collect()).retired, 0);
	assert.equal((await f.inventory.read(inputs[0])).totalEntries, 270); await reader.plans.discard(plan);
	const first = await f.maintenance.step(); assert.equal(first.deleted, 128);
	await assert.rejects(reader.plans.begin({ ...plan, id: 'late-reader' }), /unavailable/);
	await f.maintenance.collect(); assert.equal((await counts(f.factory))['inventory-captures'], 0);
	f.journal.close(); reader.journal.close();
});

test('an interrupted cleanup transaction rolls back retirement and every row deletion together', async () => {
	const f = await fixture(), id = identity('rollback'); await capture(f, id);
	const before = await counts(f.factory), original = IDBObjectStore.prototype.delete; let writes = 0;
	IDBObjectStore.prototype.delete = function (...args) { if (this.name === 'inventory-entries' && ++writes === 50) throw Error('storage interruption'); return original.apply(this, args); };
	try { await assert.rejects(f.maintenance.step(), /storage interruption/); } finally { IDBObjectStore.prototype.delete = original; }
	assert.deepEqual(await counts(f.factory), before); assert.equal((await f.inventory.read(id)).totalEntries, 270);
	await f.maintenance.collect(); assert.equal((await counts(f.factory))['inventory-captures'], 0); f.journal.close();
});

test('account changes stop cleanup between pages while its retirement survives reopening', async () => {
	let current = scope; const a: JournalAccess = { ...access(), currentScope: () => current };
	let f = await fixture(undefined, a); await capture(f, identity('scoped'));
	await assert.rejects(f.maintenance.collect(() => { current = { ...scope, ownerId: 'changed' }; }), /account or root/);
	assert.equal((await counts(f.factory))['inventory-entries'], 145); // three page records and 125 entries deleted
	f.journal.close(); f = await fixture(f.factory); await f.maintenance.collect();
	assert.equal((await counts(f.factory))['inventory-captures'], 0); f.journal.close();
});

test('repeated foreground runs have stable metadata size and retain their exact published baseline', async () => {
	const f = await foregroundFixture(5); let stable: Record<string, number> | undefined;
	for (let i = 0; i < 7; i++) {
		await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); const state = await counts(f.factory);
		if (i === 3) stable = state; if (i > 3) assert.deepEqual(state, stable);
		await f.reload();
	}
	const a = access(), head = (await f.journal().pagedCheckpoints(a).current())!;
	assert.equal((await f.journal().inventory(a).read(head.baseline.local)).totalEntries, 5);
	assert.equal((await f.journal().inventory(a).read(head.baseline.remote)).totalEntries, 5);
	assert.equal(f.creates(), 5); assert.equal(await f.journal().pagedRuns(a).active(), null); f.journal().close();
});

test('cleanup preserves unfinished effects and the most recent retained conflict receipts', async () => {
	const f = await foregroundFixture(135); f.lose();
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, f.input(), signal()), /lost accepted/);
	const active = (await f.journal().pagedRuns(access()).active())!; await f.journal().maintenance(access()).collect();
	assert.deepEqual(await f.journal().pagedRuns(access()).active(), active); assert.equal(f.creates(), 129);
	await f.reload(); await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); assert.equal(f.creates(), 135); f.journal().close();
	const g = await retentionFixture(); await runPagedForegroundCloudSync(g.saved, retainScope, g.input(), signal());
	const a = access(retainScope), retained = await g.journal().pagedRuns(a).retained(), first = g.counts();
	for (let i = 0; i < 4; i++) { await g.reload(); await runPagedForegroundCloudSync(g.saved, retainScope, g.input(), signal()); }
	assert.deepEqual(await g.journal().pagedRuns(a).retained(), retained); assert.equal(g.counts().uploads, first.uploads); assert.equal(g.counts().puts, first.puts);
	assert.equal((await counts(g.factory))['sync-paged-runs'], 1); assert.deepEqual(g.live(), g.original); g.journal().close();
});

test('a retired run finishes cleanup even when its already-published checkpoint is collected between pages', async () => {
	const f = await foregroundFixture(135), a = access();
	const first = await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); assert.ok('spec' in first);
	await runPagedForegroundCloudSync(saved, scope, f.input(), signal());
	const maintenance = f.journal().maintenance(a), p = await maintenance.step({ scope: syncScopeKey(scope), kind: 'run', id: first.spec.id, inclusive: true });
	assert.equal(p.retired, 1); assert.equal(p.deleted, 128);
	const removed = await maintenance.step({ scope: syncScopeKey(scope), kind: 'checkpoint', id: first.spec.id, inclusive: true }); assert.equal(removed.retired, 1);
	await maintenance.collect(); assert.equal((await counts(f.factory))['sync-paged-runs'], 1);
	assert.equal((await f.journal().pagedCheckpoints(a).current())?.baseline.local.source, 'local'); f.journal().close();
});


test('the active root independently protects its recovery inputs when pin indexes are damaged', async () => {
	const f = await foregroundFixture(135); f.lose();
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, f.input(), signal()), /lost accepted/);
	// Retire the released empty review first; this assertion concerns only the
	// active run and its inputs, not unrelated metadata that is safe to collect.
	await f.journal().maintenance(access()).collect();
	const original = (await f.journal().pagedRuns(access()).active())!, db = await connect(f.factory);
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction(['inventory-capture-pins', 'sync-plan-pins'], 'readwrite');
		tx.objectStore('inventory-capture-pins').clear(); tx.objectStore('sync-plan-pins').clear();
		tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
	}); db.close();
	const before = await counts(f.factory); await f.journal().maintenance(access()).collect();
	assert.deepEqual(await counts(f.factory), before); assert.deepEqual(await f.journal().pagedRuns(access()).active(), original);
	await f.reload(); await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); assert.equal(f.creates(), 135); f.journal().close();
});
