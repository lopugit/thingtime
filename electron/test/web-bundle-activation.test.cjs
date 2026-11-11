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
  assert.deepEqual(bundleActivationManifest('http://127.0.0.1:18423').features['native.web-bundle-activation'], { version: '1.3.0', methods: ['set-policy', 'checkpoint'], modes: ['remote-account', 'local-api'] });
});
test('only current nonce/window receipts may update closed diagnostic codes; old two-field clients remain valid', () => {
  const { acceptBundleActivationCheckpoint: accept } = require('../lib/web-bundle-activation.cjs');
  const window = {}, responses = [], records = [], cancellations = [];
  const pending = { window, nonce: 'current', respond: value => responses.push(value) };
  const request = value => accept({ request: value, pending, window, record: value => records.push(value), cancel: reason => cancellations.push(reason) });
  for (const bad of [{ nonce: 'old', ready: false, reason: 'cancel-dom' }, { nonce: 'current', ready: true, reason: 'PRIVATE_SENTINEL' },
    { nonce: 'current', ready: false, reason: 'cancel-dom', content: 'PRIVATE_SENTINEL' }]) assert.equal(request(bad), false);
  assert.equal(accept({ request: { nonce: 'current', ready: true }, pending, window: {}, record: () => assert.fail('wrong window'), cancel() {} }), false);
  assert.deepEqual(records, []); assert.deepEqual(responses, []);
  assert.equal(request({ nonce: 'current', ready: true }), true); assert.deepEqual(records.at(-1), { ready: true, reason: null });
  assert.equal(request({ nonce: 'current', ready: false, reason: 'cancel-dom' }), true);
  assert.deepEqual(records.at(-1), { ready: false, reason: 'cancel-dom' }); assert.deepEqual(cancellations, ['renderer-refused']);
  assert.equal(Object.hasOwn(records.at(-1), 'nonce'), false); assert.equal(Object.isFrozen(records.at(-1)), true);
  assert.equal(accept({ request: { nonce: 'current', ready: true }, pending, window,
    record() { throw Error('observer unavailable'); }, cancel() {} }), true);
});

