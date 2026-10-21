import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { foregroundFixture, saved, scope } from './foregroundSync.fixture';
import { prepareCloudInventoryWrite } from './cloudWrite';
import type { PagedRunSpec } from './pagedRunJournal';
import type { SyncOperation } from './execute';
import type { SyncEntry } from './reconcile';
import { folderBatchDigest } from './folderBatch';
const sourceFile = JSON.parse(readFileSync(new URL('./fixtures/uploadBatchDigest.v1.json', import.meta.url), 'utf8')).vectors[0].descriptor.members[0]
	.write.operation.mutation.source;
const identity = (source: 'local' | 'remote') => ({ id: crypto.randomUUID(), generation: crypto.randomUUID(), source });
const spec = (): PagedRunSpec => ({
	id: crypto.randomUUID(),
	configuration: saved.configuration,
	streaming: { source: 'local', captureId: crypto.randomUUID() },
	plan: {
		id: crypto.randomUUID(),
		local: identity('local'),
		remote: identity('remote'),
		baseline: { local: identity('local'), remote: identity('remote') },
		policy: { mode: 'backup', propagateDeletes: false },
		excludedPaths: []
	}
});
const receipt = (operation: SyncOperation) => {
	assert.equal(operation.mutation.kind, 'copy');
	return { operationId: operation.id, scope, entry: { ...(operation.mutation as any).source, id: operation.id, version: 'r1' } };
};
async function fixture(paths: { path: string; file?: boolean }[]) {
	const f = await foregroundFixture(),
		s = spec(),
		access = { scope, currentScope: () => scope };
	let runs = f.journal().pagedRuns(access);
	await runs.begin(s);
	const operations: SyncOperation[] = [],
		parents = new Map<string, string>();
	for (const [i, item] of paths.entries()) {
		const source: SyncEntry = item.file
			? { ...sourceFile, path: item.path, id: 'inode-' + i }
			: { path: item.path, id: 'inode-' + i, version: 'v1', kind: 'folder', size: 0, sha256: null };
		const operation: SyncOperation = {
			id: crypto.randomUUID(),
			confirmed: false,
			mutation: { kind: 'copy', from: 'local', path: item.path, source, expectedTarget: null }
		};
		const parent = item.path.split('/').slice(0, -1).join('/');
		await runs.appendStream(
			s,
			{ generation: s.streaming!.captureId, sequence: i + 1, revision: source.version, entry: source },
			{
				write: prepareCloudInventoryWrite(
					operation,
					scope,
					saved.configuration.remoteFolderId,
					null,
					parent ? parents.get(parent)! : saved.configuration.remoteFolderId
				)
			}
		);
		operations.push(operation);
		if (!item.file) parents.set(item.path, operation.id);
	}
	return {
		f,
		s,
		access,
		operations,
		runs: () => runs,
		reopen: async () => {
			await f.reload();
			runs = f.journal().pagedRuns(access);
		}
	};
}
test('representative512queue reserves117folders topologically then releases395files in bounded batches', async () => {
	const dirs = ['Root', ...Array.from({ length: 116 }, (_, i) => `Root/d${String(i).padStart(3, '0')}`)];
	const f = await fixture([
		...dirs.map((path) => ({ path })),
		...Array.from({ length: 395 }, (_, i) => ({ path: `${dirs[1 + (i % 116)]}/f${i}`, file: true }))
	]);
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	assert.ok('kind' in batch);
	if (!('kind' in batch)) throw Error('Expected folder batch');
	assert.equal(batch.members.length, 117);
	const digest = await folderBatchDigest(batch);
	assert.equal(batch.members[0].parent.kind, 'root');
	assert.ok(batch.members.slice(1).every((m) => m.parent.kind === 'member' && m.parent.ordinal === 0));
	for (const [i, member] of batch.members.entries()) {
		if (i === 40) {
			await f.reopen();
			assert.equal(await folderBatchDigest(await f.runs().claimTransferBatch(f.s, saved, true)), digest);
		}
		await f.runs().confirm(f.s, receipt(member.write.operation));
	}
	for (const size of [256, 139]) {
		const files = (await f.runs().claimTransferBatch(f.s, saved, true))!;
		assert.equal('kind' in files, false);
		assert.equal(files.members.length, size);
		for (const member of files.members) await f.runs().confirm(f.s, receipt(member.write.operation));
	}
	assert.equal((await f.runs().active())!.progress.confirmed, 512);
	assert.equal((await f.runs().streamState(f.s)).terminal, false);
	f.f.journal().close();
});
test('folder reservation falls back with unchanged original writes and parent-first IDs after capability loss', async () => {
	const f = await fixture([{ path: 'A' }, { path: 'A/B' }, { path: 'A/B/f', file: true }]);
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	assert.ok('kind' in batch);
	await f.reopen();
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null);
	for (const operation of f.operations.slice(0, 2)) {
		const selected = (await f.runs().claimNext(f.s))!;
		assert.equal(selected.id, operation.id);
		assert.deepEqual(selected, operation);
		await f.runs().confirm(f.s, receipt(selected));
		await f.reopen();
	}
	const file = (await f.runs().claimUploadBatch(f.s, saved))!;
	assert.equal(file.members[0].write.operation.id, f.operations[2].id);
	f.f.journal().close();
});
test('folder unknown canonical dispatch cannot retire or rekey an originally reserved child', async () => {
	const f = await fixture([{ path: 'A' }, { path: 'A/B' }]);
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	await f.runs().markUploadBatchCommit(f.s, batch.batchId, [1]);
	await f.runs().recoverUploadBatch(f.s);
	await f.reopen();
	const parent = (await f.runs().claimNext(f.s))!;
	await f.runs().confirm(f.s, receipt(parent));
	const child = (await f.runs().claimNext(f.s))!;
	assert.equal(child.id, f.operations[1].id);
	await assert.rejects(f.runs().skipUnpublishedStreamOperation(f.s, child.id, false), /uncertain|canonical|publication/i);
	await f.reopen();
	assert.equal((await f.runs().claimNext(f.s))!.id, child.id);
	assert.equal((await f.runs().streamState(f.s)).terminal, false);
	f.f.journal().close();
});

