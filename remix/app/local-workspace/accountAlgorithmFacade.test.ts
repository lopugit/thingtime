import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { accountApi, accountWorkspaceWorker } from './accountApi.client';
import { bindLocalWorkspace, workspaceDatabase } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { LocalAlgorithms } from './algorithms';
import { WorkspaceDatabase } from './storage';

test('private feed observations use exact source planes while profiles stay at home', async (t) => {
	const db = new WorkspaceDatabase(new IDBFactory()),
		lease = { assertCurrent() {}, onInvalidate: () => () => {} };
	t.after(() => db.close());
	const home = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm-source.test', dataPlane: 'home' } as const;
	const a = new LocalAlgorithms(db, lease, { scope: home, observationScope: { ...home, dataPlane: 'custom-a' } });
	const b = new LocalAlgorithms(db, lease, { scope: home, observationScope: { ...home, dataPlane: 'custom-b' } });
	const profile = (await a.create({ name: 'Across databases' })).algorithm;
	const post = { id: 'same-id', type: 'text', author: { id: 'private-author-a' }, tags: ['source-a'], createdAt: new Date().toISOString() };
	await a.observePosts([post]);
	assert.equal((await b.track({ algorithmId: profile.id, events: [{ thingId: post.id, signal: 'react' }] })).applied, 0);
	await b.observePosts([{ ...post, author: { id: 'private-author-b' }, tags: ['source-b'] }]);
	await a.track({ algorithmId: profile.id, events: [{ thingId: post.id, signal: 'react' }] });
	const row = await db.transaction(home, 'readonly', lease, (tx) => tx.get<any>('things', profile.id));
	assert.ok(row.crystal.weights.authors['private-author-a']);
	assert.equal(row.crystal.weights.authors['private-author-b'], undefined);
	assert.equal(row.crystal.weights.tags['source-b'], undefined);
	await b.track({ algorithmId: profile.id, events: [{ thingId: post.id, signal: 'react' }] });
	assert.equal((await a.list()).algorithms[0].eventCount, 2);
	assert.equal((await new LocalAlgorithms(db, lease).list()).algorithms.length, 0);
	for (const observationScope of [
		{ ...home, ownerId: 'other' },
		{ ...home, origin: 'https://other.test' }
	])
		assert.throws(() => new LocalAlgorithms(db, lease, { scope: home, observationScope }), /account and origin/);
	await db.transaction(home, 'readwrite', lease, (tx) =>
		tx.put('algorithm-post-features', 'old-unscoped', {
			type: 'text',
			ownerId: 'unsafe',
			tags: [],
			createdAt: post.createdAt,
			observedAt: Date.now()
		})
	);
	assert.equal((await a.track({ algorithmId: profile.id, events: [{ thingId: 'old-unscoped', signal: 'react' }] })).applied, 0);
});

test('native account facade edits, applies, trains and transfers offline without drafts or account requests', async () => {
	const previous = {
		window: globalThis.window,
		indexedDB: globalThis.indexedDB,
		fetch: globalThis.fetch,
		navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
	};
	const events = new EventTarget(),
		scope = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm-facade.test', dataPlane: 'home' } as const;
	let calls = 0;
	const remote = async () => {
		calls++;
		throw Error('No account request allowed');
	};
	Object.assign(globalThis, {
		indexedDB: new IDBFactory(),
		window: {
			location: { origin: scope.origin },
			addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events),
			dispatchEvent: events.dispatchEvent.bind(events)
		},
		fetch: remote
	});
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
	try {
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
		const api: any = accountApi(
			{
				algorithms: { list: remote, create: remote, update: remote, setActive: remote, remove: remote, track: remote },
				things: { export: remote, import: remote }
			},
			{ id: 'owner' },
			'home'
		);
		const created = (await api.algorithms.create({ name: 'Offline native', emoji: undefined })).algorithm;
		await api.algorithms.setActive({ algorithmId: created.id });
		await api.algorithms.update({ id: created.id, name: 'Edited on device', expectedUpdatedAt: created.updatedAt });
		const service = accountWorkspaceWorker(scope).algorithmWorker!;
		await service.algorithms.algorithms.observePosts([
			{ id: 'post', type: 'text', author: { id: 'author' }, tags: ['kindness'], createdAt: new Date().toISOString() }
		]);
		assert.equal((await api.algorithms.track({ algorithmId: created.id, events: [{ thingId: 'post', signal: 'react' }] })).trained, true);
		const state = await api.algorithms.list();
		assert.equal(state.activeAlgorithmId, created.id);
		assert.equal(state.algorithms[0].name, 'Edited on device');
		assert.equal(state.algorithms[0].eventCount, 1);
		const plan = (await api.things.export({ ids: [created.id] })).plan;
		const copy = await api.things.import({
			manifest: { format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: [] },
			files: {},
			folderId: null
		});
		assert.equal(copy.savedLocally, true);
		assert.notEqual(copy.roots[0], created.id);
		assert.equal((await api.algorithms.list()).activeAlgorithmId, created.id);
		await assert.rejects(api.algorithms.update({ id: created.id, shared: false }), /Synchronize or review/);
		assert.equal(calls, 0);
		await api.algorithms.remove({ id: created.id });
		assert.equal((await api.algorithms.list()).activeAlgorithmId, null);
		assert.equal((await service.algorithms.selection.status())?.desired, null);
		assert.equal((await accountWorkspaceWorker(scope).drafts.status()).length, 0);
		bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, ownerId: 'other' }, false);
		await assert.rejects(api.algorithms.list(), /changed/);
		assert.equal(calls, 0);
	} finally {
		rootIdentity.changed();
		bindLocalWorkspace(false, rootIdentity.read().generation);
		rootIdentity.confirm(rootIdentity.read().generation);
		await workspaceDatabase().close();
		Object.assign(globalThis, { window: previous.window, indexedDB: previous.indexedDB, fetch: previous.fetch });
		if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
		else delete (globalThis as any).navigator;
	}
});

