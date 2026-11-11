import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { watchDesktopBundleActivation, hasUnknownDesktopDraft } from './desktopBundleActivation';
import { desktopBundleSafety } from './desktopBundleSafety';
import { rootIdentity } from './rootIdentity';
import type { ThingtimeDesktopBridge } from './electronBridge';
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture({ origin = 'http://127.0.0.1:18423', version = '1.0.0', blocked = false, automaticUpdates = true, write = Promise.resolve() } = {}) {
  const previous = globalThis.MutationObserver;
  globalThis.MutationObserver = class { observe() {} disconnect() {} } as unknown as typeof MutationObserver;
  let focused = false, unknown = blocked, callback: (message: any) => void = () => {}, routeChanged = () => {}, healthy = true;
  const receipts: { nonce: string; ready: boolean }[] = [], policies: boolean[] = [];
  const doc = { hasFocus: () => focused, querySelector: () => unknown ? {} : null, querySelectorAll: () => [], documentElement: {} } as unknown as Document;
  const win = Object.assign(new EventTarget(), { location: { origin: 'http://127.0.0.1:18423' }, setInterval: () => 1, clearInterval() {} }) as unknown as Window;
  const off = desktopBundleSafety.register({ kind: 'persistence', ready: () => true, automaticUpdates: () => automaticUpdates,
    checkpoint: async () => { await write; return () => true; } });
  const bridge = { bundleActivationVersion: version, getInfo: async () => ({ sessionHash: 'session', apiOrigin: 'https://thingtime.com', nativeFeatures: { origin, features: { 'native.web-bundle-activation': { version, methods: ['set-policy', 'checkpoint'] } } } }),
    onBundleActivation: (fn: typeof callback) => { callback = fn; return () => { callback = () => {}; }; },
    bundleActivationCheckpoint: async (receipt: typeof receipts[number]) => { receipts.push(receipt); return true; },
    setBundleUpdatePolicy: async ({ enabled }: { enabled: boolean }) => { policies.push(enabled); return true; } } as ThingtimeDesktopBridge;
  const router = { state: { initialized: true, navigation: { state: 'idle' }, errors: null }, subscribe: (fn: () => void) => { routeChanged = fn; return () => {}; } };
  const close = watchDesktopBundleActivation({ bridge, router, document: doc, window: win, isHealthy: () => healthy, idleMs: 0 });
  const prepare = () => { const nonce = randomUUID(); callback({ type: 'prepare', nonce }); return nonce; };
  const unload = () => { const event = new Event('beforeunload', { cancelable: true }); win.dispatchEvent(event); return event.defaultPrevented; };
  return { receipts, policies, prepare, unload, router,
    release: (nonce: string, keepVeto = false) => callback({ type: 'release', nonce, keepVeto }),
    focus: () => { focused = true; win.dispatchEvent(new Event('focus')); },
    navigation: () => { router.state.navigation.state = 'loading'; routeChanged(); },
    fail: () => { healthy = false; }, unknown: () => { unknown = true; },
    close: () => { close(); off(); globalThis.MutationObserver = previous; } };
}

test('healthy idle background renderer fulfills durable checkpoint; focus before commit revokes it without dropping input', async () => {
  const f = fixture(); const nonce = f.prepare(); await tick();
  assert.ok(f.receipts.some(value => value.nonce === nonce && value.ready)); assert.equal(f.unload(), false);
  f.focus(); assert.equal(f.receipts.at(-1)?.ready, false); assert.equal(f.unload(), true);
  f.release(nonce, true); assert.equal(f.unload(), true); // close has started: keep veto until native settlement
  f.release(nonce); assert.equal(f.unload(), false); // actual close veto restored ordinary work
  f.close();
});
test('unknown mounted editor, failed runtime, wrong origin and old bridge stay pending', async () => {
  for (const options of [{ blocked: true }, { origin: 'https://thingtime.com' }, { version: '2.0.0' }, { version: '0.9.0' }]) {
    const f = fixture(options); f.prepare(); await tick(); assert.ok(!f.receipts.some(receipt => receipt.ready)); f.close();
  }
  const f = fixture(); f.fail(); f.prepare(); await tick(); assert.ok(!f.receipts.some(receipt => receipt.ready)); f.close();
});
test('route reload or account identity change during durable write fences the late completion', async () => {
  for (const change of ['route', 'identity']) {
    let resolve!: () => void; const write = new Promise<void>(fn => { resolve = fn; });
    const f = fixture({ write }); f.prepare(); await tick();
    if (change === 'route') f.navigation(); else rootIdentity.changed();
    resolve(); await tick(); assert.ok(!f.receipts.some(receipt => receipt.ready));
    rootIdentity.confirm(rootIdentity.read().generation); f.close();
  }
});
test('newer preparation cannot be confirmed by an old checkpoint completion', async () => {
  let resolve!: () => void; const write = new Promise<void>(fn => { resolve = fn; });
  const f = fixture({ write }); const old = f.prepare(); await tick(); f.release(old); const current = f.prepare(); resolve(); await tick();
  assert.ok(!f.receipts.some(receipt => receipt.nonce === old && receipt.ready));
  assert.ok(f.receipts.some(receipt => receipt.nonce === current && receipt.ready)); f.close();
});
test('conservative unknown controls distinguish editable drafts from inert action controls', () => {
  for (const type of ['text', 'password', 'email', 'textarea']) {
    const document = { querySelector: () => null, querySelectorAll: (selector: string) => selector.includes('video') ? [] : [{ type, value: 'unsaved' }] } as unknown as Document;
    assert.equal(hasUnknownDesktopDraft(document), true);
  }
  const document = { querySelector: () => null, querySelectorAll: (selector: string) => selector.includes('video') ? [] : [{ type: 'button', value: 'Send' }, { type: 'hidden', value: 'opaque' }] } as unknown as Document;
  assert.equal(hasUnknownDesktopDraft(document), false);
});

test('active media playback remains pending even when every editor is empty', () => {
  let paused = false;
  const document = { querySelector: () => null, querySelectorAll: (selector: string) => selector.includes('video') ? [{ paused, ended: false }] : [] } as unknown as Document;
  assert.equal(hasUnknownDesktopDraft(document), true); paused = true; assert.equal(hasUnknownDesktopDraft(document), false);
});

test('existing preference opt-out is sent to the native host and refuses automatic activation', async () => {
  const f = fixture({ automaticUpdates: false }); f.prepare(); await tick();
  assert.deepEqual(f.policies, [false]); assert.ok(!f.receipts.some(receipt => receipt.ready)); f.close();
});
test('compatible native feature additions work; cleanup fences a late durable write', async () => {
  const compatible = fixture({ version: '1.2.3' }); compatible.prepare(); await tick();
  assert.ok(compatible.receipts.some(receipt => receipt.ready)); compatible.close();
  let resolve!: () => void; const write = new Promise<void>(fn => { resolve = fn; });
  const f = fixture({ write }); f.prepare(); await tick(); f.close(); resolve(); await tick();
  assert.ok(!f.receipts.some(receipt => receipt.ready));
});
