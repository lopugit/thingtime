/** Bound actual network inactivity while excluding intentional governor waits.
 * Never use this for authorization or metadata/control-phase deadlines. */
export function createSyncTransferDeadline(signal?: AbortSignal, timeoutMs = 120000) {
 const controller = new AbortController(), active = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
 let timer: ReturnType<typeof setTimeout> | undefined, paused = 0, disposed = false;
 const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
 const dispose = () => { disposed = true; clear(); active.removeEventListener('abort', dispose); };
 const resume = () => { if (paused) paused--; clear(); if (!paused && !disposed && !active.aborted) timer = setTimeout(() => controller.abort(new DOMException('Sync network stalled', 'TimeoutError')), timeoutMs); };
 active.addEventListener('abort', dispose, { once: true }); resume();
 return { signal: active, pause: () => { paused++; clear(); }, resume, dispose };
}
