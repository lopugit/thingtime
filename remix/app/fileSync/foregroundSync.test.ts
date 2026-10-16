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
