import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { createSyncRun, type SyncExecutionPort, type SyncOperation, type SyncReceipt } from './execute';
import { executePagedSyncRun } from './pagedExecute';
import { type PagedRunSpec } from './pagedRunJournal';
import { type InventoryIdentity, upgradeInventoryJournal } from './inventoryJournal';
import { PLAN_STORES } from './pagedPlanJournal';
import { planFileSync, syncScopeKey, type SyncEntry, type SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://paged-run.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'device' };
const file = (path: string, v = '1'): SyncEntry => ({ path, id: path, version: v, kind: 'file', size: 2, sha256: v.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'folder', size: 0, sha256: null });
const spec = (): PagedRunSpec => ({ id: 'run', plan: { id: 'plan', local: { id: 'local', source: 'local', generation: 'scan' },
	remote: { id: 'remote', source: 'remote', generation: 'scan' }, baseline: {
		local: { id: 'before-local', source: 'local', generation: 'before' }, remote: { id: 'before-remote', source: 'remote', generation: 'before' }
	}, policy: { mode: 'two-way', propagateDeletes: true }, excludedPaths: [] } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'paged-run-test', IDBKeyRange); let current = { ...scope };
	const access = { scope, currentScope: () => current };
	return { factory, journal, runs: journal.pagedRuns(access), plans: journal.plans(access), inventory: journal.inventory(access),
		access, switchTo: (value: SyncScope) => { current = value; } };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec, local: SyncEntry[], remote: SyncEntry[] = [], before: SyncEntry[] = []) {
	for (const [i, id] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
		const entries = [local, remote, before, before][i]; await f.inventory.begin(id);
		for (let start = 0, ordinal = 0; start < entries.length || ordinal === 0; start += 128, ordinal++) {
			const page = entries.slice(start, start + 128);
			await f.inventory.append(id as InventoryIdentity, { ordinal, entries: page, ...(start + page.length === entries.length ? { totalEntries: entries.length } : {}) });
		}
		await f.inventory.seal(id);
	}
	await f.plans.build(s.plan);
}
const receipt = (op: SyncOperation): SyncReceipt => ({ operationId: op.id, scope,
	entry: op.mutation.kind === 'copy' ? { ...op.mutation.source, id: 'dest-' + op.id, version: 'written' } : null });
// Serializes competing callers with the same shape as browser Web Locks.
function lockFixture() {
	let tail = Promise.resolve(); let calls = 0;
	return { get calls() { return calls; }, locks: { request: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
		assert.ok(name.startsWith('thingtime-file-sync:')); calls++;
		const previous = tail; let release!: () => void; tail = new Promise<void>(resolve => { release = resolve; });
		await previous; try { return await callback(); } finally { release(); }
	} } as unknown as LockManager };
}
function portFixture(local: SyncEntry[]) {
	const entries = new Map(local.map(e => [e.path, e])), receipts = new Map<string, SyncReceipt>(), effects: string[] = [];
	const port: Omit<SyncExecutionPort, 'persist'> = {
		currentScope: () => scope, read: async (side, path) => side === 'local' ? entries.get(path) ?? null : null,
		lookup: async id => receipts.has(id) ? { status: 'complete', receipt: receipts.get(id)! } : { status: 'missing' },
		apply: async op => { const result = receipt(op); effects.push(op.id); receipts.set(op.id, result); return result; }
	};
	return { port, effects, receipts, entries };
}

