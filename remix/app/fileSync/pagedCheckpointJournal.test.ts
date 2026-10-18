import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import type { InventoryIdentity } from './inventoryJournal';
import type { PagedRunSpec } from './pagedRunJournal';
import type { PagedCheckpointSpec } from './pagedCheckpointJournal';
import type { SyncEntry, SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://checkpoint.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'root' };
const file = (path: string, version = '1'): SyncEntry => ({ path, id: path, version, size: 2, kind: 'file', sha256: version.repeat(64) });
const folder = (path: string): SyncEntry => ({ path, id: path, version: '1', size: 0, kind: 'folder', sha256: null });
const runSpec = (id = 'run'): PagedRunSpec => ({ id, plan: { id: 'plan-' + id,
	local: { id: id + '-local', source: 'local', generation: 'scan' }, remote: { id: id + '-remote', source: 'remote', generation: 'scan' },
	baseline: { local: { id: id + '-before-local', source: 'local', generation: 'prior' }, remote: { id: id + '-before-remote', source: 'remote', generation: 'prior' } },
	policy: { mode: 'two-way', propagateDeletes: true }, excludedPaths: [] } });
const checkpointSpec = (run: PagedRunSpec): PagedCheckpointSpec => ({ run, localRootId: 'folder-local', remoteFolderId: 'folder-remote' });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'checkpoint-tests', IDBKeyRange); let current = scope;
	const access = { scope, currentScope: () => current };
	return { factory, journal, access, inventory: journal.inventory(access), plans: journal.plans(access), runs: journal.pagedRuns(access),
		checkpoints: journal.pagedCheckpoints(access), changeAccount: () => { current = { ...scope, ownerId: 'other' }; } };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function capture(f: Fixture, id: InventoryIdentity, entries: SyncEntry[]) {
	await f.inventory.begin(id);
	for (let start = 0, ordinal = 0; start < entries.length || !ordinal; start += 128, ordinal++) {
		const page = entries.slice(start, start + 128);
		await f.inventory.append(id, { ordinal, entries: page, ...(start + page.length === entries.length ? { totalEntries: entries.length } : {}) });
	}
	await f.inventory.seal(id);
}
async function seed(f: Fixture, run: PagedRunSpec, local: SyncEntry[], remote: SyncEntry[] = [], prior: SyncEntry[] = []) {
	const ids = [run.plan.local, run.plan.remote, run.plan.baseline.local, run.plan.baseline.remote];
	for (const [i, id] of ids.entries()) await capture(f, id, [local, remote, prior, prior][i]);
	await f.plans.build(run.plan); await f.runs.prepare(run);
}
async function finish(f: Fixture, run: PagedRunSpec, local: SyncEntry[], remote: SyncEntry[]) {
	const left = new Map(local.map(e => [e.path, e])), right = new Map(remote.map(e => [e.path, e]));
	await f.runs.start(run);
	for (;;) {
		const page = await f.runs.read(run); if (!page.operations.length) break;
		for (const operation of page.operations) {
			const m = operation.mutation;
			const entry = m.kind === 'copy' ? { ...m.source, id: 'written-' + operation.id, version: 'written' } : null;
			const target = (m.kind === 'copy' ? m.from === 'local' : m.side === 'remote') ? right : left;
			if (entry) target.set(m.path, entry); else target.delete(m.path);
			await f.runs.confirm(run, { operationId: operation.id, scope, entry });
		}
	}
	return { local: [...left.values()], remote: [...right.values()] };
}
async function scanAfter(f: Fixture, spec: PagedCheckpointSpec, after: { local: SyncEntry[]; remote: SyncEntry[] }) {
	const draft = await f.checkpoints.begin(spec);
	await capture(f, draft.after.local, after.local); await capture(f, draft.after.remote, after.remote); return draft;
}
async function all(f: Fixture, id: InventoryIdentity) {
	const entries: SyncEntry[] = []; let next;
	do { const page = await f.inventory.read(id, next); assert.ok(page.entries.length <= 128); entries.push(...page.entries); next = page.next ?? undefined; } while (next);
	return entries;
}

