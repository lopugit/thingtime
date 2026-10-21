import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSyncRun, executeSyncRun } from './execute';
import { prepareCloudInventoryRun, parseCloudSyncRun } from './cloudWrite';
import { createCloudSyncPort } from './cloudSyncPort.client';
import { openSyncJournal } from './journal.client';
import type { SyncEntry } from './reconcile';
import type { CloudInventory } from './cloudInventory';
const scope = { origin: 'https://sync.test', ownerId: 'owner', dataPlane: 'home', rootId: 'connection', deviceId: 'device' };
const folder = (path: string): SyncEntry => ({ path, id: path, version: 'local-v1', kind: 'folder', size: 0, sha256: null });
const inventory: CloudInventory = { version: 1, complete: true, rootId: 'root', rootRevision: 'revision', nodes: [] };
const make = () =>
	prepareCloudInventoryRun(
		createSyncRun({
			scope,
			decisions: ['Documents', 'Documents/Nested'].map((path) => ({ kind: 'copy', from: 'local', path, source: folder(path), expectedTarget: null }))
		}),
		inventory
	);
test('complete inventory binds new parents to immutable operation IDs before any effect', () => {
	const run = make();
	assert.equal(run.cloudWrites[0].folderId, 'root');
	assert.equal(run.cloudWrites[1].folderId, run.operations[0].id);
	assert.deepEqual(parseCloudSyncRun(JSON.parse(JSON.stringify(run))), run);
	assert.throws(() => prepareCloudInventoryRun({ ...run, operations: [run.operations[1]] }, inventory), /parent is missing/);
	assert.throws(() => prepareCloudInventoryRun(run, { ...inventory, complete: false } as any));
	assert.throws(
		() =>
			prepareCloudInventoryRun(run, {
				...inventory,
				nodes: [{ kind: 'folder', id: 'occupied', folderId: 'root', path: 'Documents', revision: 'existing' }]
			}),
		/already exists/
	);
});
test('nested folder executor resumes accepted response loss after journal reopen without duplicate parents or source-byte reads', async () => {
	const factory = new IDBFactory();
	let journal = await openSyncJournal(factory),
		lost = true,
		creates = 0;
	const rows = new Map<string, any>(),
		receipts = new Map<string, any>();
	const runtime = {
		currentScope: () => scope,
		origin: () => scope.origin,
		requireCapability: async () => {},
		fetch: async (url: any, init: any) => {
			const u = new URL(String(url));
			assert.equal(u.origin, scope.origin);
			assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner');
			assert.equal(init.headers['X-Thingtime-Expected-Data-Plane'], 'home');
			if (init.method === 'POST') {
				const input = JSON.parse(init.body),
					prior = receipts.get(input.operationId);
				if (prior) {
					assert.deepEqual(prior.input, input);
					return Response.json({ ok: true, folder: prior.folder, replayed: true });
				}
				assert.ok(input.folderId === 'root' || rows.has(input.folderId));
				const value = { id: input.id, name: input.name, folderId: input.folderId, revision: 'created-' + input.id };
				rows.set(input.id, value);
				receipts.set(input.operationId, { input, folder: value });
				creates++;
				if (lost) {
					lost = false;
					throw Error('accepted folder reply lost');
				}
				return Response.json({ ok: true, folder: value, replayed: false });
			}
			if (u.searchParams.has('rootId')) {
				const path=u.searchParams.get('path')!; let parentId='root', found:any;
				for(const name of path.split('/')) { found=[...rows.values()].find(row=>row.folderId===parentId&&row.name===name);if(!found)break;parentId=found.id; }
				return Response.json({ok:true,observation:{version:1,complete:true,rootId:'root',rootRevision:'r1',path,entry:found?{path,id:found.id,version:found.revision,kind:'folder',size:0,sha256:null}:null}});
			}
			const id = u.searchParams.get('folderId')!;
			if (u.searchParams.has('operationId'))
				return Response.json({ ok: true, receipt: receipts.get(u.searchParams.get('operationId')!)?.folder ?? null });
			return rows.has(id) ? Response.json({ ok: true, folder: rows.get(id) }) : Response.json({ ok: false }, { status: 404 });
		}
	};
	const port = (run: ReturnType<typeof make>) =>
		createCloudSyncPort(
			run,
			{
				currentScope: () => scope,
				persist: journal.persist,
				readLocal: async (path) => folder(path),
				openSource: async () => {
					throw Error('folders have no byte source');
				}
			},
			runtime
		);
	const run = make();
	await assert.rejects(executeSyncRun(run, port(run)), /reply lost/);
	assert.equal(creates, 1);
	journal.close();
	journal = await openSyncJournal(factory);
	const restored = parseCloudSyncRun((await journal.read(scope))!);
	const done = await executeSyncRun(restored, port(restored));
	assert.ok(done.operations.every((op) => op.confirmed));
	assert.equal(creates, 2);
	assert.equal(rows.size, 2);
	journal.close();
});
