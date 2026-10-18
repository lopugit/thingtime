import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { H3, toNodeListener } from 'nitro/h3';

import { getApiFallbackOrigin, hasSelfHostedApiEnv, selectedRuntimeSupportsPlan, shouldProxyApiToFallback, proxyApiRequestToFallback } from './apiFallback';
import handleApi from '../routes/api/[...]';
import handleRootData from '../routes/api/root-data.get';
import { enforceExpectedDataPlane, mongoDataPlane } from '../../app/api/utils/mongodb/dataPlane';
import { getRequestMongoEndpoint } from '../../app/api/utils/mongodb/endpoint';
import { EXPECTED_DATA_PLANE_HEADER } from '../../app/utils/dataPlane';

const ENV_KEYS = ['JWT_PRIVATE_KEY', 'JWT_SECRET', 'MONGODB_CONNECTION_STRING', 'THINGTIME_API_FALLBACK_ORIGIN', 'THINGTIME_DESKTOP', 'THINGTIME_DESKTOP_API_MODE', 'NODE_ENV', 'MONGO_PASS'] as const;
const desktopManifest = (origin: string) => Response.json({ schemaVersion: 1, origin, features: {
  'api.passwords': { version: '1.2.1' }, 'api.mail': { version: '1.2.1' }, 'api.mail-sync': { version: '1.0.1' }, 'api.ai-chatgpt-plan': { version: '1.1.0' }
} });

const withFallbackEnv = async (fallbackOrigin: string | undefined, run: () => Promise<void> | void) => {
	const previous = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	delete process.env.THINGTIME_DESKTOP;
	delete process.env.THINGTIME_DESKTOP_API_MODE;
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
			assert.equal(refusedActor.status, 503); assert.equal(forwarded.length, count); assert.equal(actorRequest.bodyUsed, false);
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
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    const forwarded: { method: string; body: string }[] = [];
    const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
      assert.equal(url.origin, 'https://selected.test');
      if (url.pathname === '/.well-known/thingtime-capabilities.json') return desktopManifest(url.origin);
      const headers = new Headers(init.headers);
      assert.equal(headers.has('x-forwarded-host'), false);
      assert.equal(headers.has('x-forwarded-proto'), false);
      forwarded.push({ method: init.method!, body: init.body ? await new Response(init.body).text() : '' });
      return Response.json({ ok: true });
    });
    const app = new H3(); app.use(handleApi);
    const server = createServer(toNodeListener(app));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      for (const path of ['passwords', 'mail', 'mail/sync', 'ai/chatgpt-plan']) for (const method of ['GET', 'POST']) {
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
      assert.equal(forwarded.length, 8);
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

test('explicit local mode never falls through to a remote account backend', async () => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'local';
    const request = new Request('http://127.0.0.1:18731/api/v1/auth/register', { method: 'POST', body: '{}' });
    assert.equal(shouldProxyApiToFallback(request), false);
    assert.equal((await (handleApi as any)({ req: request, context: { params: { path: 'v1/auth/register' } } })).status, 503);
    assert.equal(request.bodyUsed, false);
  });
});

test('explicit remote mode cannot activate inherited local database credentials', async () => {
  await withFallbackEnv('https://selected.test', () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    process.env.MONGODB_CONNECTION_STRING = 'mongodb://127.0.0.1:18732/local';
    process.env.JWT_SECRET = 'synthetic';
    assert.equal(hasSelfHostedApiEnv(), false);
    assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:18731/api/root-data')), true);
    assert.equal(shouldProxyApiToFallback(new Request('https://unrelated.test/api/root-data')), false);
  });
});

test('explicit selected runtime supports loopback and refuses cleartext remote targets', async () => {
  await withFallbackEnv('http://127.0.0.1:18733', () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    assert.equal(getApiFallbackOrigin(), 'http://127.0.0.1:18733');
    assert.equal(shouldProxyApiToFallback(new Request('http://127.0.0.1:18731/api/root-data')), true);
    process.env.THINGTIME_API_FALLBACK_ORIGIN = 'http://remote.test';
    assert.equal(getApiFallbackOrigin(), null);
  });
});

test('plan management only forwards to an explicitly selected runtime with same-origin mutation checks', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    let calls = 0;
    const upstream = t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
      if (url.pathname === '/.well-known/thingtime-capabilities.json') {
        assert.equal(new Headers(init.headers).has('cookie'), false);
        return Response.json({ schemaVersion: 1, origin: url.origin, features: { 'api.ai-chatgpt-plan': { version: '1.1.0' } } });
      }
      calls++;
      assert.equal(url.origin, 'https://selected.test');
      const headers = new Headers(init.headers);
      assert.equal(headers.get('origin'), 'https://selected.test');
      assert.equal(headers.has('x-forwarded-host'), false);
      assert.equal(headers.get('X-Thingtime-Expected-User'), 'synthetic-owner');
      return Response.json({ ok: true, available: true, accounts: [], attempts: [] });
    });
    try {
      const request = (origin: string) => new Request('http://127.0.0.1:18731/api/v1/ai/chatgpt-plan', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-User': 'synthetic-owner', 'x-forwarded-host': 'attacker.test' }, body: '{"action":"prepare-import"}'
      });
      const handle = (req: Request) => (handleApi as any)({ req, context: { params: { path: 'v1/ai/chatgpt-plan' } } });
      assert.equal((await handle(request('http://127.0.0.1:18731'))).status, 503);
      process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
      assert.equal((await handle(request('https://attacker.test'))).status, 403);
      assert.equal((await handle(request('http://127.0.0.1:18731'))).status, 200);
      assert.equal(calls, 1);
    } finally { upstream.mock.restore(); }
  });
});

