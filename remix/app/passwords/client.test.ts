import assert from 'node:assert/strict';
import test from 'node:test';
import { passwordRequest } from './client';

test('whole-vault searches negotiate support, encode the query on every page, and respect cancellation', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: 'https://password-search.test' } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  let version = '1.1.0';
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = String(input);
    if (!url.startsWith('/api/v1/passwords')) return Response.json({ schemaVersion: 1, origin: 'https://password-search.test', features: { 'api.passwords': { version } } });
    requests.push(url);
    assert.equal(init?.cache, 'no-store'); assert.equal(init?.credentials, 'same-origin'); assert.equal(init?.redirect, 'error');
    return Response.json({ ok: true, ownerId: 'owner', entries: [], nextCursor: null });
  });
  await assert.rejects(passwordRequest('owner', undefined, undefined, undefined, 'facebook'), /incompatible/);
  assert.equal(requests.length, 0, 'old servers must not silently ignore search');
  version = '1.3.0';
  await passwordRequest('owner', undefined, undefined, undefined, 'facebook & [.*]');
  await passwordRequest('owner', undefined, undefined, 'opaque-cursor', 'facebook & [.*]');
  for (const url of requests) assert.equal(new URL(url, 'https://password-search.test').searchParams.get('q'), 'facebook & [.*]');
  assert.equal(new URL(requests[1], 'https://password-search.test').searchParams.get('cursor'), 'opaque-cursor');
  const controller = new AbortController(); controller.abort();
  await assert.rejects(passwordRequest('owner', undefined, controller.signal, undefined, 'obsolete'), { name: 'AbortError' });
  assert.equal(requests.length, 2);
  await passwordRequest('owner', undefined, undefined, undefined, '');
  assert.equal(requests[2], '/api/v1/passwords', 'clearing the query restarts the complete list');
});