test('checkpoint captures can only begin after full confirmation and cannot use pre-run scans', async () => {
	const f = await fixture(), run = runSpec(), spec = checkpointSpec(run); await seed(f, run, [file('a')]);
	await assert.rejects(f.checkpoints.begin(spec), /Complete the sync run/); await f.runs.start(run);
	await assert.rejects(f.checkpoints.begin(spec), /Complete the sync run/);
	const after = await finish(f, run, [file('a')], []), draft = await f.checkpoints.begin(spec);
	assert.deepEqual(await f.checkpoints.begin(spec), draft);
	assert.notEqual(draft.after.local.id, run.plan.local.id);
	await assert.rejects(f.checkpoints.begin({ ...spec, localRootId: 'changed' }), /changed/);
	await assert.rejects(f.checkpoints.step(spec), /Complete both post-run/);
	for (const id of [draft.after.local, draft.after.remote, draft.baseline.local, draft.baseline.remote]) await assert.rejects(f.inventory.discard(id), /pinned/);
	await scanAfter(f, spec, after); await f.checkpoints.build(spec); f.journal.close();
});

test('edits after a successful copy retain its confirmed baseline and plan a single-sided update', async () => {
	const f = await fixture(), run = runSpec(), spec = checkpointSpec(run); await seed(f, run, [file('a')]);
	const after = await finish(f, run, [file('a')], []); after.local = [file('a', '2')];
	await scanAfter(f, spec, after); const result = await f.checkpoints.build(spec);
	assert.deepEqual(await all(f, result.baseline.local), [file('a')]);
	assert.deepEqual(await all(f, result.baseline.remote), after.remote);
	const next = runSpec('next'); next.plan.baseline = result.baseline;
	await capture(f, next.plan.local, after.local); await capture(f, next.plan.remote, after.remote); await f.plans.build(next.plan);
	const decisions = (await f.plans.read(next.plan)).decisions;
	assert.equal(decisions.length, 1); assert.equal(decisions[0].kind, 'copy');
	if (decisions[0].kind === 'copy') assert.equal(decisions[0].from, 'local');
	await f.runs.prepare(next); f.journal.close();
});

test('bounded checkpoint merge resumes across reopen, includes deletions, and releases only its own pins', async () => {
	let f = await fixture(); const run = runSpec(), spec = checkpointSpec(run);
	const prior = [folder('old'), file('old/deleted')];
	const local = [folder('new'), ...Array.from({ length: 301 }, (_, i) => file('new/' + String(i).padStart(4, '0')))];
	await seed(f, run, local, prior, prior); const after = await finish(f, run, local, prior); const draft = await scanAfter(f, spec, after);
	const first = await f.checkpoints.step(spec); assert.ok(first.paths > 0 && first.paths <= 128); assert.equal(first.phase, 'building');
	assert.equal(await f.checkpoints.current(), null); await assert.rejects(f.plans.discard(run.plan), /pinned/);
	f.journal.close(); f = await fixture(f.factory);
	await Promise.all([f.checkpoints.step(spec), f.checkpoints.step(spec)]);
	const result = await f.checkpoints.build(spec); assert.equal(result.phase, 'published'); assert.equal(result.entries, local.length);
	const sorted = (entries: SyncEntry[]) => entries.sort((a, b) => a.path < b.path ? -1 : 1);
	assert.deepEqual(await all(f, result.baseline.local), sorted(after.local)); assert.deepEqual(await all(f, result.baseline.remote), sorted(after.remote));
	assert.equal(await f.runs.active(), null); await f.plans.discard(run.plan);
	for (const id of [run.plan.local, run.plan.remote, run.plan.baseline.local, run.plan.baseline.remote, draft.after.local, draft.after.remote]) await f.inventory.discard(id);
	await assert.rejects(f.inventory.discard(result.baseline.local), /pinned/);
	await assert.rejects(f.journal.persist({ version: 1, id: 'legacy', scope, operations: [] }), /paged/);
	await assert.rejects(f.journal.checkpoint(scope), /paged/); f.journal.close();
});