test('selected ChatGPT runtime negotiation rejects wrong origins and missing/breaking contracts', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    let manifest: any;
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(manifest));
    try {
      for (const [origin, version, expected] of [
        ['https://selected.test', '1.1.0', true], ['https://selected.test', '1.2.0', true],
        ['https://selected.test', '1.0.0', false], ['https://selected.test', '2.0.0', false],
        ['https://other.test', '1.1.0', false], ['https://selected.test', '', false]
      ] as const) {
        manifest = { schemaVersion: 1, origin, features: { 'api.ai-chatgpt-plan': { version } } };
        assert.equal(await selectedRuntimeSupportsPlan(), expected);
      }
    } finally { mock.mock.restore(); }
  });
});

test('a delayed plan manifest cannot authorize a newly selected endpoint or consume the handoff', async t => {
  await withFallbackEnv('https://first.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    let release!: () => void;
    let started!: () => void;
    const manifestStarted = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const calls: string[] = [];
    const mock = t.mock.method(globalThis, 'fetch', async (url: URL) => {
      calls.push(url.toString()); started(); await gate;
      return Response.json({ schemaVersion: 1, origin: 'https://first.test', features: { 'api.ai-chatgpt-plan': { version: '1.1.0' } } });
    });
    const request = new Request('http://127.0.0.1:18731/api/v1/ai/chatgpt-plan', {
      method: 'POST', headers: { Origin: 'http://127.0.0.1:18731', 'Content-Type': 'application/json' }, body: '{"action":"import","encrypted":"synthetic"}'
    });
    try {
      const pending = (handleApi as any)({ req: request, context: { params: { path: 'v1/ai/chatgpt-plan' } } });
      await manifestStarted;
      process.env.THINGTIME_API_FALLBACK_ORIGIN = 'https://second.test';
      release();
      const response = await pending;
      assert.equal(response.status, 409);
      assert.equal(request.bodyUsed, false);
      assert.deepEqual(calls, ['https://first.test/.well-known/thingtime-capabilities.json']);
      const direct = await proxyApiRequestToFallback(request, 'https://first.test');
      assert.equal(direct.status, 409);
      assert.equal(request.bodyUsed, false);
      assert.equal(calls.length, 1);
    } finally { release(); mock.mock.restore(); }
  });
});

test('desktop proxy streams uploads and replies without waiting for completion, and downstream cancel reaches upstream', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    process.env.THINGTIME_DESKTOP_API_MODE = 'remote';
    let cancelled = false;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"First"}\n')); },
      cancel() { cancelled = true; }
    });
    const upload = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('partial upload')); } });
    const request = new Request('http://127.0.0.1:18731/api/v1/lopu/chats/reply', { method: 'POST', body: upload, duplex: 'half' } as any);
    const mock = t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => {
      assert.equal(init.body, request.body);
      assert.equal(init.signal, request.signal);
      return new Response(upstreamBody, { headers: { 'content-type': 'application/x-ndjson' } });
    });
    try {
      const response = await proxyApiRequestToFallback(request);
      assert.equal(response.headers.get('content-type'), 'application/x-ndjson');
      const reader = response.body!.getReader();
      const chunk = await reader.read();
      assert.equal(new TextDecoder().decode(chunk.value), '{"type":"delta","text":"First"}\n');
      assert.equal(chunk.done, false);
      await reader.cancel();
      assert.equal(cancelled, true);
    } finally { await request.body?.cancel(); mock.mock.restore(); }
  });
});

test('desktop proxy propagates request cancellation without logging or echoing fetch errors', async t => {
  await withFallbackEnv('https://selected.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const logs: unknown[] = [];
    const log = t.mock.method(console, 'error', (...args: unknown[]) => { logs.push(args); });
    const mock = t.mock.method(globalThis, 'fetch', async (_url: URL, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('synthetic-private-fetch-error')), { once: true });
      started();
    }));
    try {
      const pending = proxyApiRequestToFallback(new Request('http://127.0.0.1:18731/api/v1/lopu/chats/reply', { method: 'POST', body: '{}', signal: controller.signal }));
      const rejected = assert.rejects(pending, { name: 'AbortError', message: 'Desktop API request cancelled.' });
      await ready; controller.abort(); await rejected;
      assert.equal(logs.length, 0);
    } finally { mock.mock.restore(); log.mock.restore(); }
  });
});

test('desktop proxy discards a response and its cookies if the selected endpoint changed while awaiting headers', async t => {
  await withFallbackEnv('https://first.test', async () => {
    process.env.THINGTIME_DESKTOP = '1';
    let cancelled = false;
    const mock = t.mock.method(globalThis, 'fetch', async (url: URL) => {
      assert.equal(url.origin, 'https://first.test');
      process.env.THINGTIME_API_FALLBACK_ORIGIN = 'https://second.test';
      return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Set-Cookie': 'tt_auth=synthetic-old-session' } });
    });
    try {
      const response = await proxyApiRequestToFallback(new Request('http://127.0.0.1:18731/api/v1/auth/me'));
      assert.equal(response.status, 409);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(cancelled, true);
    } finally { mock.mock.restore(); }
  });
});
