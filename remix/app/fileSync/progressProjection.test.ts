import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSyncProgressDescriptor, projectSyncProgress, syncProgressMetrics, type SyncProgressRow, type SyncProgressSource } from './progressProjection';
import type { SyncEntry } from './reconcile';

const entry = (path: string, size = 0, kind: 'file' | 'folder' = 'file'): SyncEntry => ({ path, size, kind, id: path, version: 'one', sha256: kind === 'file' ? 'a'.repeat(64) : null });
const row = (path: string, size = 0, confirmed = false, kind: 'file' | 'folder' = 'file'): SyncProgressRow => {
	const source = entry(path, size, kind);
	return { entry: source, operation: { id: `op:${path}`, confirmed, mutation: { kind: 'copy', path, from: 'local', source, expectedTarget: null } } };
};
const source = (rows: SyncProgressRow[]): SyncProgressSource => ({ async *rows(signal) {
	for (const item of [...rows].sort((a, b) => a.entry.path < b.entry.path ? -1 : 1)) { signal?.throwIfAborted(); yield item; }
} });

test('malformed cached descriptors are rejected before creating a progress view', () => {
	for (const value of [null, {}, { run: {} }, { scope: {}, run: { id: 'x' } }, { scope: 'other', run: null }]) assert.throws(() => parseSyncProgressDescriptor(value));
});

test('mixed file sizes use file bytes, avoid folder byte duplication, and aggregate nested descendants', async () => {
	const page = await projectSyncProgress(source([row('A', 0, true, 'folder'), row('A/B', 0, true, 'folder'), row('A/B/large', 990), row('A/small', 10, true), row('empty', 0, true, 'folder')]));
	assert.equal(page.parent.files, 2); assert.equal(page.parent.folders, 3);
	assert.equal(page.parent.bytesTotal, 1000); assert.equal(page.parent.bytesConfirmed, 10);
	assert.equal(syncProgressMetrics(page.parent).percent, 1);
	assert.equal(page.rows[0].bytesTotal, 1000); assert.equal(page.rows[0].operations, 4);
	const nested = await projectSyncProgress(source([row('A', 0, true, 'folder'), row('A/B', 0, true, 'folder'), row('A/B/large', 990), row('A/small', 10, true)]), { parent: 'A' });
	assert.deepEqual(nested.rows.map(r => r.path), ['A/B', 'A/small']);
	assert.equal(nested.rows[0].bytesTotal, 990);
});

test('zero byte files and empty folder operations require durable confirmation for 100 percent', async () => {
	const page = await projectSyncProgress(source([row('empty', 0, false, 'folder'), row('zero')]));
	assert.equal(syncProgressMetrics(page.parent).percent, 0);
	assert.equal(syncProgressMetrics(page.rows[0]).status, 'Pending');
	const done = await projectSyncProgress(source([row('empty', 0, true, 'folder'), row('zero', 0, true)]));
	assert.equal(syncProgressMetrics(done.parent).percent, 100);
	assert.equal(syncProgressMetrics(done.rows[0]).status, 'Complete');
});

test('active upload bytes are clamped, do not become receipts, and unknown totals invent no progress', async () => {
	const page = await projectSyncProgress(source([row('large', 100)]), { activePath: 'large' });
	const active = { stage: 'transferring' as const, total: 1, confirmed: 0, path: 'large', bytes: 100, size: 100 };
	assert.equal(syncProgressMetrics(page.parent, active).percent, 99.9);
	assert.equal(syncProgressMetrics(page.parent, { ...active, bytes: 1000 }).bytes, 100);
	assert.equal(syncProgressMetrics(page.parent, { ...active, size: undefined }).bytes, 0);
	assert.equal(page.parent.confirmed, 0);
	assert.equal(syncProgressMetrics(page.parent, { ...active, path: 'different' }).bytes, 0);
});

test('a stale active callback cannot add bytes for an already confirmed file to its parent', async () => {
	const page = await projectSyncProgress(source([row('done', 20, true), row('pending', 80)]), { activePath: 'done' });
	const metrics = syncProgressMetrics(page.parent, { stage: 'transferring', total: 2, confirmed: 1, path: 'done', bytes: 20, size: 20 });
	assert.equal(metrics.bytes, 20); assert.equal(metrics.percent, 20); assert.equal(metrics.active, false);
});

test('huge byte totals fail explicitly instead of silently losing integer precision', async () => {
	await assert.rejects(projectSyncProgress(source([row('a', Number.MAX_SAFE_INTEGER), row('b', 1)])), /safe range/);
});

test('resume uses saved receipts; error, pause and cancellation preserve pending work without excluding it', async () => {
	const page = await projectSyncProgress(source([row('done', 20, true), row('pending', 80), { entry: entry('excluded', 10), operation: null, excluded: true }, { entry: entry('unchanged', 30), operation: null }]));
	assert.equal(page.parent.bytesConfirmed, 20); assert.equal(page.parent.bytesTotal, 100);
	assert.equal(page.parent.excluded, 1); assert.equal(page.parent.unchanged, 1);
	for (const [state, label] of [['error', 'Error'], ['paused', 'Paused'], ['cancelled', 'Cancelled']] as const) {
		const metrics = syncProgressMetrics(page.parent, undefined, state);
		assert.equal(metrics.percent, 20); assert.equal(metrics.status, label);
	}
	assert.equal(syncProgressMetrics(page.rows.find(r => r.path === 'excluded')!).percent, null);
	assert.equal(syncProgressMetrics(page.rows.find(r => r.path === 'unchanged')!).status, 'Up to date');
	assert.equal(syncProgressMetrics(page.rows.find(r => r.path === 'done')!, undefined, 'error').status, 'Complete');
});

test('more than an inventory page produces stable bounded sibling pages with full parent totals', async () => {
	const rows = Array.from({ length: 275 }, (_, index) => row(`file-${String(index).padStart(3, '0')}`, index + 1, index < 130));
	let after: string | null = null, count = 0; const seen = new Set<string>();
	do {
		const page = await projectSyncProgress(source(rows), { after });
		assert.ok(page.rows.length <= 32); assert.equal(page.parent.files, 275); assert.equal(page.parent.confirmed, 130);
		for (const item of page.rows) { assert.ok(!seen.has(item.path)); seen.add(item.path); count++; }
		after = page.next;
	} while (after);
	assert.equal(count, 275);
});

test('aborted and disordered pages never publish partial aggregates', async () => {
	const controller = new AbortController();
	await assert.rejects(projectSyncProgress({ async *rows() { yield row('a'); controller.abort(); yield row('b'); } }, { signal: controller.signal }), /abort/i);
	await assert.rejects(projectSyncProgress({ async *rows() { yield row('b'); yield row('a'); } }), /order changed/);
});
