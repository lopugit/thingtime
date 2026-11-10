import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { executePreparedPagedSyncRun } from './pagedExecute';
import { type PagedRunSpec, PAGED_RUN_STORES } from './pagedRunJournal';
import { parseSyncPriorityPaths } from './syncPriorityJournal';
import { syncScopeKey, type SyncEntry, type SyncScope } from './reconcile';
import { type SyncOperation, type SyncReceipt, type SyncExecutionPort } from './execute';

const scope: SyncScope = { origin: 'https://priority.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'device' };
const file = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'file', size: 1, sha256: 'a'.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', kind: 'folder', size: 0, sha256: null });
const spec = (): PagedRunSpec => ({ id: 'run', plan: { id: 'plan', local: { id: 'local', source: 'local', generation: 'scan' },
	remote: { id: 'remote', source: 'remote', generation: 'scan' }, baseline: {
		local: { id: 'old-local', source: 'local', generation: 'old' }, remote: { id: 'old-remote', source: 'remote', generation: 'old' }
	}, policy: { mode: 'two-way', propagateDeletes: true }, excludedPaths: [] } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'priority-test', IDBKeyRange); let current = { ...scope };
	const access = { scope, currentScope: () => current };
	return { factory, journal, access, runs: journal.pagedRuns(access), priorities: journal.priorities(access),
		switchTo: (value: SyncScope) => { current = value; } };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec, local: SyncEntry[], remote: SyncEntry[] = [], before: SyncEntry[] = []) {
	const inventory = f.journal.inventory(f.access);
	for (const [i, id] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
		const entries = [local, remote, before, before][i]; await inventory.begin(id);
		for (let offset = 0, ordinal = 0; offset < entries.length || ordinal === 0; offset += 128, ordinal++) {
			const page = entries.slice(offset, offset + 128);
			await inventory.append(id, { ordinal, entries: page, ...(offset + page.length === entries.length ? { totalEntries: entries.length } : {}) });
		}
		await inventory.seal(id);
	}
	await f.journal.plans(f.access).build(s.plan); await f.runs.prepare(s);
}
const receipt = (op: SyncOperation): SyncReceipt => ({ operationId: op.id, scope,
	entry: op.mutation.kind === 'copy' ? { ...op.mutation.source, id: 'saved-' + op.id, version: 'saved' } : null });
async function next(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec) {
	const op = await f.runs.claimNext(s); assert.ok(op); await f.runs.confirm(s, receipt(op)); return op.mutation.path;
}
function port(local: SyncEntry[]) {
	const entries = new Map(local.map(e => [e.path, e])), receipts = new Map<string, SyncReceipt>(), effects: string[] = [];
	const value: Omit<SyncExecutionPort, 'persist'> = { currentScope: () => scope,
		read: async (side, path) => side === 'local' ? entries.get(path) ?? null : null,
		lookup: async id => receipts.has(id) ? { status: 'complete', receipt: receipts.get(id)! } : { status: 'missing' },
		apply: async op => { const r = receipt(op); effects.push(op.mutation.path); receipts.set(op.id, r); return r; } };
	return { value, receipts, effects };
}

test('priority preferences persist before a run, use CAS and fence account/device/root', async () => {
	let f = await fixture(); assert.deepEqual(await f.priorities.read(), { revision: 0, paths: [] });
	assert.deepEqual(await f.priorities.save(['Z/file', '.git'], 0), { revision: 1, paths: ['Z/file', '.git'] });
	await assert.rejects(f.priorities.save(['other'], 0), /changed/);
	for (const paths of [['../escape'], ['/absolute'], ['a', 'A'], ['a', 'a'], ['a//b']]) assert.throws(() => parseSyncPriorityPaths(paths));
	f.journal.close(); f = await fixture(f.factory); assert.deepEqual((await f.priorities.read()).paths, ['Z/file', '.git']);
	const other = { ...scope, deviceId: 'other' };
	assert.deepEqual(await f.journal.priorities({ scope: other, currentScope: () => other }).read(), { revision: 0, paths: [] });
	f.switchTo({ ...scope, ownerId: 'other' }); await assert.rejects(f.priorities.read(), /changed/); await assert.rejects(f.priorities.save([], 1), /changed/);
	f.journal.close();
});

test('exact file priority copies every planned ancestor first, then resumes canonical order', async () => {
	const f = await fixture(), s = spec(), items = [file('a'), folder('Z'), folder('Z/sub'), file('Z/sub/target'), file('Z/sub/other')];
	await f.priorities.save(['Z/sub/target'], 0); await seed(f, s, items); await f.runs.start(s);
	const order = [await next(f, s), await next(f, s), await next(f, s)];
	assert.deepEqual((await f.runs.read(s)).operations.map(op => op.mutation.path), ['a', 'Z/sub/other']);
	while ((await f.runs.active())!.progress.phase !== 'complete') order.push(await next(f, s));
	assert.deepEqual(order, ['Z', 'Z/sub', 'Z/sub/target', 'a', 'Z/sub/other']);
	assert.deepEqual((await f.runs.read(s)).operations, []);
	const confirmed = await f.runs.readConfirmed(s); assert.deepEqual(confirmed.rows.map(r => r.operation.mutation.path), ['a', 'Z', 'Z/sub', 'Z/sub/other', 'Z/sub/target']);
	f.journal.close();
});

test('prefix priorities use path boundaries and preserve canonical deepest-first Trash chains', async () => {
	const f = await fixture(), s = spec();
	const before = [folder('old'), folder('old/sub'), file('old/sub/file')], local = [file('Z-other'), folder('Z'), file('Z/b'), file('Z/a'), file('a')];
	await f.priorities.save(['old', 'Z'], 0); await seed(f, s, local, before, before); await f.runs.start(s);
	const order = []; while ((await f.runs.active())!.progress.phase !== 'complete') order.push(await next(f, s));
	assert.deepEqual(order, ['Z', 'Z/a', 'Z/b', 'Z-other', 'a', 'old/sub/file', 'old/sub', 'old']); f.journal.close();
});

test('a changed priority applies after acknowledgement; uncertain publication stays reserved across reopen', async () => {
	let f = await fixture(); const s = spec(), items = [file('a'), file('b'), file('c')], p = port(items);
	await seed(f, s, items); await f.priorities.save(['c'], 0);
	const apply = p.value.apply;
	p.value.apply = async (op, binding) => { const r = await apply(op, binding); await f.priorities.save(['b'], 1); throw Error('lost reply'); };
	await assert.rejects(executePreparedPagedSyncRun(s, scope, f.runs, p.value), /lost reply/); assert.deepEqual(p.effects, ['c']);
	const original = (await f.runs.find(s, 'c'))!; f.journal.close(); f = await fixture(f.factory);
	assert.equal((await f.runs.claimNext(s))!.id, original.id);
	p.value.apply = apply; const lookups: string[] = [], lookup = p.value.lookup;
	p.value.lookup = async (id, binding) => { lookups.push(id); return lookup(id, binding); };
	await executePreparedPagedSyncRun(s, scope, f.runs, p.value);
	assert.equal(lookups[0], original.id); assert.deepEqual(p.effects, ['c', 'b', 'a']); f.journal.close();
});

test('pending/cancelled attempts retain reservation and cannot confirm another operation', async () => {
	const f = await fixture(), s = spec(), items = [file('a'), file('z')]; await seed(f, s, items); await f.runs.start(s);
	await f.priorities.save(['z'], 0); const held = (await f.runs.claimNext(s))!, other = (await f.runs.find(s, 'a'))!;
	await assert.rejects(f.runs.confirm(s, receipt(other)), /reserved/); await f.priorities.save(['a'], 1);
	const p = port(items); p.value.lookup = async () => ({ status: 'pending' });
	await assert.rejects(executePreparedPagedSyncRun(s, scope, f.runs, p.value), /pending/); assert.equal((await f.runs.claimNext(s))!.id, held.id);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(f.journal.pagedRuns({ ...f.access, signal: controller.signal }).claimNext(s), { name: 'AbortError' });
	assert.equal((await f.runs.claimNext(s))!.id, held.id); assert.deepEqual(p.effects, []); f.journal.close();
});

test('legacy running migration resolves canonical next before new priorities without rewriting receipts', async () => {
	let f = await fixture(); const s = spec(); await seed(f, s, [file('a'), file('b'), file('z')]); await f.runs.start(s);
	const a = (await f.runs.find(s, 'a'))!; await f.runs.confirm(s, receipt(a)); await f.priorities.save(['z'], 0); f.journal.close();
	await new Promise<void>((resolve, reject) => { const request = f.factory.open('priority-test'); request.onerror = () => reject(request.error);
		request.onsuccess = () => { const db = request.result, tx = db.transaction(PAGED_RUN_STORES[0], 'readwrite'), store = tx.objectStore(PAGED_RUN_STORES[0]);
			const get = store.get([syncScopeKey(scope), s.id]); get.onsuccess = () => { const h = get.result; delete h.scheduling; store.put(h, [syncScopeKey(scope), s.id]); };
			tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
	});
	f = await fixture(f.factory); assert.equal(await next(f, s), 'b'); assert.equal(await next(f, s), 'z');
	assert.equal((await f.runs.find(s, 'a'))!.id, a.id); assert.equal((await f.runs.active())!.progress.confirmed, 3); f.journal.close();
});

test('priority changes skip already confirmed large prefixes and never add excluded/unplanned paths', async () => {
	const f = await fixture(), s = spec(), items = [file('a'), folder('Z'), ...Array.from({ length: 265 }, (_, i) => file('Z/' + String(i).padStart(3, '0'))), file('excluded')];
	s.plan.excludedPaths = ['excluded']; await f.priorities.save(['Z'], 0); await seed(f, s, items); await f.runs.start(s);
	for (let i = 0; i < 266; i++) await next(f, s);
	await f.priorities.save(['excluded', 'missing', 'Z'], 1);
	const controller = new AbortController(); let checks = 0;
	const interrupted = f.journal.pagedRuns({ scope, signal: controller.signal, currentScope: () => {
		if (++checks === 160) controller.abort(); return scope;
	} });
	await assert.rejects(interrupted.claimNext(s), { name: 'AbortError' }); assert.ok(checks >= 160);
	assert.equal(await next(f, s), 'a'); assert.equal((await f.runs.active())!.progress.confirmed, 267);
	assert.equal(await f.runs.find(s, 'excluded'), null); f.journal.close();
});

test('priority aliases fail closed and account changes cannot select or acknowledge effects', async () => {
	const f = await fixture(), s = spec(); await seed(f, s, [folder('Actual'), file('Actual/file')]); await f.runs.start(s);
	await f.priorities.save(['actual/file'], 0); await assert.rejects(f.runs.claimNext(s), /collision/);
	await f.priorities.save(['Actual/file'], 1); const held = (await f.runs.claimNext(s))!;
	f.switchTo({ ...scope, rootId: 'other' }); await assert.rejects(f.runs.claimNext(s), /changed/); await assert.rejects(f.runs.confirm(s, receipt(held)), /changed/); f.journal.close();
});


test('upgraded journal refuses an older writer before it can reopen changed ordering state', async () => {
	const f = await fixture(); f.journal.close();
	await assert.rejects(new Promise((resolve, reject) => {
		const request = f.factory.open('priority-test', 11); request.onsuccess = () => { request.result.close(); resolve(undefined); };
		request.onerror = () => reject(request.error);
	}), { name: 'VersionError' });
});


test('canonical preview rejects an extra unconfirmed lookahead row beyond the declared total', async () => {
	let f = await fixture(); const s = spec();
	await seed(f, s, Array.from({ length: 129 }, (_, i) => file('file-' + String(i).padStart(3, '0'))));
	await f.runs.start(s); f.journal.close();
	await new Promise<void>((resolve, reject) => { const request = f.factory.open('priority-test'); request.onerror = () => reject(request.error);
		request.onsuccess = () => { const db = request.result, tx = db.transaction(PAGED_RUN_STORES[0], 'readwrite'), store = tx.objectStore(PAGED_RUN_STORES[0]);
			const get = store.get([syncScopeKey(scope), s.id]); get.onsuccess = () => { const h = get.result; h.operations = 128; store.put(h, [syncScopeKey(scope), s.id]); };
			tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); };
	});
	f = await fixture(f.factory); await assert.rejects(f.runs.read(s), /count/); f.journal.close();
});
