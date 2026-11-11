'use strict';
/** Download in the background after healthy renderer startup. Staging never
 * reloads a live editor: the existing launch gate applies it on the next normal
 * process start. A later explicit safe-reload flow can use the same receipt. */
function createWebBundleUpdates({ store, downloader, timeoutMs = 10 * 60 * 1000 }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60 * 60 * 1000) throw new Error('Invalid update operation deadline');
  const controller = new AbortController();
  let operation, closed = false;
  let state = { status: 'idle', releaseId: null, version: null, completeBytes: 0, error: null };
  const snapshot = () => ({ ...state });
  function checkAndStage() {
    if (closed) return Promise.resolve(snapshot());
    if (operation) return operation;
    state = { status: 'checking', releaseId: null, version: null, completeBytes: 0, error: null };
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
    operation = (async () => {
      try {
        const current = await store.inspect(); signal.throwIfAborted();
        if (current.pending) { state = { ...state, status: 'pending', releaseId: current.pending.releaseId }; return snapshot(); }
        state = { ...state, status: 'checking' };
        const envelope = await downloader.check({ signal, minimumSequence: current.highestSequence }); signal.throwIfAborted();
        if (!envelope) { state = { ...state, status: 'current' }; return snapshot(); }
        state = { ...state, status: 'downloading', releaseId: envelope.releaseId, version: envelope.descriptor.version };
        const result = await downloader.download(envelope, { signal, onProgress: progress => {
          if (!closed) state = { ...state, completeBytes: progress.completeBytes };
        } }); signal.throwIfAborted();
        await store.stage(result.directory, envelope, { signal });
        state = { ...state, status: 'pending', completeBytes: result.completeBytes };
        try { await downloader.discard(envelope.releaseId); }
        catch { state = { ...state, error: 'The update is staged; its temporary download copy could not be removed.' }; }
      } catch (error) {
        state = { ...state, status: signal.aborted ? 'interrupted' : 'unavailable',
          error: signal.aborted ? 'The bundle update was interrupted; verified partial bytes are retained.' : 'The bundle update could not be verified. The running app is unchanged.' };
      }
      return snapshot();
    })().finally(() => { operation = null; });
    return operation;
  }
  return { snapshot, checkAndStage, close: async () => { closed = true; controller.abort(); await operation; } };
}
module.exports = { createWebBundleUpdates };
