import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiFallbackOrigin, shouldProxyApiToFallback } from './apiFallback';
import handleApi from '../routes/api/[...]';
import handleRootData from '../routes/api/root-data.get';
import { enforceExpectedDataPlane, mongoDataPlane } from '../../app/api/utils/mongodb/dataPlane';
import { getRequestMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';
import { EXPECTED_DATA_PLANE_HEADER } from '../../app/utils/dataPlane';

const ENV_KEYS = ['JWT_PRIVATE_KEY', 'JWT_SECRET', 'MONGODB_CONNECTION_STRING', 'THINGTIME_API_FALLBACK_ORIGIN'] as const;

const withFallbackEnv = async (fallbackOrigin: string | undefined, run: () => Promise<void> | void) => {
	const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	delete process.env.JWT_PRIVATE_KEY;
	delete process.env.JWT_SECRET;
	delete process.env.MONGODB_CONNECTION_STRING;
	if (fallbackOrigin === undefined) delete process.env.THINGTIME_API_FALLBACK_ORIGIN;
	else process.env.THINGTIME_API_FALLBACK_ORIGIN = fallbackOrigin;

	try {
		await run();
	} finally {
		for (const key of ENV_KEYS) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
};

test('API fallback defaults to production and accepts only HTTPS or loopback HTTP targets', async () => {
	await withFallbackEnv(undefined, () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
	await withFallbackEnv('https://pr-68.previews.dev.thingtime.com/path?ignored=true', () => {
		assert.equal(getApiFallbackOrigin(), 'https://pr-68.previews.dev.thingtime.com');
	});
	await withFallbackEnv('http://127.0.0.1:18280/', () => {
		assert.equal(getApiFallbackOrigin(), 'http://127.0.0.1:18280');
	});
	await withFallbackEnv('http://example.com/', () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
	await withFallbackEnv('https://user:secret@example.com/', () => {
		assert.equal(getApiFallbackOrigin(), 'https://thingtime.com');
	});
});

test('API fallback compares complete origins so two loopback ports do not bypass the proxy', async () => {
	await withFallbackEnv('http://127.0.0.1:18280/', () => {
		assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:59892/api/v1/devices')), true);
		assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:18280/api/v1/devices')), false);
	});
});

test('vault verification refuses fallback without reading or forwarding credentials', async () => {
	await withFallbackEnv('https://thingtime.com', async () => {
		const request = new Request('http://127.0.0.1:17340/api/v1/vault/reveal', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"synthetic"}' });
		const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/vault/reveal' } } });
		assert.equal(response.status, 503);
		assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
		assert.equal(request.bodyUsed, false);
		assert.ok(!(await response.text()).includes('synthetic'));
	});
});

test('fallback forwards the database identity, selection and cookie for upstream read/write enforcement', async (t) => {
	await withFallbackEnv('https://fallback.test', async () => {
		const location = 'mongodb://scope.test/example';
		const plane = mongoDataPlane({ url: location, savedId: null });
		const forwarded: Request[] = [];
		const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
			assert.equal(url.origin, 'https://fallback.test');
			const request = new Request(url, init); forwarded.push(request);
			assert.equal(request.headers.get('Cookie'), 'session=synthetic');
			assert.equal(request.headers.get('x-tt-mongo-url'), location);
			const selected = await getRequestMongoEndpoint(request);
			if (url.pathname === '/api/root-data') return Response.json({ dataPlane: mongoDataPlane(selected) });
			const refused = enforceExpectedDataPlane(request, selected);
			if (refused) return refused;
			if (request.method === 'PATCH') assert.deepEqual(await request.json(), { id: 'same-id', crystal: { name: 'Updated' } });
			return Response.json({ ok: true });
		});
		try {
			const headers = { Cookie: 'session=synthetic', 'x-tt-mongo-url': location };
			const root = await (handleRootData as any)({ req: new Request('http://127.0.0.1:17340/api/root-data', { headers }) });
			assert.equal((await root.json()).dataPlane, plane);
			for (const method of ['GET', 'PATCH']) for (const expected of [plane, 'home']) {
				const request = new Request('http://127.0.0.1:17340/api/v1/things?id=same-id', { method,
					headers: { ...headers, 'Content-Type': 'application/json', [EXPECTED_DATA_PLANE_HEADER]: expected },
					...(method === 'PATCH' ? { body: JSON.stringify({ id: 'same-id', crystal: { name: 'Updated' } }) } : {}) });
				const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/things' } } });
				assert.equal(forwarded.at(-1)?.headers.get(EXPECTED_DATA_PLANE_HEADER), expected);
				assert.equal(response.status, expected === plane ? 200 : 409);
				if (expected !== plane) assert.equal((await response.json()).code, 'DATA_PLANE_CHANGED');
			}
			const count = forwarded.length;
			const actorRequest = new Request('http://127.0.0.1:17340/api/v1/things', { method: 'POST', headers: { ...headers, 'X-Thingtime-Expected-Actor': 'synthetic-account', [EXPECTED_DATA_PLANE_HEADER]: plane }, body: '{}' });
			const refusedActor = await (handleApi as any)({ req: actorRequest, context: { params: { path: 'v1/things' } } });
			assert.equal(refusedActor.status, 503); assert.equal(forwarded.length, count); assert.equal(actorRequest.bodyUsed, false);
		} finally { upstream.mock.restore(); }
	});
});
