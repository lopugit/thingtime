import assert from 'node:assert/strict';
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
