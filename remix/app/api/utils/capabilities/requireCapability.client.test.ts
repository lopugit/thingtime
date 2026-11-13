import { createLibraryArchiveReadChecker } from '~/utils/libraryArchiveCapabilities.client';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { afterEach, beforeEach, test } from 'node:test';
import { createThingtimeCapabilityChecker } from './requireCapability.client';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';
import { canKeepThingAfterReadFailure } from '../../../components/Things/thingDetailSectionsCore';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin: 'https://thingtime.test' } }
  });
});
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

const manifest = (version = '1.1.0') => ({
  schemaVersion: 1,
  origin: 'https://thingtime.test',
  features: { 'api.lopu-reminders': { version } }
});

test('capability checks bypass HTTP cache but coalesce successful requests', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, THINGTIME_CAPABILITY_MANIFEST_PATH);
    assert.equal(options?.cache, 'no-store');
    assert.equal(options?.credentials, 'same-origin');
    assert.deepEqual(options?.headers, { Accept: 'application/json' });
    assert.ok(options?.signal instanceof AbortSignal);
    return Response.json(manifest());
  });
  const check = createThingtimeCapabilityChecker();
  await Promise.all([check('api.lopu-reminders', '1.1.0'), check('api.lopu-reminders', '1.0.0')]);
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 1);
});

test('incompatible cached contracts fail closed and retry against the deployed manifest', async (t) => {
  let body: unknown = manifest('1.0.0');
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(body));
  const check = createThingtimeCapabilityChecker();
  for (const invalid of [
    manifest('1.0.0'), manifest('2.0.0'), { ...manifest(), schemaVersion: 2 },
    { ...manifest(), origin: 'https://another.test' }, { ...manifest(), features: {} }, null
  ]) {
    body = invalid;
    await assert.rejects(check('api.lopu-reminders', '1.1.0'), /incompatible/);
  }
  body = manifest('1.1.1');
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 7);
});

test('network, HTTP and malformed JSON failures do not poison later retries', async (t) => {
  const responses = [
    () => { throw new TypeError('Network unavailable'); },
    () => new Response(null, { status: 503 }),
    () => new Response('{'),
    () => Response.json(manifest())
  ];
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => responses.shift()!());
  const check = createThingtimeCapabilityChecker();
  for (let index = 0; index < 3; index++) await assert.rejects(check('api.lopu-reminders', '1.1.0'));
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 4);
});

test('timed out negotiation is bounded and can be retried', async (t) => {
  const controllers: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    assert.equal(milliseconds, 20_000);
    const controller = new AbortController();
    controllers.push(controller);
    return controller.signal;
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, options) => {
    return new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true });
    });
  });
  const check = createThingtimeCapabilityChecker();
  const rejected = assert.rejects(check('api.lopu-reminders', '1.1.0'), /timed out/);
  controllers[0].abort(new DOMException('Connection check timed out', 'TimeoutError'));
  await rejected;
  fetchMock.mock.mockImplementation(async (_url, options) => {
    assert.equal(options?.signal?.aborted, false);
    return Response.json(manifest());
  });
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 2);
  assert.equal(controllers.length, 2);
});

test('archive clients reject missing, older and breaking contracts but accept compatible versions', async (t) => {
 for (const [feature, minimum] of [['api.lopu-chats', '1.4.0'], ['api.lopu-chats-update', '1.3.0']]) {
  for (const version of [undefined, '1.2.0', '2.0.0', minimum, '1.9.1']) {
   const mock = t.mock.method(globalThis, 'fetch', async () => Response.json({ schemaVersion: 1, origin: 'https://thingtime.test', features: version ? { [feature]: { version } } : {} }));
   const check = createThingtimeCapabilityChecker();
   if (version === minimum || version === '1.9.1') await check(feature, minimum);
   else await assert.rejects(check(feature, minimum));
   mock.mock.restore();
  }
 }
});


