const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWebBundleActivation, closeForBundleActivation, assertBundleActivationSender, bundleActivationManifest } = require('../lib/web-bundle-activation.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(overrides = {}) {
  let identity = {}, pending = true, checkpoint, closes = 0, releases = 0;
  const host = createWebBundleActivation({ context: () => identity, pending: async () => pending,
    checkpoint: request => new Promise(resolve => { checkpoint = { ...request, resolve }; }),
    release: () => { releases++; }, closeAndRelaunch: async ({ assertCurrent }) => { assertCurrent(); closes++; return true; }, ...overrides });
  return { host, replace: () => { identity = {}; }, busy: () => { identity = null; }, pending: value => { pending = value; },
    checkpoint: () => checkpoint, closes: () => closes, releases: () => releases };
}
test('one verified pending bundle plus a current nonce lease commits exactly once', async () => {
  const f = fixture(); const first = f.host.attempt(); assert.equal(f.host.attempt(), first); await tick();
  const request = f.checkpoint(); request.resolve({ nonce: request.nonce, ready: true });
  assert.equal(await first, true); assert.equal(f.closes(), 1); assert.equal(f.releases(), 1);
});
test('busy, absent pending, refused or unrelated nonce never closes the app', async () => {
  const f = fixture(); f.busy(); assert.equal(await f.host.attempt(), false);
  const absent = fixture(); absent.pending(false); assert.equal(await absent.host.attempt(), false);
  for (const receipt of [{ ready: true, nonce: 'old' }, { ready: false }]) {
    const g = fixture(); const result = g.host.attempt(); await tick(); const request = g.checkpoint();
    request.resolve({ nonce: request.nonce, ...receipt }); assert.equal(await result, false); assert.equal(g.closes(), 0);
  }
});
test('identity replacement, user input cancellation and shutdown fence an old renderer reply', async () => {
  for (const invalidate of [f => f.replace(), f => f.host.cancel(), f => f.host.close()]) {
    const f = fixture(); const result = f.host.attempt(); await tick(); const request = f.checkpoint(); invalidate(f);
    request.resolve({ nonce: request.nonce, ready: true }); assert.equal(await result, false); assert.equal(f.closes(), 0);
  }
});
test('stalled inspection or renderer has a bounded lifetime; a later attempt can recover', async () => {
  for (const phase of ['pending', 'checkpoint']) {
    const f = fixture({ timeoutMs: 25, ...(phase === 'pending' ? { pending: () => new Promise(() => {}) } : {}) });
    // AbortSignal.timeout is unref'ed: retain a bounded test watchdog, never a hung suite.
    const watchdog = setTimeout(() => assert.fail('activation did not stop'), 1000);
    assert.equal(await f.host.attempt(), false); clearTimeout(watchdog); assert.equal(f.closes(), 0);
    f.host.close();
  }
});
test('close-to-hide / beforeunload veto does not queue relaunch or retain authority', async () => {
  for (const mode of ['hide', 'beforeunload']) {
    const window = new EventEmitter(); let relaunch = 0;
    window.webContents = new EventEmitter();
    window.close = () => { if (mode === 'hide') window.emit('close', { defaultPrevented: true }); else window.webContents.emit('will-prevent-unload', {}); };
    const abort = new AbortController();
    const result = closeForBundleActivation({ window, signal: abort.signal, assertCurrent() {}, relaunch: () => { relaunch++; } });
    await tick(); assert.equal(relaunch, 0); abort.abort(); assert.equal(await result, false);
    assert.equal(relaunch, 0); assert.equal(window.listenerCount('closed'), 0);
  }
});
test('only accepted close commits; no relaunch while asynchronous unload is still pending', async () => {
  const window = new EventEmitter(); let relaunch = 0; window.close = () => {};
  const abort = new AbortController();
  const result = closeForBundleActivation({ window, signal: abort.signal, assertCurrent() {}, relaunch: () => { relaunch++; } });
  await tick(); assert.equal(relaunch, 0); window.emit('closed'); assert.equal(await result, true); assert.equal(relaunch, 1);
});
test('activation sender requires current exact window, main frame and loaded app origin', () => {
  const frame = { url: 'http://127.0.0.1:18423/things' }, window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  assert.doesNotThrow(() => assertBundleActivationSender(event, window, 'http://127.0.0.1:18423'));
  for (const altered of [{ ...event, sender: {} }, { ...event, senderFrame: { ...frame } }]) assert.throws(() => assertBundleActivationSender(altered, window, 'http://127.0.0.1:18423'));
  assert.throws(() => assertBundleActivationSender(event, window, 'https://thingtime.com'));
  assert.throws(() => assertBundleActivationSender(event, null, 'http://127.0.0.1:18423'));
  assert.deepEqual(bundleActivationManifest('http://127.0.0.1:18423').features['native.web-bundle-activation'], { version: '1.0.0', methods: ['set-policy', 'checkpoint'] });
});
test('close timeout retains one observer and work fence until actual Chromium veto', async () => {
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.close = () => {};
  const abort = new AbortController(); let pending = false, relaunch = 0;
  const result = closeForBundleActivation({ window, signal: abort.signal, assertCurrent() {}, relaunch: () => { relaunch++; }, onCloseState: value => { pending = value; } });
  abort.abort(); assert.equal(await result, false); assert.equal(pending, true); assert.equal(window.listenerCount('closed'), 1);
  // Returning focus can no longer undo Electron's close dispatch. Renderer veto
  // ends that close, then ordinary work can be admitted again.
  window.webContents.emit('will-prevent-unload', {}); assert.equal(pending, false); assert.equal(relaunch, 0); assert.equal(window.listenerCount('closed'), 0);
});
test('ordinary work is tracked to settlement, cancels preparation and is refused after close starts', async () => {
  const { createBundleWorkAdmission } = require('../lib/web-bundle-activation.cjs');
  let closing = false, starts = 0, finish;
  const admission = createBundleWorkAdmission({ closing: () => closing, onStart: () => { starts++; } });
  const work = admission.wrap(() => new Promise(resolve => { finish = resolve; }));
  const result = work(); assert.equal(admission.active, 1); assert.equal(starts, 1);
  closing = true; await assert.rejects(work(), /finishing an update/); assert.equal(admission.active, 1);
  finish('saved'); assert.equal(await result, 'saved'); assert.equal(admission.active, 0);
  closing = false; const failed = admission.wrap(() => { throw Error('work failed'); }); await assert.rejects(failed(), /work failed/); assert.equal(admission.active, 0);
});

