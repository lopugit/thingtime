import assert from 'node:assert/strict';
import test from 'node:test';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { runForegroundCloudSync } from './foregroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { retentionFixture, scope as retentionScope } from './conflictRetention.fixture';
import type { ForegroundSyncInput } from './foregroundSync';

const signal = () => new AbortController().signal;
const access = (input: ForegroundSyncInput) => ({ scope: input.currentScope(), currentScope: input.currentScope });

test('native pages drive planning and checkpoint publication without a legacy root scan', async () => {
	const f = await foregroundFixture(135), input: ForegroundSyncInput = f.input(); let captures = 0;
	input.scanLocal = async () => { throw Error('legacy root scan must not run'); };
	input.inspectLocal = async path => structuredClone(f.local.find(row => row.path === path) ?? null);
	input.scanLocalPages = async function* () {
		captures++; const generation = crypto.randomUUID(), rows = structuredClone(f.local);
		for (let offset = 0; offset < rows.length; offset += 128) yield {
			generation, ordinal: offset / 128, entries: rows.slice(offset, offset + 128),
			...(offset + 128 >= rows.length ? { totalEntries: rows.length } : {})
		};
	};
	await runPagedForegroundCloudSync(saved, scope, input, signal());
	assert.equal(captures, 2); assert.equal(f.creates(), 135);
	const head = (await f.journal().pagedCheckpoints(access(input)).current())!;
	assert.equal((await f.journal().inventory(access(input)).read(head.baseline.local)).totalEntries, 135);
	await runPagedForegroundCloudSync(saved, scope, input, signal());
	assert.equal(captures, 4); assert.equal(f.creates(), 135); f.journal().close();
});

test('incomplete or substituted native pages never start writes or replace a good checkpoint', async () => {
	for (const failure of ['missing', 'generation', 'ordinal', 'extra', 'duplicate', 'count', 'ancestor', 'empty'] as const) {
		const f = await foregroundFixture(), input: ForegroundSyncInput = f.input();
		await runPagedForegroundCloudSync(saved, scope, input, signal());
		const head = await f.journal().pagedCheckpoints(access(input)).current(), creates = f.creates();
		input.scanLocal = async () => { throw Error('legacy root scan must not run'); };
		input.scanLocalPages = async function* () {
			if (failure === 'empty') return;
			const generation = crypto.randomUUID();
			yield { generation, ordinal: 0, entries: structuredClone(f.local), ...(failure === 'extra' ? { totalEntries: 1 } : {}) };
			if (failure === 'missing') return;
			yield { generation: failure === 'generation' ? crypto.randomUUID() : generation, ordinal: failure === 'ordinal' ? 2 : 1,
				entries: failure === 'duplicate' ? structuredClone(f.local) : failure === 'ancestor' ? [{ ...f.local[0], id: 'orphan', path: 'missing/child' }] : [],
				totalEntries: failure === 'count' ? 2 : failure === 'duplicate' || failure === 'ancestor' ? 2 : 1 };
		};
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, signal()), failure);
		assert.equal(f.creates(), creates, failure);
		assert.deepEqual(await f.journal().pagedCheckpoints(access(input)).current(), head, failure);
		assert.equal(await f.journal().pagedRuns(access(input)).active(), null, failure); f.journal().close();
	}
});

test('individual path checks avoid whole-root rescans in both foreground runners', async () => {
	for (const run of [runForegroundCloudSync, runPagedForegroundCloudSync]) {
		const f = await foregroundFixture(20), input: ForegroundSyncInput = f.input();
		const originalScan = input.scanLocal; let scans = 0, inspections = 0;
		input.scanLocal = async () => { scans++; return originalScan(); };
		input.inspectLocal = async path => { inspections++; return structuredClone(f.local.find(row => row.path === path) ?? null); };
		await run(saved, scope, input, signal());
		assert.equal(scans, 2, 'Only initial inventory and post-run verification scan the root');
		assert.ok(inspections >= 20); assert.equal(f.creates(), 20); f.journal().close();
	}
});