function healthyEligibility() {
  return { closeAccepted: false, closePending: false, allowClosing: false, nativeAuthority: true,
    automaticUpdates: true, rendererReady: true, windowAvailable: true, windowFocused: false,
    servicesClosing: false, servicesClosed: false, authorityActive: false, idleInterval: true,
    counts: { otherWindows: 0, rendererRequests: 0, ipcWork: 0, mailWork: 0, attachmentUploads: 0, folderQueue: 0, aiSyncWork: 0 },
    idle: { reserved: false, reservation: 'absent', http: 'idle', chatgpt: 'idle', runtime: 'idle' },
    speechActive: false, fileExportActive: false, folderSyncActive: false, folderStreamActive: false,
    folderRequestActive: false, syncWindowActive: false, agentBrowserActive: false, contextAvailable: true };
}
test('eligibility projects every existing native gate and independently identifies IPC/request/work counters', () => {
  const { projectBundleActivationEligibility: project } = require('../lib/web-bundle-activation.cjs');
  assert.equal(project(healthyEligibility()).eligible, true);
  const flags = { closeAccepted: 'closeAccepted', closePending: 'closePending', nativeAuthority: 'nativeAuthority',
    automaticUpdates: 'automaticUpdates', rendererReady: 'rendererReady', windowAvailable: 'windowAvailable', windowFocused: 'windowUnfocused',
    servicesClosing: 'servicesOpen', servicesClosed: 'servicesOpen', authorityActive: 'authorityStable', idleInterval: 'idleInterval',
    speechActive: 'speechIdle', fileExportActive: 'fileExportIdle', folderSyncActive: 'folderSyncIdle', folderStreamActive: 'folderStreamIdle',
    folderRequestActive: 'folderRequestIdle', syncWindowActive: 'syncWindowIdle', agentBrowserActive: 'agentBrowserIdle', contextAvailable: 'contextAvailable' };
  for (const [flag, blocker] of Object.entries(flags)) {
    const input = healthyEligibility(); input[flag] = !input[flag];
    assert.deepEqual(project(input).blockers, [blocker], flag);
  }
  const counters = { otherWindows: 'otherWindows', rendererRequests: 'rendererRequests', ipcWork: 'ipcWork', mailWork: 'mailIdle',
    attachmentUploads: 'uploadsIdle', folderQueue: 'folderQueueIdle', aiSyncWork: 'aiSyncIdle' };
  for (const [counter, blocker] of Object.entries(counters)) {
    const input = healthyEligibility(); input.counts[counter] = 2;
    assert.deepEqual(project(input).blockers, [blocker]); assert.equal(project(input).counts[counter], 2);
    for (const invalid of [-1, NaN, undefined, '0']) { input.counts[counter] = invalid; assert.equal(project(input).eligible, false); }
  }
  assert.equal(project(null).eligible, false);
});
test('shutdown diagnostics distinguish unavailable, busy and failed providers without relaxing held reservation semantics', () => {
  const { bundleShutdownIdleState: observe, projectBundleActivationEligibility: project } = require('../lib/web-bundle-activation.cjs');
  const input = healthyEligibility();
  input.idle = observe({ http: () => false, chatgpt: null, runtime: () => { throw Error('secret provider details'); } });
  assert.deepEqual(input.idle, { reserved: false, reservation: 'absent', http: 'busy', chatgpt: 'unavailable', runtime: 'error' });
  assert.deepEqual(project(input).blockers, ['embeddedHttpIdle', 'embeddedChatgptIdle', 'embeddedRuntimeIdle']);
  input.idle = observe({ reservation: { isCurrent: () => true }, http: () => false, chatgpt: null, runtime: () => false });
  assert.equal(project(input).eligible, true, 'The existing held composite reservation is authoritative');
  input.idle = observe({ reservation: { isCurrent: () => false }, http: () => true, chatgpt: () => true, runtime: () => true });
  assert.deepEqual(project(input).blockers, ['shutdownReservation']);
  input.closePending = true; input.allowClosing = true; input.idle = healthyEligibility().idle;
  assert.equal(project(input).eligible, true); input.closeAccepted = true; assert.equal(project(input).eligible, false);
});
test('diagnostics clone/freeze only the declared public primitives, never account content, provider errors or handles', () => {
  const { projectBundleActivationEligibility: project } = require('../lib/web-bundle-activation.cjs');
  const input = healthyEligibility(); input.sessionHash = input.account = input.profile = 'PRIVATE_SENTINEL';
  input.counts.privateField = 'PRIVATE_SENTINEL'; input.idle.credentials = 'PRIVATE_SENTINEL';
  const result = project(input); input.counts.ipcWork = 9; input.idle.http = 'busy';
  assert.equal(JSON.stringify(result).includes('PRIVATE_SENTINEL'), false);
  assert.equal(result.counts.ipcWork, 0); assert.equal(result.idle.http, 'idle');
  for (const value of [result, result.gates, result.counts, result.idle, result.blockers]) assert.equal(Object.isFrozen(value), true);
});
test('development observer emits changed reasons and a bounded main-process heartbeat', () => {
  const { projectBundleActivationEligibility: project, createBundleActivationDiagnosticReporter } = require('../lib/web-bundle-activation.cjs');
  let at = 0; const emitted = [];
  const report = createBundleActivationDiagnosticReporter({ now: () => at, emit: entry => emitted.push(entry) });
  const idle = project(healthyEligibility()); assert.equal(report(idle), true);
  at = 29_999; assert.equal(report(idle), false); at = 30_000; assert.equal(report(idle), true);
  const input = healthyEligibility(); input.windowFocused = true; assert.equal(report(project(input)), true);
  at = 30_001; assert.equal(report(project(input)), false);
  assert.equal(emitted.length, 3); assert.deepEqual(emitted[2].blockers, ['windowUnfocused']);
  const failed = createBundleActivationDiagnosticReporter({ emit() { throw Error('observer unavailable'); } });
  assert.equal(failed(idle), false); assert.equal(idle.eligible, true);
});
test('actual main diagnostic emitter uses retained stderr without enabling suppressed stdout', () => {
  const helpers = require('../lib/web-bundle-activation.cjs');
  const source = require('node:fs').readFileSync(require.resolve('../main.cjs'), 'utf8');
  const start = source.indexOf('const reportBundleActivation ='), end = source.indexOf('function handleDesktopOperation(', start);
  assert.ok(start >= 0 && end > start);
  const stdout = [], stderr = [];
  const report = new Function('createBundleActivationDiagnosticReporter', 'console', source.slice(start, end) + '\nreturn reportBundleActivation;')(
    helpers.createBundleActivationDiagnosticReporter, { log: value => stdout.push(value), error: value => stderr.push(value) });
  const state = helpers.projectBundleActivationEligibility(healthyEligibility()); report(state);
  assert.deepEqual(stdout, []); assert.equal(stderr.length, 1);
  assert.ok(stderr[0].startsWith('[thingtime:bundle-activation] '));
  const { observedAt, ...projected } = JSON.parse(stderr[0].slice('[thingtime:bundle-activation] '.length));
  assert.equal(Number.isSafeInteger(observedAt), true); assert.deepEqual(projected, state);
});
test('native verifier retains only the canonical diagnostic allowlist and rejects malformed projections', () => {
  const { projectBundleActivationEligibility: project } = require('../lib/web-bundle-activation.cjs');
  const source = require('node:fs').readFileSync(require.resolve('../scripts/verify-web-bundle-auto-activation.mjs'), 'utf8');
  const start = source.indexOf('function publicActivationDiagnostics('), end = source.indexOf('async function captureHostActivationLog(', start);
  assert.ok(start >= 0 && end > start);
  const helpers = require('../lib/web-bundle-activation.cjs');
  const copy = new Function('diagnosticTemplate', 'BUNDLE_CHECKPOINT_REASONS', 'BUNDLE_CANCELLATION_REASONS', source.slice(start, end) + '\nreturn publicActivationDiagnostics;')(
    project({}), helpers.BUNDLE_CHECKPOINT_REASONS, helpers.BUNDLE_CANCELLATION_REASONS);
  const good = project(healthyEligibility());
  const untrusted = { ...good, profile: 'PRIVATE_SENTINEL', counts: { ...good.counts, private: 'PRIVATE_SENTINEL' }, idle: { ...good.idle, private: 'PRIVATE_SENTINEL' } };
  assert.deepEqual(copy(untrusted), good); assert.equal(JSON.stringify(copy(untrusted)).includes('PRIVATE_SENTINEL'), false);
  for (const value of [null, { ...good, format: 2 }, { ...good, eligible: false }, { ...good, counts: { ...good.counts, ipcWork: 'PRIVATE_SENTINEL' } },
    { ...good, gates: {} }, { ...good, blockers: ['PRIVATE_SENTINEL'] }]) assert.throws(() => copy(value));
});