test('unpublished parent revision releases only folder dependents then allocates one durable new target intent', async () => {
	const f = await fixture([{ path: 'A' }, { path: 'A/child', file: true }]);
	const originalParent = f.operations[0],
		originalChild = f.operations[1];
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	assert.ok('kind' in batch); // child file is outside this folder reservation
	await f.runs().recoverUploadBatch(f.s);
	assert.equal((await f.runs().claimNext(f.s))!.id, originalParent.id);
	await f.runs().skipUnpublishedStreamOperation(f.s, originalParent.id, false);
	await f.reopen();
	assert.equal(await f.runs().claimNext(f.s), null); // no fabricated replacement source
	const source = { ...(originalParent.mutation as any).source, version: 'v2' };
	const replacement: SyncOperation = { ...originalParent, id: crypto.randomUUID(), mutation: { ...(originalParent.mutation as any), source } };
	await f
		.runs()
		.appendStream(
			f.s,
			{ sequence: 3, generation: f.s.streaming!.captureId, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(replacement, scope, saved.configuration.remoteFolderId, null, saved.configuration.remoteFolderId) }
		);
	const selected = (await f.runs().claimNext(f.s))!;
	assert.equal(selected.id, replacement.id);
	await f.runs().confirm(f.s, receipt(selected));
	await f.reopen();
	assert.equal((await f.runs().claimNext(f.s))!.id, originalChild.id);
	const hint = (await f.runs().targetRebind(f.s, originalChild.id))!;
	assert.equal(hint.parentId, replacement.id);
	const before = (await f.runs().active())!.progress;
	const next = await f.runs().rebindStreamTarget(f.s, originalChild.id, (originalChild.mutation as any).source, replacement.id);
	assert.notEqual(next.id, originalChild.id);
	assert.deepEqual(next.mutation, originalChild.mutation);
	await f.reopen();
	assert.equal((await f.runs().claimNext(f.s))!.id, next.id);
	assert.equal((await f.runs().cloudBinding(f.s, saved.configuration, { id: next.id }))!.write.folderId, replacement.id);
	assert.deepEqual((await f.runs().active())!.progress, before); // no synthetic canonical counters
	assert.equal((await f.runs().streamState(f.s)).sequence, 3);
	await f.runs().confirm(f.s, receipt(next));
	f.f.journal().close();
});
test('forced folder-child recovery can park without changing its ID while a legitimate parent revision is prepared', async () => {
	const f = await fixture([{ path: 'A' }, { path: 'A/B' }, { path: 'A/B/file', file: true }]);
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	assert.equal(batch.members.length, 2);
	await f.runs().recoverUploadBatch(f.s);
	const a = (await f.runs().claimNext(f.s))!;
	await f.runs().skipUnpublishedStreamOperation(f.s, a.id, false);
	await f.reopen();
	const child = (await f.runs().claimNext(f.s))!;
	assert.equal(child.id, f.operations[1].id);
	const hint = (await f.runs().targetRebind(f.s, child.id))!;
	assert.equal(hint.recovery, true);
	assert.equal(hint.parentId, null);
	await f.runs().deferTargetRebind(f.s, child.id);
	await f.reopen();
	assert.equal(await f.runs().claimNext(f.s), null);
	const source = { ...(a.mutation as any).source, version: 'v2' },
		b: SyncOperation = { ...a, id: crypto.randomUUID(), mutation: { ...(a.mutation as any), source } };
	await f
		.runs()
		.appendStream(
			f.s,
			{ sequence: 4, generation: f.s.streaming!.captureId, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(b, scope, saved.configuration.remoteFolderId, null, saved.configuration.remoteFolderId) }
		);
	assert.equal((await f.runs().claimNext(f.s))!.id, b.id);
	await f.runs().confirm(f.s, receipt(b));
	assert.equal((await f.runs().claimNext(f.s))!.id, child.id);
	const replacement = await f.runs().rebindStreamTarget(f.s, child.id, (child.mutation as any).source, b.id);
	await f.reopen();
	assert.equal((await f.runs().claimNext(f.s))!.id, replacement.id);
	await f.runs().confirm(f.s, receipt(replacement));
	const file = (await f.runs().claimNext(f.s))!;
	assert.equal(file.id, f.operations[2].id);
	assert.equal((await f.runs().targetRebind(f.s, file.id))!.parentId, replacement.id);
	await assert.rejects(
		f.runs().rebindStreamTarget(f.s, file.id, { ...(file.mutation as any).source, version: 'changed' }, replacement.id),
		/unchanged/
	);
	await f.runs().markStreamCanonicalDispatch(f.s, file.id);
	await f.reopen();
	assert.equal((await f.runs().targetRebind(f.s, file.id))!.undispatched, false);
	await assert.rejects(f.runs().deferTargetRebind(f.s, file.id), /unresolved/);
	assert.equal((await f.runs().claimNext(f.s))!.id, file.id);
	f.f.journal().close();
});

