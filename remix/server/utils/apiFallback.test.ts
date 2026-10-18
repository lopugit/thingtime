import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { H3, toNodeListener } from 'nitro/h3';

import { getApiFallbackOrigin, shouldProxyApiToFallback, proxyApiRequestToFallback } from './apiFallback';
import handleApi from '../routes/api/[...]';
import handleRootData from '../routes/api/root-data.get';
import { enforceExpectedDataPlane, mongoDataPlane } from '../../app/api/utils/mongodb/dataPlane';
import { getRequestMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';
import { enforceExpectedActor } from '../../app/api/utils/auth/expectedActor';
import { EXPECTED_DATA_PLANE_HEADER } from '../../app/utils/dataPlane';

const ENV_KEYS = ['JWT_PRIVATE_KEY', 'JWT_SECRET', 'MONGODB_CONNECTION_STRING', 'THINGTIME_API_FALLBACK_ORIGIN', 'THINGTIME_DESKTOP', 'NODE_ENV', 'MONGO_PASS'] as const;
const desktopManifest = (origin: string) => Response.json({ schemaVersion: 1, origin, features: {
  'api.passwords': { version: '1.2.1' }, 'api.mail': { version: '1.2.1' }, 'api.mail-sync': { version: '1.0.1' }
} });

const withFallbackEnv = async (fallbackOrigin: string | undefined, run: () => Promise<void> | void) => {
	const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	delete process.env.THINGTIME_DESKTOP;
	process.env.NODE_ENV = 'production';
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

test('fallback has no default and rejects malformed, credential-bearing and insecure targets', async () => {
  for (const target of [undefined, '', 'not a URL', 'thingtime.com', 'http://127.0.0.1:18280', 'http://example.com', 'https://user:secret@example.com']) {
    await withFallbackEnv(target, () => assert.equal(getApiFallbackOrigin(), null));
  }
  await withFallbackEnv('https://selected.test/path', () => assert.equal(getApiFallbackOrigin(), 'https://selected.test'));
});

test('incomplete local servers refuse every method, including registration, without network or body reads', async t => {
  const upstream = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected upstream request'); });
  try {
    for (const mode of ['production', 'development', 'test']) for (const target of [undefined, 'https://thingtime.com']) {
      await withFallbackEnv(target, async () => {
        process.env.NODE_ENV = mode;
        for (const path of ['v1/auth/register', 'v1/things', 'v1/admin/migrations/run']) for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
          const request = new Request(`http://127.0.0.1:17340/api/${path}`, { method, ...(method === 'GET' ? {} : { body: '{"password":"synthetic"}' }) });
          assert.equal(shouldProxyApiToFallback(request), false);
          const response = await (handleApi as any)({ req: request, context: { params: { path } } });
          assert.equal(response.status, 503);
          assert.equal((await response.json()).code, 'LOCAL_API_NOT_CONFIGURED');
          assert.equal(request.bodyUsed, false);
          assert.equal((await proxyApiRequestToFallback(request)).status, 503);
        }
        assert.equal((await (handleRootData as any)({ req: new Request('http://127.0.0.1:17340/api/root-data') })).status, 503);
      });
    }
    await withFallbackEnv('https://thingtime.com', async () => {
      process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:27017/test';
      const request = new Request('http://127.0.0.1:17340/api/v1/auth/register', { method: 'POST', body: '{}' });
      assert.equal((await (handleApi as any)({ req: request, context: { params: { path: 'v1/auth/register' } } })).status, 503);
      assert.equal(request.bodyUsed, false);
      process.env.NODE_ENV = 'test'; process.env.THINGTIME_DESKTOP = '1';
      assert.equal(shouldProxyApiToFallback(request), false);
    });
    assert.equal(upstream.mock.callCount(), 0);
  } finally { upstream.mock.restore(); }
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
		process.env.THINGTIME_DESKTOP = '1';
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
			assert.equal(refusedActor.status, 403); assert.equal(forwarded.length, count); assert.equal(actorRequest.bodyUsed, false);
		} finally { upstream.mock.restore(); }
	});
});

