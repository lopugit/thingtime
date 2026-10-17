import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { fingerprintSource } from './contentFingerprint';
import { createSyncRun, executeSyncRun } from './execute';
import { planFileSync, sameSyncStamp } from './reconcile';
import { inventorySyncEntry } from './cloudInventory';
import { prepareCloudInventoryRun } from './cloudWrite';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { openSyncJournal } from './journal.client';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'config' };
async function fixture() {
	const bytes = new Uint8Array([1, 2, 3]),
		fingerprint = await fingerprintSource({ size: 3, read: async (o, n) => bytes.slice(o, o + n), check: () => {} });
	const file = {
		id: 'file',
		revision: 'cloud-v1',
		name: 'file.bin',
		folderId: 'cloud-subfolder',
		trashed: false,
		content: { attachmentId: 'attachment', version: 'a'.repeat(64), size: 3, fingerprint }
	};
	const folder = { id: 'cloud-subfolder', revision: 'folder-v1', folderId: 'cloud-root', name: 'nested' };
	const inventory = {
		version: 1 as const,
		complete: true as const,
		rootId: 'cloud-root',
		rootRevision: 'root-v1',
		nodes: [
			{ kind: 'folder' as const, path: 'nested', id: folder.id, revision: folder.revision, folderId: 'cloud-root' },
			{ kind: 'file' as const, path: 'nested/file.bin', file }
		]
	};
	const run = prepareCloudInventoryRun(
		createSyncRun(
			planFileSync(
				{ scope, complete: true, entries: [] },
				{ scope, complete: true, entries: inventory.nodes.map(inventorySyncEntry) },
				{ scope, entries: [] },
				{ mode: 'download', propagateDeletes: false }
			)
		),
		inventory
	);
	let gets = 0,
		stages = 0,
		publishes = 0,
		lose = true,
		changeRemote = false,
		changeLocal = false,
		badStage = false,
		changeOrigin = false,
		changeAncestor = false,
		activeOrigin = scope.origin;
	const local = new Map<string, any>(),
		receipts = new Map<string, any>();
	const runtime = {
		currentScope: () => scope,
		origin: () => activeOrigin,
		requireCapability: async () => {},
		fetch: async (url: any, init: any) => {
			gets++;
			const u = new URL(String(url));
			assert.equal(init.credentials, 'same-origin');
			if (u.pathname === '/api/v1/files' && u.searchParams.has('rootId')) {
				assert.equal(u.searchParams.get('rootId'), inventory.rootId);
				const path = u.searchParams.get('path');
				const node = inventory.nodes.find(node => node.path === path);
				return Response.json({ ok: true, observation: { version: 1, complete: true, rootId: inventory.rootId, rootRevision: 'root-v1', path,
					entry: node && folder.name === 'nested' ? inventorySyncEntry(node) : null } });
			}
			if (u.pathname === '/api/v1/files') return Response.json({ ok: true, ...(u.searchParams.has('folderId') ? { folder } : { file }) });
			const offset = Number(u.searchParams.get('offset')),
				length = Number(u.searchParams.get('length'));
			return new Response(bytes.slice(offset, offset + length), {
				status: 206,
				headers: {
					ETag: '"' + file.content.version + '"',
					'Content-Range': `bytes ${offset}-${offset + length - 1}/3`,
					'Content-Length': String(length)
				}
			});
		}
	};
	const target = {
		lookup: async (op: any) => (receipts.has(op.id) ? { status: 'complete' as const, receipt: receipts.get(op.id) } : { status: 'missing' as const }),
		stage: async (op: any, _scope: any, source: any) => {
			stages++;
			const m = op.mutation;
			if (source) {
				assert.deepEqual(await source.read(0, 3), bytes);
				assert.deepEqual(await fingerprintSource(source), fingerprint);
			} else assert.equal(m.source.kind, 'folder');
			if (changeAncestor && source) folder.name = 'moved';
			if (changeRemote && source) file.revision = 'remote-edited';
			if (changeOrigin && source) activeOrigin = 'https://other.test';
			if (changeLocal && source) local.set(m.path, { ...m.source, id: 'local-new', version: 'local-edit' });
			return {
				operationId: op.id,
				scope,
				token: 'stage-' + op.id,
				entry: { ...m.source, id: 'local-' + op.id, version: 'local-v1', ...(badStage && source ? { size: 7 } : {}) }
			};
		},
		publish: async (op: any, _scope: any, stage: any) => {
			assert.ok(sameSyncStamp(op.mutation.expectedTarget, local.get(op.mutation.path) ?? null), 'Native destination CAS');
			publishes++;
			local.set(op.mutation.path, stage.entry);
			const receipt = { operationId: op.id, scope, entry: stage.entry };
			receipts.set(op.id, receipt);
			if (lose && op.mutation.source.kind === 'file') {
				lose = false;
				throw Error('lost local publication reply');
			}
			return receipt;
		}
	};
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory);
	return {
		run,
		local,
		counts: () => ({ gets, stages, publishes }),
		journal: () => journal,
		reopen: async () => {
			journal.close();
			journal = await openSyncJournal(factory);
		},
		port: () =>
			createCloudSyncPort(
				run,
				{
					currentScope: () => scope,
					persist: journal.persist,
					readLocal: async (p) => local.get(p) ?? null,
					openSource: async () => {
						throw Error('Downloads do not open an upload source');
					},
					localTarget: target
				},
				runtime
			),
		set: (key: string) => {
			lose = false;
			if (key === 'remote') changeRemote = true;
			if (key === 'local') changeLocal = true;
			if (key === 'stage') badStage = true;
			if (key === 'origin') changeOrigin = true;
			if (key === 'ancestor') changeAncestor = true;
		},
		runtime
	};
}
test('nested downloads use the same durable run and recover lost native publication replies without rereading cloud bytes', async () => {
	const f = await fixture();
	await assert.rejects(executeSyncRun(f.run, f.port()), /lost local publication/);
	assert.equal(f.local.size, 2);
	const before = f.counts();
	await f.reopen();
	const done = await executeSyncRun((await f.journal().read(scope))!, f.port());
	assert.ok(done.operations.every((o) => o.confirmed));
	assert.deepEqual(f.counts(), before);
	f.journal().close();
});
test('staged downloads reject altered source, invalid stage proof and native destination races', async () => {
	for (const kind of ['remote', 'local', 'stage', 'origin']) {
		const f = await fixture();
		f.set(kind);
		await assert.rejects(
			executeSyncRun(f.run, f.port()),
			kind === 'remote' ? /Cloud source changed/ : kind === 'local' ? /destination CAS/ : kind === 'origin' ? /context changed/ : /Native stage/
		);
		assert.equal(f.counts().publishes, 1);
		f.journal().close();
	}
});
test('a download cannot instantiate an execution port without a native publication adapter', async () => {
	const f = await fixture();
	assert.throws(
		() =>
			createCloudSyncPort(
				f.run,
				{
					currentScope: () => scope,
					persist: async () => {},
					readLocal: async () => null,
					openSource: async () => {
						throw Error('unused');
					}
				},
				f.runtime
			),
		/staged publication/
	);
	f.journal().close();
});


test('renaming a cloud ancestor during staging prevents publication even when the old file id and parent remain valid', async () => {
 const f = await fixture(); f.set('ancestor');
 await assert.rejects(executeSyncRun(f.run, f.port()), /Cloud path changed/);
 assert.equal(f.counts().publishes, 1); assert.equal(f.local.has('nested/file.bin'), false);
 f.journal().close();
});
test('legacy runs retain receipt recovery but cannot publish without their original cloud root', async () => {
 const f = await fixture();
 for (const write of f.run.cloudWrites) delete write.cloudRootId;
 await assert.rejects(executeSyncRun(f.run, f.port()), /no pinned cloud root/);
 assert.equal(f.counts().publishes, 0); f.journal().close();
});