// Exercise the real main-function wiring rather than a second eligibility
// expression. No Electron process, profile, authority or native work is created.
function actualMainEligibility(patch = {}) {
  const { readFileSync } = require('node:fs'); const helpers = require('../lib/web-bundle-activation.cjs');
  const source = readFileSync(require.resolve('../main.cjs'), 'utf8');
  const start = source.indexOf('function bundleActivationDiagnostics('), end = source.indexOf('function startBundleUpdateCheck(', start);
  assert.ok(start >= 0 && end > start);
  const window = { isDestroyed: () => false, isFocused: () => false }, context = { window };
  const emitted = [];
  const values = { projectBundleActivationEligibility: helpers.projectBundleActivationEligibility,
    nativeBundleActivationAllowed: helpers.nativeBundleActivationAllowed, localRuntimeInitialized: true,
    localRuntime: { runningEnabled: false, state: { enabled: false }, error: null, child: null },
    embeddedApiRuntimeWork: () => ({ version: '1.0.0', isIdle: () => true, reserveShutdown: () => null }),
    embeddedShutdownState: () => healthyEligibility().idle, mainWindow: window, bundleActivationContext: context,
    bundleCloseAccepted: false, bundleClosePending: false, bundleAutomaticUpdates: true, bundleRendererReady: true,
    desktopServicesClosing: false, desktopServicesClosed: false, authorityTransition: { active: false }, bundleLastActivity: Date.now() - 31_000,
    BrowserWindow: { getAllWindows: () => [window] }, bundleRendererRequests: new Set(), bundleWorkAdmission: { active: 0 },
    desktopSpeech: { current: null }, desktopMail: { active: new Map() }, desktopAttachmentUpload: { active: new Map() },
    desktopFileExport: { active: null }, desktopFolderSync: { active: null, streamWaiter: null, resourceRequest: null, ordinaryQueue: [] },
    aiSyncSessions: new Map(), syncWindowLease: { window: null }, agentBrowsersPromise: null,
    parallelDevMode: true, webBundleUpdates: { snapshot: () => ({ status: 'pending' }) }, reportBundleActivation: value => emitted.push(value),
    bundleLastCheckpoint: null, bundleLastCancellation: null, ...patch };
  const run = new Function(...Object.keys(values), source.slice(start, end) + '\nreturn { read: bundleActivationDiagnostics, eligible: bundleActivationEligible };');
  return { ...run(...Object.values(values)), context, emitted };
}
test('actual main gate and public projection agree on work/refusal and development-only emission', () => {
  const good = actualMainEligibility(); assert.equal(good.eligible(), good.context); assert.equal(good.read().eligible, true);
  assert.deepEqual(good.emitted, [good.read()]);
  for (const [patch, blocker] of [
    [{ bundleRendererRequests: new Set([1]) }, 'rendererRequests'], [{ bundleWorkAdmission: { active: 1 } }, 'ipcWork'],
    [{ desktopMail: { active: new Map([[1, {}]]) } }, 'mailIdle'], [{ agentBrowsersPromise: Promise.resolve({}) }, 'agentBrowserIdle'],
    [{ embeddedShutdownState: () => ({ ...healthyEligibility().idle, runtime: 'busy' }) }, 'embeddedRuntimeIdle'],
    [{ authorityTransition: { active: true } }, 'authorityStable'], [{ bundleCloseAccepted: true }, 'closeAccepted']
  ]) {
    const host = actualMainEligibility(patch); assert.equal(host.eligible(), null); assert.deepEqual(host.read().blockers, [blocker]);
  }
  for (const patch of [{ parallelDevMode: false }, { webBundleUpdates: { snapshot: () => ({ status: 'checking' }) } }]) {
    const host = actualMainEligibility(patch); host.eligible(); assert.deepEqual(host.emitted, []);
  }
});
test('actual main idle/lifecycle discovery fails closed when accessors or provider probes throw', () => {
  const helpers = require('../lib/web-bundle-activation.cjs');
  const source = require('node:fs').readFileSync(require.resolve('../main.cjs'), 'utf8');
  const functions = source.slice(source.indexOf('function embeddedPlanRuntimeIdle('), source.indexOf('function releaseBundleShutdown('));
  const run = new Function('globalThis', 'nativeRuntimeWorkLifecycle', 'bundleShutdownIdleState', 'bundleShutdownReservation', 'bundledRendererServer',
    functions + '\nreturn { read: embeddedShutdownState, idle: embeddedShutdownIdle, activity: embeddedApiRuntimeWork };');
  const plan = Symbol.for('thingtime.chatgpt-plan.idle'), runtime = Symbol.for('thingtime.runtime-work.lifecycle');
  const activity = { version: '1.0.0', isIdle: () => true, reserveShutdown: () => null };
  for (const selected of [plan, runtime]) {
    const globals = { [plan]: () => true, [runtime]: activity };
    Object.defineProperty(globals, selected, { get() { throw Error('PRIVATE_SENTINEL'); } });
    const host = run(globals, helpers.nativeRuntimeWorkLifecycle, helpers.bundleShutdownIdleState, null, { isIdle: () => true });
    assert.equal(host.idle(), false); assert.equal(host.read()[selected === plan ? 'chatgpt' : 'runtime'], 'error');
    assert.equal(JSON.stringify(host.read()).includes('PRIVATE_SENTINEL'), false);
    if (selected === runtime) assert.equal(host.activity(), null);
  }
  for (const http of [{ get isIdle() { throw Error('private accessor'); } }, { isIdle() { throw Error('private probe'); } }]) {
    const host = run({ [plan]: () => true, [runtime]: activity }, helpers.nativeRuntimeWorkLifecycle, helpers.bundleShutdownIdleState, null, http);
    assert.equal(host.idle(), false); assert.equal(host.read().http, 'error');
  }
  assert.equal(helpers.nativeBundleActivationAllowed({ initialized: true, runtime: { get error() { throw Error('private'); } }, activity }), false);
});
test('close timeout retains one observer and work fence until actual Chromium veto', async () => {
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.close = () => {};
  const abort = new AbortController(); let pending = false, relaunch = 0;
  const result = closeForBundleActivation({ window, signal: abort.signal, assertCurrent() {}, relaunch: () => { relaunch++; }, onCloseState: value => { pending = value; } });
  let settled = false; result.finally(() => { settled = true; });
  abort.abort(); await tick(); assert.equal(settled, false); assert.equal(pending, true); assert.equal(window.listenerCount('closed'), 1);
  // Returning focus can no longer undo Electron's close dispatch. Renderer veto
  // ends that close, then ordinary work can be admitted again.
  window.webContents.emit('will-prevent-unload', {}); assert.equal(await result, false); assert.equal(pending, false); assert.equal(relaunch, 0); assert.equal(window.listenerCount('closed'), 0);
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
  let settled = false; result.finally(() => { settled = true; });
  controller.abort(); await tick(); assert.equal(settled, false); assert.equal(pending, true); assert.deepEqual(reserved, [true, true]);
  for (const event of ['activate', 'second-instance']) assert.equal(presentBundleWindow({ blocked: pending, window: null, origin: 'http://127.0.0.1:18423', create: () => { created++; } }), false, event);
  assert.equal(created, 0);
  window.webContents.emit('will-prevent-unload', {}); assert.equal(await result, false); assert.equal(pending, false); assert.deepEqual(reserved, [false, false]);
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
  window.emit('closed'); await tick(); assert.equal(relaunchStarted, true); assert.equal(pending, false); assert.equal(accepted, true);
  for (const event of ['activate', 'second-instance']) assert.equal(presentBundleWindow({ blocked: pending || accepted, window: null, origin: 'http://127.0.0.1:18423', create: () => { creates++; } }), false, event);
  assert.equal(creates, 0); finish(); assert.equal(await result, true);
});
test('ordinary presentation restores an existing window and never creates before an origin is ready', () => {
  const { presentBundleWindow } = require('../lib/web-bundle-activation.cjs'); const actions = [];
  const window = { isDestroyed: () => false, isMinimized: () => true, restore: () => actions.push('restore'), show: () => actions.push('show'), focus: () => actions.push('focus') };
  assert.equal(presentBundleWindow({ blocked: false, window, origin: 'http://127.0.0.1:18423', create: () => assert.fail('already exists') }), true);
  assert.deepEqual(actions, ['restore', 'show', 'focus']);
  assert.equal(presentBundleWindow({ blocked: false, window: null, origin: null, create: () => assert.fail('not ready') }), false);
});
test('remote and local API lanes require current authority and a compatible process work contract', () => {
  const { nativeBundleActivationAllowed: allowed, nativeRuntimeWorkLifecycle: negotiate } = require('../lib/web-bundle-activation.cjs');
  const activity = { version: '1.0.0', isIdle: () => true, reserveShutdown: () => null };
  const remote = { runningEnabled: false, state: { enabled: false }, error: null, child: null };
  const external = { ...remote, runningEnabled: true, state: { enabled: true, databaseMode: 'external' } };
  const managed = { ...external, state: { enabled: true, databaseMode: 'managed' }, child: { pid: 123, exitCode: null, signalCode: null, killed: false } };
  for (const runtime of [remote, external, managed]) {
    assert.equal(allowed({ initialized: true, runtime, activity }), true);
    for (const patch of [{ initialized: false }, { runtime: null }, { activity: null },
      { runtime: { ...runtime, runningEnabled: undefined } }, { runtime: { ...runtime, state: {} } },
      { runtime: { ...runtime, restartRequired: true } }, { runtime: { ...runtime, error: 'unavailable' } }]) {
      assert.equal(allowed({ initialized: true, runtime, activity, ...patch }), false);
    }
  }
  for (const runtime of [{ ...external, child: {} }, { ...managed, state: { enabled: true, databaseMode: 'unknown' } },
    ...[null, {}, { ...managed.child, pid: 0 }, { ...managed.child, killed: true }, { ...managed.child, exitCode: 1 },
      { ...managed.child, signalCode: 'SIGTERM' }].map(child => ({ ...managed, child }))]) {
    assert.equal(allowed({ initialized: true, runtime, activity }), false);
  }
  for (const candidate of [null, undefined, {}, { ...activity, version: '2.0.0' }, { ...activity, version: '1.0.0-unknown' },
    { ...activity, isIdle: true }, { ...activity, reserveShutdown: null }, { get version() { throw Error('unavailable'); } }]) {
    assert.ok(!negotiate(candidate));
    assert.equal(allowed({ initialized: true, runtime: remote, activity: candidate }), false);
  }
  const compatible = { ...activity, version: '1.2.3' };
  assert.equal(negotiate(compatible), compatible);
});
test('all three shutdown providers remain reserved until release and a busy API producer rolls back preparation', () => {
  const { reserveBundleShutdown } = require('../lib/web-bundle-activation.cjs');
  let apiBusy = true;
  const held = [false, false, false];
  const providers = held.map((_, index) => () => {
    if (held[index] || (index === 2 && apiBusy)) return null;
    held[index] = true;
    return { isCurrent: () => held[index], release: () => { held[index] = false; } };
  });
  assert.equal(reserveBundleShutdown(providers), null); assert.deepEqual(held, [false, false, false]);
  apiBusy = false;
  const current = reserveBundleShutdown(providers);
  assert.equal(current.isCurrent(), true); assert.deepEqual(held, [true, true, true]);
  assert.equal(reserveBundleShutdown(providers), null); assert.equal(current.isCurrent(), true);
  current.release(); assert.deepEqual(held, [false, false, false]); assert.equal(current.isCurrent(), false);
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

test('dispatched close retains coordinator ownership across cancellation until the real terminal event', async () => {
  for (const terminal of ['veto', 'closed']) {
    const window = new EventEmitter(); window.webContents = new EventEmitter();
    let dispatches = 0, relaunches = 0, checkpointCalls = 0, releases = 0, finishRelaunch;
    window.close = () => { dispatches++; };
    const identity = {}, stages = [];
    const host = createWebBundleActivation({ context: () => identity, pending: async () => true,
      checkpoint: async ({ nonce }) => { checkpointCalls++; return { nonce, ready: true }; },
      release: () => { releases++; }, timeoutMs: 1000,
      closeAndRelaunch: args => closeForBundleActivation({ ...args, window, observe: event => stages.push(event.stage),
        relaunch: () => { relaunches++; return new Promise(resolve => { finishRelaunch = resolve; }); } }) });
    const result = host.attempt(); let settled = false; result.then(() => { settled = true; });
    await tick(); host.cancel(); await tick();
    assert.equal(settled, false); assert.equal(host.attempt(), result);
    assert.equal(releases, 0); assert.equal(dispatches, 1); assert.equal(checkpointCalls, 1);
    assert.deepEqual(stages, ['close-dispatch', 'close-cancel-pending']);
    if (terminal === 'veto') {
      window.webContents.emit('will-prevent-unload', {});
      assert.equal(await result, false); window.emit('closed'); assert.equal(relaunches, 0);
    } else {
      window.webContents.emit('destroyed'); window.emit('closed'); window.emit('closed'); await tick();
      assert.equal(relaunches, 1); assert.equal(settled, false); assert.equal(host.attempt(), result); assert.equal(releases, 0);
      finishRelaunch(); assert.equal(await result, true);
    }
    assert.equal(releases, 1); assert.equal(window.listenerCount('closed'), 0);
    assert.equal(window.webContents.listenerCount('will-prevent-unload'), 0); host.close();
  }
});
test('pre-dispatch abort never closes; lifecycle observations accept only closed codes and cannot change control', async () => {
  const { observeBundleLifecycle } = require('../lib/web-bundle-activation.cjs');
  const controller = new AbortController(); controller.abort(); let closes = 0;
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.close = () => { closes++; };
  await assert.rejects(closeForBundleActivation({ window, signal: controller.signal, assertCurrent() {}, relaunch() {} }));
  assert.equal(closes, 0); assert.equal(window.listenerCount('closed'), 0);
  assert.equal(observeBundleLifecycle(() => assert.fail('invalid code'), 'PRIVATE_SENTINEL'), false);
  const observed = []; assert.equal(observeBundleLifecycle(value => observed.push(value), 'before-quit'), true);
  assert.deepEqual(observed, [{ stage: 'before-quit' }]); assert.equal(Object.isFrozen(observed[0]), true);
  assert.equal(observeBundleLifecycle(() => { throw Error('private'); }, 'window-closed'), false);
});

test('an actual inspection deadline cannot release a dispatched close owner before Chromium resolves it', async () => {
  const window = new EventEmitter(); window.webContents = new EventEmitter(); window.close = () => {};
  const signal = AbortSignal.timeout(10), stages = []; let settled = false;
  const watchdog = setTimeout(() => assert.fail('deadline did not fire'), 1000);
  try {
    const result = closeForBundleActivation({ window, signal, assertCurrent() {}, relaunch() {}, observe: event => stages.push(event.stage) });
    result.then(() => { settled = true; });
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); await tick();
    assert.equal(settled, false); assert.deepEqual(stages, ['close-dispatch','close-cancel-pending']);
    window.emit('closed'); assert.equal(await result, true);
    assert.deepEqual(stages, ['close-dispatch','close-cancel-pending','window-closed','relaunch-entry']);
  } finally { clearTimeout(watchdog); }
});