test('crash between paired output pages preserves the old head and resumes exact pages', async () => {
	let f = await fixture(); const run = runSpec(), spec = checkpointSpec(run), local = Array.from({ length: 140 }, (_, i) => file('a' + i.toString().padStart(3, '0')));
	await seed(f, run, local); const after = await finish(f, run, local, []), draft = await scanAfter(f, spec, after);
	const add = IDBObjectStore.prototype.add; let interrupted = false;
	IDBObjectStore.prototype.add = function(value, key) {
		if (this.name === 'inventory-pages' && Array.isArray(key) && key[1] === draft.baseline.remote.id) { interrupted = true; throw Error('Simulated process loss between replica pages'); }
		return add.call(this, value, key);
	};
	try { await assert.rejects(f.checkpoints.step(spec), /Simulated process loss/); } finally { IDBObjectStore.prototype.add = add; }
	assert.ok(interrupted); assert.equal((await f.inventory.begin(draft.baseline.local)).entries, 128);
	assert.equal((await f.inventory.begin(draft.baseline.remote)).entries, 0); assert.equal(await f.checkpoints.current(), null);
	assert.equal((await f.runs.active())?.spec.id, run.id);
	f.journal.close(); f = await fixture(f.factory); const result = await f.checkpoints.build(spec);
	assert.equal(result.entries, 140); assert.deepEqual(await all(f, result.baseline.local), local); f.journal.close();
});

test('old publication retries never roll back a new baseline or release a later active run', async () => {
	const f = await fixture(), first = runSpec(), spec = checkpointSpec(first); await seed(f, first, []); await finish(f, first, [], []);
	await scanAfter(f, spec, { local: [], remote: [] }); const published = await f.checkpoints.build(spec); const head = await f.checkpoints.current();
	const next = runSpec('next'); next.plan.baseline = published.baseline;
	await capture(f, next.plan.local, []); await capture(f, next.plan.remote, []); await f.plans.build(next.plan); await f.runs.prepare(next);
	await f.checkpoints.step(spec); assert.equal((await f.runs.active())?.spec.id, next.id); assert.deepEqual(await f.checkpoints.current(), head);
	await f.runs.start(next);
	await assert.rejects(f.checkpoints.begin({ ...checkpointSpec(next), remoteFolderId: 'changed' }), /roots/);
	await scanAfter(f, checkpointSpec(next), { local: [], remote: [] }); const nextPublished = await f.checkpoints.build(checkpointSpec(next));
	await f.checkpoints.step(spec); assert.equal((await f.checkpoints.current())?.runId, next.id);
	await f.inventory.discard(published.baseline.local); await assert.rejects(f.inventory.discard(nextPublished.baseline.local), /pinned/);
	const stale = runSpec('stale'); await seed(f, stale, []).then(() => assert.fail('stale baseline was accepted'), e => assert.match(e.message, /current paged sync baseline/));
	f.journal.close();
});

test('post-scan case collisions preserve the prior checkpoint and all recovery inputs', async () => {
	const f = await fixture(), run = runSpec(), spec = checkpointSpec(run); await seed(f, run, [file('a')]);
	const after = await finish(f, run, [file('a')], []); after.local = [{ ...after.local[0], path: 'A' }];
	await scanAfter(f, spec, after); await assert.rejects(f.checkpoints.build(spec), /collision/);
	assert.equal(await f.checkpoints.current(), null); assert.equal((await f.runs.active())?.spec.id, run.id);
	await assert.rejects(f.inventory.discard(run.plan.local), /pinned/); f.journal.close();
});

test('account change after a committed page stops further advancement and resumes under the original account', async () => {
	let f = await fixture(); const run = runSpec(), spec = checkpointSpec(run), local = Array.from({ length: 150 }, (_, i) => file('a' + i));
	await seed(f, run, local); const after = await finish(f, run, local, []); await scanAfter(f, spec, after);
	await assert.rejects(f.checkpoints.build(spec, () => f.changeAccount()), /account or root changed/);
	f.journal.close(); f = await fixture(f.factory); const result = await f.checkpoints.build(spec); assert.equal(result.entries, 150); f.journal.close();
});
