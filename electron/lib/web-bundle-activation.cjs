'use strict';
const { randomUUID } = require('node:crypto');
const BUNDLE_ACTIVATION_FEATURE = Object.freeze({ version: '1.3.0', methods: Object.freeze(['set-policy', 'checkpoint']), modes: Object.freeze(['remote-account', 'local-api']) });
const BUNDLE_CHECKPOINT_REASONS = Object.freeze(['renderer-ready', 'renderer-disposed', 'renderer-focused', 'renderer-recent-activity',
  'renderer-unhealthy', 'identity-pending', 'router-unready', 'unknown-draft', 'dirty-control', 'host-unsupported', 'checkpoint-invalidated',
  'cancel-input', 'cancel-focus', 'cancel-pagehide', 'cancel-router', 'cancel-identity', 'cancel-safety', 'cancel-dom', 'cancel-dispose',
  'persistence-missing', 'persistence-unready', 'work-unready', 'participant-unavailable', 'preference-disabled', 'preference-unavailable', 'readiness-unavailable', 'participant-changed',
  'participant-checkpoint', 'persistence-checkpoint', 'certificate-invalid', 'certificate-ready']);
const BUNDLE_CANCELLATION_REASONS = Object.freeze(['host-changed', 'host-input', 'host-authority', 'host-network', 'host-work', 'host-preference', 'renderer-refused']);
/** Diagnostics are optional and never grant readiness. Stale/wrong-window
 * messages cannot replace the current operation's diagnostic record. */
function acceptBundleActivationCheckpoint({ request, pending, window, record, cancel }) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || typeof request.ready !== 'boolean' || !pending ||
      pending.window !== window || request.nonce !== pending.nonce) return false;
  const keys = Object.keys(request);
  if (!keys.every(key => ['nonce', 'ready', 'reason'].includes(key)) || !keys.includes('nonce') || !keys.includes('ready') ||
      (keys.includes('reason') && !BUNDLE_CHECKPOINT_REASONS.includes(request.reason))) return false;
  try { record(Object.freeze({ ready: request.ready, reason: request.reason ?? null })); }
  catch { /* A diagnostic observer cannot change protocol acceptance. */ }
  if (!request.ready) cancel('renderer-refused');
  pending.respond({ nonce: request.nonce, ready: request.ready }); return true;
}
const bundleActivationManifest = origin => ({ origin, features: { 'native.web-bundle-activation': BUNDLE_ACTIVATION_FEATURE } });
function assertBundleActivationSender(event, window, origin) {
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame ||
      new URL(event.senderFrame.url).origin !== origin) throw Error('Bundle activation requires the current bundled window');
}
function sendBundleActivation(window, message) {
  try {
    if (!window || window.isDestroyed() || !window.webContents || window.webContents.isDestroyed()) return false;
    window.webContents.send('thingtime-desktop:bundle-activation', message); return true;
  } catch { return false; }
}
const withAbort = (work, signal) => new Promise((resolve, reject) => {
  const aborted = () => { signal.removeEventListener('abort', aborted); reject(signal.reason); };
  signal.addEventListener('abort', aborted, { once: true });
  if (signal.aborted) aborted();
  else Promise.resolve().then(work).then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
});

/** Negotiate the loaded bundle's process-only background-work boundary. */
function nativeRuntimeWorkLifecycle(value) {
  try {
    return value && /^1\.\d+\.\d+$/.test(value.version) && typeof value.isIdle === 'function' &&
      typeof value.reserveShutdown === 'function' ? value : null;
  } catch { return null; }
}
/** Both API lanes require initialized, unchanged authority and the bundle's
 * background-work contract. Managed databases must still be alive. */
function nativeBundleActivationAllowed({ initialized, runtime, activity }) {
 try {
  if (initialized !== true || !runtime || !nativeRuntimeWorkLifecycle(activity) || runtime.error !== null || runtime.restartRequired === true ||
      typeof runtime.runningEnabled !== 'boolean' || runtime.runningEnabled !== runtime.state?.enabled) return false;
  if (!runtime.runningEnabled || runtime.state.databaseMode === 'external') return runtime.child === null;
  return runtime.state.databaseMode === 'managed' && Number.isSafeInteger(runtime.child?.pid) && runtime.child.pid > 0 &&
    runtime.child.exitCode === null && runtime.child.signalCode === null && runtime.child.killed === false;
 } catch { return false; }
}

