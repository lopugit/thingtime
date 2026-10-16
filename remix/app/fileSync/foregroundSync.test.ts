import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { runForegroundCloudSync } from './foregroundSync';
import { newFileSyncConfiguration } from './configuration';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const saved = {
	id: 'connection',
	updatedAt: '2026-10-17T00:00:00.000Z',
	configuration: {
		...newFileSyncConfiguration({ name: 'Test', deviceId: 'device', localRootId: 'native-root', remoteFolderId: 'cloud-root' }),
		mode: 'backup' as const,
		paused: false
	}
};
async function fixture() {
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory),
		condition = { network: 'wifi' as any, charging: true },
		changed = false,
		lost = false,
		creates = 0;
	const folder = { path: 'Documents', id: 'native-folder', version: '1', kind: 'folder' as const, size: 0, sha256: null };
	const rows = new Map<string, any>(),
		receipts = new Map<string, any>();
	const runtime = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (url: any, init: any) => {
			const u = new URL(String(url));
			if (init.method === 'POST') {
				const request = JSON.parse(init.body),
					old = receipts.get(request.operationId);
				if (old) return Response.json({ ok: true, folder: old, replayed: true });
				const result = { id: request.id, revision: 'created', folderId: request.folderId, name: request.name };
				rows.set(result.id, result);
				receipts.set(request.operationId, result);
				creates++;
				if (lost) {
					lost = false;
					throw Error('lost accepted creation');
				}
				return Response.json({ ok: true, folder: result, replayed: false });
			}
			const id = u.searchParams.get('folderId')!;
			if (u.searchParams.has('operationId')) return Response.json({ ok: true, receipt: receipts.get(u.searchParams.get('operationId')!) ?? null });
			return rows.has(id) ? Response.json({ ok: true, folder: rows.get(id) }) : Response.json({ ok: false }, { status: 404 });
		}
	};
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: saved.id,
			updatedAt: changed ? '2026-10-18T00:00:00.000Z' : saved.updatedAt,
			crystal: saved.configuration,
			author: { id: 'owner' },
			thingtime: ['file-sync'],
			acl: ['tt:user']
		}),
		authorizeDevice: async () => {},
		conditions: async () => condition,
		scanLocal: async () => [folder],
		inventory: async () => ({
			version: 1 as const,
			complete: true as const,
			rootId: 'cloud-root',
			rootRevision: 'root-revision',
			nodes: [...rows.values()].map((value) => ({
				kind: 'folder' as const,
				path: value.name,
				id: value.id,
				folderId: value.folderId,
				revision: value.revision
			}))
		}),
		source: async () => {
			throw Error('directories have no bytes');
		},
		journal,
		runtime,
		progress: () => {}
	});
	return {
		input,
		journal: () => journal,
		rows,
		creates: () => creates,
		change: () => {
			changed = true;
		},
		lose: () => {
			lost = true;
		},
		condition: (network: string) => {
			condition.network = network;
		},
		reload: async () => {
			journal.close();
			journal = await openSyncJournal(factory);
		}
	};
}
test('a user-started run uploads, checkpoints and checks a second time without duplicating destinations', async () => {
	const f = await fixture();
	const first = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(f.creates(), 1);
	assert.ok(first.operations.every((op) => op.confirmed));
	assert.equal((await f.journal().checkpoint(scope))?.baseline.entries.length, 1);
	const second = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(second.operations.length, 0);
	assert.equal(f.creates(), 1);
	f.journal().close();
});
test('lost replies resume the same run after reload; changed reviewed settings and network policy stop effects', async () => {
	const f = await fixture();
	f.lose();
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /lost accepted/);
	const original = await f.journal().read(scope);
	await f.reload();
	f.condition('cellular');
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /selected network/);
	assert.equal(f.creates(), 1);
	f.condition('wifi');
	const done = await runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal);
	assert.equal(done.id, original?.id);
	assert.equal(f.creates(), 1);
	f.change();
	await assert.rejects(runForegroundCloudSync(saved, scope, f.input(), new AbortController().signal), /configuration or device approval changed/);
	f.journal().close();
});

test('foreground downloads recover native receipts and checkpoint failure without republishing or losing later edits', async () => {
	const download = { ...saved, configuration: { ...saved.configuration, mode: 'download' as const } };
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory),
		local: any[] = [],
		publications = 0,
		lose = true;
	const receipts = new Map<string, any>();
	const remote = { kind: 'folder' as const, path: 'Documents', id: 'cloud-documents', folderId: 'cloud-root', revision: 'r1' };
	const input = () => ({
		currentScope: () => scope,
		readConfiguration: async () => ({
			id: download.id,
			updatedAt: download.updatedAt,
			crystal: download.configuration,
			author: { id: scope.ownerId },
			acl: ['tt:user'],
			thingtime: ['file-sync']
		}),
		authorizeDevice: async () => {},
		conditions: async () => ({ network: 'wifi' as const, charging: true }),
		scanLocal: async () => structuredClone(local),
		inventory: async () => ({ version: 1 as const, complete: true as const, rootId: 'cloud-root', rootRevision: 'r1', nodes: [remote] }),
		source: async () => {
			throw Error('not an upload');
		},
		journal,
		progress: () => {},
		runtime: {
			currentScope: () => scope,
			origin: () => scope.origin,
			requireCapability: async () => {},
			fetch: async (_url: any, init: any) => {
				assert.equal(init.method, 'GET');
				return Response.json({ ok: true, folder: { id: remote.id, folderId: remote.folderId, name: remote.path, revision: remote.revision } });
			}
		},
		localTarget: {
			lookup: async (op: any) =>
				receipts.has(op.id) ? { status: 'complete' as const, receipt: receipts.get(op.id) } : { status: 'missing' as const },
			stage: async (op: any) => ({
				scope,
				operationId: op.id,
				token: 'stage',
				entry: { ...op.mutation.source, id: 'local-folder', version: 'local-1' }
			}),
			publish: async (op: any, _scope: any, stage: any) => {
				publications++;
				local = [stage.entry];
				const receipt = { scope, operationId: op.id, entry: stage.entry };
				receipts.set(op.id, receipt);
				if (lose) {
					lose = false;
					throw Error('lost native reply');
				}
				return receipt;
			}
		}
	});
	await assert.rejects(runForegroundCloudSync(download, scope, input(), new AbortController().signal), /lost native reply/);
	const original = await journal.read(scope);
	journal.close();
	journal = await openSyncJournal(factory);
	const realComplete = journal.complete;
	journal.complete = async () => {
		throw Error('checkpoint failure');
	};
	await assert.rejects(runForegroundCloudSync(download, scope, input(), new AbortController().signal), /checkpoint failure/);
	assert.equal(publications, 1);
	assert.equal((await journal.read(scope))?.id, original?.id);
	local[0] = { ...local[0], version: 'local-edited-after-receipt' };
	journal.complete = realComplete;
	const done = await runForegroundCloudSync(download, scope, input(), new AbortController().signal);
	assert.equal(done.operations.length, 0);
	assert.equal(publications, 1);
	const baseline = (await journal.checkpoint(scope))!.baseline.entries[0];
	assert.equal(baseline.local.id, 'local-folder');
	assert.equal(baseline.remote.id, remote.id);
	assert.equal(baseline.local.version, 'local-edited-after-receipt');
	await assert.rejects(
		runForegroundCloudSync(
			{ ...download, configuration: { ...download.configuration, propagateDeletes: true } },
			scope,
			input(),
			new AbortController().signal
		),
		/deletion propagation disabled/
	);
	journal.close();
});
