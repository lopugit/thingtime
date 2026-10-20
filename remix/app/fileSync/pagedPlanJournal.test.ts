import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { type InventoryIdentity, INVENTORY_PAGE_ENTRIES, INVENTORY_STORES } from './inventoryJournal';
import { type PagedPlanSpec, type PagedPlanCursor } from './pagedPlanJournal';
import { planFileSync, syncScopeKey, type SyncDecision, type SyncEntry, type SyncScope, type SyncPolicy } from './reconcile';

const scope: SyncScope = { origin: 'https://paged-planner.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const file = (path: string, version = '1', side = ''): SyncEntry => ({ path, id: side + path, version, kind: 'file', size: 2, sha256: version.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'folder', size: 0, sha256: null });
const spec = (id = 'plan', policy: SyncPolicy = { mode: 'two-way', propagateDeletes: true }): PagedPlanSpec => ({
	id, local: { id: 'local', source: 'local', generation: 'scan' }, remote: { id: 'remote', source: 'remote', generation: 'scan' },
	baseline: { local: { id: 'before-local', source: 'local', generation: 'baseline' }, remote: { id: 'before-remote', source: 'remote', generation: 'baseline' } },
	policy, excludedPaths: []
});
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'paged-plan-test', IDBKeyRange);
	let current = { ...scope };
	const access = { scope, currentScope: () => current };
	return { factory, journal, plans: journal.plans(access), inventory: journal.inventory(access), switchTo: (value: SyncScope) => { current = value; } };
}
async function capture(f: Awaited<ReturnType<typeof fixture>>, id: InventoryIdentity, entries: SyncEntry[]) {
	await f.inventory.begin(id);
	for (let start = 0, ordinal = 0; start < entries.length || ordinal === 0; start += INVENTORY_PAGE_ENTRIES, ordinal++) {
		const page = entries.slice(start, start + INVENTORY_PAGE_ENTRIES);
		await f.inventory.append(id, { ordinal, entries: page, ...(start + page.length === entries.length ? { totalEntries: entries.length } : {}) });
	}
	await f.inventory.seal(id);
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, s: PagedPlanSpec, local: SyncEntry[], remote: SyncEntry[], beforeLocal: SyncEntry[] = [], beforeRemote = beforeLocal) {
	for (const [i, id] of [s.local, s.remote, s.baseline.local, s.baseline.remote].entries()) await capture(f, id, [local, remote, beforeLocal, beforeRemote][i]);
}

test('planning siblings writes each ancestor flag once per bounded page', async t => {
	const f = await fixture(), s = spec();
	await seed(f, s, [folder('parent'), ...Array.from({ length: 129 }, (_, i) => file(`parent/${i}`))], []);
	let writes = 0; const put = IDBObjectStore.prototype.put;
	t.mock.method(IDBObjectStore.prototype, 'put', function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
		if (this.name === 'sync-plan-ancestors') writes++; return put.apply(this, args);
	});
	const result = await f.plans.build(s);
	assert.equal(writes, 2); assert.equal(result.decisions, 130);
	assert.equal((await decisions(f, s)).length, 130); f.journal.close();
});
async function decisions(f: Awaited<ReturnType<typeof fixture>>, s: PagedPlanSpec) {
	const result: SyncDecision[] = []; let next: PagedPlanCursor | undefined;
	do {
		const page = await f.plans.read(s, next);
		assert.ok(page.decisions.length <= INVENTORY_PAGE_ENTRIES);
		result.push(...page.decisions); next = page.next ?? undefined;
		if (!next) assert.equal(result.length, page.totalDecisions);
	} while (next);
	return result;
}

test('paged decisions preserve the whole-tree planner across all modes and replica changes', async () => {
	const f = await fixture(), s = spec();
	const old = [folder('Folder'), ...Array.from({ length: 380 }, (_, i) => file(`Folder/f-${String(i).padStart(4, '0')}`))];
	const local = old.filter((_e, i) => i % 11 !== 2).map((e, i) => e.kind === 'file' && i % 9 === 0 ? file(e.path, '2') : e);
	const remote = old.filter((_e, i) => i % 13 !== 2).map((e, i) => e.kind === 'file' && i % 7 === 0 ? file(e.path, '3', 'remote:') : e);
	local.push(file('new-local')); remote.push(file('new-remote'));
	await seed(f, s, local.reverse(), remote.reverse(), old);
	for (const mode of ['two-way', 'upload', 'download', 'backup'] as const) for (const propagateDeletes of [false, true]) {
		const input = { ...s, id: `${mode}-${propagateDeletes}`, policy: { mode, propagateDeletes } };
		await f.plans.build(input);
		const expected = planFileSync({ scope, complete: true, entries: local }, { scope, complete: true, entries: remote },
			{ scope, entries: old.map(e => ({ path: e.path, local: e, remote: e })) }, input.policy).decisions;
		assert.deepEqual((await decisions(f, input)).sort((a, b) => a.path.localeCompare(b.path)), expected.sort((a, b) => a.path.localeCompare(b.path)));
	}
	f.journal.close();
});