test('both shutdown providers reserve atomically and a busy second provider releases only this attempt', () => {
  const { reserveBundleShutdown } = require('../lib/web-bundle-activation.cjs');
  let firstReserved = false, secondBusy = true, released = 0;
  const first = () => {
    if (firstReserved) return null; firstReserved = true;
    return { isCurrent: () => firstReserved, release: () => { firstReserved = false; released++; } };
  };
  const second = () => secondBusy ? null : { isCurrent: () => !secondBusy, release() {} };
  assert.equal(reserveBundleShutdown([first, second]), null); assert.equal(firstReserved, false); assert.equal(released, 1);
  secondBusy = false;
  const reservation = reserveBundleShutdown([first, second]); assert.equal(reservation.isCurrent(), true);
  assert.equal(reserveBundleShutdown([first, second]), null); assert.equal(reservation.isCurrent(), true, 'another attempt cannot release the existing reservation');
  reservation.release(); reservation.release(); assert.equal(released, 2); assert.equal(reservation.isCurrent(), false);
});
test('missing, revoked and throwing shutdown providers fail closed without leaking acquired reservations', () => {
  const { reserveBundleShutdown } = require('../lib/web-bundle-activation.cjs');
  let current = true, releases = 0;
  const first = () => ({ isCurrent: () => current, release: () => { releases++; } });
  for (const second of [undefined, () => null, () => { throw Error('unavailable'); }, () => ({ isCurrent: () => false, release() {} })]) {
    assert.equal(reserveBundleShutdown([first, second]), null);
  }
  assert.equal(releases, 4);
  const held = reserveBundleShutdown([first]); current = false; assert.equal(held.isCurrent(), false); held.release();
});
test('unresolved close holds both admissions; a veto releases them and allows window presentation', async () => {
  const { reserveBundleShutdown, presentBundleWindow } = require('../lib/web-bundle-activation.cjs');
  const reserved = [false, false];
  const reservation = reserveBundleShutdown(reserved.map((_, index) => () => {
    reserved[index] = true; return { isCurrent: () => reserved[index], release: () => { reserved[index] = false; } };
  }));
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.close = () => {};
  let pending = false, created = 0;
  const controller = new AbortController();
  const result = closeForBundleActivation({ window, signal: controller.signal, assertCurrent() {}, relaunch: () => assert.fail('veto cannot relaunch'),
    onCloseState: (value, accepted) => { pending = value; if (!value && !accepted) reservation.release(); } });
  controller.abort(); assert.equal(await result, false); assert.equal(pending, true); assert.deepEqual(reserved, [true, true]);
  for (const event of ['activate', 'second-instance']) assert.equal(presentBundleWindow({ blocked: pending, window: null, origin: 'http://127.0.0.1:18423', create: () => { created++; } }), false, event);
  assert.equal(created, 0);
  window.webContents.emit('will-prevent-unload', {}); assert.equal(pending, false); assert.deepEqual(reserved, [false, false]);
  assert.equal(presentBundleWindow({ blocked: pending, window: null, origin: 'http://127.0.0.1:18423', create: () => { created++; } }), true); assert.equal(created, 1);
});
test('accepted close keeps activation and second-instance fenced while password disconnect/relaunch is unresolved', async () => {
  const { presentBundleWindow } = require('../lib/web-bundle-activation.cjs');
  const window = new EventEmitter(), controller = new AbortController(); window.webContents = new EventEmitter(); window.close = () => {};
  let pending = false, accepted = false, finish, relaunchStarted = false, creates = 0;
  // Real main registers its lifecycle invalidation before the activation helper.
  window.on('closed', () => controller.abort());
  const result = closeForBundleActivation({ window, signal: controller.signal, assertCurrent() {},
    onCloseState: (value, committed) => { pending = value; if (committed) accepted = true; },
    relaunch: () => new Promise(resolve => { relaunchStarted = true; finish = resolve; }) });
  window.emit('closed'); await result; await tick(); assert.equal(relaunchStarted, true); assert.equal(pending, false); assert.equal(accepted, true);
  for (const event of ['activate', 'second-instance']) assert.equal(presentBundleWindow({ blocked: pending || accepted, window: null, origin: 'http://127.0.0.1:18423', create: () => { creates++; } }), false, event);
  assert.equal(creates, 0); finish(); await tick();
});
test('ordinary presentation restores an existing window and never creates before an origin is ready', () => {
  const { presentBundleWindow } = require('../lib/web-bundle-activation.cjs'); const actions = [];
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => actions.push('restore'), show: () => actions.push('show'), focus: () => actions.push('focus') };
  assert.equal(presentBundleWindow({ blocked: false, window, origin: 'http://127.0.0.1:18423', create: () => assert.fail('already exists') }), true);
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
  assert.equal(presentBundleWindow({ blocked: false, window: null, origin: null, create: () => assert.fail('not ready') }), false);
});
test('only a positively initialized remote-account runtime permits automatic activation', () => {
  const { remoteAccountBundleActivationAllowed: allowed } = require('../lib/web-bundle-activation.cjs');
  const runtime = { runningEnabled: false, state: { enabled: false }, error: null, child: null };
  assert.equal(allowed({ initialized: true, runtime }), true);
  for (const input of [{ initialized: false, runtime }, { initialized: true, runtime: null },
    { initialized: true, runtime: { ...runtime, runningEnabled: undefined } }, { initialized: true, runtime: { ...runtime, state: {} } },
    { initialized: true, runtime: { ...runtime, runningEnabled: true } }, { initialized: true, runtime: { ...runtime, state: { enabled: true } } },
    { initialized: true, runtime: { ...runtime, restartRequired: true } }, { initialized: true, runtime: { ...runtime, child: {} } },
    { initialized: true, runtime: { ...runtime, error: 'unavailable' } }]) assert.equal(allowed(input), false);
});
test('renderer loss during checkpoint or lease release cannot escape as an unhandled activation failure', () => {
  const { sendBundleActivation } = require('../lib/web-bundle-activation.cjs'); const sent = [];
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...args) => sent.push(args) } };
  assert.equal(sendBundleActivation(window, { type: 'prepare', nonce: 'owned' }), true);
  assert.deepEqual(sent, [['thingtime-desktop:bundle-activation', { type: 'prepare', nonce: 'owned' }]]);
  for (const lost of [null, { ...window, isDestroyed: () => true }, { ...window, webContents: { isDestroyed: () => true } },
    { ...window, webContents: { isDestroyed: () => false, send: () => { throw Error('destroyed during send'); } } }])
    assert.equal(sendBundleActivation(lost, { type: 'release', nonce: 'owned' }), false);
});
test('dev launcher refusal and native relaunch failure never lock the current session authority', async () => {
  const { queueDesktopRelaunch } = require('../lib/web-bundle-activation.cjs');
  const { AuthorityTransition } = require('../lib/authority-transition.cjs');
  for (const process of [{ connected: false }, { connected: true, send: (_message, callback) => callback(Error('gone')) },
    { connected: true, send: () => { throw Error('disconnected'); } }]) {
    const authorityTransition = new AuthorityTransition(); let quits = 0;
    await assert.rejects(queueDesktopRelaunch({ app: { quit: () => { quits++; } }, authorityTransition, parallelDevMode: true, process }));
    assert.equal(authorityTransition.restarting, false); assert.equal(authorityTransition.active, false); assert.equal(quits, 0);
  }
  const authorityTransition = new AuthorityTransition();
  await assert.rejects(queueDesktopRelaunch({ app: { relaunch: () => { throw Error('unavailable'); }, quit: () => assert.fail('not queued') }, authorityTransition, parallelDevMode: false }));
  assert.equal(authorityTransition.restarting, false);
});
test('a queued replacement retains authority before quit; delayed launcher acknowledgement does not quit early', async () => {
  const { queueDesktopRelaunch } = require('../lib/web-bundle-activation.cjs');
  const { AuthorityTransition } = require('../lib/authority-transition.cjs');
  let acknowledge; const authorityTransition = new AuthorityTransition(), events = [];
  const app = { quit: () => { assert.equal(authorityTransition.restarting, true); events.push('quit'); } };
  const operation = queueDesktopRelaunch({ app, authorityTransition, parallelDevMode: true, process: { connected: true, send: (message, callback) => { assert.deepEqual(message, { type: 'thingtime-dev-restart' }); acknowledge = callback; } } });
  await tick(); assert.equal(authorityTransition.restarting, false); assert.deepEqual(events, []);
  acknowledge(null); await operation; assert.deepEqual(events, ['quit']);
  const nativeAuthority = new AuthorityTransition();
  await queueDesktopRelaunch({ app: { relaunch: () => { assert.equal(nativeAuthority.restarting, false); }, quit: () => { assert.equal(nativeAuthority.restarting, true); } }, authorityTransition: nativeAuthority, parallelDevMode: false });
});