test('owned-plan clients negotiate each new operation and reject pre-admission or breaking origins', async (t) => {
  for (const [feature, minimum, old] of [
    ['api.ai-models', '1.8.0', '1.7.0'], ['api.lopu-chats', '1.7.0', '1.6.0'],
    ['api.lopu-chats-update', '1.6.0', '1.5.0'], ['api.lopu-chats-reply', '1.21.0', '1.20.0'],
    ['api.lopu-chats-reply', '1.23.1', '1.23.0'], ['api.lopu-chats-reply', '1.23.2', '1.23.1']
  ]) {
    for (const version of [undefined, old, '2.0.0', minimum, '1.99.0']) {
      const response = t.mock.method(globalThis, 'fetch', async () => Response.json({ schemaVersion: 1, origin: 'https://thingtime.test', features: version ? { [feature]: { version } } : {} }));
      const check = createThingtimeCapabilityChecker();
      if (version === minimum || version === '1.99.0') await check(feature, minimum);
      else await assert.rejects(check(feature, minimum));
      response.mock.restore();
    }
  }
});


test('theme saves refuse stale manifests then retry compatible focus-setting support', async (t) => {
  const { THEME_CAPABILITY_REQUIREMENTS } = await import('../../../theme/capabilities');
  let version = '1.1.0';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ schemaVersion: 1, origin: 'https://thingtime.test', features: { 'api.themes': { version } } }));
  const check = createThingtimeCapabilityChecker();
  await assert.rejects(check('api.themes', THEME_CAPABILITY_REQUIREMENTS['api.themes']), /incompatible/);
  version = '1.2.1';
  await check('api.themes', THEME_CAPABILITY_REQUIREMENTS['api.themes']);
});

test('selected-origin changes fetch a new manifest and late old reads cannot evict it', async (t) => {
  let releaseOld!: (value: Response) => void;
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls++;
    if (calls === 1) return new Promise<Response>(resolve => { releaseOld = resolve; });
    return Response.json({ ...manifest(), origin: 'https://selected.test' });
  });
  const check = createThingtimeCapabilityChecker();
  const old = check('api.lopu-reminders', '1.1.0');
  await check('api.lopu-reminders', '1.1.0', 'https://selected.test');
  releaseOld(Response.json({ ...manifest(), origin: 'https://wrong.test' }));
  await assert.rejects(old, /incompatible/);
  await check('api.lopu-reminders', '1.1.0', 'https://selected.test');
  assert.equal(calls, 2);
});


test('native scoped discovery reaches the selected HTTP API, never the bundled UI manifest', async (t) => {
  const nativeFetch = globalThis.fetch;
  let bundledRequests = 0, selectedRequests = 0;
  const start = async (server: Server) => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
    return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  };
  let selectedOrigin = '';
  const selected = createServer((request, response) => {
    assert.equal(request.url, THINGTIME_CAPABILITY_MANIFEST_PATH); selectedRequests++;
    assert.equal(request.headers.cookie, undefined, 'Public discovery must not receive account cookies');
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ...manifest(), origin: selectedOrigin }));
  });
  selectedOrigin = await start(selected);
  let uiOrigin = '';
  uiOrigin = await start(createServer((_request, response) => {
    bundledRequests++; response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ...manifest(), origin: uiOrigin }));
  }));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: uiOrigin } } });
  const destinations: string[] = [];
  const browserFetch: typeof fetch = async (target, init) => {
    const url = new URL(String(target), uiOrigin); destinations.push(url.href);
    return nativeFetch(url, init);
  };
  t.mock.method(globalThis, 'fetch', browserFetch);
  let active = true;
  const host = createFolderHostFetch({ origin: selectedOrigin, localOrigin: uiOrigin, ownerId: 'synthetic-owner',
    signal: new AbortController().signal, check: () => { if (!active) throw Error('Account changed'); }, fetch: browserFetch });
  const transport = { fetch: host, currentOrigin: () => { if (!active) throw Error('Account changed'); return selectedOrigin; } };
  const check = createThingtimeCapabilityChecker();
  await check('api.lopu-reminders', '1.1.0', selectedOrigin, transport);
  await check('api.lopu-reminders', '1.1.0', selectedOrigin, transport);
  assert.equal(selectedRequests, 1); assert.equal(bundledRequests, 0);
  assert.deepEqual(destinations, [selectedOrigin + THINGTIME_CAPABILITY_MANIFEST_PATH]);
  active = false;
  await assert.rejects(check('api.lopu-reminders', '1.1.0', selectedOrigin, transport), /Account changed/);
  assert.equal(selectedRequests, 1, 'A stale scope must be rejected even on a cached manifest');
  // Explicit-origin callers without a native adapter also reach that public
  // origin, rather than comparing a local bundle manifest with a foreign one.
  await createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0', selectedOrigin);
  assert.equal(selectedRequests, 2); assert.equal(bundledRequests, 0);
});

