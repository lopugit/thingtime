import assert from 'node:assert/strict';
import test from 'node:test';
import { createSyncRun, executeSyncRun, type SyncExecutionPort, type SyncReceipt, type SyncRun } from './execute';
import { planFileSync, type SyncEntry, type SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://thingtime.test', ownerId: 'owner', dataPlane: 'home', rootId: 'root', deviceId: 'phone' };
const entry = (path: string, hash = 'a'): SyncEntry => ({ path, id: path, version: hash, kind: 'file', size: 10, sha256: hash.repeat(64) });
const make = (local: SyncEntry[], remote: SyncEntry[], old: SyncEntry[] = []) => {
	let id = 0;
	return createSyncRun(planFileSync({ scope, complete: true, entries: local }, { scope, complete: true, entries: remote },
		{ scope, entries: old.map(value => ({ path: value.path, local: value, remote: value })) }, { mode: 'two-way', propagateDeletes: true }), () => `op-${++id}`);
};

const fixture = (left: SyncEntry[], right: SyncEntry[]) => {
	const local = new Map(left.map(value => [value.path, value])), remote = new Map(right.map(value => [value.path, value]));
	const receipts = new Map<string, SyncReceipt>(), applied: string[] = [];
	let durable: SyncRun | null = null;
	const port: SyncExecutionPort = {
		currentScope: () => scope,
		read: async (side, path) => (side === 'local' ? local : remote).get(path) ?? null,
		lookup: async id => receipts.has(id) ? { status: 'complete', receipt: receipts.get(id)! } : { status: 'missing' },
		persist: async run => { durable = structuredClone(run); },
		apply: async operation => {
			assert.ok(durable?.operations.some(value => value.id === operation.id), 'persist before effect');
			const mutation = operation.mutation;
			const target = mutation.kind === 'copy' ? (mutation.from === 'local' ? remote : local) : (mutation.side === 'local' ? local : remote);
			const result = mutation.kind === 'copy' ? { ...mutation.source, id: 'target-' + operation.id, version: 'written-' + operation.id } : null;
			if (result) target.set(mutation.path, result); else target.delete(mutation.path);
			const receipt = { operationId: operation.id, scope, entry: result };
			receipts.set(operation.id, receipt); applied.push(operation.id);
			return receipt;
		}
	};
	return { port, local, remote, applied, receipts, saved: () => structuredClone(durable!) };
};

test('copies are confirmed durably before any removals, regardless of path sort', async () => {
	const old = entry('a-deleted'), fresh = entry('z-new');
	const f = fixture([fresh], [old]);
	const run = make([fresh], [old], [old]);
	assert.deepEqual(run.operations.map(op => op.mutation.kind), ['copy', 'trash']);
	const done = await executeSyncRun(run, f.port);
	assert.ok(done.operations.every(op => op.confirmed));
	assert.equal(f.remote.has('a-deleted'), false); assert.equal(f.remote.has('z-new'), true);
});

test('lost completion response recovers by receipt without repeating the write', async () => {
	const f = fixture([entry('photo')], []);
	const apply = f.port.apply;
	f.port.apply = async (...args) => { await apply(...args); throw new Error('connection lost'); };
	await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port), /connection lost/);
	assert.equal(f.saved().operations[0].confirmed, false);
	const done = await executeSyncRun(f.saved(), f.port);
	assert.equal(done.operations[0].confirmed, true); assert.equal(f.applied.length, 1);
});

test('crash while persisting a completed receipt also recovers exactly once', async () => {
	const f = fixture([entry('photo')], []);
	const persist = f.port.persist;
	f.port.persist = async run => { if (run.operations[0].confirmed) throw new Error('disk full'); await persist(run); };
	await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port), /disk full/);
	f.port.persist = persist;
	await executeSyncRun(f.saved(), f.port);
	assert.equal(f.applied.length, 1);
});

test('failed copy leaves deletion pending and both existing copies intact', async () => {
	const old = entry('old'), fresh = entry('new'); const f = fixture([fresh], [old]);
	f.port.apply = async () => { throw new Error('upload failed'); };
	await assert.rejects(executeSyncRun(make([fresh], [old], [old]), f.port), /upload failed/);
	assert.equal(f.remote.has('old'), true); assert.ok(f.saved().operations.every(op => !op.confirmed));
});

test('changed source or target refuses effects before calling a writer', async () => {
	for (const side of ['local', 'remote'] as const) {
		const f = fixture([entry('photo')], []), run = make([entry('photo')], []);
		f[side].set('photo', entry('photo', 'b'));
		await assert.rejects(executeSyncRun(run, f.port), /changed/); assert.equal(f.applied.length, 0);
	}
});

test('a source reappearing cancels a previously planned deletion', async () => {
	const f = fixture([], [entry('photo')]); const run = make([], [entry('photo')], [entry('photo')]);
	f.local.set('photo', entry('photo', 'b'));
	await assert.rejects(executeSyncRun(run, f.port), /deletion changed/); assert.equal(f.applied.length, 0);
});

test('account change during async receipt lookup stops every later operation', async () => {
	const f = fixture([entry('photo')], []);
	f.port.lookup = async () => { f.port.currentScope = () => ({ ...scope, ownerId: 'other' }); return { status: 'missing' }; };
	await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port), /context changed/); assert.equal(f.applied.length, 0);
});

test('pending receipts wait without re-executing uncertain operations', async () => {
	const f = fixture([entry('photo')], []);
	f.port.lookup = async () => ({ status: 'pending' });
	await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port), /still pending/); assert.equal(f.applied.length, 0);
});

test('foreign or wrong-content receipts cannot confirm completion', async () => {
	for (const receipt of [
		{ operationId: 'op-2', scope: { ...scope, ownerId: 'other' }, entry: entry('photo') },
		{ operationId: 'op-2', scope, entry: entry('photo', 'b') },
		{ operationId: 'wrong', scope, entry: entry('photo') }
	]) {
		const f = fixture([entry('photo')], []);
		f.port.lookup = async () => ({ status: 'complete', receipt });
		await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port), /receipt/);
		assert.equal(f.saved().operations[0].confirmed, false); assert.equal(f.applied.length, 0);
	}
});

test('cancellation after an accepted effect retains recovery identity', async () => {
	const f = fixture([entry('photo')], []), abort = new AbortController(), apply = f.port.apply;
	f.port.apply = async (...args) => { const receipt = await apply(...args); abort.abort(); return receipt; };
	await assert.rejects(executeSyncRun(make([entry('photo')], []), f.port, abort.signal), { name: 'AbortError' });
	await executeSyncRun(f.saved(), f.port); assert.equal(f.applied.length, 1);
});

test('no run can be created around unresolved conflicting content', () => {
	assert.throws(() => make([entry('photo', 'b')], [entry('photo', 'c')], [entry('photo')]), /conflicts/);
});