test('failed, foreign and changed path observations never become absence or fall back to a scan', async () => {
	for (const mode of ['failure', 'foreign', 'changed', 'account'] as const) {
		const f = await foregroundFixture(), input: ForegroundSyncInput = f.input(); let scans = 0;
		const originalScan = input.scanLocal;
		input.scanLocal = async () => { scans++; return originalScan(); };
		input.inspectLocal = async () => {
			if (mode === 'failure') throw Error('Permission unavailable');
			if (mode === 'account') input.currentScope = () => ({ ...scope, ownerId: 'other' });
			return { ...f.local[0], ...(mode === 'foreign' ? { path: 'different' } : {}), ...(mode === 'changed' ? { version: 'newer' } : {}) };
		};
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, signal()));
		assert.equal(scans, 1); assert.equal(f.creates(), 0); f.journal().close();
	}
});

test('paged foreground resumes original operation IDs across page boundaries and publishes an exact complete baseline', async () => {
	const f = await foregroundFixture(135); f.lose();
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, f.input(), signal()), /lost accepted/);
	const runs = f.journal().pagedRuns(access(f.input())), original = (await runs.active())!;
	assert.equal(original.progress.confirmed, 128); assert.equal(f.creates(), 129);
	const pending = await runs.read(original.spec); const originalIds = pending.operations.map(o => o.id);
	await f.reload(); f.condition('cellular');
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, f.input(), signal()), /selected network/);
	assert.equal(f.creates(), 129); f.condition('wifi');
	const done = await runPagedForegroundCloudSync(saved, scope, f.input(), signal());
	assert.ok('spec' in done); assert.equal(done.spec.id, original.spec.id); assert.equal(done.progress.confirmed, 135); assert.equal(f.creates(), 135);
	assert.equal(await f.journal().pagedRuns(access(f.input())).active(), null);
	assert.ok(originalIds.every(id => [...f.rows.values()].some(row => row.id === id)));
	const head = (await f.journal().pagedCheckpoints(access(f.input())).current())!;
	const inventory = f.journal().inventory(access(f.input()));
	const a = await inventory.read(head.baseline.local), b = await inventory.read(head.baseline.remote);
	assert.equal(a.totalEntries, 135); assert.equal(b.totalEntries, 135);
	assert.equal(a.entries[0].id, f.local[0].id); assert.equal(b.entries[0].id, [...f.rows.values()].find(row => row.name === f.local[0].path).id);
	const second = await runPagedForegroundCloudSync(saved, scope, f.input(), signal());
	assert.ok('spec' in second); assert.equal(second.progress.operations, 0); assert.equal(f.creates(), 135);
	f.journal().close();
});

test('a stopped post-run import is recaptured from a fresh generation without republishing files', async () => {
	const f = await foregroundFixture(129); const input: ForegroundSyncInput = f.input(); let verifying = false, fail = true;
	const base = input.journal.inventory;
	input.journal.inventory = a => {
		const inventory = base(a);
		return { ...inventory, append: async (id, page) => {
			if (verifying && fail && page.ordinal === 1) { fail = false; throw Error('interrupted checkpoint import'); }
			return inventory.append(id, page);
		} };
	};
	input.progress = p => { verifying = p.stage === 'verifying'; };
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, signal()), /interrupted checkpoint import/);
	const active = (await f.journal().pagedRuns(access(input)).active())!;
	assert.equal(active.progress.phase, 'complete'); assert.equal(f.creates(), 129);
	const checkpoints = f.journal().pagedCheckpoints(access(input));
	const spec = { run: active.spec, localRootId: saved.configuration.localRootId, remoteFolderId: saved.configuration.remoteFolderId };
	const partial = await checkpoints.begin(spec);
	f.local[0].version = 'edited-after-import'; await f.reload();
	const done = await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); assert.ok('spec' in done);
	assert.equal(done.spec.id, active.spec.id); assert.equal(f.creates(), 129);
	const complete = await f.journal().pagedCheckpoints(access(f.input())).begin(spec);
	assert.notEqual(complete.after.local.id, partial.after.local.id);
	const observed = await f.journal().inventory(access(f.input())).read(complete.baseline.local);
	assert.equal(observed.entries.find(e => e.path === f.local[0].path)?.version, 'edited-after-import'); f.journal().close();
});

