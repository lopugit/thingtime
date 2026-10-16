import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { anonymousApi, resolveLocalWebpage } from './api.client';
import { anonymousThings, anonymousWorkspaceDatabase, anonymousWorkspaceLease, bindLocalWorkspace } from './runtime.client';
import { LocalActions } from './actions';
import { localActionRequests } from './actionRequests';
import { LocalThings } from './things';
import { rootIdentity } from '../utils/rootIdentity';

async function fixture() {
	const original = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
	const requests: { url: string; credentials?: RequestCredentials }[] = [];
	let allowPublic = false;
	const origin = 'https://restored-routing.example';
	Object.assign(globalThis, {
		window: { dispatchEvent() {}, location: { origin } },
		indexedDB: new IDBFactory(),
		fetch: async (input: RequestInfo | URL, options?: RequestInit) => {
			const url = new URL(String(input), origin);
			requests.push({ url: url.href, credentials: options?.credentials });
			if (!allowPublic) throw new Error('Unexpected outbound request');
			if (options?.credentials === 'same-origin')
				return Response.json({ schemaVersion: 1, origin, features: { 'api.things': { version: '1.31.0' } } });
			assert.equal(options?.credentials, 'omit');
			assert.equal(options?.redirect, 'error');
			return Response.json({
				ok: true,
				thing: { id: url.searchParams.get('id'), author: { id: 'public-author' }, crystal: { name: 'Public restored component' } },
				comments: []
			});
		}
	});
	bindLocalWorkspace(true, rootIdentity.read().generation);
	const remote = async (..._args: any[]): Promise<any> => {
		throw new Error('Account transport called');
	};
	const createApi = () =>
		anonymousApi({
			things: { create: remote, get: remote, list: remote, update: remote, remove: remote, react: remote, save: remote },
			timeline: { page: remote, version: remote }
		});
	const api = createApi();
	const scope = { ownerId: 'local-workspace', dataPlane: 'local-workspace', apiOrigin: origin };
	const component = await api.things.create({
		thingtime: ['component'],
		crystal: { name: 'Recorded card', componentKey: 'routing-card', version: 1, render: { tag: 'p', children: 'Old recorded content' } }
	});
	const page = await api.things.create({
		thingtime: ['webpage'],
		crystal: { name: 'Page', blocks: [{ id: 'body', type: 'component', component: component.id }] }
	});
	const event = (await api.timeline.page(scope, { thingId: page.id, before: null, after: null, limit: 40 })).entries[0].event;
	await api.things.update({ id: component.id, crystal: { render: { tag: 'p', children: 'New live content' } } });
	await api.things.update({ id: page.id, crystal: { name: 'Later page' } });
	const preview = (await api.timeline.version(scope, { command: 'preview-version', mode: 'restore', eventId: event.id, componentMode: 'recorded' }))
		.preview;
	await api.timeline.version(scope, {
		command: 'apply-version',
		mode: 'restore',
		eventId: event.id,
		componentMode: 'recorded',
		operationId: randomUUID(),
		expectedHeadId: preview.expectedHeadId,
		expectedComponents: preview.components.fingerprint
	});
	const restored = (await api.things.get({ id: page.id })).thing.crystal.blocks[0].component as string;
	assert.match(restored, /^restored-[a-f0-9]{48}$/);
	return {
		api,
		createApi,
		restored,
		component,
		requests,
		allowPublic: () => {
			allowPublic = true;
		},
		close: async () => {
			await anonymousWorkspaceDatabase().close();
			Object.assign(globalThis, original);
		}
	};
}

test('restored component reads, comments, reactions and rename stay in local authority, including deleted reads', async () => {
	const h = await fixture();
	try {
		const read = await h.api.things.get({ id: h.restored });
		assert.equal(read.thing.crystal.render.children, 'Old recorded content');
		assert.equal(read.thing.localOnly, true);
		assert.equal(read.discussion.sourceThingId, h.restored);
		const comment = await h.api.things.create({
			thingtime: ['post', 'comment'],
			crystal: { type: 'text', text: 'A local restored component comment.' },
			targetId: h.restored
		});
		const comments = await h.api.things.list({ target: h.restored, thingtime: 'comment', commentProjection: true });
		assert.equal(comments.comments[0].id, comment.id);
		assert.equal((await h.api.things.react({ id: h.restored, emoji: '❤️' })).reactionCounts['❤️'], 1);
		assert.equal((await h.api.things.save({ id: h.restored })).saved, true);
		await h.api.things.update({ id: h.restored, crystal: { name: 'Renamed restored component' } });
		assert.equal((await h.api.things.get({ id: h.restored })).thing.crystal.name, 'Renamed restored component');
		assert.equal((await h.api.things.get({ id: h.component.id })).thing.crystal.render.children, 'New live content');
		await h.api.things.remove({ id: h.restored });
		h.allowPublic();
		await assert.rejects(h.api.things.get({ id: h.restored }), /not in this workspace/);
		await assert.rejects(h.api.things.list({ target: h.restored, thingtime: 'comment', commentProjection: true }), /not in this workspace/);
		assert.equal((await resolveLocalWebpage({ kind: 'id', id: h.restored })).page, null);
		assert.deepEqual(h.requests, [], 'even a deleted local identity must not become a public fetch');
	} finally {
		await h.close();
	}
});

