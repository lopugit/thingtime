/** One independent queue loop. A pending pass never blocks another pump, and
 * a wake during that pass is retained for the next iteration. */
export function createSyncPump(enabled: () => boolean, pass: () => Promise<number | null>) {
 let running = false, requested = false, stopped = false;
 let timer: ReturnType<typeof setTimeout> | null = null;
 const wake = () => {
  if (stopped || !enabled()) return;
  if (running) { requested = true; return; }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void drain(); }, 0);
 };
 const drain = async () => {
  if (stopped || running || !enabled()) return;
  running = true;
  try {
   const delay = await pass();
   if (!stopped && delay !== null) timer = setTimeout(wake, Math.max(1000, Math.min(60_000, delay)));
  } catch { /* Durable queues retain failures; identity retirement stops them. */ }
  finally {
   running = false;
   if (requested) { requested = false; wake(); }
  }
 };
 return { wake, stop() { stopped = true; if (timer) clearTimeout(timer); } };
}
