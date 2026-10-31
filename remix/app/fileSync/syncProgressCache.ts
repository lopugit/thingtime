/** Coalesce byte/index ticks without retaining writes after a task loses its
 * authorization or stops. Stage changes and terminal states persist promptly. */
export function createSyncProgressCache<T extends { stage: string }>(input: {
 signal: AbortSignal; check(): void; persist(value: T): void; prune(): void; intervalMs?: number;
}) {
 let timer: ReturnType<typeof setTimeout> | undefined, pending: T | undefined, stage: string | undefined, pruned = false, closed = false;
 const clear = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined; };
 const dispose = () => { closed = true; clear(); pending = undefined; input.signal.removeEventListener('abort', dispose); };
 const flush = () => {
  clear(); if (closed || input.signal.aborted || !pending) return;
  const value = pending; pending = undefined;
  input.check(); input.persist(value);
  if (!pruned) { input.prune(); pruned = true; }
 };
 input.signal.addEventListener('abort', dispose, { once: true });
 return {
  write(value: T) {
   if (closed || input.signal.aborted) return;
   input.check(); pending = value;
   if (stage !== value.stage || ['complete', 'retained'].includes(value.stage)) { stage = value.stage; flush(); }
   else if (timer === undefined) timer = setTimeout(() => { try { flush(); } catch { dispose(); } }, input.intervalMs ?? 500);
  }, dispose
 };
}