test('home algorithm sync keeps selected-plane authority and a slow profile upload cannot block built-in selection', async () => {
	const previous = {
		window: globalThis.window,
		indexedDB: globalThis.indexedDB,
		fetch: globalThis.fetch,
		navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator')
	};
	const events = new EventTarget(),
		scope = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm-pump.test', dataPlane: 'custom-' + 'a'.repeat(64) } as const;
	const calls: any[] = [],
		feeds: any[] = [];
	let online = false,
		release!: () => void,
		held = new Promise<void>((resolve) => {
			release = resolve;
		});
	const remote = {
		algorithms: {},
		things: {
			feed: async (args: any) => {
				feeds.push(args);
				return {
					ok: true,
					posts: [{ id: 'post', type: 'text', tags: ['source'], author: { id: 'author' }, createdAt: new Date().toISOString() }],
					nextCursor: null
				};
			}
		}
	};
	Object.assign(globalThis, {
		indexedDB: new IDBFactory(),
		window: {
			location: { origin: scope.origin },
			addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events),
			dispatchEvent: events.dispatchEvent.bind(events)
		},
		fetch: async (url: string, init: RequestInit) => {
			if (url.includes('capabilities'))
				return Response.json({
					schemaVersion: 1,
					origin: scope.origin,
					features: { 'api.algorithms-sync': { version: '1.2.0' }, 'api.mongodb-endpoint': { version: '1.1.0' } }
				});
			assert.equal(url, '/api/v1/algorithms/sync');
			assert.equal((init.headers as any)['X-Thingtime-Expected-Data-Plane'], scope.dataPlane);
			assert.equal((init.headers as any)['X-Thingtime-Expected-Actor'], scope.ownerId);
			const request = JSON.parse(String(init.body));
			calls.push(request);
			const envelope = { ok: true, ownerId: scope.ownerId, dataPlane: scope.dataPlane, storagePlane: 'home' };
			if (request.operation === 'snapshot') return Response.json({ ...envelope, complete: true, algorithms: [] });
			const selection = { algorithmId: null, version: 'algorithm-selection-v1:' + 'a'.repeat(64) };
			if (request.operation === 'selection') return Response.json({ ...envelope, selection });
			if (request.operation === 'select')
				return Response.json({
					...envelope,
					acknowledgment: {
						...request.command,
						result: { algorithmId: request.command.algorithmId, version: 'algorithm-selection-v1:' + 'b'.repeat(64) }
					}
				});
			await held;
			const { id, writeId, action, expectedVersion } = request.command;
			return Response.json({
				...envelope,
				acknowledgment: { id, writeId, action, expectedVersion, resultVersion: 'algorithm-state-v1:' + 'c'.repeat(64) }
			});
		}
	});
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: {
			get onLine() {
				return online;
			}
		}
	});
	const waitFor = async (check: () => Promise<boolean>) => {
		const deadline = Date.now() + 4000;
		while (!(await check())) {
			assert.ok(Date.now() < deadline, 'independent queue did not complete');
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
	};
	try {
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
		const api: any = accountApi(remote, { id: 'owner' }, scope.dataPlane);
		const created = (await api.algorithms.create({ name: 'Home profile' })).algorithm;
		await api.algorithms.setActive({ algorithmId: 'hot' });
		const worker = accountWorkspaceWorker(scope, { localPlane: 'home' }),
			service = worker.algorithmWorker!;
		await worker.sync.things.create({ thingtime: ['data'], crystal: { name: 'Home generic work stays queued' } });
		assert.equal(calls.length, 0);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
		online = true;
		worker.wake();
		await waitFor(async () => calls.some((call) => call.operation === 'write') && (await service.algorithms.selection.status())?.state === 'synced');
		assert.equal((await service.algorithms.status())[0].state, 'syncing');
		assert.equal((await worker.sync.status())[0].state, 'pending', 'home view never grants generic home network authority under another plane');
		const result = await api.things.feed({ algorithm: created.id, tag: undefined });
		assert.equal(feeds[0].algorithm, 'latest');
		assert.equal(result.localRanking, true);
		assert.equal((await api.algorithms.track({ algorithmId: created.id, events: [{ thingId: 'post', signal: 'react' }] })).applied, 1);
		release();
		await waitFor(async () => (await service.algorithms.status())[0].state === 'synced');
		assert.equal(calls.filter((call) => call.operation === 'select').length, 1);
		const old = api;
		bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, dataPlane: 'custom-' + 'b'.repeat(64) }, false);
		await assert.rejects(old.algorithms.track({ algorithmId: created.id, events: [] }), /changed/);
		const next: any = accountApi(remote, { id: 'owner' }, 'custom-' + 'b'.repeat(64));
		assert.equal((await next.algorithms.list()).algorithms[0].id, created.id);
		assert.equal((await next.algorithms.track({ algorithmId: created.id, events: [{ thingId: 'post', signal: 'react' }] })).applied, 0);
	} finally {
		release();
		rootIdentity.changed();
		bindLocalWorkspace(false, rootIdentity.read().generation);
		rootIdentity.confirm(rootIdentity.read().generation);
		await workspaceDatabase().close();
		Object.assign(globalThis, { window: previous.window, indexedDB: previous.indexedDB, fetch: previous.fetch });
		if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
		else delete (globalThis as any).navigator;
	}
});