test('scoped discovery combines caller cancellation with its deadline and permits a fresh retry', async (t) => {
  let requested!: () => void;
  const received = new Promise<void>(resolve => { requested = resolve; });
  let calls = 0;
  const caller = new AbortController();
  const transport = {
    currentOrigin: () => 'https://selected.test',
    signal: caller.signal,
    fetch: (async (target, init) => {
      assert.equal(String(target), 'https://selected.test' + THINGTIME_CAPABILITY_MANIFEST_PATH);
      assert.equal(init?.credentials, 'omit'); assert.equal(init?.redirect, 'error');
      calls++;
      if (calls > 1) return Response.json({ ...manifest(), origin: 'https://selected.test' });
      requested();
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }) as typeof fetch
  };
  const check = createThingtimeCapabilityChecker();
  const interrupted = assert.rejects(check('api.lopu-reminders', '1.1.0', 'https://selected.test', transport), /abort/i);
  await received; caller.abort(); await interrupted;
  await check('api.lopu-reminders', '1.1.0', 'https://selected.test', { ...transport, signal: undefined });
  assert.equal(calls, 2);
});


test("an immediate remount never inherits the previous caller's aborted discovery", async () => {
  let calls = 0;
  const cancelled = new AbortController();
  const transport = {
    currentOrigin: () => 'https://selected.test',
    fetch: (async (_target, init) => {
      calls++;
      if (calls > 1) return Response.json({ ...manifest(), origin: 'https://selected.test' });
      return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }));
    }) as typeof fetch
  };
  const check = createThingtimeCapabilityChecker();
  const old = assert.rejects(check('api.lopu-reminders', '1.1.0', 'https://selected.test', { ...transport, signal: cancelled.signal }), /abort/i);
  cancelled.abort();
  // Deliberately do not await the aborted promise: React can remount first.
  await check('api.lopu-reminders', '1.1.0', 'https://selected.test', transport);
  await old;
  await check('api.lopu-reminders', '1.1.0', 'https://selected.test', transport);
  assert.equal(calls, 2, 'Late old failure must preserve the successful remount cache');
});

test('discovery read failures retain readable projections only for transient transport/HTTP failures', async (t) => {
  for (const status of [408, 429, 500, 503, 401, 403, 404]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status }));
    await assert.rejects(createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0'), error => {
      assert.equal(canKeepThingAfterReadFailure(error), status === 408 || status === 429 || status >= 500);
      return true;
    });
    fetchMock.mock.restore();
  }
  const offline = t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('Network unavailable'); });
  await assert.rejects(createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0'), error => {
    assert.equal(canKeepThingAfterReadFailure(error), true);
    return true;
  });
  offline.mock.restore();
  for (const body of [null, manifest('0.1.0'), { ...manifest(), origin: 'https://wrong-origin.test' }, { ...manifest(), features: {} }]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(body));
    await assert.rejects(createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0'), error => {
      assert.equal(canKeepThingAfterReadFailure(error), false);
      return true;
    });
    fetchMock.mock.restore();
  }
  const malformed = t.mock.method(globalThis, 'fetch', async () => new Response('{'));
  await assert.rejects(createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0'), error => {
    assert.equal(canKeepThingAfterReadFailure(error), false);
    return true;
  });
  malformed.mock.restore();
});

test('manifest body transport remains transient while malformed complete bodies do not', async (t) => {
  for (const failure of [new TypeError('Connection terminated'), new DOMException('Connection check timed out', 'TimeoutError')]) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); controller.error(failure); } })));
    await assert.rejects(createThingtimeCapabilityChecker()('api.lopu-reminders', '1.1.0'), error => {
      assert.equal(canKeepThingAfterReadFailure(error), true);
      return true;
    });
    fetchMock.mock.restore();
  }
});


