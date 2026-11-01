import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { createSyncRun, executeSyncRun, type SyncOperation, type SyncReceipt } from './execute';
import { localTrashContexts, type LocalTrashContext } from './localTrash';
import { prepareCloudInventoryRun } from './cloudWrite';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { sameSyncStamp, type SyncEntry } from './reconcile';
import type { LocalSyncTarget } from './localSyncTarget';

const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
async function fixture() {
	const parent: SyncEntry = { path: 'folder', id: 'native-parent', version: 'initial', kind: 'folder', size: 0, sha256: null };
	const child = (name: string): SyncEntry => ({
		path: 'folder/' + name,
		id: name,
		version: 'initial',
		kind: 'file',
		size: 3,
		sha256: 'a'.repeat(64)
	});
	const original = [parent, child('a'), child('b')];
	const run = prepareCloudInventoryRun(
		createSyncRun({ scope, decisions: original.map((expected) => ({ kind: 'trash', side: 'local', path: expected.path, expected })) }),
		{ version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'root-v1', nodes: [] }
	);
	const contexts = localTrashContexts(run),
		local = new Map(original.map((entry) => [entry.path, entry]));
	const receipts = new Map<string, SyncReceipt>(),
		transitions = new Map<string, SyncEntry>();
	let journal = await openSyncJournal(new IDBFactory()),
		loss = true,
		reappear = false,
		badProof = false,
		unavailable = false,
		reads = 0,
		moves = 0;
	const expected = (op: SyncOperation, context?: LocalTrashContext) => {
		assert.equal(op.mutation.kind, 'trash');
		if (op.mutation.kind !== 'trash') throw Error('Expected Trash');
		if (badProof) return { ...op.mutation.expected, id: 'forged' };
		return context?.childrenOperationId ? transitions.get(context.childrenOperationId)! : op.mutation.expected;
	};
	const native: LocalSyncTarget = {
		lookup: async (op, current, context) => {
			assert.deepEqual(current, scope);
			assert.deepEqual(context, contexts.get(op.id));
			return receipts.has(op.id) ? { status: 'complete', receipt: receipts.get(op.id)! } : { status: 'missing' };
		},
		trashExpected: async (op, _scope, context) => expected(op, context),
		trash: async (op, _scope, context) => {
			assert.deepEqual(context, contexts.get(op.id));
			assert.ok(sameSyncStamp(local.get(op.mutation.path)!, expected(op, context)));
			if (context?.parent) {
				const before = context.parent.previousOperationId ? transitions.get(context.parent.previousOperationId)! : context.parent.expected;
				assert.ok(sameSyncStamp(local.get(before.path)!, before));
				const after = { ...before, version: op.id };
				local.set(after.path, after);
				transitions.set(op.id, after);
			}
			moves++;
			local.delete(op.mutation.path);
			const receipt = { operationId: op.id, scope, entry: null };
			receipts.set(op.id, receipt);
			if (loss) {
				loss = false;
				throw Error('Lost native Trash reply');
			}
			return receipt;
		},
		stage: async () => {
			throw Error('Not a copy');
		},
		publish: async () => {
			throw Error('Not a copy');
		}
	};
	const runtime = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (url: any, init: any) => {
			assert.equal(init.method, 'GET');
			const u = new URL(String(url));
			assert.equal(u.searchParams.get('rootId'), 'cloud-root');
			reads++;
			if (unavailable) return Response.json({ ok: false }, { status: 404 });
			const path = u.searchParams.get('path')!;
			return Response.json({
				ok: true,
				observation: {
					version: 1,
					complete: true,
					rootId: 'cloud-root',
					rootRevision: 'r1',
					path,
					entry: reappear && reads >= 2 ? { ...parent, path, id: 'replacement' } : null
				}
			});
		}
	};
	return {
		run,
		local,
		native,
		contexts,
		receipts,
		journal,
		counts: () => ({ reads, moves }),
		set: (flag: string) => {
			loss = false;
			reappear = flag === 'reappear';
			badProof = flag === 'bad-proof';
			unavailable = flag === 'unavailable';
		},
		port: () =>
			createCloudSyncPort(
				run,
				{
					currentScope: () => scope,
					persist: journal.persist,
					readLocal: async (path) => local.get(path) ?? null,
					openSource: async () => {
						throw Error('No upload');
					},
					localTarget: native
				},
				runtime
			)
	};
}

test('local Trash uses fresh path absence, bounded child receipt links, and original IDs after a lost reply', async () => {
	const f = await fixture();
	assert.deepEqual(
		f.run.operations.map((op) => op.mutation.path),
		['folder/a', 'folder/b', 'folder']
	);
	const [a, b, folder] = f.run.operations;
	assert.equal(f.contexts.get(b.id)!.parent!.previousOperationId, a.id);
	assert.equal(f.contexts.get(folder.id)!.childrenOperationId, b.id);
	await assert.rejects(executeSyncRun(f.run, f.port()), /Lost native Trash/);
	assert.equal(f.counts().moves, 1);
	const saved = (await f.journal.read(scope))!;
	const done = await executeSyncRun(saved, f.port());
	assert.ok(done.operations.every((op) => op.confirmed));
	assert.equal(f.counts().moves, 3);
	assert.equal(f.local.size, 0);
	assert.deepEqual(
		done.operations.map((op) => op.id),
		f.run.operations.map((op) => op.id)
	);
	assert.equal(folder.mutation.kind === 'trash' && folder.mutation.expected.version, 'initial');
	f.journal.close();
});

test('recreated cloud paths, failed reads and invalid native preconditions stop before moving local data', async () => {
	for (const flag of ['reappear', 'unavailable', 'bad-proof']) {
		const f = await fixture();
		f.set(flag);
		await assert.rejects(executeSyncRun(f.run, f.port()), flag === 'reappear' ? /reappeared/ : flag === 'unavailable' ? /404/ : /precondition/);
		assert.equal(f.counts().moves, 0);
		assert.equal(f.local.size, 3);
		f.journal.close();
	}
});