test('explicit online algorithm changes carry captured authority and abort before a retired session can send', async () => {
	const original = { window: globalThis.window, indexedDB: globalThis.indexedDB, fetch: globalThis.fetch };
	const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	const events = new EventTarget(),
		scope = { kind: 'account', ownerId: 'owner', origin: 'https://algorithm-explicit.test', dataPlane: 'home' } as const;
	let entered!: () => void,
		release!: () => void,
		options: any,
		writes = 0;
	const ready = new Promise<void>((resolve) => {
			entered = resolve;
		}),
		pending = new Promise<void>((resolve) => {
			release = resolve;
		});
	Object.assign(globalThis, {
		indexedDB: new IDBFactory(),
		window: {
			location: { origin: scope.origin },
			addEventListener: events.addEventListener.bind(events),
			removeEventListener: events.removeEventListener.bind(events),
			dispatchEvent: events.dispatchEvent.bind(events)
		},
		fetch: async () => {
			throw Error('Unexpected request');
		}
	});
	Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
	try {
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, true);
		const api: any = accountApi(
			{
				algorithms: {
					update: async (input: any, request: any) => {
						assert.equal(input.shared, false);
						options = request;
						entered();
						await pending;
						request.signal.throwIfAborted();
						writes++;
						return { ok: true };
					}
				}
			},
			{ id: scope.ownerId },
			scope.dataPlane
		);
		const change = api.algorithms.update({ id: 'uncached-owned-profile', shared: false });
		await ready;
		assert.equal(options.expectedActor, scope.ownerId);
		assert.equal(options.expectedDataPlane, scope.dataPlane);
		bindLocalWorkspace(false, rootIdentity.read().generation, { ...scope, dataPlane: 'custom-' + 'b'.repeat(64) }, true);
		assert.equal(options.signal.aborted, true, 'plane changes retire pending online options even without a new root generation');
		release();
		await assert.rejects(change, /abort|changed/i);
		await assert.rejects(api.algorithms.update({ id: 'uncached-owned-profile', shared: false }), /changed/i);
		assert.equal(writes, 0);
	} finally {
		release();
		rootIdentity.changed();
		await workspaceDatabase().close();
		Object.assign(globalThis, original);
		if (oldNavigator) Object.defineProperty(globalThis, 'navigator', oldNavigator);
		else Reflect.deleteProperty(globalThis, 'navigator');
	}
});
