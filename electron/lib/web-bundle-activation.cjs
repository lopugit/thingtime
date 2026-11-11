'use strict';
const { randomUUID } = require('node:crypto');
const BUNDLE_ACTIVATION_FEATURE = Object.freeze({ version: '1.0.0', methods: Object.freeze(['set-policy', 'checkpoint']) });
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

/** Detached local-account API jobs do not yet share shutdown admission.
 * Only a positively initialized, unchanged remote-account lane can activate. */
function remoteAccountBundleActivationAllowed({ initialized, runtime }) {
  return initialized === true && Boolean(runtime) && runtime.runningEnabled === false && runtime.state?.enabled === false &&
    runtime.error === null && runtime.child === null && runtime.restartRequired !== true;
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

/** Retain session authority only after a replacement process is queued. */
async function queueDesktopRelaunch({ app, authorityTransition, parallelDevMode, process }) {
  if (parallelDevMode) {
    if (!process.connected || typeof process.send !== 'function') throw Error('Restart this development app through the parallel development launcher.');
    await new Promise((resolve, reject) => {
      process.send({ type: 'thingtime-dev-restart' }, error => {
        if (error) { reject(Error('The development launcher did not accept the restart request.')); return; }
        authorityTransition.retainUntilRestart(); app.quit(); resolve();
      });
    });
  } else { app.relaunch(); authorityTransition.retainUntilRestart(); app.quit(); }
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
function closeForBundleActivation({ window, signal, assertCurrent, relaunch, onCloseState = () => {} }) {
  return new Promise((resolve, reject) => {
    let accepted = false, started = false;
    const cleanup = () => {
      window.removeListener('closed', onClosed); window.removeListener('close', onClose);
      window.webContents?.removeListener('will-prevent-unload', onVeto);
      signal.removeEventListener('abort', onAbort); onCloseState(false, accepted);
    };
    // A close already dispatched into Chromium cannot be cancelled natively.
    // Keep exactly one observer and the renderer's fail-closed unload veto
    // until Chromium reports refusal/acceptance; don't schedule another close.
    const onAbort = () => { if (!accepted) { if (!started) cleanup(); resolve(false); } };
    const onVeto = () => { cleanup(); resolve(false); };
    const onClose = event => { if (event.defaultPrevented) onVeto(); };
    const onClosed = () => {
      accepted = true; cleanup();
      Promise.resolve().then(relaunch).then(() => resolve(true), reject);
    };
    try {
      assertCurrent(); signal.throwIfAborted();
      window.once('closed', onClosed); window.on('close', onClose);
      window.webContents?.once('will-prevent-unload', onVeto);
      signal.addEventListener('abort', onAbort, { once: true });
      started = true; onCloseState(true); window.close();
    } catch (error) { cleanup(); reject(error); }
  });
}
module.exports = { queueDesktopRelaunch, sendBundleActivation, remoteAccountBundleActivationAllowed, reserveBundleShutdown, presentBundleWindow, createBundleWorkAdmission, BUNDLE_ACTIVATION_FEATURE, bundleActivationManifest, assertBundleActivationSender, createWebBundleActivation, closeForBundleActivation };
