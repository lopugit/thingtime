import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi, resolveLocalWebpage } from './api.client';
import { anonymousWorkspaceDatabase, bindLocalWorkspace } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';

test('anonymous API writes and exports use no network and a retired facade cannot switch to an account', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB;
	Object.assign(globalThis, { window: { dispatchEvent() {} }, indexedDB: new IDBFactory() });
	let remoteCalls = 0;
	const remote = async (..._args: any[]): Promise<any> => { remoteCalls++; throw new Error('Unexpected remote call'); };
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ login: remote, auth: { login: remote }, things: { create: remote, update: remote, get: remote, list: remote, export: remote, import: remote, bulk: remote, feed: remote, trending: remote }, actions: { run: remote }, schemas: { list: remote } });
		const created = await api.things.create({ thingtime: ['data'], crystal: { name: 'Offline' } });
		assert.equal((await api.things.get({ id: created.id })).thing.crystal.name, 'Offline');
		assert.equal((await api.things.export({ ids: [created.id] })).plan.things.length, 1);
		await assert.rejects(api.actions.run({}), /signed-in account/);
		assert.equal(api.login, remote, 'Explicit sign-in remains available from a local workspace');
		assert.equal(remoteCalls, 0);
		const component = await api.things.create({ thingtime: ['component'], crystal: { name: 'Card', componentKey: 'card', version: 1, render: { tag: 'p', children: 'Offline component' } } });
		const page = await api.things.create({ thingtime: ['webpage'], crystal: { name: 'Components', blocks: [{ id: 'card', type: 'component', component: 'card' }, { id: 'missing', type: 'component', component: 'missing' }] } });
		const rendered = await resolveLocalWebpage({ kind: 'id', id: page.id });
		assert.equal(rendered.refs.card, component.id);
		assert.equal(rendered.refs.missing, null);
		assert.deepEqual(rendered.components.map((row: any) => row.id), [component.id]);
		const newer = await api.things.create({ thingtime: ['component'], crystal: { name: 'Card v2', componentKey: 'card', version: 2, render: { tag: 'p', children: 'Newest component' } } });
		assert.equal((await resolveLocalWebpage({ kind: 'id', id: page.id })).refs.card, newer.id);
		await api.things.update({ id: page.id, crystal: { blocks: [{ id: 'card', type: 'component', component: 'card' }] } });
		const exported = (await api.things.export({ ids: [page.id] })).plan;
		assert.equal(exported.things.find((row: any) => row.id === page.id).crystal.blocks[0].component, newer.id);
		assert.ok(exported.things.some((row: any) => row.id === newer.id));
		assert.equal(remoteCalls, 0);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		await assert.rejects(api.things.create({ crystal: { name: 'Late callback' } }), /Workspace changed/);
		assert.equal(remoteCalls, 0);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory });
	}
});
