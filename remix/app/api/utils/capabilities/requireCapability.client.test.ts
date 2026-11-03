import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { createFolderHostFetch } from '~/fileSync/folderHostFetch.client';
import { afterEach, beforeEach, test } from 'node:test';
import { createThingtimeCapabilityChecker } from './requireCapability.client';
import { THINGTIME_CAPABILITY_MANIFEST_PATH } from './capabilityContract';

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
    ['api.lopu-chats-update', '1.6.0', '1.5.0'], ['api.lopu-chats-reply', '1.21.0', '1.20.0']
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
