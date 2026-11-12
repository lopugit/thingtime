import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopRendererBootHealth, watchDesktopRendererReady } from './desktopRendererReady';

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0, calls = 0, errors = 0, listener = () => {};
  const router = {
    state: { initialized: false, navigation: { state: 'loading' }, errors: null as unknown },
    subscribe(callback: () => void) { listener = callback; return () => { listener = () => {}; }; }
  };
  const root = { childElementCount: 0 };
  const health = createDesktopRendererBootHealth();
  const bridge = { rendererReady: async () => { calls++; return true; } };
  const close = watchDesktopRendererReady({ router, root, bridge, isHealthy: health.isHealthy,
    requestFrame: callback => { const id = ++next; frames.set(id, callback); return id; },
    cancelFrame: id => { frames.delete(id); }, onError: () => { errors++; } });
  const paint = async () => {
    const current = [...frames.values()]; frames.clear();
    current.forEach(callback => callback(0));
    await new Promise(resolve => setImmediate(resolve));
  };
  return { router, root, bridge, health, close, paint, changed: () => listener(), calls: () => calls, errors: () => errors };
}

test('requires initialized routing and a committed nonempty application before acknowledgment', async () => {
  const f = fixture();
  await f.paint(); await f.paint(); assert.equal(f.calls(), 0);
  f.router.state.initialized = true; f.router.state.navigation.state = 'idle'; f.changed();
  await f.paint(); await f.paint(); assert.equal(f.calls(), 0);
  f.root.childElementCount = 1; f.changed();
  await f.paint(); assert.equal(f.calls(), 0);
  await f.paint(); assert.equal(f.calls(), 1);
  f.changed(); await f.paint(); await f.paint(); assert.equal(f.calls(), 1);
  f.close();
});

test('a route failure or navigation during paint cannot confirm a broken trial', async () => {
  const f = fixture();
  f.router.state.initialized = true; f.router.state.navigation.state = 'idle'; f.root.childElementCount = 1;
  f.router.state.errors = { root: new Error('Failed loader') }; f.changed();
  await f.paint(); await f.paint(); assert.equal(f.calls(), 0);
  f.router.state.errors = null; f.changed(); await f.paint();
  f.router.state.navigation.state = 'loading'; f.changed(); await f.paint(); assert.equal(f.calls(), 0);
  f.router.state.navigation.state = 'idle'; f.changed(); await f.paint(); await f.paint(); assert.equal(f.calls(), 1);
  f.close();
});

test('cleanup prevents acknowledgment after the component is replaced or closed', async () => {
  const f = fixture();
  f.router.state.initialized = true; f.router.state.navigation.state = 'idle'; f.root.childElementCount = 1; f.changed();
  await f.paint(); f.close(); await f.paint(); f.changed(); await f.paint(); assert.equal(f.calls(), 0);
});

test('a render error vetoes acknowledgment even when router state has no errors and recovery DOM is nonempty', async () => {
  const f = fixture();
  f.router.state.initialized = true; f.router.state.navigation.state = 'idle'; f.root.childElementCount = 1; f.changed();
  await f.paint(); f.health.onError(); await f.paint();
  assert.equal(f.router.state.errors, null); assert.equal(f.calls(), 0); f.close();
});

test('bridge refusal is reported once without replaying a confirmation', async () => {
  const f = fixture();
  f.bridge.rendererReady = async () => { throw new Error('Refused'); };
  f.router.state.initialized = true; f.router.state.navigation.state = 'idle'; f.root.childElementCount = 1; f.changed();
  await f.paint(); await f.paint(); f.changed(); await f.paint();
  assert.equal(f.errors(), 1); f.close();
});
