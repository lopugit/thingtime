import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { LocalActions } from './actions';
import { localActionRequests } from './actionRequests';
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
		await assert.rejects(invoke(step('GET', undefined, { id: 'private-account-thing' })), /local workspace/);
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
