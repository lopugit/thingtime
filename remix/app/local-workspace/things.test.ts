import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { WorkspaceDatabase, type WorkspaceLease } from './storage';
import { LocalThings, localThingProjection } from './things';
import { serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';

const fixture = () => {
	const db = new WorkspaceDatabase(new IDBFactory());
	const lease: WorkspaceLease = { assertCurrent() {}, onInvalidate: () => () => {} };
	return { db, things: new LocalThings(db, { kind: 'anonymous' }, lease) };
};
test('normal validation applies locally and never permits fake account records', async () => {
	const { db, things } = fixture();
	await assert.rejects(things.create({ thingtime: ['user'], crystal: { username: 'admin', isAdmin: true } }));
	await assert.rejects(things.create({ thingtime: ['nonexistent'], crystal: {} }), /Unknown thingtime schema/);
	await assert.rejects(things.create({ thingtime: ['data'], crystal: JSON.parse('{"__proto__":{"admin":true}}') }), /Unsafe property/);
	const row = await things.create({ thingtime: ['data'], crystal: { name: 'Local note', value: 'hello' } });
	const projected = localThingProjection(row, 'local-workspace');
	assert.equal(projected.localOnly, true); assert.equal(projected.visibility, 'private'); assert.deepEqual(projected.acl, ['tt:user']);
	assert.match(row.id, /^local-/); await db.close();
});
test('concurrent editor updates produce one conflict instead of overwriting newer content', async () => {
	const { db, things } = fixture(); const row = await things.create({ crystal: { text: 'initial' } });
	const results = await Promise.allSettled(['a', 'b'].map(text => things.update({ id: row.id, expectedUpdatedAt: row.updatedAt, crystal: { text } })));
	assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
	assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'WRITE_CONFLICT').length, 1);
	assert.equal((await things.get(row.id)).revision, 2); await db.close();
});
test('folder relationships stay local, reject cycles, and preserve children unless recursion is explicit', async () => {
	const { db, things } = fixture();
	const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Folder' } });
	const nested = await things.create({ thingtime: ['folder'], crystal: { name: 'Nested' }, folderId: folder.id });
	await assert.rejects(things.update({ id: folder.id, folderId: nested.id }), /cannot contain itself/);
	await assert.rejects(things.create({ crystal: {}, folderId: 'private-account-folder' }), /not in this workspace/);
	assert.equal((await things.remove([folder.id])).deleted.length, 1);
	assert.equal((await things.get(nested.id)).folderId, null);
	const replacement=await things.create({thingtime:['folder'],crystal:{name:'Replacement'}});
	await things.move([nested.id],replacement.id);
	assert.equal((await things.remove([replacement.id], true)).deleted.length, 2);
	assert.deepEqual((await things.list()).things.map(row => row.crystal.name), ['Timeline']); await db.close();
});
test('portable round trip remaps folder and component dependencies and strips local metadata', async () => {
	const { db, things } = fixture();
	const component = await things.create({ thingtime: ['component'], crystal: { name: 'Card', key: 'local-card', render: { tag: 'p', children: 'Editable' } } });
	const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Cards' } });
	const page = await things.create({ thingtime: ['webpage'], folderId: folder.id, crystal: { name: 'Page', version: 1, blocks: [{ id: 'card', type: 'component', component: component.id }] } });
	const { manifest } = await things.export([folder.id]); validateTransfer(manifest);
	assert.equal(manifest.things.length, 3);
	assert.doesNotMatch(serializeTransfer(manifest), /"author"|"revision"|"visibility"|"updatedAt"/);
	const imported = await things.import(manifest);
	const copy = await things.get(imported.idMap[page.id]);
	assert.equal(copy.folderId, imported.idMap[folder.id]);
	assert.equal((copy.crystal.blocks as any[])[0].component, imported.idMap[component.id]);
	assert.notEqual(copy.id, page.id); await db.close();
});
test('failed import rolls back all records and unresolved exports fail visibly', async () => {
	const { db, things } = fixture();
	const manifest = { format: 'thingtime.transfer', version: 1, roots: ['note'], files: [], things: [{ id: 'note', thingtime: ['data'], crystal: { text: 'test' } }] };
	await assert.rejects(things.import(manifest, 'missing-folder'), /not in this workspace/);
	assert.equal((await things.list()).things.length, 0);
	const page = await things.create({ thingtime: ['webpage'], crystal: { name: 'Incomplete', blocks: [{ id: 'x', type: 'component', component: 'absent' }] } });
	await assert.rejects(things.export([page.id]), /Missing component/); await db.close();
});
