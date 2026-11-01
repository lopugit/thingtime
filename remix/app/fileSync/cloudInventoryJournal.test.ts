import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { openSyncJournal } from './journal.client';
import { INVENTORY_PAGE_BYTES, INVENTORY_STORES, upgradeInventoryJournal, type InventoryIdentity } from './inventoryJournal';
import { upgradePagedPlanJournal } from './pagedPlanJournal';
import { upgradePagedRunJournal } from './pagedRunJournal';
import { upgradePagedCheckpointJournal } from './pagedCheckpointJournal';
import { inventorySyncEntry, type CloudInventoryNode } from './cloudInventory';
import { contentPartPlan } from './contentFingerprint';
import { syncScopeKey, type SyncScope } from './reconcile';
const scope: SyncScope = { origin: 'https://cloud-capture.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const identity: InventoryIdentity = { id: 'cloud-scan', source: 'remote', generation: 'frozen-one' };
const root = { rootId: 'cloud-root', rootRevision: 'root-one' };
const folder: CloudInventoryNode = { kind: 'folder', path: 'Documents', id: 'folder', folderId: root.rootId, revision: 'folder-one' };
const file = (i: number, path = 'Documents/file-' + String(i).padStart(4, '0')): Extract<CloudInventoryNode, {kind: 'file'}> => ({ kind: 'file', path,
	file: { id: 'file-' + i, revision: 'file-one', folderId: 'folder', name: path.split('/').at(-1)!, trashed: false,
		content: { attachmentId: 'attachment-' + i, version: 'a'.repeat(64), size: 2, fingerprint: { algorithm: 'sha256-parts-v1', ...contentPartPlan(2), sha256: 'b'.repeat(64) } } } });
async function fixture(factory = new IDBFactory()) {
	const journal = await openSyncJournal(factory, 'cloud-capture', IDBKeyRange); let current = scope;
	const access = { scope, currentScope: () => current };
	return { factory, journal, access, inventory: journal.inventory(access), changeAccount: () => { current = { ...scope, ownerId: 'other' }; } };
}

test('cloud metadata is atomically retained with each page and survives capture/validation restarts', async () => {
	let f = await fixture(); await f.inventory.beginCloud(identity, root);
	const first = [folder, ...Array.from({ length: 127 }, (_, i) => file(i))];
	await f.inventory.appendCloud(identity, { ordinal: 0, nodes: first });
	await assert.rejects(f.inventory.cloudRoot(identity), /complete/); await assert.rejects(f.inventory.cloudNode(identity, first[1].path), /complete/);
	f.journal.close(); f = await fixture(f.factory); await f.inventory.beginCloud(identity, root);
	assert.equal((await f.inventory.appendCloud(identity, { ordinal: 0, nodes: first })).entries, 128);
	await f.inventory.appendCloud(identity, { ordinal: 1, nodes: Array.from({ length: 128 }, (_, i) => file(i + 127)), totalEntries: 256 });
	await assert.rejects(f.inventory.seal(identity, p => { if (p.validatedEntries === 128) throw Error('Stop after first validation page'); }), /Stop after/);
	f.journal.close(); f = await fixture(f.factory); assert.equal((await f.inventory.seal(identity)).entries, 256);
	assert.deepEqual(await f.inventory.cloudRoot(identity), root);
	assert.deepEqual(await f.inventory.cloudNode(identity, 'Documents/file-0254'), file(254));
	assert.equal(await f.inventory.cloudNode(identity, 'Documents/absent'), null);
	const page = await f.inventory.read(identity); assert.equal(page.entries.length, 128); assert.deepEqual(page.entries[1], inventorySyncEntry(file(0)));
	await assert.rejects(f.inventory.cloudNode(identity, 'documents/file-0254'), /collision/); f.journal.close();
});

test('changed cloud page metadata is refused even when the reconciliation stamp is unchanged', async () => {
	const f = await fixture(); await f.inventory.beginCloud(identity, root);
	const nodes = [folder, file(0)]; await f.inventory.appendCloud(identity, { ordinal: 0, nodes, totalEntries: 2 });
	const changed = file(0); changed.file.content.attachmentId = 'different-object';
	assert.deepEqual(inventorySyncEntry(changed), inventorySyncEntry(file(0)));
	await assert.rejects(f.inventory.appendCloud(identity, { ordinal: 0, nodes: [folder, changed], totalEntries: 2 }), /retry changed/);
	await assert.rejects(f.inventory.append(identity, { ordinal: 0, entries: nodes.map(inventorySyncEntry), totalEntries: 2 }), /original metadata/);
	await assert.rejects(f.inventory.beginCloud(identity, { ...root, rootRevision: 'newer' }), /root changed/);
	await f.inventory.seal(identity); assert.deepEqual(await f.inventory.cloudNode(identity, file(0).path), file(0)); f.journal.close();
});

test('physical cloud parent identities are validated across pages, including root and root aliases', async () => {
	for (const broken of ['file-parent', 'folder-parent', 'root-alias']) {
		const f = await fixture(); await f.inventory.beginCloud(identity, root); const parent = structuredClone(folder), child = file(0);
		if (broken === 'file-parent') child.file.folderId = 'other-folder';
		if (broken === 'folder-parent') parent.folderId = 'other-root';
		if (broken === 'root-alias') child.file.id = root.rootId;
		await f.inventory.appendCloud(identity, { ordinal: 0, nodes: [parent] });
		await f.inventory.appendCloud(identity, { ordinal: 1, nodes: [child], totalEntries: 2 });
		await assert.rejects(f.inventory.seal(identity), /ancestry changed|metadata changed/);
		await assert.rejects(f.inventory.cloudRoot(identity), /complete/); f.journal.close();
	}
});

test('a generic or local capture cannot silently attach cloud metadata to an earlier observation', async () => {
	const f = await fixture(); await f.inventory.begin(identity);
	await assert.rejects(f.inventory.beginCloud(identity, root), /root changed/);
	await assert.rejects(f.inventory.appendCloud(identity, { ordinal: 0, nodes: [], totalEntries: 0 }), /original metadata/);
	await assert.rejects(f.inventory.beginCloud({ ...identity, id: 'local', source: 'local' }, root), /remote inventory/);
	await f.inventory.append(identity, { ordinal: 0, entries: [], totalEntries: 0 }); await f.inventory.seal(identity);
	await assert.rejects(f.inventory.cloudRoot(identity), /complete cloud metadata/); f.journal.close();
});

test('the cloud payload shares the page byte budget instead of hiding outside the entry limit', async () => {
	const f = await fixture(); await f.inventory.beginCloud(identity, root);
	const prefix = Array.from({ length: 15 }, () => '界'.repeat(250)).join('/');
	const nodes = Array.from({ length: 64 }, (_, i) => file(i, prefix + '/file-' + i));
	assert.ok(new TextEncoder().encode(JSON.stringify(nodes.map(inventorySyncEntry))).length < INVENTORY_PAGE_BYTES);
	await assert.rejects(f.inventory.appendCloud(identity, { ordinal: 0, nodes, totalEntries: nodes.length }), /byte bound/);
	assert.equal((await f.inventory.begin(identity)).entries, 0); f.journal.close();
});

test('retained cloud metadata is scoped and pinned by the same plan/run generation', async () => {
	const f = await fixture(); await f.inventory.beginCloud(identity, root);
	await f.inventory.appendCloud(identity, { ordinal: 0, nodes: [folder, file(0)], totalEntries: 2 }); await f.inventory.seal(identity);
	const local: InventoryIdentity = { id: 'local', source: 'local', generation: 'one' };
	await f.inventory.begin(local); await f.inventory.append(local, { ordinal: 0, entries: [], totalEntries: 0 }); await f.inventory.seal(local);
	const plan = { id: 'plan', local, remote: identity, baseline: { local, remote: { ...identity, id: 'empty-remote' } }, policy: { mode: 'download' as const, propagateDeletes: false }, excludedPaths: [] };
	await f.inventory.begin(plan.baseline.remote); await f.inventory.append(plan.baseline.remote, { ordinal: 0, entries: [], totalEntries: 0 }); await f.inventory.seal(plan.baseline.remote);
	await f.journal.plans(f.access).build(plan); await f.journal.pagedRuns(f.access).prepare({ id: 'run', plan });
	await assert.rejects(f.inventory.discard(identity), /pinned/);
	f.changeAccount(); await assert.rejects(f.inventory.cloudNode(identity, file(0).path), /account or root/); f.journal.close();
});

test('version-6 observations and completed legacy runs survive the metadata-store upgrade', async () => {
	const factory = new IDBFactory();
	await new Promise<void>((resolve, reject) => {
		const request = factory.open('cloud-capture', 6);
		request.onupgradeneeded = () => {
			const db = request.result; db.createObjectStore('runs').put({ version: 1, id: 'old', scope, operations: [] }, syncScopeKey(scope)); db.createObjectStore('checkpoints');
			upgradeInventoryJournal(db); upgradePagedPlanJournal(db); upgradePagedRunJournal(db); upgradePagedCheckpointJournal(db);
			request.transaction!.objectStore(INVENTORY_STORES[0]).put({ ...identity, scope: syncScopeKey(scope), phase: 'complete', pages: 1, entries: 0, validatedEntries: 0, validatedThrough: null }, [syncScopeKey(scope), identity.id]);
		};
		request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
	});
	const f = await fixture(factory); assert.equal((await f.journal.read(scope))?.id, 'old'); assert.equal((await f.inventory.read(identity)).totalEntries, 0);
	await assert.rejects(f.inventory.beginCloud(identity, root), /root changed/); f.journal.close();
	await assert.rejects(new Promise((resolve, reject) => { const r = factory.open('cloud-capture', 6); r.onsuccess = () => { r.result.close(); resolve(null); }; r.onerror = () => reject(r.error); }), { name: 'VersionError' });
});