test('active API capability source refuses an older proxy despite a newer frontend manifest', async t => {
  let current = '2.2.0';
  const calls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/v1/capabilities')) {
      assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store');
      return Response.json({ ok: true, schemaVersion: 1, features: { 'api.connections': current },
        dataEnvironment: { authorityOrigin: 'https://must-not-be-followed.example' } });
    }
    return Response.json({ schemaVersion: 1, origin: 'https://thingtime.test', features: { 'api.connections': { version: '2.3.0' } } });
  });
  const frontend = createThingtimeCapabilityChecker();
  const active = createThingtimeCapabilityChecker({ source: 'active-api' });
  await frontend('api.connections', '2.3.0');
  await assert.rejects(active('api.connections', '2.3.0'), /incompatible/);
  current = '2.3.1'; await active('api.connections', '2.3.0');
  assert.ok(calls.every(url => url === THINGTIME_CAPABILITY_MANIFEST_PATH || url === 'https://thingtime.test/api/v1/capabilities'));
});

test('active API source keeps explicit origin, schema and response endpoint fences', async t => {
  let body: unknown = null, responseUrl = '';
  t.mock.method(globalThis, 'fetch', async () => { const response = Response.json(body); if (responseUrl) Object.defineProperty(response, 'url', { value: responseUrl }); return response; });
  const active = createThingtimeCapabilityChecker({ source: 'active-api' });
  for (const invalid of [null, { ok: true, schemaVersion: 2, features: {} },
    { ok: true, schemaVersion: 1, origin: 'https://foreign.test', features: { 'api.connections': '2.3.0' } },
    { ok: true, schemaVersion: 1, features: [] }, { ok: false, schemaVersion: 1, features: { 'api.connections': '2.3.0' } }]) {
    body = invalid; await assert.rejects(active('api.connections', '2.3.0'), /incompatible/);
  }
  body = { ok: true, schemaVersion: 1, origin: 'https://thingtime.test', features: { 'api.connections': '2.3.0' } };
  await active('api.connections', '2.3.0');
  for (const url of ['https://foreign.test/api/v1/capabilities', 'https://thingtime.test/other']) {
    responseUrl = url;
    await assert.rejects(createThingtimeCapabilityChecker({ source: 'active-api' })('api.connections', '2.3.0'), /changed origin or endpoint/);
  }
});


test('Archive read gate rejects a 1.62 active API behind a 1.63 frontend and retries after rollout', async () => {
  const origin = 'https://thingtime.test';
  let activeVersion: string | undefined = '1.62.0';
  const calls: string[] = [];
  const fetcher = (async (url: string) => {
    const path = new URL(url, origin).pathname;
    calls.push(path);
    return Response.json(path === '/api/v1/capabilities'
      ? { ok: true, schemaVersion: 1, features: activeVersion ? { 'api.things': activeVersion } : {} }
      : { schemaVersion: 1, origin, features: { 'api.things': { version: '1.63.0' } } });
  }) as typeof fetch;
  const check = createLibraryArchiveReadChecker(createThingtimeCapabilityChecker(), createThingtimeCapabilityChecker({ source: 'active-api' }));
  const transport = { fetch: fetcher, currentOrigin: () => origin };
  let queries = 0;
  const query = async () => { await check(origin, transport); queries++; };
  for (const version of ['1.62.0', undefined, '2.0.0']) {
    activeVersion = version;
    await assert.rejects(query(), /api.things is incompatible/);
    assert.equal(queries, 0, 'an incompatible active API cannot reach the library query');
  }
  assert.deepEqual(new Set(calls), new Set(['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']));
  activeVersion = '1.63.0';
  await query();
  assert.equal(queries, 1);
});

test('a completed manifest outlives its request deadline and has a deliberate freshness bound', async t => {
  let time = 1;
  const deadlines: AbortController[] = [];
  t.mock.method(AbortSignal, 'timeout', () => {
    const controller = new AbortController(); deadlines.push(controller); return controller.signal;
  });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => Response.json(manifest()));
  const check = createThingtimeCapabilityChecker({ now: () => time });
  await check('api.lopu-reminders', '1.1.0');
  deadlines[0].abort(new DOMException('Old request timed out', 'TimeoutError'));
  time += 30_000;
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 1, 'An expired request deadline cannot evict its completed value');
  time += 30_000;
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(fetchMock.mock.callCount(), 2, 'Public capabilities cannot remain cached indefinitely');
});

