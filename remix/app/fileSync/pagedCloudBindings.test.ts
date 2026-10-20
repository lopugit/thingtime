import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBDatabase } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration, type FileSyncConfiguration } from './configuration';
import { inventorySyncEntry, type CloudInventoryNode } from './cloudInventory';
import { fingerprintSource } from './contentFingerprint';
import { prepareCloudInventoryRun } from './cloudWrite';
import { localTrashContexts } from './localTrash';
import { createPagedCloudSyncPort } from './cloudSyncPort.client';
import { executePagedSyncRun } from './pagedExecute';
import type { PagedRunSpec } from './pagedRunJournal';
import type { SyncOperation, SyncReceipt } from './execute';
import { sameSyncStamp, type SyncEntry, type SyncScope } from './reconcile';
import type { LocalSyncTarget } from './localSyncTarget';
import type { CloudTransportRuntime } from './cloudTransport';

const scope: SyncScope = { origin: 'https://paged-cloud.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const root = { rootId: 'cloud-root', rootRevision: 'root-one' };
const folder = (path: string): SyncEntry => ({ path, id: 'native-' + path, kind: 'folder', version: 'one', sha256: null, size: 0 });
const bytes = new Uint8Array([1, 2, 3]);
let fingerprint: Awaited<ReturnType<typeof fingerprintSource>>;
before(async () => { fingerprint = await fingerprintSource({ size: bytes.length, check: () => {}, read: async (o, n) => bytes.slice(o, o + n) }); });
const file = (path: string): SyncEntry => ({ path, id: 'native-' + path, kind: 'file', version: 'one', sha256: null, size: bytes.length, fingerprint });
const node = (path: string, folderId = root.rootId): CloudInventoryNode => ({ kind: 'file', path, file: { id: 'cloud-' + path, revision: 'one', name: path.split('/').at(-1)!, folderId, trashed: false,
	content: { attachmentId: 'attachment-' + path, version: 'a'.repeat(64), size: bytes.length, fingerprint } } });
const config = (mode: FileSyncConfiguration['mode'] = 'download') => ({ ...newFileSyncConfiguration({ name: 'Cloud', deviceId: scope.deviceId, localRootId: 'native-root', remoteFolderId: root.rootId }), mode, paused: false, propagateDeletes: true });
const spec = (c: FileSyncConfiguration): PagedRunSpec => ({ id: 'run', plan: { id: 'plan', local: { id: 'local', source: 'local', generation: 'one' }, remote: { id: 'remote', source: 'remote', generation: 'one' },
	baseline: { local: { id: 'before-local', source: 'local', generation: 'before' }, remote: { id: 'before-remote', source: 'remote', generation: 'before' } },
	policy: { mode: c.mode, propagateDeletes: c.propagateDeletes }, excludedPaths: [] } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'paged-cloud-bindings', IDBKeyRange); let current = { ...scope };
	const access = { scope, currentScope: () => current };
	return { factory, journal, inventory: journal.inventory(access), plans: journal.plans(access), runs: journal.pagedRuns(access), access,
		changeAccount: () => { current = { ...scope, ownerId: 'other' }; } };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>, s: PagedRunSpec, local: SyncEntry[], remote: CloudInventoryNode[], beforeLocal: SyncEntry[] = [], beforeRemote: SyncEntry[] = []) {
	for (const [id, entries] of [[s.plan.local, local], [s.plan.baseline.local, beforeLocal], [s.plan.baseline.remote, beforeRemote]] as const) {
		await f.inventory.begin(id);
		for (let offset = 0, ordinal = 0; offset < entries.length || ordinal === 0; offset += 128, ordinal++) {
			const page = entries.slice(offset, offset + 128);
			await f.inventory.append(id, { ordinal, entries: page, ...(offset + page.length === entries.length ? { totalEntries: entries.length } : {}) });
		}
		await f.inventory.seal(id);
	}
	await f.inventory.beginCloud(s.plan.remote, root);
	for (let offset = 0, ordinal = 0; offset < remote.length || ordinal === 0; offset += 128, ordinal++) {
		const nodes = remote.slice(offset, offset + 128);
		await f.inventory.appendCloud(s.plan.remote, { ordinal, nodes, ...(offset + nodes.length === remote.length ? { totalEntries: remote.length } : {}) });
	}
	await f.inventory.seal(s.plan.remote); await f.plans.build(s.plan); await f.runs.prepare(s);
}

test('upload preparation batches file and distinct parent reads instead of opening transactions per file', async () => {
	const f = await fixture(), c = config('upload'), s = spec(c);
	const parents = Array.from({ length: 128 }, (_, i) => 'folder-' + String(i).padStart(3, '0'));
	await seed(f, s, [...parents.map(folder), ...parents.map(path => file(path + '/file'))], []);
	await f.runs.beginCloud(s, c);
	assert.equal((await f.runs.stepCloud(s)).prepared, 128);
	const original = IDBDatabase.prototype.transaction; let transactions = 0;
	IDBDatabase.prototype.transaction = function (...args) { transactions++; return original.apply(this, args); };
	try { assert.deepEqual(await f.runs.stepCloud(s), { prepared: 256, total: 256, phase: 'ready' }); }
	finally { IDBDatabase.prototype.transaction = original; }
	assert.ok(transactions > 0 && transactions <= 5, `128 files with distinct parents used ${transactions} transactions`);
	for (const path of [parents[0], parents[64], parents[127]]) {
		const parent = (await f.runs.find(s, path))!;
		const binding = await f.runs.cloudBinding(s, c, { path: path + '/file' });
		const expected = prepareCloudInventoryRun({ version: 1, id: s.id, scope,
			operations: [parent, (await f.runs.find(s, path + '/file'))!] }, { version: 1, complete: true, ...root, nodes: [] });
		assert.deepEqual(binding?.write, expected.cloudWrites.find(write => write.operation.mutation.path === path + '/file'));
	}
	f.journal.close();
});

test('batched cloud reads preserve order, missing nodes, exact names, bounds and account isolation', async () => {
	const f = await fixture(), s = spec(config()); const remote = node('A');
	await seed(f, s, [], [remote]);
	assert.deepEqual(await f.inventory.cloudNodes(s.plan.remote, ['missing', 'A']), [null, remote]);
	await assert.rejects(f.inventory.cloudNodes(s.plan.remote, ['a']), /collision requires review/);
	await assert.rejects(f.inventory.cloudNodes(s.plan.remote, ['A', 'a']), /Invalid cloud inventory path/);
	await assert.rejects(f.inventory.cloudNodes(s.plan.remote, Array.from({ length: 129 }, (_, i) => 'file-' + i)), /Invalid cloud inventory path/);
	f.changeAccount(); await assert.rejects(f.inventory.cloudNodes(s.plan.remote, ['A']), /account or root/);
	f.journal.close();
});

test('paged upload bindings preserve prepared parent IDs and immutable configuration across restarts', async () => {
	let f = await fixture(); const c = config('upload'), s = spec(c);
	const local = [folder('A'), folder('A/B'), ...Array.from({ length: 270 }, (_, i) => file('A/B/file-' + String(i).padStart(3, '0')))];
	await seed(f, s, local, []); await f.runs.beginCloud(s, c);
	assert.equal((await f.runs.stepCloud(s)).prepared, 128);
	await assert.rejects(f.runs.start(s), /Complete cloud bindings/);
	await assert.rejects(f.runs.cloudBinding(s, c, { path: 'A' }), /Complete cloud bindings/);
	await assert.rejects(f.inventory.discard(s.plan.remote), /pinned/);
	f.journal.close(); f = await fixture(f.factory);
	assert.equal((await f.runs.beginCloud(s, c)).prepared, 128); await f.runs.prepareCloud(s, c);
	const operations: SyncOperation[] = [];
	for (const e of local) operations.push((await f.runs.find(s, e.path))!);
	const expected = prepareCloudInventoryRun({ version: 1, id: s.id, scope, operations }, { version: 1, complete: true, ...root, nodes: [] });
	for (const write of expected.cloudWrites) assert.deepEqual((await f.runs.cloudBinding(s, c, { id: write.operation.id }))?.write, write);
	await assert.rejects(f.runs.beginCloud(s, { ...c, localRootId: 'other' }), /configuration changed/);
	await assert.rejects(f.runs.beginCloud(s, { ...c, mode: 'backup', propagateDeletes: false }), /does not match/);
	await assert.rejects(f.runs.cloudBinding(s, c, { path: 'a' }), /identity changed/);
	assert.equal(await f.runs.cloudBinding(s, c, { path: 'missing' }), null);
	await f.runs.start(s); assert.equal((await f.runs.beginCloud(s, c)).phase, 'ready');
	f.changeAccount(); await assert.rejects(f.runs.cloudBinding(s, c, { path: 'A' }), /account or root/); f.journal.close();
});

test('local folder Trash receipt chains cross page and browser-journal reopen boundaries', async () => {
	let f = await fixture(); const c = config(), s = spec(c);
	const local = [folder('A'), folder('A/B'), ...Array.from({ length: 270 }, (_, i) => file('A/B/file-' + String(i).padStart(3, '0'))), file('A/file')];
	await seed(f, s, local, [], local, local); await f.runs.beginCloud(s, c); await f.runs.stepCloud(s);
	f.journal.close(); f = await fixture(f.factory); await f.runs.prepareCloud(s, c);
	const operations: SyncOperation[] = [];
	for (const e of local) operations.push((await f.runs.find(s, e.path))!);
	operations.sort((a, b) => b.mutation.path.split('/').length - a.mutation.path.split('/').length || (a.mutation.path < b.mutation.path ? -1 : 1));
	const expected = localTrashContexts({ version: 1, id: s.id, scope, operations });
	for (const op of operations) assert.deepEqual((await f.runs.cloudBinding(s, c, { id: op.id }))?.trashContext, expected.get(op.id));
	const rootBinding = await f.runs.cloudBinding(s, c, { path: 'A' }); assert.ok(rootBinding?.trashContext?.childrenOperationId); f.journal.close();
});

test('an invalid later cloud binding keeps the entire run unstarted; discard removes partial preparation', async () => {
	const f = await fixture(), c = config('upload'), s = spec(c);
	const bad: SyncEntry = { path: 'z-no-parts', id: 'bad', version: '1', kind: 'file', size: 2, sha256: 'a'.repeat(64) };
	await seed(f, s, [...Array.from({ length: 140 }, (_, i) => file('a-' + i)), bad], []);
	await f.runs.beginCloud(s, c); assert.equal((await f.runs.stepCloud(s)).prepared, 128);
	await assert.rejects(f.runs.stepCloud(s), /file upload/); assert.equal((await f.runs.beginCloud(s, c)).prepared, 128);
	await assert.rejects(f.runs.start(s), /Complete cloud bindings/);
	await f.runs.discard(s); await f.runs.prepare(s); assert.equal((await f.runs.beginCloud(s, c)).prepared, 0); f.journal.close();
});

test('cloud metadata cannot be bound after generic execution started', async () => {
	const f = await fixture(), c = config(), s = spec(c); await seed(f, s, [], [node('file')]); await f.runs.start(s);
	await assert.rejects(f.runs.beginCloud(s, c), /before starting/); f.journal.close();
});

test('shared cloud transport resumes a paged download after an accepted publication loses its reply', async () => {
	let f = await fixture(); const c = config(), s = spec(c), remote = Array.from({ length: 270 }, (_, i) => node('file-' + String(i).padStart(3, '0')));
	await seed(f, s, [], remote); await f.runs.prepareCloud(s, c);
	const local = new Map<string, SyncEntry>(), receipts = new Map<string, SyncReceipt>(); let effects = 0, ranges = 0, lose = true;
	const runtime: CloudTransportRuntime = { currentScope: () => scope, origin: () => scope.origin, requireCapability: async () => {}, fetch: async (url, init) => {
		const u = new URL(String(url)); assert.equal(u.origin, scope.origin); assert.equal(init?.credentials, 'same-origin');
		if (u.pathname === '/api/v1/files') {
			if (u.searchParams.has('path')) { const path = u.searchParams.get('path')!, source = remote.find(n => n.path === path)!;
				return Response.json({ ok: true, observation: { version: 1, complete: true, ...root, path, entry: inventorySyncEntry(source) } }); }
			const source = remote.find(n => n.kind === 'file' && n.file.id === u.searchParams.get('id'));
			assert.ok(source?.kind === 'file'); return Response.json({ ok: true, file: source.file });
		}
		ranges++; const offset = Number(u.searchParams.get('offset')), length = Number(u.searchParams.get('length'));
		return new Response(bytes.slice(offset, offset + length), { status: 206, headers: { ETag: '"' + 'a'.repeat(64) + '"', 'Content-Range': `bytes ${offset}-${offset + length - 1}/3`, 'Content-Length': String(length) } });
	} };
	const target: LocalSyncTarget = {
		lookup: async op => receipts.has(op.id) ? { status: 'complete', receipt: receipts.get(op.id)! } : { status: 'missing' },
		stage: async (op, _, source) => {
			assert.ok(op.mutation.kind === 'copy'); assert.ok(source); assert.deepEqual(await source.read(0, 3), bytes);
			return { operationId: op.id, scope, token: 'stage-' + op.id, entry: { ...op.mutation.source, id: 'written-' + op.id, version: 'written' } };
		},
		publish: async (op, _, staged) => {
			assert.ok(op.mutation.kind === 'copy'); assert.ok(sameSyncStamp(op.mutation.expectedTarget, local.get(op.mutation.path) ?? null));
			effects++; local.set(op.mutation.path, staged.entry); const receipt = { operationId: op.id, scope, entry: staged.entry }; receipts.set(op.id, receipt);
			if (effects === 129 && lose) { lose = false; throw Error('lost accepted publication reply'); } return receipt;
		}
	};
	const input = { currentScope: () => scope, readLocal: async (path: string) => local.get(path) ?? null, openSource: async () => { throw Error('No upload'); }, localTarget: target };
	const locks = { request: async (_name: string, _options: unknown, callback: () => Promise<unknown>) => callback() } as LockManager;
	let port = await createPagedCloudSyncPort(s, c, f.runs, input, runtime);
	await assert.rejects(executePagedSyncRun(s, scope, f.runs, port, { locks }), /lost accepted/);
	assert.equal((await f.runs.begin(s)).confirmed, 128); assert.equal(effects, 129);
	const original = await f.runs.find(s, 'file-128'); f.journal.close(); f = await fixture(f.factory);
	assert.deepEqual(await f.runs.find(s, 'file-128'), original);
	await assert.rejects(createPagedCloudSyncPort(s, { ...c, network: 'any' }, f.runs, input, runtime), /configuration changed/);
	port = await createPagedCloudSyncPort(s, c, f.runs, input, runtime);
	assert.equal((await executePagedSyncRun(s, scope, f.runs, port, { locks })).phase, 'complete');
	assert.equal(effects, 270); assert.equal(receipts.size, 270); assert.equal(ranges, 270);
	for (const n of remote) assert.deepEqual(local.get(n.path)?.fingerprint, fingerprint);
	assert.equal((await f.runs.begin(s)).confirmed, 270); f.journal.close();
});

test('expanded bindings obey the byte limit and resume before reaching the entry limit', async () => {
	const f = await fixture(), c = config('upload'), s = spec(c), local: SyncEntry[] = [];
	let path = '';
	for (let i = 0; i < 10; i++) { path += (path ? '/' : '') + '界'.repeat(180); local.push({ ...folder(path), id: 'folder-' + i }); }
	for (let i = 0; i < 140; i++) local.push({ ...file(path + '/file-' + String(i).padStart(3, '0')), id: 'file-' + i });
	await seed(f, s, local, []); await f.runs.beginCloud(s, c);
	const page = await f.runs.stepCloud(s); assert.ok(page.prepared > 0 && page.prepared < 128);
	assert.equal((await f.runs.prepareCloud(s, c)).prepared, local.length); f.journal.close();
});

test('an aborted binding page does not publish partial destinations or progress', async () => {
	const f = await fixture(), c = config('upload'), s = spec(c); await seed(f, s, [file('a'), file('b'), file('c')], []); await f.runs.beginCloud(s, c);
	const original = IDBObjectStore.prototype.put; let writes = 0;
	IDBObjectStore.prototype.put = function(value, key) {
		if (this.name === 'sync-paged-operations' && value.cloud && ++writes === 2) throw new DOMException('Synthetic quota refusal', 'QuotaExceededError');
		return original.call(this, value, key);
	};
	try { await assert.rejects(f.runs.stepCloud(s), /Synthetic quota/); } finally { IDBObjectStore.prototype.put = original; }
	assert.equal((await f.runs.beginCloud(s, c)).prepared, 0); await assert.rejects(f.runs.start(s), /Complete cloud bindings/);
	assert.equal((await f.runs.prepareCloud(s, c)).prepared, 3); f.journal.close();
});