test('normal local browser Actions read, update and delete restored copies without networking or altering the shared component', async () => {
	const h = await fixture();
	try {
		const things = anonymousThings(),
			program = await things.create({
				thingtime: ['action'],
				crystal: {
					name: 'Edit restored component locally',
					runtime: 'browser',
					version: 1,
					capabilities: [{ capability: 'http.request', endpoints: ['GET', 'PATCH', 'DELETE'].map((method) => `${method} /api/v1/things`) }],
					steps: [
						{
							op: 'http.request',
							path: '/api/v1/things',
							method: 'GET',
							query: { id: h.restored },
							feature: 'api.things',
							minimumVersion: '1.33.0',
							maxResultBytes: 65536
						},
						{
							op: 'http.request',
							path: '/api/v1/things',
							method: 'PATCH',
							body: { id: h.restored, crystal: { name: 'Updated by local Action' } },
							feature: 'api.things',
							minimumVersion: '1.33.0',
							maxResultBytes: 65536
						},
						{
							op: 'http.request',
							path: '/api/v1/things',
							method: 'DELETE',
							body: { id: h.restored },
							feature: 'api.things',
							minimumVersion: '1.33.0',
							maxResultBytes: 65536
						},
						{ op: 'return', value: '$step.2.thing.crystal.name' }
					]
				}
			});
		const outcome = await new LocalActions(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease()).run({
			action: program.id
		});
		assert.equal(outcome.status, 'ok', outcome.error);
		assert.equal(outcome.result, 'Updated by local Action');
		await assert.rejects(things.get(h.restored), /not in this workspace/);
		assert.equal((await things.get(h.component.id)).crystal.name, 'Recorded card');
		assert.deepEqual(h.requests, []);
	} finally {
		await h.close();
	}
});

test('public restored IDs remain public reads while account partitions and stale anonymous facades grant no local authority', async () => {
	const h = await fixture();
	try {
		const remoteId = 'restored-' + 'f'.repeat(48);
		const accountScope = { kind: 'account' as const, ownerId: 'another-account', dataPlane: 'home', origin: 'https://restored-routing.example' };
		const accountLease = { assertCurrent() {}, onInvalidate: () => () => {} };
		const account = new LocalThings(anonymousWorkspaceDatabase(), accountScope, accountLease);
		const stored = await account.create({
			thingtime: ['component'],
			crystal: { name: 'Private account content', render: { tag: 'p', children: 'Private' } }
		});
		// Simulate an account restore/cached server ID in the separate test partition.
		await anonymousWorkspaceDatabase().transaction(accountScope, 'readwrite', accountLease, async (tx) => {
			await tx.put('things', remoteId, { ...stored, id: remoteId });
			await tx.delete('things', stored.id);
		});
		h.allowPublic();
		const publicRead = await h.api.things.get({ id: remoteId });
		assert.equal(publicRead.thing.author.id, 'public-author');
		assert.equal(publicRead.thing.crystal.name, 'Public restored component');
		await assert.rejects(h.api.things.react({ id: remoteId, emoji: '❤️' }), /not available/);
		const request = localActionRequests(anonymousWorkspaceDatabase(), { kind: 'anonymous' }, anonymousWorkspaceLease(), async () => {
			throw new Error('Unexpected data Action');
		});
		for (const method of ['GET', 'PATCH', 'DELETE'])
			await assert.rejects(
				request(
					{
						method,
						query: {},
						path: '/api/v1/things',
						feature: 'api.things',
						minimumVersion: '1.33.0',
						maxResultBytes: 65536,
						...(method === 'GET'
							? { query: { id: remoteId } }
							: { body: { id: remoteId, ...(method === 'PATCH' ? { crystal: { name: 'Not allowed' } } : {}) } })
					},
					'local-workspace',
					new AbortController().signal
				),
				/not in this workspace/
			);
		assert.equal((await account.get(remoteId)).crystal.name, 'Private account content');
		const before = h.requests.length;
		rootIdentity.changed();
		bindLocalWorkspace(false, rootIdentity.read().generation);
		rootIdentity.confirm(rootIdentity.read().generation);
		await assert.rejects(h.api.things.get({ id: h.restored }), /Workspace changed/);
		await assert.rejects(h.api.things.list({ target: h.restored, commentProjection: true }), /Workspace changed/);
		assert.equal(h.requests.length, before);
	} finally {
		await h.close();
	}
});

test('identity changes during local routing retire the read before any public transport', async () => {
	const h = await fixture(),
		original = LocalThings.prototype.hasReference;
	try {
		for (const read of [
			(api: typeof h.api) => api.things.get({ id: h.restored }),
			(api: typeof h.api) => api.things.list({ target: h.restored, commentProjection: true }),
			() => resolveLocalWebpage({ kind: 'id', id: h.restored })
		]) {
			bindLocalWorkspace(true, rootIdentity.read().generation);
			// Retire after the scoped lookup resolves, before its caller resumes.
			LocalThings.prototype.hasReference = async function (id) {
				const result = await original.call(this, id);
				rootIdentity.changed();
				bindLocalWorkspace(false, rootIdentity.read().generation);
				rootIdentity.confirm(rootIdentity.read().generation);
				return result;
			};
			await assert.rejects(read(h.createApi()), /Workspace changed/);
		}
		assert.deepEqual(h.requests, []);
	} finally {
		LocalThings.prototype.hasReference = original;
		await h.close();
	}
});