test('expired public manifests single-flight conditional revalidation and detect rollout changes', async t => {
  let time = 1, calls = 0, etag = '"before"';
  const fetchMock = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    assert.equal(init?.cache, 'no-store');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('If-None-Match'), calls === 1 ? null : '"before"');
    if (calls === 2) return new Response(null, { status: 304 });
    return Response.json(manifest(calls === 1 ? '1.1.0' : '2.0.0'), { headers: { ETag: etag } });
  });
  const check = createThingtimeCapabilityChecker({ now: () => time });
  await check('api.lopu-reminders', '1.1.0');
  time += 60_000;
  await Promise.all(Array.from({ length: 12 }, () => check('api.lopu-reminders', '1.1.0')));
  assert.equal(fetchMock.mock.callCount(), 2);
  time += 60_000; etag = '"after"';
  await assert.rejects(check('api.lopu-reminders', '1.1.0'), /incompatible/);
});

test('conditional validators never cross selected origins and unsolicited 304 fails closed', async t => {
  let time = 1, calls = 0;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    assert.equal(new Headers(init?.headers).has('If-None-Match'), false);
    return calls === 1 ? Response.json(manifest(), { headers: { ETag: '"first-origin"' } }) : new Response(null, { status: 304 });
  });
  const check = createThingtimeCapabilityChecker({ now: () => time });
  await check('api.lopu-reminders', '1.1.0');
  time += 60_000;
  await assert.rejects(check('api.lopu-reminders', '1.1.0', 'https://selected.test'), /unavailable/);
});

test('failed revalidation cannot reuse stale compatibility and an explicit retry fetches again', async t => {
  let time = 1, calls = 0;
  const mock = t.mock.method(globalThis, 'fetch', async (_url, init) => {
    calls++;
    if (calls === 2) throw new TypeError('Network unavailable');
    assert.equal(new Headers(init?.headers).has('If-None-Match'), false);
    return Response.json(manifest(), { headers: { ETag: '"valid"' } });
  });
  const check = createThingtimeCapabilityChecker({ now: () => time });
  await check('api.lopu-reminders', '1.1.0');
  time += 60_000;
  await assert.rejects(check('api.lopu-reminders', '1.1.0'), /Network unavailable/);
  await check('api.lopu-reminders', '1.1.0');
  assert.equal(mock.mock.callCount(), 3);
});


test('a completed scoped result survives later caller cancellation without relaxing the scope fence', async () => {
  const caller = new AbortController();
  let calls = 0;
  const transport = {
    currentOrigin: () => 'https://thingtime.test',
    fetch: (async () => { calls++; return Response.json(manifest()); }) as typeof fetch
  };
  const check = createThingtimeCapabilityChecker();
  await check('api.lopu-reminders', '1.1.0', 'https://thingtime.test', { ...transport, signal: caller.signal });
  caller.abort();
  await assert.rejects(check('api.lopu-reminders', '1.1.0', 'https://thingtime.test', { ...transport, signal: caller.signal }), /abort/i);
  await check('api.lopu-reminders', '1.1.0', 'https://thingtime.test', transport);
  assert.equal(calls, 1);
  await assert.rejects(check('api.lopu-reminders', '1.1.0', 'https://thingtime.test', {
    ...transport, currentOrigin: () => 'https://different.test'
  }), /selected API server changed/);
  assert.equal(calls, 1);
});


test('same-origin active API discovery retains platform cookies while foreign and scoped transports omit credentials', async t => {
  for (const [expectedOrigin, customTransport, credentials] of [
    ['https://thingtime.test', false, 'same-origin'],
    ['https://selected.test', false, 'omit'],
    ['https://thingtime.test', true, 'omit'],
    ['https://selected.test', true, 'omit']
  ] as const) {
    const fetchMock = t.mock.method(globalThis, 'fetch', async (url, init) => {
      assert.equal(String(url), expectedOrigin + '/api/v1/capabilities');
      assert.equal(init?.credentials, credentials);
      assert.equal(init?.redirect, 'error');
      assert.equal(new Headers(init?.headers).has('x-vercel-protection-bypass'), false, 'A project secret must never be needed in browser discovery');
      return Response.json({ ok: true, schemaVersion: 1, features: { 'api.connections': '2.3.0' } });
    });
    const transport = customTransport ? { fetch: globalThis.fetch, currentOrigin: () => expectedOrigin } : undefined;
    await createThingtimeCapabilityChecker({ source: 'active-api' })('api.connections', '2.3.0', expectedOrigin, transport);
    assert.equal(fetchMock.mock.callCount(), 1);
    fetchMock.mock.restore();
  }
});
