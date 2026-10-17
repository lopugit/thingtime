import assert from 'node:assert/strict';
import test from 'node:test';
import { accountAlgorithmTransport } from './algorithmTransport.client';
import { bindLocalWorkspace, accountWorkspaceLease } from './runtime.client';
import { rootIdentity } from '../utils/rootIdentity';
import { parseAlgorithmWrite } from '../api/utils/algorithms/algorithmSyncContract';
const signal = () => new AbortController().signal;
test('algorithm transport requires current authority and compatible origin, bounds data, and keeps selected-plane fencing for home writes', async () => {
	const origin = 'https://algorithm-transport.test',
		plane = 'custom-' + 'a'.repeat(64),
		scope = { kind: 'account', ownerId: 'owner', origin, dataPlane: plane } as const;
	const previous = { window: globalThis.window, fetch: globalThis.fetch },
		calls: { url: string; init: RequestInit }[] = [],
		events: string[] = [];
	let capability: string | undefined,
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', complete: true, algorithms: [] }),
		after: (() => void) | undefined;
	Object.assign(globalThis, {
		window: {
			location: { origin },
			dispatchEvent: (event: Event) => {
				events.push(event.type);
				return true;
			}
		},
		fetch: async (url: string, init: RequestInit) => {
			if (url.includes('capabilities'))
				return Response.json({
					schemaVersion: 1,
					origin,
					features: { 'api.algorithms-sync': { version: capability }, 'api.mongodb-endpoint': { version: '1.1.0' } }
				});
			calls.push({ url, init });
			after?.();
			return response;
		}
	});
	const bind = (confirmed = true) => {
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(false, rootIdentity.read().generation, scope, confirmed);
		return accountAlgorithmTransport(scope, accountWorkspaceLease(scope));
	};
	try {
		await assert.rejects(bind(false).snapshot(signal()), /offline/);
		assert.equal(calls.length, 0);
		for (const unsupported of [undefined, '0.9.0', '2.0.0']) {
			capability = unsupported;
			await assert.rejects(bind().snapshot(signal()), /incompatible/);
		}
		assert.equal(calls.length, 0);
		capability = '1.0.0';
		assert.deepEqual(await bind().snapshot(signal()), []);
		assert.equal(calls[0].url, '/api/v1/algorithms/sync');
		assert.equal(calls[0].init.credentials, 'same-origin');
		assert.equal(calls[0].init.redirect, 'error');
		assert.equal(calls[0].init.cache, 'no-store');
		assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Data-Plane'], plane);
		assert.equal((calls[0].init.headers as any)['X-Thingtime-Expected-Actor'], 'owner');
		const command = parseAlgorithmWrite({
			id: '123e4567-e89b-42d3-a456-426614174000',
			action: 'save',
			expectedVersion: null,
			writeId: 'profile-write',
			content: { name: 'Reading', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null },
			description: ''
		});
		const ack = {
			id: command.id,
			writeId: command.writeId,
			action: 'save',
			expectedVersion: null,
			resultVersion: 'algorithm-state-v1:' + 'b'.repeat(64)
		};
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', acknowledgment: ack });
		assert.deepEqual(await bind().write(command, signal()), ack);
		assert.deepEqual(JSON.parse(String(calls.at(-1)!.init.body)), { operation: 'write', expectedOwnerId: 'owner', command });
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', acknowledgment: { ...ack, writeId: 'wrong' } });
		await assert.rejects(bind().write(command, signal()), /does not match/);
		const selection = { algorithmId: 'hot', version: 'algorithm-selection-v1:' + 'c'.repeat(64) };
		const select = { algorithmId: 'hot', expectedVersion: selection.version, writeId: 'choose-hot' };
		await assert.rejects(bind().selection(signal()), /incompatible/);
		capability = '1.1.0';
		const beforePlacement = calls.length;
		await assert.rejects(bind().write({ ...command, folderId: null } as any, signal()), /incompatible/);
		assert.equal(calls.length, beforePlacement, 'older hosts never receive an unsupported placement write');
		capability = '1.2.0';
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', acknowledgment: ack });
		assert.deepEqual(await bind().write({ ...command, folderId: null } as any, signal()), ack);
		assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).command.folderId, null);
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', selection });
		assert.deepEqual(await bind().selection(signal()), selection);
		response = Response.json({
			ok: true,
			ownerId: 'owner',
			dataPlane: plane,
			storagePlane: 'home',
			acknowledgment: { ...select, result: selection }
		});
		assert.deepEqual(await bind().select(select, signal()), { ...select, result: selection });
		assert.equal(JSON.parse(String(calls.at(-1)!.init.body)).operation, 'select');
		response = Response.json({
			ok: true,
			ownerId: 'owner',
			dataPlane: plane,
			storagePlane: 'home',
			acknowledgment: { ...select, writeId: 'wrong', result: selection }
		});
		await assert.rejects(bind().select(select, signal()), /acknowledgment changed/);
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', complete: false, algorithms: [] });
		await assert.rejects(bind().snapshot(signal()), /incomplete/);
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, complete: true, algorithms: [] });
		await assert.rejects(bind().snapshot(signal()), /storage confirmation/);
		response = new Response('private outage', { status: 503 });
		await assert.rejects(bind().snapshot(signal()), (error: any) => error.status === 503 && !error.message.includes('private outage'));
		response = new Response('x'.repeat(8 * 1024 * 1024 + 1));
		await assert.rejects(bind().snapshot(signal()), /cache limit/);
		response = Response.json({ ok: true, ownerId: 'other', dataPlane: plane, storagePlane: 'home', complete: true, algorithms: [] });
		await assert.rejects(bind().snapshot(signal()), /confirmation changed/);
		assert.ok(events.includes('thingtime:root-data-refresh'));
		response = Response.json({ ok: true, ownerId: 'owner', dataPlane: plane, storagePlane: 'home', complete: true, algorithms: [] });
		const transport = bind();
		after = () => bindLocalWorkspace(false, rootIdentity.read().generation, scope, false);
		await assert.rejects(transport.snapshot(signal()), /offline|confirmation changed/);
		assert.equal(calls.at(-1)!.init.signal!.aborted, true);
		after = undefined;
		const before = calls.length;
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(true, rootIdentity.read().generation);
		await assert.rejects(accountAlgorithmTransport(scope, { assertCurrent() {}, onInvalidate: () => () => {} }).snapshot(signal()));
		assert.equal(calls.length, before);
	} finally {
		Object.assign(globalThis, previous);
		rootIdentity.confirm(rootIdentity.read().generation);
		bindLocalWorkspace(true, rootIdentity.read().generation);
	}
});