test('pending old child target is excluded beside replacement parent and sibling folder batches, then scalar rebind remains selectable', async () => {
	const f = await fixture([{ path: 'A' }, { path: 'A/B' }, { path: 'A/B/f', file: true }]);
	await f.runs().claimTransferBatch(f.s, saved, true);
	await f.runs().recoverUploadBatch(f.s);
	const a = (await f.runs().claimNext(f.s))!;
	await f.runs().skipUnpublishedStreamOperation(f.s, a.id, false);
	const child = (await f.runs().claimNext(f.s))!;
	await f.runs().deferTargetRebind(f.s, child.id);
	const source = { ...(a.mutation as any).source, version: 'v2' },
		replacement: SyncOperation = { ...a, id: crypto.randomUUID(), mutation: { ...(a.mutation as any), source } };
	await f
		.runs()
		.appendStream(
			f.s,
			{ sequence: 4, generation: f.s.streaming!.captureId, revision: source.version, entry: source },
			{ write: prepareCloudInventoryWrite(replacement, scope, saved.configuration.remoteFolderId, null, saved.configuration.remoteFolderId) }
		);
	const siblingSource = { ...source, path: 'C', id: 'sibling-inode' },
		sibling: SyncOperation = {
			id: crypto.randomUUID(),
			confirmed: false,
			mutation: { kind: 'copy', from: 'local', path: 'C', source: siblingSource, expectedTarget: null }
		};
	await f
		.runs()
		.appendStream(
			f.s,
			{ sequence: 5, generation: f.s.streaming!.captureId, revision: siblingSource.version, entry: siblingSource },
			{ write: prepareCloudInventoryWrite(sibling, scope, saved.configuration.remoteFolderId, null, saved.configuration.remoteFolderId) }
		);
	const batch = (await f.runs().claimTransferBatch(f.s, saved, true))!;
	assert.ok('kind' in batch);
	assert.deepEqual(new Set(batch.members.map((m) => m.write.operation.id)), new Set([replacement.id, sibling.id]));
	for (const m of batch.members) await f.runs().confirm(f.s, receipt(m.write.operation));
	assert.equal(await f.runs().claimTransferBatch(f.s, saved, true), null);
	assert.equal((await f.runs().claimNext(f.s, true, 512, true))!.id, child.id);
	const next = await f.runs().rebindStreamTarget(f.s, child.id, (child.mutation as any).source, replacement.id);
	await f.runs().confirm(f.s, receipt((await f.runs().claimNext(f.s))!));
	assert.equal(await f.runs().claimUploadBatch(f.s, saved), null); // file's stale target cannot bypass lazy rebind
	const file = (await f.runs().claimNext(f.s, true, 512, true))!;
	assert.equal(file.id, f.operations[2].id);
	assert.equal((await f.runs().targetRebind(f.s, file.id))!.parentId, next.id);
	f.f.journal().close();
});
