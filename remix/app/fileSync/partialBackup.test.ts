import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { runPagedForegroundCloudSync } from './pagedForegroundSync';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import type { ForegroundSyncInput } from './foregroundSync';
import type { InventoryIdentity } from './inventoryJournal';
import type { NativeBackupCapture, NativeScanSkip, NativeSkippedPage } from './nativeInventory';
import type { PagedPlanSpec } from './pagedPlanJournal';
import type { PagedRunSpec } from './pagedRunJournal';
import type { SyncEntry } from './reconcile';
const policy = { mode: 'backup' as const, propagateDeletes: false };
const file = (path: string, id = path): SyncEntry => ({ path, id, version: '1', kind: 'file', size: 1, sha256: 'a'.repeat(64) });
const coverage = (totalEntries: number, totalSkipped = 1): NativeBackupCapture => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), totalEntries,
	coverage: totalSkipped ? 'partial' : 'full', consistency: 'per-entry', totalSkipped });
const skipPage = (capture: NativeBackupCapture, skipped: NativeScanSkip[], offset = 0): NativeSkippedPage => ({ capture, offset, skipped,
	nextOffset: offset + skipped.length === capture.totalSkipped ? null : offset + skipped.length, totalSkipped: capture.totalSkipped });
const identity = (source: 'local' | 'remote'): InventoryIdentity => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
const access = { scope, currentScope: () => scope };
async function open(factory = new IDBFactory()) { return openSyncJournal(factory, 'partial-backup', IDBKeyRange); }
async function capture(j: Awaited<ReturnType<typeof open>>, id: InventoryIdentity, entries: SyncEntry[], c?: NativeBackupCapture, skips: NativeScanSkip[] = []) {
	const journal = j.inventory(access); await journal.begin(id);
	if (c) { await journal.setCoverage(id, c, policy); for (let offset = 0; offset < skips.length || offset === 0; offset += 128) await journal.appendSkips(id, skipPage(c, skips.slice(offset, offset + 128), offset)); }
	await journal.append(id, { ordinal: 0, entries, totalEntries: entries.length }); await journal.seal(id);
}

test('every skipped item persists in bounded pages across reopen and cannot seal with gaps or changed retries', async () => {
	const factory = new IDBFactory(); let j = await open(factory), journal = j.inventory(access); const id = identity('local'), c = coverage(1, 301);
	const skips: NativeScanSkip[] = Array.from({ length: 301 }, (_, ordinal) => ({ ordinal, path: 'skip-' + ordinal, reason: 'symlink', scope: 'entry' }));
	await journal.begin(id); await journal.setCoverage(id, c, policy);
	await assert.rejects(journal.setCoverage(id, { ...c, coverage: 'full', totalSkipped: 0 }, policy), /coverage changed/);
	await assert.rejects(journal.setCoverage(id, c, { mode: 'upload', propagateDeletes: false }), /backup/);
	const first = skipPage(c, skips.slice(0, 128)); await journal.appendSkips(id, first); await journal.appendSkips(id, first);
	await assert.rejects(journal.appendSkips(id, { ...first, skipped: first.skipped.map(s => ({ ...s, reason: 'changed' })) }), /retry changed/);
	await assert.rejects(journal.appendSkips(id, skipPage(c, skips.slice(256), 256)), /out of order/);
	await journal.append(id, { ordinal: 0, entries: [file('ok')], totalEntries: 1 }); await assert.rejects(journal.seal(id), /skipped inventory are incomplete/);
	// Terminal entry count does not authorize appending previously absent skip pages.
	await assert.rejects(journal.appendSkips(id, skipPage(c, skips.slice(128, 256), 128)), /out of order/);
	await journal.discard(id); const complete = identity('local'); await capture(j, complete, [file('ok')], c, skips);
	j.close(); j = await open(factory); journal = j.inventory(access);
	assert.deepEqual(await journal.coverage(complete), c); let offset = 0, count = 0;
	do { const page = (await journal.readSkips(complete, offset))!; assert.ok(page.skipped.length <= 128); count += page.skipped.length;
		if (page.nextOffset === null) break; offset = page.nextOffset; } while (true);
	assert.equal(count, 301); await assert.rejects(journal.readSkips(complete, 1));
	const foreign = j.inventory({ scope, currentScope: () => ({ ...scope, origin: 'https://other.test' }) });
	await assert.rejects(foreign.readSkips(complete), /account or root/); j.close();
});

test('planning cannot reinterpret a partial source as upload, download, two-way or deletion-capable backup', async () => {
	const j = await open(), local = identity('local'), remote = identity('remote'), beforeLocal = identity('local'), beforeRemote = identity('remote');
	const c = coverage(1); await capture(j, local, [file('ok')], c, [{ ordinal: 0, path: 'link', reason: 'symlink', scope: 'entry' }]);
	for (const id of [remote, beforeLocal, beforeRemote]) await capture(j, id, []);
	const base: PagedPlanSpec = { id: 'backup', local, remote, baseline: { local: beforeLocal, remote: beforeRemote }, policy, excludedPaths: [] };
	for (const mode of ['two-way', 'upload', 'download', 'backup'] as const) {
		if (mode === 'backup') continue;
		await assert.rejects(j.plans(access).build({ ...base, id: mode, policy: { mode, propagateDeletes: false } }), /backup/);
	}
	await assert.rejects(j.plans(access).build({ ...base, id: 'deleting', policy: { mode: 'backup', propagateDeletes: true } }), /backup/);
	await j.plans(access).build(base); const decisions = (await j.plans(access).read(base)).decisions;
	assert.equal(decisions.length, 1); assert.equal(decisions[0].kind, 'copy'); assert.equal(await j.inventory(access).coverage(local).then(c => c?.coverage), 'partial'); j.close();
});

