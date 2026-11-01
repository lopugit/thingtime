import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasNativePasswordProvider, hasNativePasswordStatus, nativePasswordConnectionEvent, nativePasswordProvider } from './native.client';

test('connection reads require native 1.1 and compatible future minors remain supported', async t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); });
  const events = new EventTarget(), calls: string[] = [];
  const desktop = { passwordsVersion: '1.0.0', passwordProvider: async (request: { action: string }) => { calls.push(request.action); return { ok: true, connection: 'connected' }; } };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: Object.assign(events, { thingtimeDesktop: desktop }) });
  assert.equal(hasNativePasswordProvider(), true);
  assert.equal(hasNativePasswordStatus(), false);
  assert.deepEqual(await nativePasswordProvider('status', 'fixture'), { ok: true, connection: 'unavailable' });
  assert.deepEqual(calls, []);
  let changes = 0; events.addEventListener(nativePasswordConnectionEvent, () => changes++);
  for (const version of ['1.1.0', '1.2.3']) {
    desktop.passwordsVersion = version;
    assert.equal(hasNativePasswordStatus(), true);
    assert.equal((await nativePasswordProvider('status', 'fixture')).connection, 'connected');
  }
  assert.equal(changes, 0, 'Status reads must not emit mutation notifications');
  await nativePasswordProvider('connect', 'fixture');
  assert.equal(changes, 1);
  for (const version of ['2.0.0', '1.1', '1.01.0']) {
    desktop.passwordsVersion = version;
    assert.equal(hasNativePasswordStatus(), false);
  }
});