test('paged operations preserve global copy/deletion ordering and IDs after reopening', async () => {
	let f = await fixture(); const s = spec();
	const before = [folder('A'), folder('A/b'), file('A/b/deleted'), file('a-old')];
	const local = [folder('Z'), folder('Z/b'), file('Z/b/new'), ...Array.from({ length: 270 }, (_, i) => file('z-' + String(i).padStart(3, '0')))];
	await seed(f, s, local, before, before); await f.runs.begin(s); assert.equal((await f.runs.step(s)).read, 128);
	await assert.rejects(f.runs.read(s), /incomplete/); await assert.rejects(f.runs.start(s), /incomplete/);
	await assert.rejects(f.plans.discard(s.plan), /pinned/);
	f.journal.close(); f = await fixture(f.factory); assert.equal((await f.runs.begin(s)).read, 128);
	await Promise.all([f.runs.prepare(s), f.runs.prepare(s)]);
	const initial = await f.runs.find(s, 'z-000'); assert.ok(initial);
	f.journal.close(); f = await fixture(f.factory); assert.deepEqual((await f.runs.active())?.spec, s); assert.deepEqual(await f.runs.find(s, 'z-000'), initial);
	const expected = createSyncRun(planFileSync({ scope, complete: true, entries: local }, { scope, complete: true, entries: before },
		{ scope, entries: before.map(e => ({ path: e.path, local: e, remote: e })) }, s.plan.policy));
	await f.runs.start(s); const mutations = [], ids = new Set<string>();
	for (;;) {
		const page = await f.runs.read(s); assert.ok(page.operations.length <= 128);
		if (!page.operations.length) break;
		for (const op of page.operations) { assert.ok(!ids.has(op.id)); ids.add(op.id); mutations.push(op.mutation); await f.runs.confirm(s, receipt(op)); }
	}
	assert.deepEqual(mutations, expected.operations.map(op => op.mutation));
	assert.equal((await f.runs.begin(s)).phase, 'complete'); await assert.rejects(f.runs.discard(s), /started/);
	await assert.rejects(f.plans.discard(s.plan), /pinned/); f.journal.close();
});

test('a conflict on a later page prevents every operation from becoming executable', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [...Array.from({ length: 260 }, (_, i) => file('a-' + i)), file('z')], [file('z', '2')]);
	await assert.rejects(f.runs.prepare(s), /conflicts/); assert.ok((await f.runs.begin(s)).read >= 128);
	await assert.rejects(f.runs.read(s), /incomplete/); await assert.rejects(f.runs.start(s), /incomplete/);
	await f.runs.discard(s); await f.plans.discard(s.plan); f.journal.close();
});

test('duplicate operation IDs abort the whole page and retry preserves prior progress', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [file('a'), file('b')]); await f.runs.begin(s);
	await assert.rejects(f.runs.step(s, () => 'duplicate')); assert.equal((await f.runs.begin(s)).read, 0);
	await assert.rejects(f.runs.step(s, () => s.id), /unique/); await f.runs.prepare(s);
	assert.equal((await f.runs.read(s)).operations.length, 2); f.journal.close();
});

test('legacy and paged writers atomically exclude each other for the same root', async () => {
	for (const first of ['legacy', 'paged', 'race']) {
		const f = await fixture(), s = spec(); const items = [file('a')]; await seed(f, s, items);
		const legacy = createSyncRun(planFileSync({ scope, complete: true, entries: items }, { scope, complete: true, entries: [] },
			{ scope, entries: [] }, s.plan.policy));
		if (first === 'legacy') { await f.journal.persist(legacy); await assert.rejects(f.runs.begin(s), /unfinished/); }
		else if (first === 'paged') { await f.runs.begin(s); await assert.rejects(f.journal.persist(legacy), /paged/); }
		else { const results = await Promise.allSettled([f.runs.begin(s), f.journal.persist(legacy)]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); }
		f.journal.close();
	}
});

test('confirmations require the exact receipt and ordered prefix; repeats are idempotent', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [file('a'), file('b')]); await f.runs.prepare(s);
	const [a, b] = (await f.runs.read(s)).operations;
	await assert.rejects(f.runs.confirm(s, receipt(a)), /Start/); await f.runs.start(s);
	await assert.rejects(f.runs.confirm(s, receipt(b)), /in order/);
	await assert.rejects(f.runs.confirm(s, { ...receipt(a), scope: { ...scope, ownerId: 'other' } }), /identity/);
	await assert.rejects(f.runs.confirm(s, { ...receipt(a), entry: file('a', '2') }), /content/);
	assert.equal((await f.runs.confirm(s, receipt(a))).confirmed, 1);
	assert.equal((await f.runs.confirm(s, receipt(a))).confirmed, 1);
	await assert.rejects(f.runs.confirm(s, { ...receipt(a), entry: { ...receipt(a).entry!, version: 'different' } }), /retry changed/);
	assert.equal((await f.runs.read(s)).operations[0].id, b.id); await f.runs.confirm(s, receipt(b));
	assert.equal((await f.runs.read(s)).operations.length, 0); f.journal.close();
});

