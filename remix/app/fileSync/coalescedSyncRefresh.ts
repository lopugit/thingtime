/** At most one journal reader plus one trailing refresh for an event burst. */
export function coalescedSyncRefresh(read: () => Promise<void>, delayMs = 100) {
 let disposed = false, running = false, dirty = false;
 let timer: ReturnType<typeof setTimeout> | undefined;
 const run = async () => {
  timer = undefined;
  if (disposed || running) return;
  running = true; dirty = false;
  try { await read(); }
  finally {
   running = false;
   if (dirty && !disposed) timer = setTimeout(() => { void run(); }, delayMs);
  }
 };
 return {
  request() {
   if (disposed) return;
   if (running) { dirty = true; return; }
   if (timer === undefined) void run();
  },
  dispose() { disposed = true; dirty = false; clearTimeout(timer); }
 };
}