const idleStates = new Set(['idle', 'busy', 'unavailable', 'error']);
function observeBundleIdle(probe) {
  if (typeof probe !== 'function') return 'unavailable';
  try { const result = probe(); return result === true ? 'idle' : result === false ? 'busy' : 'unavailable'; }
  catch { return 'error'; }
}
/** Read-only observations. An acquired reservation remains authoritative, as in
 * the existing shutdown gate; diagnostic probes never acquire/release it. */
function bundleShutdownIdleState({ reservation, http, chatgpt, runtime }) {
  return Object.freeze({ reserved: Boolean(reservation),
    reservation: reservation ? observeBundleIdle(() => reservation.isCurrent()) : 'absent',
    http: observeBundleIdle(http), chatgpt: observeBundleIdle(chatgpt), runtime: observeBundleIdle(runtime) });
}
function projectBundleActivationEligibility(input) {
  input = input && typeof input === 'object' ? input : {};
  const counts = {};
  for (const name of ['otherWindows', 'rendererRequests', 'ipcWork', 'mailWork', 'attachmentUploads', 'folderQueue', 'aiSyncWork']) {
    const value = input.counts?.[name];
    counts[name] = Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const reserved = input.idle?.reserved === true;
  const idle = { reserved };
  for (const name of ['http', 'chatgpt', 'runtime']) idle[name] = idleStates.has(input.idle?.[name]) ? input.idle[name] : 'unavailable';
  idle.reservation = reserved && idleStates.has(input.idle?.reservation) ? input.idle.reservation : reserved ? 'unavailable' : 'absent';
  // Every key is part of the public allowlist. Never return input objects,
  // errors, live handles, URLs, IDs, paths or arbitrary provider metadata.
  const gates = {
    closeAccepted: input.closeAccepted === false,
    closePending: input.closePending === false || input.allowClosing === true,
    nativeAuthority: input.nativeAuthority === true,
    automaticUpdates: input.automaticUpdates === true,
    rendererReady: input.rendererReady === true,
    windowAvailable: input.windowAvailable === true,
    windowUnfocused: input.windowFocused === false,
    servicesOpen: input.servicesClosing === false && input.servicesClosed === false,
    authorityStable: input.authorityActive === false,
    idleInterval: input.idleInterval === true,
    otherWindows: counts.otherWindows === 0,
    rendererRequests: counts.rendererRequests === 0,
    ipcWork: counts.ipcWork === 0,
    shutdownReservation: !reserved || idle.reservation === 'idle',
    embeddedHttpIdle: reserved || idle.http === 'idle',
    embeddedChatgptIdle: reserved || idle.chatgpt === 'idle',
    embeddedRuntimeIdle: reserved || idle.runtime === 'idle',
    speechIdle: input.speechActive === false,
    mailIdle: counts.mailWork === 0,
    uploadsIdle: counts.attachmentUploads === 0,
    fileExportIdle: input.fileExportActive === false,
    folderSyncIdle: input.folderSyncActive === false,
    folderStreamIdle: input.folderStreamActive === false,
    folderRequestIdle: input.folderRequestActive === false,
    folderQueueIdle: counts.folderQueue === 0,
    aiSyncIdle: counts.aiSyncWork === 0,
    syncWindowIdle: input.syncWindowActive === false,
    agentBrowserIdle: input.agentBrowserActive === false,
    contextAvailable: input.contextAvailable === true
  };
  const blockers = Object.freeze(Object.keys(gates).filter(name => !gates[name]));
  const checkpoint = input.checkpoint && [true, false, null].includes(input.checkpoint.ready) &&
    (input.checkpoint.reason === null || BUNDLE_CHECKPOINT_REASONS.includes(input.checkpoint.reason))
    ? Object.freeze({ ready: input.checkpoint.ready, reason: input.checkpoint.reason }) : null;
  const cancellation = BUNDLE_CANCELLATION_REASONS.includes(input.cancellation) ? input.cancellation : null;
  return Object.freeze({ format: 1, eligible: blockers.length === 0, blockers,
    gates: Object.freeze(gates), counts: Object.freeze(counts), idle: Object.freeze(idle), checkpoint, cancellation });
}
/** The caller gates this to staged-pending task development builds. Ordinary
 * app startup/polling emits nothing; unchanged reasons emit one heartbeat. */
function createBundleActivationDiagnosticReporter({ emit, now = Date.now, heartbeatMs = 30000 }) {
  let previous, lastAt;
  return state => {
    const signature = JSON.stringify([state.blockers, state.checkpoint, state.cancellation]), at = now();
    if (previous === signature && at - lastAt < heartbeatMs) return false;
    try {
      emit({ observedAt: at, format: state.format, eligible: state.eligible,
        blockers: state.blockers, gates: state.gates, counts: state.counts, idle: state.idle, checkpoint: state.checkpoint, cancellation: state.cancellation });
      previous = signature; lastAt = at; return true;
    } catch { return false; } // An optional observer cannot alter eligibility.
  };
}

/** Acquire all in-process admission reservations without yielding. Failure of
 * either provider rolls back only this attempt's already acquired handles. */
function reserveBundleShutdown(providers) {
  const handles = []; let released = false;
  const release = () => {
    if (released) return; released = true;
    for (const handle of handles.reverse()) { try { handle.release(); } catch { /* fail closed at the provider */ } }
  };
  try {
    for (const provider of providers) {
      if (typeof provider !== 'function') throw Error('Missing shutdown admission');
      const handle = provider();
      if (handle && typeof handle.release === 'function') handles.push(handle);
      if (!handle || typeof handle.isCurrent !== 'function' || typeof handle.release !== 'function' || handle.isCurrent() !== true) throw Error('Busy shutdown admission');
    }
    if (!handles.length) throw Error('Missing shutdown admission');
    const isCurrent = () => {
      try { return !released && handles.every(handle => handle.isCurrent() === true); } catch { return false; }
    };
    if (!isCurrent()) throw Error('Changed shutdown admission');
    return Object.freeze({ isCurrent, release });
  } catch { release(); return null; }
}

// Diagnostic events are deliberately independent of permissions and readiness.
const BUNDLE_LIFECYCLE_STAGES = Object.freeze([
  'close-dispatch', 'close-event', 'close-prevented', 'close-cancel-pending',
  'unload-prevented', 'contents-destroyed', 'window-closed', 'relaunch-entry',
  'restart-check', 'password-disconnect-start', 'password-disconnect-end',
  'supervisor-queue', 'supervisor-send-complete', 'quit-request', 'before-quit',
  'services-close-start', 'services-close-end', 'quit-retry'
]);
function observeBundleLifecycle(observer, stage) {
  if (!BUNDLE_LIFECYCLE_STAGES.includes(stage)) return false;
  try { observer?.(Object.freeze({ stage })); return true; }
  catch { return false; } // Optional observation must not change shutdown.
}

/** Retain session authority only after a replacement process is queued. */
async function queueDesktopRelaunch({ app, authorityTransition, parallelDevMode, process, observe }) {
  if (parallelDevMode) {
    if (!process.connected || typeof process.send !== 'function') throw Error('Restart this development app through the parallel development launcher.');
    await new Promise((resolve, reject) => {
      observeBundleLifecycle(observe, 'supervisor-queue');
      process.send({ type: 'thingtime-dev-restart' }, error => {
        if (error) { reject(Error('The development launcher did not accept the restart request.')); return; }
        observeBundleLifecycle(observe, 'supervisor-send-complete');
        authorityTransition.retainUntilRestart(); observeBundleLifecycle(observe, 'quit-request'); app.quit(); resolve();
      });
    });
  } else { app.relaunch(); authorityTransition.retainUntilRestart(); observeBundleLifecycle(observe, 'quit-request'); app.quit(); }
}

/** Both application activation entry points use this admission decision. */
function presentBundleWindow({ blocked, window, origin, create }) {
  if (blocked) return false;
  if (!window || window.isDestroyed()) {
    if (!origin) return false;
    create(); return true;
  }
  if (window.isMinimized()) window.restore();
  window.show(); window.focus(); return true;
}

/** All ordinary desktop IPC work is admitted before the close-start boundary.
 * Discovery/checkpoint messages use their own exact-sender protocol. */
function createBundleWorkAdmission({ closing, onStart }) {
  let active = 0;
  return {
    get active() { return active; },
    wrap(operation) { return async (...args) => {
      if (closing()) throw Error('Thingtime is finishing an update. Retry after it reopens.');
      active++; onStart();
      try { return await operation(...args); } finally { active--; }
    }; }
  };
}

/** Close start fences new work; actual accepted close commits relaunch. A renderer checkpoint is a
 * revocable lease, not permission to force-close or to bypass beforeunload. */
function createWebBundleActivation({ context, pending, checkpoint, release, closeAndRelaunch, timeoutMs = 10000 }) {
  let operation, controller, closed = false;
  const cancel = () => controller?.abort();
  function attempt() {
    if (closed) return Promise.resolve(false);
    if (operation) return operation;
    controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    const nonce = randomUUID();
    operation = (async () => {
      let initial;
      const assertCurrent = () => {
        signal.throwIfAborted();
        if (!initial || context() !== initial) throw Error('Activation context changed');
      };
      try {
        initial = context();
        if (!initial || !await withAbort(pending, signal)) return false;
        assertCurrent();
        const receipt = await withAbort(() => checkpoint({ nonce, signal }), signal);
        assertCurrent();
        if (receipt?.nonce !== nonce || receipt.ready !== true) return false;
        return await closeAndRelaunch({ signal, assertCurrent, nonce });
      } catch { return false; }
      finally { release(nonce); }
    })().finally(() => { operation = null; controller = null; });
    return operation;
  }
  return { attempt, cancel, close() { closed = true; cancel(); } };
}

/** Never queue app.relaunch while a window can veto close. In particular, a
 * sync close-to-hide and beforeunload refusal leave the old app fully usable. */
function closeForBundleActivation({ window, signal, assertCurrent, relaunch, onCloseState = () => {}, observe }) {
  return new Promise((resolve, reject) => {
    let accepted = false, started = false, settled = false, contents;
    const report = stage => observeBundleLifecycle(observe, stage);
    const cleanup = () => {
      window.removeListener('closed', onClosed); window.removeListener('close', onClose);
      contents?.removeListener('will-prevent-unload', onUnloadVeto);
      contents?.removeListener('destroyed', onDestroyed);
      signal.removeEventListener('abort', onAbort); onCloseState(false, accepted);
    };
    // A close already dispatched into Chromium cannot be cancelled natively.
    // Keep exactly one observer and the renderer's fail-closed unload veto
    // until Chromium reports refusal/acceptance; don't schedule another close.
    const onAbort = () => {
      if (settled) return;
      if (started) { report('close-cancel-pending'); return; }
      settled = true; cleanup(); resolve(false);
    };
    const onVeto = () => {
      if (settled) return;
      settled = true; cleanup(); resolve(false);
    };
    const onUnloadVeto = () => { report('unload-prevented'); onVeto(); };
    const onDestroyed = () => report('contents-destroyed');
    const onClose = event => { report(event.defaultPrevented ? 'close-prevented' : 'close-event'); if (event.defaultPrevented) onVeto(); };
    const onClosed = () => {
      if (settled) return;
      accepted = true; settled = true; report('window-closed'); cleanup();
      Promise.resolve().then(() => { report('relaunch-entry'); return relaunch(); }).then(() => resolve(true), reject);
    };
    try {
      // Retain the emitter before close: BrowserWindow.webContents is a native
      // getter which is unavailable after the window has been destroyed.
      assertCurrent(); signal.throwIfAborted(); contents = window.webContents;
      window.once('closed', onClosed); window.on('close', onClose);
      contents?.once('will-prevent-unload', onUnloadVeto);
      contents?.once('destroyed', onDestroyed);
      signal.addEventListener('abort', onAbort, { once: true });
      started = true; onCloseState(true); report('close-dispatch'); window.close();
    } catch (error) { cleanup(); reject(error); }
  });
}
module.exports = { BUNDLE_LIFECYCLE_STAGES, observeBundleLifecycle, BUNDLE_CHECKPOINT_REASONS, BUNDLE_CANCELLATION_REASONS, acceptBundleActivationCheckpoint, observeBundleIdle, bundleShutdownIdleState, projectBundleActivationEligibility, createBundleActivationDiagnosticReporter, queueDesktopRelaunch, sendBundleActivation, nativeBundleActivationAllowed, nativeRuntimeWorkLifecycle, reserveBundleShutdown, presentBundleWindow, createBundleWorkAdmission, BUNDLE_ACTIVATION_FEATURE, bundleActivationManifest, assertBundleActivationSender, createWebBundleActivation, closeForBundleActivation };
