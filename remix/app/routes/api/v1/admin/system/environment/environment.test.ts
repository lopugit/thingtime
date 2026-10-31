import assert from 'node:assert/strict';
import test from 'node:test';
import { createSystemEnvironmentHandlers } from './_environment';
const origin = 'https://thingtime.example';
const request = (body = {}, originHeader = origin) =>
	new Request(`${origin}/api/v1/admin/system/environment`, {
		method: 'POST',
		headers: { Origin: originHeader, 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});

test('environment management checks admin before any store access and prevents cross-origin writes', async () => {
	for (const status of [401, 403]) {
		let reads = 0;
		const handlers = createSystemEnvironmentHandlers({
			requireAdmin: async () => ({ error: { status, message: 'Denied' } }),
			systemEnvironmentStore: async () => {
				reads++;
				return null;
			}
		} as any);
		const response = await handlers.loader({ request: new Request(origin) });
		assert.equal(response.status, status);
		assert.equal(reads, 0);
		assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
	}
	let reads = 0;
	const handlers = createSystemEnvironmentHandlers({
		requireAdmin: async () => ({ user: { id: 'admin' } }),
		systemEnvironmentStore: async () => {
			reads++;
			return null;
		}
	} as any);
	assert.equal((await handlers.action({ request: request({}, 'https://attacker.example') })).status, 403);
	assert.equal(reads, 0);
	assert.equal((await handlers.action({ request: request() })).status, 503);
});

test('successful mutation returns metadata and redeploy notice, never upstream payload', async () => {
	const handlers = createSystemEnvironmentHandlers({
		requireAdmin: async () => ({ user: { id: 'admin' } }),
		systemEnvironmentStore: async () => ({ mutate: async () => ({ value: 'must-not-leak' }), list: async () => [] })
	} as any);
	const response = await handlers.action({ request: request({ action: 'create', key: 'X', value: 'synthetic', target: 'preview' }) });
	assert.deepEqual(await response.json(), { ok: true, configured: true, entries: [], requiresRedeploy: true });
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});

test('oversized JSON preserves the private 413 response', async () => {
	const handlers = createSystemEnvironmentHandlers({
		requireAdmin: async () => ({ user: { id: 'admin' } }),
		systemEnvironmentStore: async () => ({ mutate: async () => assert.fail('must not mutate'), list: async () => [] })
	} as any);
	const response = await handlers.action({ request: request({ value: 'x'.repeat(41 * 1024) }) }).catch((error: unknown) => {
		if (error instanceof Response) return error;
		throw error;
	});
	assert.equal(response.status, 413);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
});
