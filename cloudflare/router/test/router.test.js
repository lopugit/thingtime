import assert from 'node:assert/strict';
import test from 'node:test';

import router, { loadRouteTable, resetRouteTableCache, ROUTE_TABLE_KEY } from '../src/index.js';
import { DEFAULT_ROUTE_TABLE, resolveRoute, validateRouteTable, withTarget } from '../src/routeTable.js';

const kv = (value) => ({ get: async (key, type) => (key === ROUTE_TABLE_KEY && type === 'json' ? value : null) });

const withFetch = async (handler, run) => {
	const original = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (request) => {
		calls.push(request);
		return handler(request);
	};
	try {
		return await run(calls);
	} finally {
		globalThis.fetch = original;
	}
};

test('longest prefix wins and boundaries are respected', () => {
	const table = DEFAULT_ROUTE_TABLE;
	assert.deepEqual(resolveRoute(table, '/api/v1/things'), { group: 'things', target: 'vercel' });
	assert.deepEqual(resolveRoute(table, '/api/v1/things/pins'), { group: 'things', target: 'vercel' });
	assert.equal(resolveRoute(table, '/api/v1/thingsX').group, 'api');
	assert.equal(resolveRoute(table, '/api/v1/auth/me').group, 'auth');
	assert.equal(resolveRoute(table, '/api/root-data').group, 'rootData');
	assert.equal(resolveRoute(table, '/things').group, 'default');
});

test('stored tables are validated and malformed ones refused', () => {
	assert.equal(validateRouteTable(DEFAULT_ROUTE_TABLE).ok, true);
	assert.equal(validateRouteTable({ ...DEFAULT_ROUTE_TABLE, default: 'aws' }).ok, false);
	assert.equal(validateRouteTable({ ...DEFAULT_ROUTE_TABLE, version: 2 }).ok, false);
	assert.equal(validateRouteTable({ version: 1, default: 'vercel', groups: { x: { prefixes: ['api'], target: 'vercel' } } }).ok, false);
	assert.equal(validateRouteTable({ version: 1, default: 'vercel', groups: { x: { prefixes: ['/a?b'], target: 'vercel' } } }).ok, false);
	assert.equal(validateRouteTable([]).ok, false);
});

test('withTarget flips one group, the default, or everything', () => {
	const one = withTarget(DEFAULT_ROUTE_TABLE, 'things', 'worker');
	assert.equal(one.groups.things.target, 'worker');
	assert.equal(one.groups.auth.target, 'vercel');
	assert.equal(DEFAULT_ROUTE_TABLE.groups.things.target, 'vercel', 'the source table is not mutated');
	const all = withTarget(DEFAULT_ROUTE_TABLE, '*', 'worker');
	assert.equal(all.default, 'worker');
	assert.ok(Object.values(all.groups).every((group) => group.target === 'worker'));
	assert.throws(() => withTarget(DEFAULT_ROUTE_TABLE, 'nope', 'worker'), /Unknown group/);
	assert.throws(() => withTarget(DEFAULT_ROUTE_TABLE, 'things', 'aws'), /Target must be/);
});

test('an invalid or unreadable stored table falls back to the default', async () => {
	resetRouteTableCache();
	assert.equal((await loadRouteTable({ ROUTES: kv({ version: 9 }) })).source, 'default (stored table invalid)');
	resetRouteTableCache();
	assert.equal((await loadRouteTable({ ROUTES: { get: async () => { throw new Error('down'); } } })).source, 'default (KV unavailable)');
	resetRouteTableCache();
	assert.equal((await loadRouteTable({})).source, 'default');
	resetRouteTableCache();
});

test('health reports the active table without secrets', async () => {
	resetRouteTableCache();
	const response = await router.fetch(new Request('https://thingtime.com/__cf/health'), {
		ROUTER_VERSION: '1.0.0',
		ROUTES: kv(withTarget(DEFAULT_ROUTE_TABLE, 'things', 'worker'))
	});
	const body = await response.json();
	assert.equal(response.status, 200);
	assert.equal(body.table.source, 'kv');
	assert.equal(body.table.groups.things, 'worker');
	assert.equal(body.apiWorker, false);
	assert.equal(response.headers.get('cache-control'), 'no-store');
	resetRouteTableCache();
});

test('via paths route the inner path and pass it to Vercel unchanged', async () => {
	resetRouteTableCache();
	await withFetch(
		async () => new Response('teapot', { status: 418, headers: { 'x-origin': 'vercel' } }),
		async (calls) => {
			const response = await router.fetch(new Request('https://thingtime.com/__cf/via/api/v1/teapot?x=1'), {});
			assert.equal(response.status, 418);
			assert.equal(await response.text(), 'teapot');
			assert.equal(response.headers.get('x-thingtime-route'), 'api; vercel');
			assert.equal(response.headers.get('x-origin'), 'vercel');
			assert.equal(calls.length, 1);
			assert.equal(new URL(calls[0].url).pathname, '/api/v1/teapot');
			assert.equal(new URL(calls[0].url).search, '?x=1');
		}
	);
	resetRouteTableCache();
});

test('a worker route without an API Worker falls back to Vercel', async () => {
	resetRouteTableCache();
	await withFetch(
		async () => new Response('ok'),
		async (calls) => {
			const response = await router.fetch(new Request('https://thingtime.com/api/v1/things'), {
				ROUTES: kv(withTarget(DEFAULT_ROUTE_TABLE, 'things', 'worker'))
			});
			assert.equal(response.headers.get('x-thingtime-route'), 'things; vercel (worker unavailable)');
			assert.equal(calls.length, 1);
		}
	);
	resetRouteTableCache();
});

test('a worker route uses the API Worker binding when present', async () => {
	resetRouteTableCache();
	let workerCalls = 0;
	const env = {
		ROUTES: kv(withTarget(DEFAULT_ROUTE_TABLE, 'things', 'worker')),
		API_WORKER: { fetch: async () => { workerCalls++; return new Response('from worker'); } }
	};
	await withFetch(async () => new Response('from vercel'), async (calls) => {
		const response = await router.fetch(new Request('https://thingtime.com/api/v1/things'), env);
		assert.equal(await response.text(), 'from worker');
		assert.equal(response.headers.get('x-thingtime-route'), 'things; worker');
		assert.equal(workerCalls, 1);
		assert.equal(calls.length, 0);
	});
	resetRouteTableCache();
});

test('a router failure fails open to the origin', async () => {
	resetRouteTableCache();
	await withFetch(async () => new Response('origin'), async (calls) => {
		const env = { API_WORKER: { fetch: async () => { throw new Error('worker crashed'); } }, ROUTES: kv(withTarget(DEFAULT_ROUTE_TABLE, '*', 'worker')) };
		const response = await router.fetch(new Request('https://thingtime.com/api/v1/things'), env);
		assert.equal(await response.text(), 'origin');
		assert.equal(calls.length, 1);
	});
	resetRouteTableCache();
});

test('unknown test paths are 404 and never forwarded', async () => {
	await withFetch(async () => new Response('origin'), async (calls) => {
		const response = await router.fetch(new Request('https://thingtime.com/__cf/nope'), {});
		assert.equal(response.status, 404);
		assert.equal(calls.length, 0);
	});
});