test('late descendant edits protect a deleted folder, with cancellation and reopen in both passes', async () => {
	let f = await fixture(); const s = spec();
	const old = [folder('folder'), ...Array.from({ length: 400 }, (_, i) => file('folder/' + String(i).padStart(4, '0')))];
	const remote = old.map((e, i) => i === 400 ? file(e.path, '2') : e);
	await seed(f, s, [], remote, old);
	for (const phase of ['indexing', 'planning']) {
		const abort = new AbortController();
		await assert.rejects(f.journal.plans({ scope, currentScope: () => scope, signal: abort.signal }).build(s, state => {
			if (state.phase === phase && (phase === 'indexing' ? state.indexed : state.planned) >= 128) abort.abort();
		}), { name: 'AbortError' });
		await assert.rejects(f.plans.read(s), /incomplete/);
		f.journal.close(); f = await fixture(f.factory);
		const state = await f.plans.begin(s);
		assert.equal(state.phase, phase);
		assert.equal(phase === 'indexing' ? state.indexed : state.planned, 128);
	}
	assert.equal((await f.plans.build(s)).phase, 'complete');
	const rows = await decisions(f, s);
	assert.deepEqual(rows[0], { kind: 'conflict', path: 'folder', reason: 'delete-edit', local: null, remote: folder('folder') });
	assert.equal(rows.at(-1)?.kind, 'conflict');
	assert.equal(rows.filter(d => d.kind === 'trash').length, 399);
	f.journal.close();
});

test('a late cross-replica alias or invalid baseline exposes no partial plan, even when excluded', async () => {
	for (const fault of ['alias', 'baseline']) {
		const f = await fixture(), s = spec(); s.excludedPaths = ['z'];
		const earlier = Array.from({ length: 300 }, (_, i) => file('a-' + String(i).padStart(4, '0')));
		await seed(f, s, [...earlier, file('Z')], fault === 'alias' ? [file('z')] : [],
			fault === 'baseline' ? [file('Z')] : [], []);
		await assert.rejects(f.plans.build(s), fault === 'alias' ? /collision/ : /baseline/);
		const state = await f.plans.begin(s); assert.ok(state.indexed >= 128); assert.equal(state.phase, 'indexing');
		await assert.rejects(f.plans.read(s), /incomplete/);
		await assert.rejects(f.inventory.discard(s.local), /pinned/);
		await f.plans.discard(s); await f.inventory.discard(s.local);
		f.journal.close();
	}
});

test('unfinished plans pin captures atomically; completing one does not unpin another', async () => {
	const f = await fixture(), s = spec(), second = spec('other');
	await seed(f, s, [file('a')], []);
	await Promise.all([f.plans.begin(s), f.plans.begin(second)]);
	for (const id of [s.local, s.remote, s.baseline.local, s.baseline.remote]) await assert.rejects(f.inventory.discard(id), /pinned/);
	await Promise.all([f.plans.build(s), f.plans.build(s)]);
	assert.equal((await decisions(f, s)).length, 1);
	await assert.rejects(f.inventory.discard(s.local), /pinned/);
	await f.plans.discard(second); await f.inventory.discard(s.local);
	assert.equal((await decisions(f, s))[0].kind, 'copy');
	await f.plans.discard(s); await assert.rejects(f.plans.read(s), /unavailable/);
	f.journal.close();
});

test('exclusions protect parents and omit descendant changes without hiding validation', async () => {
	const f = await fixture(), s = spec(); s.excludedPaths = ['folder/protected'];
	const old = [folder('folder'), file('folder/protected'), file('folder/other')];
	await seed(f, s, [], [folder('folder'), file('folder/protected', '2'), file('folder/other')], old);
	await f.plans.build(s);
	assert.deepEqual((await decisions(f, s)).map(d => [d.path, d.kind, d.kind === 'conflict' ? d.reason : null]),
		[['folder', 'conflict', 'excluded-descendants'], ['folder/other', 'trash', null]]);
	f.journal.close();
});

