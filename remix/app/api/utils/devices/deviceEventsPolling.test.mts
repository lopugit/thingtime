import { createServer, request as httpRequest } from 'node:http';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const reads: any[] = [];
let events: any[] = [];
let onRead: (() => void) | undefined;
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => ({ id: 'owner' }) } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) } });
mock.module(new URL('./devices.ts', import.meta.url).href, { namedExports: {
	listDeviceEvents: async (...args: any[]) => { reads.push(args); onRead?.(); args[4].signal.throwIfAborted(); return { ok: true, events, nextCursor: 'cursor' }; }
} });
const { loader } = await import('../../../routes/api/v1/devices/events/_events');
test('closing an idle event request stops its wait without a second database read', async () => {
	reads.length = 0; events = [];
	const controller = new AbortController();
	const request = new Request('https://thingtime.test/api/v1/devices/events?deviceId=device&waitMs=20000', { signal: controller.signal });
	const pending = loader({ request });
	await new Promise(resolve => setTimeout(resolve, 10));
	controller.abort();
	await assert.rejects(pending, { name: 'AbortError' });
	assert.equal(reads.length, 1);
	assert.equal(reads[0][0], 'owner');
	assert.equal(reads[0][4].signal, request.signal);
	assert.ok(reads[0][4].deadlineAt <= Date.now() + 25_000);
});
test('available events retain the NDJSON hello, data and cursor response', async () => {
	events = [{ id: 'event-1', type: 'device.state' }];
	const response = await loader({ request: new Request('https://thingtime.test/api/v1/devices/events?deviceId=device') });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'no-store');
	const rows = (await response.text()).trim().split('\n').map(value => JSON.parse(value));
	assert.equal(rows[0].type, 'hello');
	assert.deepEqual(rows[1], events[0]);
	assert.deepEqual(rows[2], { type: 'cursor', cursor: 'cursor' });
});

test('real HTTP socket disconnect reaches the Nitro Node adapter signal and ends polling', { timeout: 3000 }, async () => {
	events = []; reads.length = 0;
	const require = createRequire(import.meta.url);
	// Resolve the exact adapter shipped with Nitro, including its transitive version.
	const adapter = require.resolve('srvx/node', { paths: [dirname(require.resolve('nitro/package.json'))] });
	const { toNodeHandler } = await import(pathToFileURL(adapter).href);
	let finished!: () => void;
	const done = new Promise<void>(resolve => { finished = resolve; });
	let serverRequest!: Request;
	const handler = toNodeHandler(async (request: Request) => {
		serverRequest = request;
		try { return await loader({ request }); }
		catch (error) { if (!request.signal.aborted) throw error; return new Response(null, { status: 499 }); }
		finally { finished(); }
	});
	const server = createServer((request, response) => { void Promise.resolve(handler(request, response)).catch(() => response.destroy()); });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	try {
		const address = server.address(); if (!address || typeof address === 'string') throw Error('Expected TCP listener');
		const read = new Promise<void>(resolve => { onRead = resolve; });
		const client = httpRequest({ hostname: '127.0.0.1', port: address.port, path: '/api/v1/devices/events?deviceId=device&waitMs=20000' });
		client.on('error', () => {}); client.end();
		await read; client.destroy(); await done;
		assert.equal(serverRequest.signal.aborted, true);
		assert.equal(reads.length, 1);
	} finally {
		onRead = undefined; server.closeAllConnections();
		await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
	}
});