test('legacy uncertain work finishes with its original IDs before the next foreground run migrates', async () => {
	const f = await foregroundFixture(); f.lose();
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), signal()), /lost accepted/);
	const old = (await f.journal().read(scope))!; await f.reload();
	const recovered = await runPagedForegroundCloudSync(saved, scope, f.input(), signal());
	assert.ok('operations' in recovered); assert.equal(recovered.id, old.id); assert.equal(f.creates(), 1);
	const next = await runPagedForegroundCloudSync(saved, scope, f.input(), signal());
	assert.ok('spec' in next); assert.equal(next.progress.operations, 0);
	assert.ok(await f.journal().pagedCheckpoints(access(f.input())).current()); f.journal().close();
});

test('paged Ignore retains both file versions, releases the active root and reuses receipts; a later winner still synchronizes', async () => {
	const f = await retentionFixture(); f.lose();
	await assert.rejects(runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal()), /reply lost/);
	const active = (await f.journal().pagedRuns(access(f.input())).active())!;
	const before = f.counts(); await f.reload();
	const resumed = await runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal());
	assert.ok('spec' in resumed); assert.equal(resumed.spec.id, active.spec.id); assert.deepEqual(f.counts(), before);
	assert.deepEqual(f.live(), f.original); assert.equal(await f.journal().pagedRuns(access(f.input())).active(), null);
	assert.equal(await f.journal().pagedCheckpoints(access(f.input())).current(), null);
	await f.reload(); await runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal());
	assert.equal(f.counts().uploads, 1); assert.equal(f.counts().retained, 1); assert.equal(f.counts().reviews, 2);
	f.review(async () => [{ path: 'report.bin', from: 'local' }]);
	const synced = await runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal());
	assert.ok('spec' in synced); assert.equal(synced.spec.review?.kind, 'resolve'); assert.equal(f.counts().publications, 1);
	assert.equal((await f.journal().pagedCheckpoints(access(f.input())).current())?.runId, synced.spec.id); f.journal().close();
});

test('a fully imported review resumes without reopening the popup, while an incomplete review requires fresh choices', async () => {
	for (const partial of [false, true]) {
		const f = await retentionFixture(), input = f.input(), paged = input.journal.pagedRuns;
		let stop = true;
		input.journal.pagedRuns = a => { const journal = paged(a); return { ...journal,
			appendReview: async (spec, page) => { if (partial && stop) { stop = false; throw Error('review save stopped'); } return journal.appendReview(spec, page); },
			step: journal.step,
			prepare: async (...args) => { if (!partial && stop) { stop = false; throw Error('operation preparation stopped'); } return journal.prepare(...args); }
		}; };
		await assert.rejects(runPagedForegroundCloudSync(f.saved, retentionScope, input, signal()), /stopped/);
		assert.equal(f.counts().uploads, 0); await f.reload();
		await runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal());
		assert.equal(f.counts().reviews, partial ? 2 : 1); assert.equal(f.counts().uploads, 1); f.journal().close();
	}
});

test('saved settings are pinned before cloud preparation and a resumed transfer rejects changed roots', async () => {
	const f = await foregroundFixture(), input = f.input(), paged = input.journal.pagedRuns;
	input.journal.pagedRuns = a => ({ ...paged(a), prepareCloud: async () => { throw Error('stopped before cloud preparation'); } });
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, signal()), /stopped before cloud/);
	const original = (await paged(access(input)).active())!; assert.deepEqual(original.spec.configuration, saved.configuration);
	await f.reload(); const changed = { ...saved, configuration: { ...saved.configuration, localRootId: 'different-root' } }, next = f.input();
	const read = next.readConfiguration; next.readConfiguration = async () => ({ ...await read(), crystal: changed.configuration });
	await assert.rejects(runPagedForegroundCloudSync(changed, scope, next, signal()), /different settings/); assert.equal(f.creates(), 0);
	await runPagedForegroundCloudSync(saved, scope, f.input(), signal()); assert.equal(f.creates(), 1); f.journal().close();
});

