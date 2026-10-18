import assert from 'node:assert/strict';
import test from 'node:test';

import { getApiFallbackOrigin, proxyApiRequestToFallback, shouldProxyApiToFallback } from './apiFallback';
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

test('password manager refuses implicit fallback without reading secrets', async () => {
 await withFallbackEnv('https://thingtime.com', async () => {
  const prior = process.env.THINGTIME_DESKTOP; delete process.env.THINGTIME_DESKTOP;
  try {
   const request = new Request('http://127.0.0.1:17340/api/v1/passwords', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"entry":"synthetic-secret"}' });
   const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/passwords' } } });
   assert.equal(response.status, 503); assert.equal(request.bodyUsed, false);
  } finally { if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});

test('desktop vault proxy requires the bundled origin and pinned HTTPS endpoint', async t => {
 await withFallbackEnv('https://selected.test', async () => {
  const prior = process.env.THINGTIME_DESKTOP; process.env.THINGTIME_DESKTOP = '1';
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
   calls++; assert.equal(url.origin, 'https://selected.test');
   const headers = new Headers(init.headers); assert.equal(headers.get('origin'), 'https://selected.test'); assert.equal(headers.has('x-forwarded-host'), false);
   return Response.json({ ok: true });
  });
  try {
   for (const [origin, status] of [['https://attacker.test', 403], ['http://127.0.0.1:17340', 200]] as const) {
    const request = new Request('http://127.0.0.1:17340/api/v1/passwords', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await (handleApi as any)({ req: request, context: { params: { path: 'v1/passwords' } } })).status, status);
   }
   assert.equal(calls, 1);
  } finally { mock.mock.restore(); if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});

test('desktop sync forwards only the explicit account/home/server-bound route family', async t => {
 await withFallbackEnv('https://sync.test', async () => {
  const prior = process.env.THINGTIME_DESKTOP; process.env.THINGTIME_DESKTOP = '1';
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
   calls++; assert.equal(url.origin, 'https://sync.test');
   const h = new Headers(init.headers);
   assert.equal(h.get('X-Thingtime-Expected-Actor'), 'owner'); assert.equal(h.get('X-Thingtime-Expected-Data-Plane'), 'home');
   assert.equal(h.get('X-Thingtime-Expected-Api-Origin'), 'https://sync.test');
   assert.equal(h.get('Origin'), 'https://sync.test'); assert.equal(h.has('x-forwarded-host'), false);
   return Response.json({ ok: true });
  });
  const headers = { Origin: 'http://127.0.0.1:17340', 'X-Thingtime-Expected-Actor': 'owner',
   'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Api-Origin': 'https://sync.test',
   'x-forwarded-host': 'untrusted.test' };
  try {
   for (const [path, method] of [['auth/me', 'GET'], ['things', 'PATCH'], ['files', 'POST'], ['attachments/uploads', 'POST'], ['attachments/content', 'GET'], ['attachments/content', 'POST']]) {
    const request = new Request('http://127.0.0.1:17340/api/v1/' + path, { method, headers, ...(method !== 'GET' ? { body: '{}' } : {}) });
    const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/' + path } } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('x-thingtime-api-fallback'), 'https://sync.test');
   }
   for (const path of ['things', 'attachments/content']) {
   for (const patch of [{ 'X-Thingtime-Expected-Api-Origin': 'https://old.test' }, { 'X-Thingtime-Expected-Actor': '' }, { 'X-Thingtime-Expected-Data-Plane': 'foreign' }, { Origin: 'https://foreign.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const request = new Request('http://127.0.0.1:17340/api/v1/' + path, { method: 'POST', headers: { ...headers, ...patch }, body: '{}' });
    assert.equal((await (handleApi as any)({ req: request, context: { params: { path: 'v1/' + path } } })).status, 503);
    assert.equal(request.bodyUsed, false);
   }
   }
   const request = new Request('http://127.0.0.1:17340/api/v1/actions/run', { method: 'POST', headers, body: '{}' });
   assert.equal((await (handleApi as any)({ req: request, context: { params: { path: 'v1/actions/run' } } })).status, 503);
   assert.equal(request.bodyUsed, false); assert.equal(calls, 6);
   delete process.env.THINGTIME_DESKTOP;
   const web = new Request('http://127.0.0.1:17340/api/v1/things', { method: 'POST', headers, body: '{}' });
   assert.equal((await (handleApi as any)({ req: web, context: { params: { path: 'v1/things' } } })).status, 503);
   assert.equal(calls, 6);
  } finally { mock.mock.restore(); if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});


test('a destination switch after admission is rejected before proxy body consumption', async t => {
 await withFallbackEnv('https://new.test', async () => {
  const mock = t.mock.method(globalThis, 'fetch', async () => { throw Error('Must not forward'); });
  try {
   const request = new Request('http://127.0.0.1:17340/api/v1/files', { method: 'POST', body: '{"private":"fixture"}',
    headers: { 'X-Thingtime-Expected-Api-Origin': 'https://old.test' } });
   const response = await proxyApiRequestToFallback(request);
   assert.equal(response.status, 409); assert.equal((await response.json()).code, 'API_ORIGIN_CHANGED');
   assert.equal(request.bodyUsed, false); assert.equal(mock.mock.callCount(), 0);
  } finally { mock.mock.restore(); }
 });
});


test('desktop proxy accepts framework request wrappers without cloning foreign private state', async t => {
 await withFallbackEnv('https://sync.test', async () => {
  const prior = process.env.THINGTIME_DESKTOP; process.env.THINGTIME_DESKTOP = '1';
  let calls = 0;
  const mocked = t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
   calls++; const headers = new Headers(init.headers);
   assert.equal(headers.has('x-forwarded-host'), false); assert.equal(headers.has('x-forwarded-proto'), false);
   assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner');
   if (init.method === 'POST') assert.equal(Buffer.from(init.body as ArrayBuffer).toString(), '{"value":"preserved"}');
   return Response.json({ ok: true });
  });
  try {
   for (const method of ['GET', 'POST']) {
    const original = new Request('http://127.0.0.1:17340/api/v1/files', { method, headers: {
     Origin: 'http://127.0.0.1:17340', 'X-Thingtime-Expected-Actor': 'owner', 'X-Thingtime-Expected-Data-Plane': 'home',
     'X-Thingtime-Expected-Api-Origin': 'https://sync.test', 'x-forwarded-host': 'untrusted.test', 'x-forwarded-proto': 'https'
    }, ...(method === 'POST' ? { body: '{"value":"preserved"}' } : {}) });
    // A framework wrapper exposes standard request fields/methods without the
    // private slots that Node's Request copy constructor expects on this object.
    const wrapped = Object.create(Request.prototype);
    for (const key of ['url', 'method', 'headers', 'body', 'bodyUsed', 'signal'] as const)
     Object.defineProperty(wrapped, key, { get: () => original[key] });
    wrapped.arrayBuffer = original.arrayBuffer.bind(original);
    assert.throws(() => new Request(wrapped));
    const response = await (handleApi as any)({ req: wrapped, context: { params: { path: 'v1/files' } } });
    assert.equal(response.status, 200); assert.equal(original.bodyUsed, method === 'POST');
   }
   assert.equal(calls, 2);
  } finally { mocked.mock.restore(); if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});