test('lost effect reply and cancellation recover by original receipt after reopening', async () => {
	for (const reason of ['lost', 'cancelled', 'confirm-failed']) {
		let f = await fixture(); const s = spec(), items = [file('a'), file('b')], p = portFixture(items), lock = lockFixture(), abort = new AbortController();
		await seed(f, s, items); await f.runs.prepare(s); const apply = p.port.apply;
		p.port.apply = async (...args) => {
			assert.equal((await f.runs.begin(s)).phase, 'running');
			const r = await apply(...args);
			if (reason === 'lost') throw Error('lost response'); if (reason === 'cancelled') abort.abort(); return r;
		};
		const journal = reason === 'confirm-failed' ? { ...f.runs, confirm: async () => { throw Error('disk failure'); } } : f.runs;
		await assert.rejects(executePagedSyncRun(s, scope, journal, p.port, { locks: lock.locks, signal: abort.signal }));
		await assert.rejects(f.runs.discard(s), /started/); assert.equal((await f.runs.begin(s)).confirmed, 0);
		const id = p.effects[0]; f.journal.close(); f = await fixture(f.factory); p.port.apply = apply;
		await executePagedSyncRun(s, scope, f.runs, p.port, { locks: lock.locks });
		assert.equal(p.effects.filter(value => value === id).length, 1); assert.equal(p.effects.length, 2); f.journal.close();
	}
});

test('competing executors use one root lock and never repeat effects', async () => {
	const f = await fixture(), s = spec(), items = [file('a'), file('b')], p = portFixture(items), lock = lockFixture();
	await seed(f, s, items); await f.runs.prepare(s);
	await Promise.all([1, 2].map(() => executePagedSyncRun(s, scope, f.runs, p.port, { locks: lock.locks })));
	assert.equal(lock.calls, 2); assert.equal(p.effects.length, 2); f.journal.close();
});

test('changed sources, pending receipts and mismatched journal owners never apply effects', async () => {
	for (const fault of ['source', 'pending', 'owner', 'scope-change']) {
		const f = await fixture(), s = spec(), items = [file('a')], p = portFixture(items), lock = lockFixture();
		await seed(f, s, items); await f.runs.prepare(s); let chosenScope = scope;
		if (fault === 'source') p.entries.set('a', file('a', '2'));
		if (fault === 'pending') p.port.lookup = async () => ({ status: 'pending' });
		if (fault === 'owner') { chosenScope = { ...scope, ownerId: 'other' }; p.port.currentScope = () => chosenScope; }
		if (fault === 'scope-change') p.port.lookup = async () => { f.switchTo({ ...scope, deviceId: 'other' }); return { status: 'pending' }; };
		await assert.rejects(executePagedSyncRun(s, chosenScope, f.runs, p.port, { locks: lock.locks }));
		assert.equal(p.effects.length, 0); f.journal.close();
	}
});

test('preparation cancellation retains its page; changed settings and new runs are refused', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, Array.from({ length: 270 }, (_, i) => file('f-' + i)));
	const abort = new AbortController(), runs = f.journal.pagedRuns({ ...f.access, signal: abort.signal });
	await assert.rejects(runs.prepare(s, state => { if (state.read >= 128) abort.abort(); }), { name: 'AbortError' });
	assert.equal((await f.runs.begin(s)).read, 128);
	await assert.rejects(f.runs.begin({ ...s, id: 'other' }), /active/);
	await assert.rejects(f.runs.prepare({ ...s, plan: { ...s.plan, policy: { ...s.plan.policy, mode: 'backup' } } }), /changed/);
	await f.runs.prepare(s); f.journal.close();
});

test('empty plans complete without effects and retain the checkpoint boundary', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, []); await f.runs.prepare(s);
	const p = portFixture([]); assert.equal((await executePagedSyncRun(s, scope, f.runs, p.port, { locks: lockFixture().locks })).phase, 'complete');
	assert.equal(p.effects.length, 0); await assert.rejects(f.runs.discard(s), /started/); f.journal.close();
});