test('private account services refuse implicit fallback without reading secrets', async () => {
 await withFallbackEnv('https://thingtime.com', async () => {
  const prior = process.env.THINGTIME_DESKTOP; delete process.env.THINGTIME_DESKTOP;
  try {
   for (const path of ['v1/passwords', 'v1/mail', 'v1/mail/sync']) {
   const request = new Request(`http://127.0.0.1:17340/api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"entry":"synthetic-secret"}' });
   const response = await (handleApi as any)({ req: request, context: { params: { path } } });
   assert.equal(response.status, 503); assert.equal(request.bodyUsed, false);
   }
  } finally { if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});

test('desktop vault proxy requires the bundled origin and pinned HTTPS endpoint', async t => {
 await withFallbackEnv('https://selected.test', async () => {
  const prior = process.env.THINGTIME_DESKTOP; process.env.THINGTIME_DESKTOP = '1';
  let calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
   if (url.pathname === '/.well-known/thingtime-capabilities.json') return desktopManifest(url.origin);
   calls++; assert.equal(url.origin, 'https://selected.test');
   const headers = new Headers(init.headers); assert.equal(headers.get('origin'), 'https://selected.test'); assert.equal(headers.has('x-forwarded-host'), false);
   return Response.json({ ok: true });
  });
  try {
   for (const path of ['v1/passwords', 'v1/mail', 'v1/mail/sync']) for (const [origin, status] of [['https://attacker.test', 403], ['http://127.0.0.1:17340', 200]] as const) {
    const request = new Request(`http://127.0.0.1:17340/api/${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal((await (handleApi as any)({ req: request, context: { params: { path } } })).status, status);
   }
   assert.equal(calls, 3);
  } finally { mock.mock.restore(); if (prior === undefined) delete process.env.THINGTIME_DESKTOP; else process.env.THINGTIME_DESKTOP = prior; }
 });
});

test('desktop private services accept real Nitro requests without native Request cloning', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    const forwarded: { method: string; body: string }[] = [];
    const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
      assert.equal(url.origin, 'https://selected.test');
      if (url.pathname === '/.well-known/thingtime-capabilities.json') return desktopManifest(url.origin);
      const headers = new Headers(init.headers);
      assert.equal(headers.has('x-forwarded-host'), false);
      assert.equal(headers.has('x-forwarded-proto'), false);
      forwarded.push({ method: init.method!, body: init.body ? Buffer.from(init.body as ArrayBuffer).toString() : '' });
      return Response.json({ ok: true });
    });
    const app = new H3(); app.use(handleApi);
    const server = createServer(toNodeListener(app));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const path of ['passwords', 'mail', 'mail/sync']) for (const method of ['GET', 'POST']) {
        const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
          const request = httpRequest(`${origin}/api/v1/${path}`, {
            method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(method === 'GET' ? { 'X-Forwarded-Host': 'attacker.test', 'X-Forwarded-Proto': 'https' } : {}) }
          }, response => {
            let body = ''; response.on('data', chunk => { body += chunk; });
            response.on('end', () => resolve({ status: response.statusCode!, body }));
          });
          request.on('error', reject); request.end(method === 'POST' ? '{"operation":"catalog"}' : undefined);
        });
        assert.equal(result.status, 200, `${method} ${path}: ${result.body}`);
        assert.equal(forwarded.at(-1)?.method, method);
        assert.equal(forwarded.at(-1)?.body, method === 'POST' ? '{"operation":"catalog"}' : '');
      }
      assert.equal(forwarded.length, 6);
    } finally {
      upstream.mock.restore();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

test('desktop password search negotiates the selected server before forwarding private requests', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    for (const [version, origin, accepted] of [
      ['1.1.9', 'https://selected.test', false], ['1.2.0', 'https://selected.test', true],
      ['1.2.1', 'https://selected.test', true], ['2.0.0', 'https://selected.test', false],
      [undefined, 'https://selected.test', false], ['1.2.1', 'https://other.test', false]
    ] as const) {
      let forwarded = 0;
      const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
        if (url.pathname === '/.well-known/thingtime-capabilities.json') {
          assert.equal(url.origin, 'https://selected.test');
          assert.equal(new Headers(init.headers).has('cookie'), false);
          assert.equal(new Headers(init.headers).has('authorization'), false);
          assert.equal(init.body, undefined); assert.equal(init.redirect, 'error');
          return Response.json({ schemaVersion: 1, origin, features: { 'api.passwords': { version } } });
        }
        forwarded++; assert.equal(url.searchParams.get('q'), 'facebook');
        return Response.json({ ok: true });
      });
      try {
        const request = new Request('http://127.0.0.1:17340/api/v1/passwords?q=facebook', {
          method: 'POST', headers: { Origin: 'http://127.0.0.1:17340', Cookie: 'tt_auth=synthetic' }, body: '{"operation":"catalog"}'
        });
        const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/passwords' } } });
        assert.equal(response.status, accepted ? 200 : 503);
        assert.equal(forwarded, accepted ? 1 : 0);
        if (!accepted) {
          assert.equal(request.bodyUsed, false);
          assert.equal((await response.json()).code, 'API_CAPABILITY_INCOMPATIBLE');
        }
      } finally { upstream.mock.restore(); }
    }
  });
});


