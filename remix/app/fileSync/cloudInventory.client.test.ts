import test from 'node:test';
import assert from 'node:assert/strict';
import { readCloudFolderInventory } from './cloudInventory.client';
const scope = { origin: 'https://example.test', ownerId: 'owner', dataPlane: 'home', deviceId: 'device', rootId: 'connection' };
const payload = { ok: true, inventory: { version: 1, complete: true, rootId: 'folder', rootRevision: 'version', nodes: [] } };
const input = (fetcher: typeof fetch) => ({
	currentScope: () => scope,
	origin: () => scope.origin,
	requireCapability: async () => {},
	fetch: fetcher
});
test('cloud inventory client negotiates capability and pins account, data plane, origin and root', async () => {
	const versions: string[] = [];
	const result = await readCloudFolderInventory(scope, 'folder', {
		...input(async (url, init) => {
			assert.equal(url, 'https://example.test/api/v1/files?rootId=folder');
			assert.equal(init?.credentials, 'include');
			assert.equal(init?.redirect, 'error');
			const headers = new Headers(init?.headers);
			assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner');
			assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
			return Response.json(payload);
		}),
		requireCapability: async (feature, version) => {
			versions.push(feature + ':' + version);
		}
	});
	assert.equal(result.complete, true);
	assert.ok(versions.includes('api.files:1.1.0'));
});
test('retired identities, foreign origins and unsupported data planes never dispatch', async () => {
	let calls = 0;
	const runtime = input(async () => {
		calls++;
		return Response.json(payload);
	});
	for (const patch of [{ ownerId: 'other' }, { dataPlane: 'custom-' + 'a'.repeat(64) }, { origin: 'https://foreign.test' }])
		await assert.rejects(readCloudFolderInventory({ ...scope, ...patch }, 'folder', runtime));
	let current = scope;
	await assert.rejects(
		readCloudFolderInventory(scope, 'folder', {
			...runtime,
			currentScope: () => current,
			requireCapability: async () => {
				current = { ...scope, ownerId: 'other' };
			}
		})
	);
	assert.equal(calls, 0);
});
test('transport errors, malformed or partial responses never return an empty scan', async () => {
	for (const response of [
		Response.json({ ok: false, error: 'denied' }, { status: 403 }),
		new Response('<html>Unavailable</html>'),
		Response.json({ ...payload, inventory: { ...payload.inventory, complete: false } }),
		Response.json({ ...payload, inventory: { ...payload.inventory, rootId: 'foreign' } })
	]) {
		await assert.rejects(
			readCloudFolderInventory(
				scope,
				'folder',
				input(async () => response)
			)
		);
	}
});
test('mid-stream account changes and oversized responses cancel the body reader', async () => {
	let current = scope,
		cancelled = false;
	let pulls = 0;
	await assert.rejects(
		readCloudFolderInventory(scope, 'folder', {
			...input(
				async () =>
					new Response(
						new ReadableStream<Uint8Array>({
							pull(controller) {
								controller.enqueue(new TextEncoder().encode('{'));
								if (++pulls > 1) current = { ...scope, deviceId: 'other' };
							},
							cancel() {
								cancelled = true;
							}
						})
					)
			),
			currentScope: () => current
		})
	);
	assert.equal(cancelled, true);
	cancelled = false;
	const huge = new ReadableStream<Uint8Array>({
		pull(controller) {
			controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1025));
		},
		cancel() {
			cancelled = true;
		}
	});
	await assert.rejects(
		readCloudFolderInventory(
			scope,
			'folder',
			input(async () => new Response(huge))
		),
		/size bound/
	);
	assert.equal(cancelled, true);
});
test('an already aborted inventory request does not dispatch', async () => {
	const controller = new AbortController();
	controller.abort();
	let calls = 0;
	await assert.rejects(
		readCloudFolderInventory(scope, 'folder', {
			...input(async () => {
				calls++;
				return Response.json(payload);
			}),
			signal: controller.signal
		})
	);
	assert.equal(calls, 0);
});