test('version-4 plans, captures and legacy runs survive the operation-journal upgrade', async () => {
	const factory = new IDBFactory(), s = spec(), key = syncScopeKey(scope);
	await new Promise<void>((resolve, reject) => {
		const request = factory.open('paged-run-test', 4);
		request.onupgradeneeded = () => {
			const db = request.result; for (const name of ['runs', 'checkpoints', ...PLAN_STORES]) db.createObjectStore(name);
			upgradeInventoryJournal(db);
			const tx = request.transaction!;
			tx.objectStore('runs').put({ version: 1, id: 'legacy', scope, operations: [] }, key);
			tx.objectStore(PLAN_STORES[0]).put({ scope: key, spec: s.plan, instance: 'old-plan', phase: 'complete', indexed: 0, planned: 0,
				decisions: 0, positions: Array.from({ length: 4 }, () => ({ after: null, read: 0 })), totals: [0, 0, 0, 0], revision: 2 }, [key, s.plan.id]);
			for (const id of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote]) tx.objectStore('inventory-captures').put({ ...id,
				scope: key, phase: 'complete', pages: 1, entries: 0, validatedEntries: 0, validatedThrough: null }, [key, id.id]);
		};
		request.onerror = () => reject(request.error); request.onsuccess = () => { request.result.close(); resolve(); };
	});
	const f = await fixture(factory); assert.equal((await f.journal.read(scope))?.id, 'legacy');
	assert.deepEqual((await f.inventory.read(s.plan.local)).entries, []); assert.equal(await f.runs.active(), null);
	await assert.rejects(f.runs.prepare(s), /Rebuild this older/);
	assert.equal(await f.runs.active(), null); await f.plans.discard(s.plan); await f.plans.build(s.plan);
	assert.equal((await f.runs.prepare(s)).phase, 'ready'); await f.runs.discard(s); assert.equal(await f.runs.active(), null);
	f.journal.close();
});

test('a paged run preserves the previous checkpoint and refuses legacy advancement', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, []);
	await f.journal.persist({ version: 1, id: 'old', scope, operations: [] });
	const checkpoint = { version: 1 as const, runId: 'old', localRootId: 'local', remoteFolderId: 'remote', baseline: { scope, entries: [] } };
	await f.journal.complete(checkpoint); await f.runs.prepare(s); await f.runs.start(s);
	await assert.rejects(f.journal.complete({ ...checkpoint, localRootId: 'changed' }), /paged/);
	assert.deepEqual(await f.journal.checkpoint(scope), checkpoint); f.journal.close();
});


test('a replacement capture with the same public identity cannot rebind a completed plan', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [file('a')]);
	await f.inventory.discard(s.plan.baseline.local);
	await f.inventory.begin(s.plan.baseline.local);
	await f.inventory.append(s.plan.baseline.local, { ordinal: 0, entries: [file('a', '2')], totalEntries: 1 });
	await f.inventory.seal(s.plan.baseline.local);
	await assert.rejects(f.runs.begin(s), /replaced/); assert.equal(await f.runs.active(), null);
	await f.inventory.discard(s.plan.local); // Earlier pin writes rolled back with the refusal.
	f.journal.close();
});

test('ready, running and completed queues retain all original inventory generations', async () => {
	let f = await fixture(); const s = spec(); await seed(f, s, [file('a')]); await f.runs.prepare(s);
	const inputs = [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote];
	for (const id of inputs) await assert.rejects(f.inventory.discard(id), /pinned/);
	await f.runs.start(s); for (const id of inputs) await assert.rejects(f.inventory.discard(id), /pinned/);
	for (const op of (await f.runs.read(s)).operations) await f.runs.confirm(s, receipt(op));
	f.journal.close(); f = await fixture(f.factory);
	assert.equal((await f.runs.active())?.progress.phase, 'complete');
	for (const id of inputs) await assert.rejects(f.inventory.discard(id), /pinned/);
	f.journal.close();
});

test('run and plan pins cannot erase each other even when their IDs match', async () => {
	const f = await fixture(), s = spec(); s.id = s.plan.id;
	await seed(f, s, [file('a')]); await f.runs.prepare(s);
	const other = { ...s.plan, id: 'other-plan' }; await f.plans.begin(other);
	await f.runs.discard(s); await assert.rejects(f.inventory.discard(s.plan.local), /pinned/);
	await f.plans.discard(other); await f.inventory.discard(s.plan.local); f.journal.close();
});

test('one capture used for both current and baseline keeps one internal generation', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [file('a')], [file('a')], [file('a')]);
	await f.plans.discard(s.plan); s.plan.baseline = { local: s.plan.local, remote: s.plan.remote };
	await f.plans.build(s.plan); await f.runs.prepare(s); assert.equal((await f.runs.start(s)).phase, 'complete');
	await assert.rejects(f.inventory.discard(s.plan.local), /pinned/); f.journal.close();
});
