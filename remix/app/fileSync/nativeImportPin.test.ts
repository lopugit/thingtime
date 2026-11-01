import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';
import type { InventoryIdentity } from './inventoryJournal';
import type { NativeBackupCapture } from './nativeInventory';
import type { PagedPlanSpec } from './pagedPlanJournal';
import type { SyncEntry, SyncScope } from './reconcile';

const scope: SyncScope = { origin: 'https://import-pin.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const access = { scope, currentScope: () => scope, cleanup: 'foreground' as const };
const saved = () => ({ id: scope.rootId, updatedAt: '2026-10-20T00:00:00.000Z', configuration: {
	...newFileSyncConfiguration({ name: 'Backup', deviceId: scope.deviceId, localRootId: 'grant', remoteFolderId: 'cloud' }),
	mode: 'backup' as const, propagateDeletes: false, paused: false
} });
const identity = (id: string): InventoryIdentity => ({ id, source: 'local', generation: 'journal-generation' });
const rows = (start: number, count: number): SyncEntry[] => Array.from({ length: count }, (_, i) => ({
	path: `file-${start + i}`, id: `inode-${start + i}`, version: 'one', kind: 'file', size: 0, sha256: 'a'.repeat(64)
}));
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'native-import-pins', IDBKeyRange);
	return { factory, journal, jobs: journal.jobs(access), inventory: journal.inventory(access), maintenance: journal.maintenance(access) };
}
async function prefix(f: Awaited<ReturnType<typeof fixture>>, id: InventoryIdentity, native?: NativeBackupCapture) {
	const capture: NativeBackupCapture = native ?? { id: crypto.randomUUID(), generation: crypto.randomUUID(), totalEntries: 260,
		coverage: 'partial', consistency: 'per-entry', totalSkipped: 1 };
	await f.inventory.begin(id);
	await f.inventory.setCoverage(id, capture, saved().configuration);
	await f.inventory.appendSkips(id, { capture, offset: 0, totalSkipped: 1, nextOffset: null,
		skipped: [{ ordinal: 0, path: null, reason: 'changed', scope: 'root' }] });
	await f.inventory.append(id, { ordinal: 0, entries: rows(0, 128) });
	await f.inventory.append(id, { ordinal: 1, entries: rows(128, 1) });
	return capture;
}
async function olderDraft(f: Awaited<ReturnType<typeof fixture>>, local: InventoryIdentity) {
	const remote = { ...identity('older-remote'), source: 'remote' as const };
	const baseline = { local: identity('older-baseline-local'), remote: { ...identity('older-baseline-remote'), source: 'remote' as const } };
	for (const id of [local, remote, baseline.local, baseline.remote]) {
		await f.inventory.begin(id); await f.inventory.append(id, { ordinal: 0, entries: [], totalEntries: 0 }); await f.inventory.seal(id);
	}
	const plan: PagedPlanSpec = { id: 'older-plan', local, remote, baseline, policy: { mode: 'backup', propagateDeletes: false }, excludedPaths: [] };
	await f.journal.plans(access).build(plan);
	await f.journal.reviewDrafts(access).build({ id: 'older-review', plan, configuration: saved().configuration });
}

test('two restarts and an older restored review cannot collect the admitted fresh-review prefix', async () => {
	let f = await fixture();
	const old = identity('older-draft'), held = identity('fresh-review');
	await olderDraft(f, old);
	let job = await f.jobs.admit(saved(), 'admitted-job');
	job = (await f.jobs.beginImport(job, 'review', held))!;
	await prefix(f, held);
	await f.inventory.retainLatest(held);
	const expected = await f.inventory.importState(held);
	assert.equal(expected.entries, 129); assert.equal(expected.pages, 2); assert.equal(expected.skipped, 1);
	f.journal.close(); f = await fixture(f.factory);
	await f.maintenance.collect();
	// Startup shows the existing initial-review head, replacing only the UI pin.
	await f.inventory.retainLatest(old);
	f.journal.close(); f = await fixture(f.factory);
	await f.maintenance.collect();
	assert.deepEqual(await f.inventory.importState(held), expected);
	assert.equal((await f.jobs.read())!.localImport!.inventory.id, held.id);
	assert.equal((await f.inventory.append(held, { ordinal: 0, entries: rows(0, 128) })).entries, 129);
	await assert.rejects(f.inventory.read(held), /incomplete/);
	job = (await f.jobs.read())!;
	assert.ok(await f.jobs.finishImport(job, held));
	await f.maintenance.collect();
	await assert.rejects(f.inventory.importState(held), /unavailable/);
	assert.equal((await f.inventory.importState(old)).entries, 0);
	f.journal.close();
});

test('policy, approval revision and source generation replacements release obsolete import pins', async () => {
	for (const reason of ['policy', 'approval', 'generation']) {
		const f = await fixture(), held = identity('obsolete'), newer = identity('latest-ui');
		let job = await f.jobs.admit(saved(), 'job');
		const native: NativeBackupCapture = { id: crypto.randomUUID(), generation: crypto.randomUUID(), totalEntries: 260,
			coverage: 'partial', consistency: 'per-entry', totalSkipped: 1 };
		job = (await f.jobs.capture(job, native.id))!;
		job = (await f.jobs.observeCapture(job, native.generation))!;
		job = (await f.jobs.beginImport(job, 'initial', held))!;
		await prefix(f, held, native);
		await f.inventory.begin(newer); await f.inventory.retainLatest(newer);
		if (reason === 'generation') job = (await f.jobs.observeCapture(job, crypto.randomUUID()))!;
		else {
			if (reason === 'policy') job = (await f.jobs.pause(job))!;
			const updated = { ...saved(), updatedAt: '2026-10-20T01:00:00.000Z', configuration: {
				...saved().configuration, ...(reason === 'policy' ? { excludedPaths: ['Library'] } : {})
			} };
			job = await f.jobs.admit(updated, 'replacement');
		}
		assert.equal(job.localImport, undefined, reason);
		await f.maintenance.collect();
		await assert.rejects(f.inventory.importState(held), /unavailable/, reason);
		f.journal.close();
	}
});