test('checkpoint retains prior facts under skipped subtrees and root gaps, including matching later observations', async () => {
	for (const rootGap of [false, true]) {
		const j = await open(), local = identity('local'), remote = identity('remote'), beforeLocal = identity('local'), beforeRemote = identity('remote');
		const old = file('unknown');
		const c = coverage(0), skips: NativeScanSkip[] = [{ ordinal: 0, path: rootGap ? null : 'unknown', reason: rootGap ? 'changed' : 'unreadable', scope: rootGap ? 'root' : 'subtree' }];
		await capture(j, local, [], c, skips); await capture(j, remote, []); await capture(j, beforeLocal, [old]); await capture(j, beforeRemote, [old]);
		const run: PagedRunSpec = { id: 'run', plan: { id: 'plan', local, remote, baseline: { local: beforeLocal, remote: beforeRemote }, policy, excludedPaths: [] } };
		await j.plans(access).build(run.plan); await j.pagedRuns(access).prepare(run); await j.pagedRuns(access).start(run);
		const spec = { run, localRootId: 'local-root', remoteFolderId: 'remote-root' }, checkpoint = j.pagedCheckpoints(access), draft = await checkpoint.begin(spec);
		await capture(j, draft.after.local, [], c, skips); await capture(j, draft.after.remote, []);
		const result = await checkpoint.build(spec), inventory = j.inventory(access);
		assert.deepEqual((await inventory.read(result.baseline.local)).entries, [old]);
		assert.deepEqual((await inventory.read(result.baseline.remote)).entries, [old]);
		assert.equal((await inventory.coverage(result.baseline.local))?.coverage, 'partial');
		assert.deepEqual((await inventory.readSkips(result.baseline.local))?.skipped, skips);
		assert.deepEqual(await inventory.unobserved(result.baseline.local, ['unknown', 'unknown/child', 'known']), rootGap ? [true, true, true] : [true, true, false]); j.close();
	}
});

test('foreground partial backup uploads supported entries, publishes partial coverage, resumes receipts and preserves skips', async () => {
	const f = await foregroundFixture(129), input: ForegroundSyncInput = f.input(); f.lose();
	input.inspectLocal = async path => structuredClone(f.local.find(e => e.path === path) ?? null);
	input.scanLocalPages = async function* () {
		const c = coverage(f.local.length), skips: NativeScanSkip[] = [{ ordinal: 0, path: 'link', reason: 'symlink', scope: 'entry' }];
		yield { generation: c.generation, ordinal: 0, entries: [], backupCapture: c, skippedPage: skipPage(c, skips) };
		for (let offset = 0; offset < f.local.length; offset += 128) yield { generation: c.generation, ordinal: offset / 128, entries: structuredClone(f.local.slice(offset, offset + 128)),
			backupCapture: c, ...(offset + 128 >= f.local.length ? { totalEntries: f.local.length } : {}) };
	};
	let completed: unknown; input.progress = value => { if (value.stage === 'complete') completed = value; };
	let descriptor: InventoryIdentity | undefined; input.inventorySession = d => { descriptor = d.inventory; };
	await assert.rejects(runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal), /lost accepted/);
	assert.equal(f.creates(), 129); assert.equal((await input.journal.inventory(access).readSkips(descriptor!))?.totalSkipped, 1);
	await f.reload(); input.journal = f.journal(); descriptor = undefined;
	await runPagedForegroundCloudSync(saved, scope, input, new AbortController().signal); assert.equal(f.creates(), 129);
	assert.ok(descriptor, 'reopening a durable run restores its reviewable coverage descriptor');
	assert.equal((await input.journal.inventory(access).readSkips(descriptor!))?.totalSkipped, 1);
	assert.deepEqual({ coverage: (completed as any).coverage, skipped: (completed as any).skipped, consistency: (completed as any).consistency }, { coverage: 'partial', skipped: 1, consistency: 'per-entry' });
	const head = (await input.journal.pagedCheckpoints(access).current())!;
	assert.equal((await input.journal.inventory(access).coverage(head.baseline.local))?.coverage, 'partial');
	assert.equal((await input.journal.inventory(access).readSkips(head.baseline.local))?.skipped[0].path, 'link'); f.journal().close();
});

test('duplicate normalized skip paths preserve their strongest subtree coverage', async () => {
	const j = await open(), id = identity('local'), c = coverage(0, 2);
	await capture(j, id, [], c, [{ ordinal: 0, path: 'Skip', reason: 'unreadable', scope: 'subtree' }, { ordinal: 1, path: 'skip', reason: 'changed', scope: 'entry' }]);
	assert.deepEqual(await j.inventory(access).unobserved(id, ['skip/child']), [true]); j.close();
});

test('only the latest review capture remains pinned until a new scan replaces it', async () => {
	const j = await open(), a = identity('local'), b = identity('local'), inventory = j.inventory(access);
	await capture(j, a, []); await inventory.retainLatest(a); await assert.rejects(inventory.discard(a), /pinned/);
	await capture(j, b, []); await inventory.retainLatest(b); await inventory.discard(a); await assert.rejects(inventory.discard(b), /pinned/); j.close();
});
