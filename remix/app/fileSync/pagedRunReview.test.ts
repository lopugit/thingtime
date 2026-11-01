import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import type { PagedRunSpec } from './pagedRunJournal';
import type { ReviewedSyncConflict } from './pagedRunReview';
import { type SyncConflict, resolveFileSyncConflicts, planConflictRetention } from './conflictResolution';
import { planFileSync, type SyncEntry, type SyncScope } from './reconcile';
import { createSyncRun } from './execute';

const scope: SyncScope = { origin: 'https://review.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const file = (path: string, side: 'local' | 'remote'): SyncEntry => ({ path, id: side + '-' + path, version: 'one', kind: 'file', size: 2, sha256: (side === 'local' ? 'a' : 'b').repeat(64) });
const spec = (count = 270, kind: 'resolve' | 'retain' = 'resolve'): PagedRunSpec => ({ id: 'run', plan: { id: 'plan',
	local: { id: 'local', source: 'local', generation: 'one' }, remote: { id: 'remote', source: 'remote', generation: 'one' },
	baseline: { local: { id: 'before-local', source: 'local', generation: 'empty' }, remote: { id: 'before-remote', source: 'remote', generation: 'empty' } },
	policy: { mode: 'two-way', propagateDeletes: true }, excludedPaths: [] }, review: { id: 'review', kind, count } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'paged-run-review', IDBKeyRange); let current = scope;
	const access = { scope, currentScope: () => current };
	return { factory, journal, inventory: journal.inventory(access), plans: journal.plans(access), runs: journal.pagedRuns(access), access,
		changeAccount: () => { current = { ...scope, ownerId: 'other' }; } };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec, count = 270) {
	const local = [file('a-copy-only', 'local'), ...Array.from({ length: count }, (_, i) => file('file-' + String(i).padStart(3, '0'), 'local'))];
	const remote = local.slice(1).map(e => file(e.path, 'remote'));
	for (const [i, id] of [s.plan.local, s.plan.remote, s.plan.baseline.local, s.plan.baseline.remote].entries()) {
		const entries = i === 0 ? local : i === 1 ? remote : []; await f.inventory.begin(id);
		for (let offset = 0, ordinal = 0; offset < entries.length || !ordinal; offset += 128, ordinal++) {
			const rows = entries.slice(offset, offset + 128);
			await f.inventory.append(id, { ordinal, entries: rows, ...(offset + rows.length === entries.length ? { totalEntries: entries.length } : {}) });
		}
		await f.inventory.seal(id);
	}
	const plan = planFileSync({ scope, complete: true, entries: local }, { scope, complete: true, entries: remote }, { scope, entries: [] }, s.plan.policy);
	const reviewed = plan.decisions.filter((d): d is SyncConflict => d.kind === 'conflict');
	const rows: ReviewedSyncConflict[] = reviewed.map((conflict, i) => ({ conflict, from: s.review!.kind === 'retain' || i % 2 ? 'local' : 'remote' }));
	await f.plans.build(s.plan); await f.runs.begin(s); return { plan, rows };
}
async function review(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec, rows: ReviewedSyncConflict[]) {
	for (let offset = 0, ordinal = 0; offset < rows.length; offset += 128, ordinal++) {
		const page = rows.slice(offset, offset + 128); await f.runs.appendReview(s, { ordinal, rows: page, complete: offset + page.length === rows.length });
	}
}

test('conflict choices survive partial import and operation preparation restarts with whole-run parity', async () => {
	let f = await fixture(); const s = spec(), { plan, rows } = await seed(f, s);
	await f.runs.appendReview(s, { ordinal: 0, rows: rows.slice(0, 128) });
	await assert.rejects(f.runs.step(s), /Complete the durable conflict review/); await assert.rejects(f.runs.start(s), /incomplete/);
	f.journal.close(); f = await fixture(f.factory); await review(f, s, rows);
	assert.equal((await f.runs.step(s)).read, 128); const first = (await f.runs.begin(s)).operations;
	f.journal.close(); f = await fixture(f.factory); await f.runs.prepare(s); assert.ok((await f.runs.begin(s)).operations > first);
	const expected = createSyncRun(resolveFileSyncConflicts(plan, rows.map(r => r.conflict), rows.map(r => ({ path: r.conflict.path, from: r.from })), s.plan.policy.mode));
	await f.runs.start(s); const actual = [];
	for (;;) {
		const page = await f.runs.read(s); if (!page.operations.length) break;
		for (const op of page.operations) {
			actual.push(op.mutation); assert.ok(op.mutation.kind === 'copy');
			await f.runs.confirm(s, { scope, operationId: op.id, entry: { ...op.mutation.source, id: 'target-' + op.id } });
		}
	}
	assert.deepEqual(actual, expected.operations.map(op => op.mutation)); f.journal.close();
});

test('retention selects only conflicting files and can never publish a sync checkpoint', async () => {
	const f = await fixture(), s = spec(3, 'retain'), { plan, rows } = await seed(f, s, 3); await review(f, s, rows); await f.runs.prepare(s);
	const actual = await f.runs.read(s), expected = createSyncRun(planConflictRetention(plan, rows.map(r => r.conflict)));
	assert.equal(actual.operations.length, 3); assert.deepEqual(actual.operations.map(o => o.mutation), expected.operations.map(o => o.mutation));
	await f.runs.start(s);
	for (const op of actual.operations) { assert.ok(op.mutation.kind === 'copy'); await f.runs.confirm(s, { scope, operationId: op.id, entry: { ...op.mutation.source, id: 'retained-' + op.id } }); }
	await assert.rejects(f.journal.pagedCheckpoints(f.access).begin({ run: s, localRootId: 'local', remoteFolderId: 'remote' }), /cannot advance/); f.journal.close();
});

test('changed, missing and extra reviewed versions keep every prepared operation unexecutable', async () => {
	for (const kind of ['changed', 'missing', 'extra'] as const) {
		const f = await fixture(), s = spec(kind === 'missing' ? 269 : kind === 'extra' ? 271 : 270), { rows } = await seed(f, s);
		if (kind === 'changed') rows.at(-1)!.conflict.remote!.version = 'edited-after-review';
		if (kind === 'missing') rows.pop();
		if (kind === 'extra') rows.push({ conflict: { kind: 'conflict', path: 'unused', reason: 'both-changed', local: file('unused', 'local'), remote: file('unused', 'remote') }, from: 'local' });
		await review(f, s, rows); await assert.rejects(f.runs.prepare(s), /changed|Invalid reviewed conflict/);
		await assert.rejects(f.runs.start(s), /incomplete/); assert.equal((await f.runs.begin(s)).confirmed, 0); f.journal.close();
	}
});

test('review pages require exact order, count and retry content, and duplicate paths roll back atomically', async () => {
	const f = await fixture(), s = spec(3), { rows } = await seed(f, s, 3);
	await assert.rejects(f.runs.appendReview(s, { ordinal: 1, rows: [rows[0]] }), /out of order/);
	await assert.rejects(f.runs.appendReview(s, { ordinal: 0, rows: [rows[0]], complete: true }), /count changed/);
	await f.runs.appendReview(s, { ordinal: 0, rows: [rows[0]] });
	await assert.rejects(f.runs.appendReview(s, { ordinal: 0, rows: [{ ...rows[0], from: 'local' }] }), /retry changed/);
	await assert.rejects(f.runs.appendReview(s, { ordinal: 1, rows: [rows[1], rows[0]], complete: true }));
	assert.equal((await f.runs.appendReview(s, { ordinal: 1, rows: rows.slice(1), complete: true })).entries, 3);
	await f.runs.prepare(s); await assert.rejects(f.runs.appendReview(s, { ordinal: 2, rows: [rows[0]] }), /out of order/); f.journal.close();
});

test('unsupported choices and live account changes cannot turn review data into approval', async () => {
	const f = await fixture(), s = spec(1), { rows } = await seed(f, s, 1);
	const bad = structuredClone(rows[0]); bad.conflict.reason = 'excluded-descendants';
	await assert.rejects(f.runs.appendReview(s, { ordinal: 0, rows: [bad], complete: true }), /needs changes/);
	const folder = structuredClone(rows[0]); folder.conflict.local = { ...folder.conflict.local!, kind: 'folder', size: 0, sha256: null };
	await assert.rejects(f.runs.appendReview(s, { ordinal: 0, rows: [folder], complete: true }), /needs changes/);
	f.changeAccount(); await assert.rejects(f.runs.appendReview(s, { ordinal: 0, rows, complete: true }), /account or root/); f.journal.close();
});
