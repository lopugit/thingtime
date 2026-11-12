import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePasswordVerificationRequest, passwordApprovalRequest, passwordRequest } from './client';

test('passkey approval surfaces rate limits without spending its website deadline in backoff', async t => {
  const origin = 'https://password-approval.test';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (!String(input).startsWith('/api/v1/passwords')) return Response.json({ schemaVersion: 1, origin, features: { 'api.passwords': { version: '1.5.0' } } });
    posts++;
    assert.equal(init?.signal?.aborted, false);
    return Response.json({ ok: false, error: 'Please wait before verifying again.' }, { status: 429, headers: { 'Retry-After': '120' } });
  });
  const controller = new AbortController();
  await assert.rejects(passwordApprovalRequest('owner', { operation: 'verify-passkey' }, controller.signal), { status: 429, message: 'Please wait before verifying again.' });
  t.mock.timers.tick(120_000);
  assert.equal(posts, 1);
  controller.abort();
  await assert.rejects(passwordApprovalRequest('owner', { operation: 'verify-passkey' }, controller.signal), { name: 'AbortError' });
  assert.equal(posts, 1);
});

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

test('native confirmation pins its selected upstream before sending the request and requires proxy origin proof', async t => {
  const renderer = 'http://127.0.0.1:18452', endpoint = 'https://vault.example';
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin: renderer } } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  const signal = new AbortController().signal;
  let proxyOrigin = '';
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    if (String(input).includes('.well-known')) return Response.json({ schemaVersion: 1, origin: renderer, features: { 'api.passwords': { version: '1.7.0' } } });
    assert.equal(input, '/api/v1/passwords');
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.signal, signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('X-Thingtime-Expected-Api-Origin'), endpoint);
    assert.equal(headers.get('X-Thingtime-Expected-Actor'), 'owner');
    assert.equal(headers.get('X-Thingtime-Expected-Data-Plane'), 'home');
    assert.deepEqual(JSON.parse(String(init?.body)), { operation: 'verification-status', expectedOwnerId: 'owner' });
    return Response.json({ ok: true, ownerId: 'owner', required: true }, { headers: proxyOrigin ? { 'x-thingtime-api-fallback': proxyOrigin } : {} });
  });
  const request = () => nativePasswordVerificationRequest('owner', endpoint, { operation: 'verification-status' }, signal);
  assert.throws(() => nativePasswordVerificationRequest('owner', endpoint, { operation: 'read' }, signal), /Unsupported native approval operation/);
  await assert.rejects(request(), /selected Thingtime API changed/);
  proxyOrigin = 'https://wrong.example';
  await assert.rejects(request(), /selected Thingtime API changed/);
  proxyOrigin = endpoint;
  assert.equal((await request()).required, true);
});
