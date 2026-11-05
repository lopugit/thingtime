import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { localActionRequests, localActionRequestSupported } from './actionRequests';
import { LocalThings } from './things';
import { LocalThemes } from './themes';
import { WorkspaceDatabase } from './storage';

const scope = { kind: 'anonymous' as const },
	lease = { assertCurrent() {}, onInvalidate: () => () => {} };
const step = (method: string, body?: unknown, query = {}) => ({
	path: '/api/v1/things',
	method,
	...(body === undefined ? {} : { body }),
	query,
	feature: 'api.things',
	minimumVersion: '1.33.0',
	maxResultBytes: 65536
});
const bulkStep = (body: unknown) => ({ ...step('POST', body), path: '/api/v1/things/bulk', feature: 'api.things-bulk', minimumVersion: '1.6.0' });

test('local bulk requests process more than a storage-writer batch without imposing a selection cap', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease);
	try {
		const definitions = Array.from({ length: 205 }, (_, index) => ({ id: `data-${index}`, thingtime: ['data'], crystal: { name: `Item ${index}` } }));
		const imported = await things.import({ format: 'thingtime.transfer', version: 1, roots: definitions.map(row => row.id), things: definitions, files: [] });
		const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Large selection' } });
		const request = localActionRequests(db, scope, lease, async () => { throw new Error('Not used'); });
		const result = await request(bulkStep({ op: 'move', ids: imported.roots, folderId: folder.id }), 'local-workspace', new AbortController().signal) as any;
		assert.equal(result.succeeded, 205); assert.equal(result.failed, 0);
		assert.equal((await things.list({ folder: folder.id, limit: 200 })).things.length, 200);
		assert.ok((await things.snapshot()).filter(row => imported.roots.includes(row.id)).every(row => row.folderId === folder.id));
	} finally { await db.close(); }
});

test('browser bulk requests move and delete editable local Things with per-item failures and no HTTP', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease);
	const fetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => { requests++; throw new Error('Network forbidden'); };
	try {
		const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Destination' } });
		const first = await things.create({ thingtime: ['data'], crystal: { name: 'First' } });
		const second = await things.create({ thingtime: ['data'], crystal: { name: 'Second' } });
		const theme = (await new LocalThemes(db, lease).save({ name: 'Protected theme', theme: {} })).theme;
		const move = bulkStep({ op: 'move', ids: [first.id, second.id], folderId: folder.id });
		assert.equal(localActionRequestSupported(move), true);
		assert.equal(localActionRequestSupported(bulkStep({ op: 'share', ids: [first.id], acl: ['tt:public'] })), false);
		assert.equal(localActionRequestSupported(bulkStep({ op: 'delete', ids: [first.id], recursive: true })), false);
		const action = await things.create({ thingtime: ['action'], crystal: {
			name: 'Bulk offline', runtime: 'browser', version: 1,
			capabilities: [{ capability: 'http.request', endpoints: ['POST /api/v1/things/bulk'] }],
			steps: [{ op: 'http.request', ...move }, { op: 'return', value: '$step.1' }]
		} });
		const outcome = await new LocalActions(db, scope, lease).run({ action: action.id });
		assert.equal(outcome.status, 'ok', outcome.error);
		assert.equal((outcome.result as any).succeeded, 2);
		assert.equal((await things.get(first.id)).folderId, folder.id);
		assert.equal((await things.get(second.id)).folderId, folder.id);
		const request = localActionRequests(db, scope, lease, async () => { throw new Error('Not used'); });
		const invoke = (body: unknown, signal = new AbortController().signal) => request(bulkStep(body), 'local-workspace', signal);
		const result = await invoke({ op: 'delete', ids: [first.id, 'foreign', theme.id] }) as any;
		assert.equal(result.succeeded, 1); assert.equal(result.failed, 2);
		assert.deepEqual(result.results.map((row: any) => row.ok), [true, false, false]);
		assert.match(result.results[2].error, /dedicated adapter/);
		assert.ok(await things.get(theme.id));
		await assert.rejects(invoke({ op: 'delete', ids: [second.id] }, AbortSignal.abort()), /abort/i);
		assert.ok(await things.get(second.id));
		assert.equal(requests, 0);
	} finally { globalThis.fetch = fetch; await db.close(); }
});

