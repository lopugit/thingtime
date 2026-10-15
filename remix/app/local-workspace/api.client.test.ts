import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi, resolveLocalWebpage } from './api.client';
import { anonymousWorkspaceDatabase, bindLocalWorkspace } from './runtime.client';
import { transferChecksum } from '../utils/thingTransfer/archive';
import { bundleFromPlan } from '../utils/thingTransfer/browser';
import { rootIdentity } from '../utils/rootIdentity';

test('anonymous API writes and exports use no network and a retired facade cannot switch to an account', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB;
	Object.assign(globalThis, { window: { dispatchEvent() {} }, indexedDB: new IDBFactory() });
	let remoteCalls = 0;
	const remote = async (..._args: any[]): Promise<any> => { remoteCalls++; throw new Error('Unexpected remote call'); };
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const api = anonymousApi({ login: remote, auth: { login: remote }, things: { create: remote, update: remote, get: remote, list: remote, export: remote, import: remote, bulk: remote, feed: remote, trending: remote }, actions: { run: remote }, schemas: { list: remote }, algorithms: { list: remote, create: remote, update: remote, remove: remote, setActive: remote, track: remote }, themes: { list: remote, save: remote, getShared: remote, setActive: remote, remove: remote } });
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
		const savedTheme = (await api.themes.save({ name: 'Local peach', theme: { colors: { accent: '#cc8866' } }, visibility: 'private' })).theme;
		await api.themes.setActive({ themeId: savedTheme.id });
		assert.equal((await api.themes.list()).activeThemeId, savedTheme.id);
		assert.equal((await api.themes.getShared({ id: savedTheme.id })).theme.name, 'Local peach');
		assert.equal((await api.things.export({ ids: [savedTheme.id] })).plan.things[0].thingtime[0], 'theme');
		await api.themes.remove({ id: savedTheme.id });
		assert.equal((await api.themes.list()).themes.length, 0);
		assert.equal(remoteCalls, 0);
		const algorithm = (await api.algorithms.create({ name: 'Local art' })).algorithm;
		await api.algorithms.setActive({ algorithmId: algorithm.id });
		assert.equal((await api.algorithms.list()).activeAlgorithmId, algorithm.id);
		await api.algorithms.track({ algorithmId: algorithm.id, events: [{ thingId: 'unknown', signal: 'view' }] });
		assert.equal((await api.things.export({ ids: [algorithm.id] })).plan.things[0].thingtime[0], 'feed-algorithm');
		await api.algorithms.remove({ id: algorithm.id }); assert.equal(remoteCalls, 0);
		const fileBytes = new TextEncoder().encode('Scoped offline bytes');
		const fileImport = await api.things.import({ manifest: { format: 'thingtime.transfer', version: 1, roots: ['file'],
			things: [{ id: 'file', thingtime: ['attachment'], crystal: { recordingFileId: 'bytes', filePurpose: 'file' } }],
			files: [{ id: 'bytes', targetId: 'file', path: 'files/000000', name: 'local.txt', mime: 'text/plain', bytes: fileBytes.length, sha256: await transferChecksum(fileBytes) }] }, localFiles: new Map([['bytes', fileBytes]]) });
		const filePlan = (await api.things.export({ ids: fileImport.roots })).plan;
		assert.deepEqual([...((await bundleFromPlan(filePlan, { fetch: remote })).files.values())][0], fileBytes);
		const fileCopy = await api.things.bulk({ op: 'copy', ids: fileImport.roots });
		const deleted = await api.things.bulk({ op: 'delete', ids: fileImport.roots });
		assert.equal(deleted.succeeded, 1); assert.equal(deleted.results[0].ok, true);
		assert.equal(fileCopy.succeeded, 1); assert.equal(fileCopy.results[0].newId, fileCopy.roots[0]);
		assert.deepEqual([...((await bundleFromPlan((await api.things.export({ ids: fileCopy.roots })).plan, { fetch: remote })).files.values())][0], fileBytes);
		assert.equal(remoteCalls, 0);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		await assert.rejects(api.things.create({ crystal: { name: 'Late callback' } }), /Workspace changed/);
		await assert.rejects(filePlan.readLocalFile(filePlan.files[0].id), /Workspace changed/);
		assert.equal(remoteCalls, 0);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory });
	}
});

