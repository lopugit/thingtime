'use strict';

/** Startup gate only: an event-loop timer cannot detect a frozen main process.
 * close() prevents new confirmation and recovery callbacks. A confirmation
 * already executing in the store cannot be cancelled by this interface.
 */
function createWebBundleLaunch({ store, onFailure, timeoutMs = 60000, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!store || typeof store.prepareLaunch !== 'function' || typeof store.confirmLaunch !== 'function' || typeof onFailure !== 'function') {
    throw new TypeError('Require a bundle store and failure callback');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Require a positive startup deadline');
  let selection, preparation, confirmation, failure, failureError, timer;
  let closed = false, failed = false, confirmed = false, server = false, renderer = false;
  function cancelTimer() { if (timer !== undefined) { clearTimer(timer); timer = undefined; } }
  function fail(error) {
    if (closed || confirmed || failed || selection?.source !== 'trial') return Promise.resolve(false);
    failed = true;
    cancelTimer();
    failure = Promise.resolve().then(async () => {
      if (!closed) await onFailure(error);
      return true;
    });
    // Retain callback errors for inspection as well as rejecting the promise
    // returned to explicit callers. Timers have no caller to await rejection.
    failure.catch(error => { failureError = error; });
    return failure;
  }
  function prepare() {
    if (!preparation) preparation = Promise.resolve().then(() => {
      if (closed) throw new Error('Bundle launch is closed');
      return store.prepareLaunch();
    }).then(result => {
      selection = result;
      if (!closed && result.source === 'trial') {
        timer = setTimer(() => { if (timer !== undefined) void fail(new Error('Bundle startup deadline exceeded')); }, timeoutMs);
        timer?.unref?.();
      }
      return result;
    });
    return preparation;
  }
  function ready(kind) {
    if (closed || failed || confirmed || selection?.source !== 'trial') return Promise.resolve(false);
    if (kind === 'server') server = true; else renderer = true;
    if (!server || !renderer) return Promise.resolve(false);
    if (!confirmation) confirmation = Promise.resolve().then(async () => {
      if (closed || failed) return false;
      // Both actual startup gates are satisfied. Filesystem confirmation is a
      // separate operation: a timer cannot cancel its durable commit safely.
      cancelTimer();
      try {
        await store.confirmLaunch(selection.releaseId);
      } catch (error) {
        await fail(error);
        return false;
      }
      if (closed || failed) return false;
      confirmed = true;
      cancelTimer();
      return true;
    });
    return confirmation;
  }
  return {
    prepare, get selection() { return selection; },
    serverReady: () => ready('server'), rendererReady: () => ready('renderer'), fail,
    get failure() { return failure; }, get failureError() { return failureError; },
    close() { closed = true; cancelTimer(); }
  };
}

module.exports = { createWebBundleLaunch };