test('changed policy, capture, scope and continuation cannot resume or disclose a plan', async () => {
	const f = await fixture(), s = spec();
	await seed(f, s, Array.from({ length: 260 }, (_, i) => file('a-' + String(i).padStart(3, '0'))), []);
	await f.plans.begin(s);
	for (const changed of [{ ...s, policy: { ...s.policy, propagateDeletes: false } }, { ...s, excludedPaths: ['a'] },
		{ ...s, local: { ...s.local, generation: 'other' } }]) await assert.rejects(f.plans.build(changed), /changed/);
	await f.plans.build(s); const token = (await f.plans.read(s)).next!;
	for (const changed of [{ ...token, id: 'wrong' }, { ...token, scope: { ...scope, ownerId: 'other' } }, { ...token, after: 'zz' }])
		await assert.rejects(f.plans.read(s, changed), /continuation|ended/);
	f.switchTo({ ...scope, ownerId: 'other' });
	await assert.rejects(f.plans.read(s), /changed/); await assert.rejects(f.plans.discard(s), /changed/);
	f.journal.close();
});

test('incomplete input refuses initialization without leaving pins; empty captures finish', async () => {
	const f = await fixture(), s = spec();
	await seed(f, s, [], []); await f.inventory.discard(s.remote); await f.inventory.begin(s.remote);
	await assert.rejects(f.plans.begin(s), /complete/);
	await f.inventory.discard(s.local); // the failed multi-input transaction rolled back all pins
	await capture(f, s.local, []); await f.inventory.discard(s.remote); await capture(f, s.remote, []);
	assert.deepEqual(await f.plans.build(s), { phase: 'complete', indexed: 0, planned: 0, decisions: 0 });
	assert.deepEqual(await decisions(f, s), []);
	f.journal.close();
});

test('Unicode case-fold expansion remains a valid durable cursor across pages', async () => {
	const f = await fixture(), s = spec(), root = 'İ'.repeat(200);
	const entries = [folder(root), ...Array.from({ length: 260 }, (_, i) => file(root + '/' + String(i).padStart(3, '0')))];
	await seed(f, s, entries, []);
	await f.plans.build(s);
	assert.equal((await decisions(f, s)).length, 261);
	f.journal.close();
});

test('long-path observations stop at the byte budget before the entry budget', async () => {
	const f = await fixture(), s = spec(); const entries: SyncEntry[] = []; let root = '';
	for (let i = 0; i < 15; i++) {
		root += (root ? '/' : '') + String(i).padStart(3, '0') + 'a'.repeat(237);
		entries.push({ ...folder(root), id: `folder-${i}` });
	}
	for (let i = 0; i < 140; i++) entries.push({ ...file(root + '/' + String(i).padStart(3, '0')), id: `file-${i}` });
	await seed(f, s, entries, entries, entries);
	await f.plans.begin(s); const first = await f.plans.step(s);
	assert.ok(first.indexed > 0 && first.indexed < 128);
	await f.plans.build(s); assert.equal((await decisions(f, s)).length, entries.length);
	f.journal.close();
});

test('version-3 captures survive the planner and pin-store upgrade', async () => {
	const factory = new IDBFactory(), s = spec();
	await new Promise<void>((resolve, reject) => {
		const request = factory.open('paged-plan-test', 3);
		request.onupgradeneeded = () => {
			for (const name of ['runs', 'checkpoints', ...INVENTORY_STORES]) {
				const store = request.result.createObjectStore(name);
				if (name === 'inventory-entries') store.createIndex('identity', ['scope', 'capture', 'identity'], { unique: true });
			}
			const headers = request.transaction!.objectStore(INVENTORY_STORES[0]);
			for (const id of [s.local, s.remote, s.baseline.local, s.baseline.remote]) headers.add({ ...id, scope: syncScopeKey(scope),
				phase: 'complete', pages: 1, entries: 0, validatedEntries: 0, validatedThrough: null }, [syncScopeKey(scope), id.id]);
		};
		request.onerror = () => reject(request.error);
		request.onsuccess = () => { request.result.close(); resolve(); };
	});
	const f = await fixture(factory);
	assert.deepEqual((await f.inventory.read(s.local)).entries, []);
	assert.equal((await f.plans.build(s)).phase, 'complete');
	f.journal.close();
});

test('20,000 paths plan and reopen with bounded decisions beyond the live whole-tree cap', async () => {
	let f = await fixture(); const s = spec();
	const count = 20_000;
	await seed(f, s, Array.from({ length: count }, (_, i) => file('file-' + String(i).padStart(6, '0'))), []);
	assert.equal((await f.plans.build(s)).decisions, count);
	f.journal.close(); f = await fixture(f.factory);
	let next: PagedPlanCursor | undefined, seen = 0;
	do {
		const page = await f.plans.read(s, next); assert.ok(page.decisions.length <= 128);
		for (const d of page.decisions) { assert.equal(d.path, 'file-' + String(seen++).padStart(6, '0')); assert.equal(d.kind, 'copy'); }
		next = page.next ?? undefined;
	} while (next);
	assert.equal(seen, count);
	await f.plans.discard(s); await f.inventory.discard(s.local); f.journal.close();
});