test('endpoints the server serves logged out stay reachable, account surfaces stay blocked', async () => {
	const oldWindow = globalThis.window, oldFactory = globalThis.indexedDB, oldFetch = globalThis.fetch;
	const origin = 'https://thingtime.example';
	let publicReads = 0, remoteCalls = 0;
	Object.assign(globalThis, { window: { dispatchEvent() {}, location: { origin } }, indexedDB: new IDBFactory(), fetch: async (_input: RequestInfo | URL, options?: RequestInit) => {
		if (options?.credentials === 'same-origin') return Response.json({ schemaVersion: 1, origin, features: Object.fromEntries(['users-profile', 'users-activity', 'users-search', 'themes-shared', 'things-feed'].map(id => [`api.${id}`, { version: id === 'users-profile' ? '1.1.0' : id === 'things-feed' ? '1.8.0' : '1.0.0' }])) });
		assert.equal(options?.credentials, 'omit'); assert.equal(options?.redirect, 'error'); publicReads++;
		const url = new URL(String(_input), origin);
		if (url.pathname === '/api/v1/things/feed') { assert.equal(url.searchParams.get('algorithm'), 'latest'); return Response.json({ ok: true, posts: [{ id: 'public-post', type: 'text', author: { id: 'author' }, tags: ['art'], createdAt: '2026-10-16T00:00:00.000Z' }], nextCursor: null }); }
		return Response.json({ ok: true });
	} });
	bindLocalWorkspace(true, rootIdentity.read().generation);
	try {
		const online = async (..._args: any[]): Promise<any> => { remoteCalls++; return { ok: true }; };
		const api = anonymousApi({
			waitlist: { join: online },
			things: { feed: online }, algorithms: { create: online, track: online, list: online },
			profile: { get: online, activity: online, search: online, update: online },
			themes: { getShared: online, listShared: online, list: online, save: online, setActive: online },
			admin: { users: online }
		});
		// A visitor with no account must still reach the public landing form,
		// public profiles, the people rail and the public theme gallery.
		for (const call of [api.waitlist.join({ email: 'a@b.co' }), api.profile.get({ username: 'lopu' }),
			api.profile.activity({ username: 'lopu' }), api.profile.search({ q: 'lo' }),
			api.themes.getShared({ id: 't' }), api.themes.listShared()]) assert.deepEqual(await call, { ok: true });
		assert.equal(publicReads, 5); assert.equal(remoteCalls, 1, 'only the explicit public waitlist uses its existing writer');
		const algorithm = (await api.algorithms.create({ name: 'Private interests' })).algorithm;
		const feed = await api.things.feed({ algorithm: algorithm.id });
		assert.equal(feed.localRanking, true); assert.equal(feed.posts[0].id, 'public-post');
		const trained = await api.algorithms.track({ algorithmId: algorithm.id, events: [{ thingId: 'public-post', signal: 'react' }] });
		assert.equal(trained.applied, 1); assert.equal(publicReads, 6); assert.equal(remoteCalls, 1);
		// Theme content now has a dedicated local writer; account surfaces stay denied.
		const saved = await api.themes.save({ name: 'Local', theme: {} });
		await api.themes.setActive({ themeId: saved.theme.id });
		for (const call of [() => api.profile.update({ bio: 'x' }), () => api.admin.users({})])
			await assert.rejects(call(), /signed-in account/);
		rootIdentity.changed(); bindLocalWorkspace(false, rootIdentity.read().generation); rootIdentity.confirm(rootIdentity.read().generation);
		for (const call of [() => api.profile.activity({ username: 'lopu' }), () => api.themes.listShared(), () => api.waitlist.join({ email: 'a@b.co' })])
			await assert.rejects(async () => call(), /Workspace changed/);
		assert.equal(publicReads, 6); assert.equal(remoteCalls, 1);
	} finally {
		await anonymousWorkspaceDatabase().close();
		Object.assign(globalThis, { window: oldWindow, indexedDB: oldFactory, fetch: oldFetch });
	}
});