test('an accepted retained version recovers without the now-missing device source', async () => {
	const f = await retentionFixture(); f.lose();
	await assert.rejects(runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal()), /reply lost/);
	const before = f.counts(); f.removeSource(); await f.reload();
	const done = await runPagedForegroundCloudSync(f.saved, retentionScope, f.input(), signal()); assert.ok('spec' in done);
	assert.equal(done.progress.phase, 'complete'); assert.deepEqual(f.counts(), before); f.journal().close();
});

test('cloud pages drive planning and validated checkpoint publication without complete-array transport', async () => {
	const f = await foregroundFixture(135), input: ForegroundSyncInput = f.input(), read = input.inventory; let captures = 0;
	input.inventory = async () => { throw Error('legacy cloud root scan must not run'); };
	input.inventoryPages = async function* () {
		captures++; const snapshot = await read(), generation = crypto.randomUUID();
		for (let offset = 0;; offset += 128) {
			const nodes = snapshot.nodes.slice(offset, offset + 128), last = offset + 128 >= snapshot.nodes.length;
			yield { ...snapshot, generation, ordinal: offset / 128, nodes, ...(last ? { totalEntries: snapshot.nodes.length } : {}) };
			if (last) return;
		}
	};
	await runPagedForegroundCloudSync(saved, scope, input, signal());
	assert.equal(captures, 2); assert.equal(f.creates(), 135);
	const head = (await f.journal().pagedCheckpoints(access(input)).current())!;
	assert.equal((await f.journal().inventory(access(input)).read(head.baseline.remote)).totalEntries, 135);
	await runPagedForegroundCloudSync(saved, scope, input, signal());
	assert.equal(captures, 4); assert.equal(f.creates(), 135); f.journal().close();
});

test('cloud page failures preserve the baseline before writes and during checkpoint verification', async () => {
	for (const phase of ['planning', 'checkpoint'] as const) for (const failure of ['missing', 'generation', 'ordinal', 'extra', 'duplicate', 'count', 'parent', 'empty'] as const) {
		const f = await foregroundFixture(), input: ForegroundSyncInput = f.input(), read = input.inventory;
		await runPagedForegroundCloudSync(saved, scope, input, signal());
		const checkpoints = f.journal().pagedCheckpoints(access(input)), head = await checkpoints.current(), creates = f.creates();
		let captures = 0;
		input.inventoryPages = async function* () {
			const snapshot = await read(), generation = crypto.randomUUID(); captures++;
			if (phase === 'checkpoint' && captures === 1) { yield { ...snapshot, generation, ordinal: 0, totalEntries: snapshot.nodes.length }; return; }
			if (failure === 'empty') return;
			const nodes = failure === 'parent' ? snapshot.nodes.map(n => ({ ...n, folderId: 'unrelated' })) : snapshot.nodes;
			yield { ...snapshot, nodes, generation, ordinal: 0, ...(failure === 'extra' || failure === 'parent' ? { totalEntries: 1 } : {}) };
			if (failure === 'missing' || failure === 'parent') return;
			yield { ...snapshot, generation: failure === 'generation' ? crypto.randomUUID() : generation, ordinal: failure === 'ordinal' ? 2 : 1,
				nodes: failure === 'duplicate' ? nodes : [], totalEntries: failure === 'count' || failure === 'duplicate' ? 2 : 1 };
		};
		await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, signal()), phase + ' ' + failure);
		assert.equal(f.creates(), creates); assert.deepEqual(await checkpoints.current(), head);
		input.inventoryPages = async function* () { const snapshot = await read(); yield { ...snapshot, generation: crypto.randomUUID(), ordinal: 0, totalEntries: snapshot.nodes.length }; };
		await runPagedForegroundCloudSync(saved, scope, input, signal()); assert.equal(f.creates(), creates);
		assert.equal(await f.journal().pagedRuns(access(input)).active(), null); f.journal().close();
	}
});