test('browser bulk copy rewrites a complete editable closure and refuses protected children before writes', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()), things = new LocalThings(db, scope, lease);
	try {
		const folder = await things.create({ thingtime: ['folder'], crystal: { name: 'Source' } });
		const component = await things.create({ thingtime: ['component'], folderId: folder.id, crystal: { name: 'Nested', componentKey: 'nested', version: 1, render: { tag: 'p', children: '独立 🌿' } } });
		const page = await things.create({ thingtime: ['webpage'], folderId: folder.id, crystal: { name: 'Page', blocks: [{ id: 'block', type: 'component', component: component.id }] } });
		const request = localActionRequests(db, scope, lease, async () => { throw new Error('Not used'); });
		const invoke = (ids: string[], signal = new AbortController().signal) => request(bulkStep({ op: 'copy', ids }), 'local-workspace', signal) as Promise<any>;
		assert.equal(localActionRequestSupported(bulkStep({ op: 'copy', ids: [folder.id] })), true);
		const copied = await invoke([folder.id, 'foreign']);
		assert.equal(copied.succeeded, 1); assert.equal(copied.failed, 1);
		assert.notEqual(copied.results[0].newId, folder.id);
		const children = (await things.snapshot()).filter(row => row.folderId === copied.results[0].newId);
		const copyPage = children.find(row => row.thingtime.includes('webpage'))!, copyComponent = children.find(row => row.thingtime.includes('component'))!;
		assert.equal((copyPage.crystal.blocks as any[])[0].component, copyComponent.id);
		assert.notEqual(copyPage.id, page.id); assert.notEqual(copyComponent.id, component.id);
		await things.remove([folder.id], true);
		assert.equal(((await things.get(copyComponent.id)).crystal.render as { children: string }).children, '独立 🌿');
		await assert.rejects(invoke([copied.results[0].newId], AbortSignal.abort()), /abort/i);
		const protectedFolder = await things.create({ thingtime: ['folder'], crystal: { name: 'Protected' } });
		const theme = (await new LocalThemes(db, lease).save({ name: 'Protected theme', theme: {} })).theme;
		await things.move([theme.id], protectedFolder.id);
		const before = (await things.snapshot()).length;
		const refused = await invoke([protectedFolder.id]);
		assert.equal(refused.failed, 1); assert.match(refused.results[0].error, /dedicated adapter/);
		assert.equal((await things.snapshot()).length, before);
	} finally { await db.close(); }
});

test('browser Actions reuse local Things operations, retain expressions and never call fetch', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		things = new LocalThings(db, scope, lease);
	const fetch = globalThis.fetch;
	let requests = 0;
	globalThis.fetch = async () => {
		requests++;
		throw new Error('Network forbidden');
	};
	try {
		const program = await things.create({
			thingtime: ['action'],
			crystal: {
				name: 'Local browser CRUD',
				runtime: 'browser',
				version: 1,
				capabilities: [{ capability: 'http.request', endpoints: ['POST', 'GET', 'PATCH', 'DELETE'].map((method) => `${method} /api/v1/things`) }],
				steps: [
					{
						op: 'http.request',
						...step('POST', {
							thingtime: ['component'],
							acl: ['tt:user'],
							crystal: { name: 'Created offline', render: { tag: 'p', children: 'Editable' } }
						})
					},
					{ op: 'http.request', ...step('PATCH', { id: '$step.1.id', crystal: { name: 'Edited offline' } }) },
					{ op: 'http.request', ...step('GET', undefined, { id: '$step.1.id' }) },
					{ op: 'http.request', ...step('DELETE', { id: '$step.1.id' }) },
					{ op: 'return', value: '$step.3.thing.crystal.name' }
				]
			}
		});
		const outcome = await new LocalActions(db, scope, lease).run({ action: program.id });
		assert.equal(outcome.status, 'ok', outcome.error);
		assert.equal(outcome.result, 'Edited offline');
		assert.equal((await things.list({ thingtime: 'component' })).things.length, 0);
		assert.equal(requests, 0);
	} finally {
		globalThis.fetch = fetch;
		await db.close();
	}
});

test('local request boundary rejects remote IDs, ownership, unsupported fields/versions and cancelled writes', async () => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		things = new LocalThings(db, scope, lease);
	const request = localActionRequests(db, scope, lease, async () => {
		throw new Error('Not used');
	});
	const invoke = (value: Parameters<typeof request>[0], signal = new AbortController().signal) => request(value, 'local-workspace', signal);
	try {
		const body = { thingtime: ['data'], crystal: { text: 'Local' } };
		for (const extra of [
			{ ownerId: 'private' },
			{ acl: ['tt:public'] },
			{ visibility: 'public' },
			{ attachmentIds: ['private-file'] },
			{ id: 'forged' }
		]) {
			await assert.rejects(invoke(step('POST', { ...body, ...extra })), /local adapter|cannot grant/);
		}
		await assert.rejects(invoke({ ...step('POST', body), minimumVersion: '99.0.0' }), /version without a local adapter/);
		await assert.rejects(invoke(step('GET', undefined, { id: 'private-account-thing' })), /not in this workspace/);
		await assert.rejects(invoke(step('GET', undefined, { scope: 'public' })), /scope request field/);
		await assert.rejects(invoke(step('POST', body), AbortSignal.abort()), /abort/i);
		await assert.rejects(request(step('POST', body), 'other-owner', new AbortController().signal), /Workspace changed/);
		assert.equal((await things.snapshot()).length, 0);
		const themes = new LocalThemes(db, lease);
		const theme = (await themes.save({ name: 'Keep active theme', theme: {} })).theme;
		await themes.setActive(theme.id);
		await assert.rejects(invoke(step('DELETE', { id: theme.id })), /dedicated adapter/);
		assert.equal((await themes.list()).activeThemeId, theme.id);
		assert.equal((await themes.list()).themes.length, 1);
		const row = await things.create(body);
		await assert.rejects(invoke({ ...step('GET', undefined, { id: row.id }), maxResultBytes: 1 }), /byte budget/);
	} finally {
		await db.close();
	}
});
