import assert from 'node:assert/strict';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { newFileSyncConfiguration } from './configuration';

export const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
export const saved = {
	id: 'connection',
	updatedAt: '2026-10-17T00:00:00.000Z',
	configuration: {
		...newFileSyncConfiguration({ name: 'Test', deviceId: 'device', localRootId: 'native-root', remoteFolderId: 'cloud-root' }),
		mode: 'backup' as const,
		paused: false
	}
};
export async function foregroundFixture(count = 1) {
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange),
		condition = { network: 'wifi' as any, charging: true },
		changed = false,
		lost = false,
		creates = 0;
	const folder = { path: 'Documents', id: 'native-folder', version: '1', kind: 'folder' as const, size: 0, sha256: null };
	const local = Array.from({ length: count }, (_, i) => ({ ...folder, path: count === 1 ? folder.path : 'Folder-' + String(i).padStart(3, '0'), id: 'native-folder-' + i }));
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
				if (lost && creates === Math.min(129, count)) {
					lost = false;
					throw Error('lost accepted creation');
				}
				return Response.json({ ok: true, folder: result, replayed: false });
			}
			if (u.searchParams.has('rootId')) {
				assert.equal(u.searchParams.get('rootId'), 'cloud-root');
				const path = u.searchParams.get('path')!, row = [...rows.values()].find(row => row.name === path);
				return Response.json({ ok: true, observation: { version: 1, complete: true, rootId: 'cloud-root', rootRevision: 'r1', path,
					entry: row ? { path, kind: 'folder', id: row.id, version: row.revision, size: 0, sha256: null } : null } });
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
		scanLocal: async () => structuredClone(local),
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
		journal: () => journal, factory,
		rows, local,
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
			journal = await openSyncJournal(factory, 'thingtime-file-sync-v1', IDBKeyRange);
		}
	};
}