test('iOS release identities and migration bodies never follow an origin fallback', async () => {
  await withFallbackEnv('https://thingtime.com', async () => {
    const request = new Request('http://127.0.0.1:17340/api/v1/integrations/ios-release', { method: 'POST', headers: { Authorization: 'Bearer synthetic-identity', 'Content-Type': 'application/json' }, body: '{"operation":"migrate","credentials":"synthetic"}' });
    const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/integrations/ios-release' } } });
    assert.equal(response.status, 503);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    assert.equal(request.bodyUsed, false);
    assert.ok(!(await response.text()).includes('synthetic'));
  });
});

test('desktop browser Actions preserve actor preconditions and reject cross-origin or vault requests before forwarding', async t => {
 await withFallbackEnv('https://selected.test', async () => {
  process.env.THINGTIME_DESKTOP = '1';
  let writes = 0;
  const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
   const request = new Request(url, init);
   assert.equal(url.origin, 'https://selected.test');
   assert.equal(request.headers.get('x-forwarded-host'), null);
   assert.equal(request.headers.get('x-forwarded-proto'), null);
   assert.equal(request.headers.get(EXPECTED_DATA_PLANE_HEADER), 'home');
   const refusal = await enforceExpectedActor(request, async () => ({ id: 'owner' }));
   if (refusal) return refusal;
   writes++;
   return Response.json({ ok: true });
  });
  try {
   const base = { Origin: 'http://127.0.0.1:17340', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json', [EXPECTED_DATA_PLANE_HEADER]: 'home', 'x-forwarded-host': 'untrusted.test', 'x-forwarded-proto': 'https' };
   for (const actor of ['owner', 'changed-account']) {
    const request = new Request('http://127.0.0.1:17340/api/v1/things', { method: 'POST', headers: { ...base, 'X-Thingtime-Expected-Actor': actor }, body: '{}' });
    const response = await (handleApi as any)({ req: request, context: { params: { path: 'v1/things' } } });
    assert.equal(response.status, actor === 'owner' ? 200 : 409);
   }
   assert.equal(writes, 1);
   const count = upstream.mock.callCount();
   for (const [path, origin, site, status] of [
    ['v1/things', 'https://foreign.test', 'cross-site', 403],
    ['v1/things', 'https://foreign.test', 'same-origin', 403],
    ['v1/vault/reveal', base.Origin, 'same-origin', 503]
   ] as const) {
    const request = new Request(`http://127.0.0.1:17340/api/${path}`, { method: 'POST', headers: { ...base, Origin: origin, 'Sec-Fetch-Site': site, 'X-Thingtime-Expected-Actor': 'owner' }, body: '{}' });
    assert.equal((await (handleApi as any)({ req: request, context: { params: { path } } })).status, status);
    assert.equal(request.bodyUsed, false);
   }
   assert.equal(upstream.mock.callCount(), count);
  } finally { upstream.mock.restore(); }
 });
});


test('desktop browser Actions forward real Nitro request bodies without native Request cloning', async t => {
 await withFallbackEnv('https://selected.test', async () => {
  process.env.THINGTIME_DESKTOP = '1';
  const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
   assert.equal(url.origin, 'https://selected.test');
   const headers = new Headers(init.headers);
   assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner');
   assert.equal(headers.has('x-forwarded-host'), false);
   assert.equal(Buffer.from(init.body as ArrayBuffer).toString(), '{"kind":"script.run"}');
   return Response.json({ ok: true });
  });
  const app = new H3(); app.use(handleApi);
  const server = createServer(toNodeListener(app));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
   const status = await new Promise<number>((resolve, reject) => {
    const request = httpRequest(`${origin}/api/v1/devices/commands`, { method: 'POST', headers: {
     Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': 'owner', 'X-Forwarded-Host': 'foreign.test'
    } }, response => { response.resume(); response.on('end', () => resolve(response.statusCode!)); });
    request.on('error', reject); request.end('{"kind":"script.run"}');
   });
   assert.equal(status, 200); assert.equal(upstream.mock.callCount(), 1);
  } finally {
   upstream.mock.restore();
   await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
 });
});