test('stale or cancelled job changes cannot release a newer import pin', async () => {
	const f = await fixture(), old = identity('old'), current = identity('current');
	const stale = (await f.jobs.beginImport(await f.jobs.admit(saved(), 'job'), 'initial', old))!;
	let job = (await f.jobs.finishImport(stale, old))!;
	job = (await f.jobs.beginImport(job, 'review', current))!;
	await prefix(f, current);
	assert.equal(await f.jobs.finishImport(stale, old), null);
	assert.equal(await f.jobs.observeCapture(stale, crypto.randomUUID()), null);
	const controller = new AbortController(); controller.abort();
	const cancelled = f.journal.jobs({ ...access, signal: controller.signal });
	assert.throws(() => cancelled.finishImport(job, current), { name: 'AbortError' });
	await f.maintenance.collect();
	assert.equal((await f.inventory.importState(current)).entries, 129);
	assert.deepEqual(await f.jobs.read(), job);
	f.journal.close();
});

test('a failed job write rolls back its import-pin deletion atomically', async () => {
	const f = await fixture(), held = identity('held');
	const job = (await f.jobs.beginImport(await f.jobs.admit(saved(), 'job'), 'review', held))!;
	await prefix(f, held);
	const original = IDBObjectStore.prototype.put;
	IDBObjectStore.prototype.put = function (...args) {
		if (this.name === 'sync-admitted-jobs') throw Error('interrupted job write');
		return original.apply(this, args);
	};
	try { await assert.rejects(f.jobs.finishImport(job, held), /interrupted job write/); }
	finally { IDBObjectStore.prototype.put = original; }
	assert.deepEqual(await f.jobs.read(), job);
	await f.maintenance.collect();
	assert.equal((await f.inventory.importState(held)).entries, 129);
	f.journal.close();
});

test('legacy completion transitions release the admitted import pin and native ticket', async () => {
	let f = await fixture();
	const held = identity('legacy-completion');
	let job = await f.jobs.admit(saved(), 'job');
	job = (await f.jobs.capture(job, crypto.randomUUID()))!;
	job = (await f.jobs.observeCapture(job, crypto.randomUUID()))!;
	job = (await f.jobs.beginImport(job, 'initial', held))!;
	await prefix(f, held);
	const complete = (await f.jobs.transition(job, 'complete'))!;
	assert.equal(complete.state, 'complete');
	assert.equal(complete.localImport, undefined);
	assert.equal(complete.nativeCaptureId, undefined);
	assert.equal(complete.nativeCaptureGeneration, undefined);
	assert.equal(complete.nativeCaptureRestarts, undefined);
	f.journal.close(); f = await fixture(f.factory);
	await f.maintenance.collect();
	await assert.rejects(f.inventory.importState(held), /unavailable/);
	assert.equal((await f.jobs.read())!.state, 'complete');
	f.journal.close();
});

test('legacy import adoption requires the retained local source descriptor and excludes derived checkpoints', async () => {
	let f = await fixture();
	const held = identity('legacy-source'), native = await prefix(f, held);
	await f.inventory.retainLatest(held);
	f.journal.close(); f = await fixture(f.factory);
	// Startup maintenance precedes migration. Its existing UI pin keeps the
	// old prefix alive until beginImport atomically adds the admission pin.
	await f.maintenance.collect();
	assert.deepEqual(await f.inventory.latestNativeImport(native.id, native.generation), held);
	assert.equal(await f.inventory.latestNativeImport(crypto.randomUUID(), native.generation), null);
	assert.equal(await f.inventory.latestNativeImport(native.id, crypto.randomUUID()), null);
	let job = await f.jobs.admit(saved(), 'legacy-job');
	job = (await f.jobs.capture(job, native.id))!;
	job = (await f.jobs.observeCapture(job, native.generation))!;
	job = (await f.jobs.beginImport(job, 'initial', held))!;
	await f.inventory.append(held, { ordinal: 2, entries: rows(129, 128) });
	await f.inventory.append(held, { ordinal: 3, entries: rows(257, 3), totalEntries: 260 });
	await f.inventory.seal(held);
	const derived = identity('derived-checkpoint');
	await f.inventory.begin(derived);
	await f.inventory.copyCoverage(held, derived, saved().configuration);
	await f.inventory.append(derived, { ordinal: 0, entries: [], totalEntries: 0 });
	await f.inventory.seal(derived);
	await f.inventory.retainLatest(derived);
	assert.equal(await f.inventory.latestNativeImport(native.id, native.generation), null);
	f.journal.close(); f = await fixture(f.factory);
	await f.maintenance.collect();
	assert.equal((await f.inventory.importState(held)).entries, 260, 'migration pin survives replacing the legacy UI pin');
	for (const other of [identity('strict-local'), { ...identity('remote'), source: 'remote' as const }]) {
		await f.inventory.begin(other); await f.inventory.retainLatest(other);
		assert.equal(await f.inventory.latestNativeImport(native.id, native.generation), null);
	}
	f.journal.close();
});
