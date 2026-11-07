import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNativePasswordResult, supportsNativePasswordProviderVersion } from './nativeConnectionStatus';

test('linked but unsynchronized stays distinct and offers existing Connect retry', () => {
  const result = normalizeNativePasswordResult({ ok: true, state: 'linked-index-pending', linked: true, indexSynchronized: false });
  assert.equal(result.ok, true); assert.equal(result.linked, true); assert.equal(result.indexSynchronized, false);
  assert.match(result.message, /not synchronized/); assert.match(result.message, /retry Connect/);
});
test('only coherent explicit metadata reports synchronized suggestions', () => {
  const success = normalizeNativePasswordResult({ ok: true, state: 'index-synchronized', linked: true, indexSynchronized: true });
  assert.equal(success.state, 'index-synchronized'); assert.equal(success.indexSynchronized, true);
  for (const result of [null, { ok: true, message: 'Connected' }, { ok: true, state: 'index-synchronized', linked: false, indexSynchronized: true }, { ok: true, state: 'index-synchronized', linked: true, indexSynchronized: false }]) {
    assert.equal(normalizeNativePasswordResult(result).state, 'unknown');
    assert.equal(normalizeNativePasswordResult(result).indexSynchronized, null);
  }
});
test('status projection never renders raw native errors or identity metadata', () => {
  const result = normalizeNativePasswordResult({ ok: false, message: 'private diagnostic', ownerId: 'private identity', username: 'private user' });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify(result), /private/);
  assert.deepEqual(Object.keys(result).sort(), ['indexSynchronized', 'linked', 'message', 'ok', 'state']);
});
test('disconnected status cannot claim a linked or synchronized account', () => {
  const result = normalizeNativePasswordResult({ ok: true, state: 'disconnected', linked: false, indexSynchronized: false });
  assert.equal(result.state, 'disconnected'); assert.equal(result.linked, false); assert.equal(result.indexSynchronized, false);
});

test('desktop adapter preserves pending and redacts legacy/arbitrary native replies', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let reply: unknown = { ok: true, state: 'linked-index-pending', linked: true, indexSynchronized: false, message: 'private native diagnostic' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { thingtimeDesktop: { passwordsVersion: '1.0.0', passwordProvider: async () => reply } } });
  try {
    const { nativePasswordProvider } = await import('./native.client');
    const pending = await nativePasswordProvider('connect', 'synthetic-owner');
    assert.equal(pending.state, 'linked-index-pending'); assert.doesNotMatch(pending.message, /private/);
    reply = { ok: true, message: 'Connected with private native diagnostic' };
    const old = await nativePasswordProvider('connect', 'synthetic-owner');
    assert.equal(old.state, 'unknown'); assert.equal(old.linked, null); assert.doesNotMatch(old.message, /private/);
    reply = { ok: false, message: 'private native error' };
    await assert.rejects(nativePasswordProvider('connect', 'synthetic-owner'), error => {
      assert.doesNotMatch(String(error), /private/); return true;
    });
  } finally { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); }
});

test('major-1 compatibility keeps old 1.0 bridges supported without invented status', () => {
  for (const version of ['1.0.0', '1.1.0', '1.2.3']) assert.equal(supportsNativePasswordProviderVersion(version), true);
  for (const version of [undefined, '2.0.0', '1.01.0', '1.1', '1.1.0-rc']) assert.equal(supportsNativePasswordProviderVersion(version), false);
});

test('iOS event adapter keeps pending status and rejects only fixed redacted errors', async () => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const events = new EventTarget(); let ok = true;
  const windowFixture = { addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    thingtimeNativeBridge: { passwordsVersion: '1.1.0', postMessage: (request: any) => {
      queueMicrotask(() => events.dispatchEvent(new CustomEvent('thingtime:native-message', { detail: { type: 'password-provider-result', payload: {
        requestId: request.payload.requestId, ok, state: 'linked-index-pending', linked: true, indexSynchronized: false, message: 'private native diagnostic' } } })));
    } } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowFixture });
  try {
    const { nativePasswordProvider } = await import('./native.client');
    assert.equal((await nativePasswordProvider('connect', 'synthetic-owner')).state, 'linked-index-pending');
    ok = false;
    await assert.rejects(nativePasswordProvider('connect', 'synthetic-owner'), error => { assert.doesNotMatch(String(error), /private/); return true; });
  } finally { if (prior) Object.defineProperty(globalThis, 'window', prior); else Reflect.deleteProperty(globalThis, 'window'); }
});
