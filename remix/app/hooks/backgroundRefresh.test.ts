import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundRefresh, type RefreshEnvironment } from './backgroundRefresh.ts';

const fixture = () => {
  let now = 0, online = true, idle = false;
  const presence = new Set<() => void>();
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const refresh = createBackgroundRefresh({ window, document, online: () => online, now: () => now,
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: id => timers.delete(id as unknown as number),
    idle: () => idle,
    onPresence: (listener: () => void) => { presence.add(listener); return () => { presence.delete(listener); }; }
  } as unknown as RefreshEnvironment);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { refresh, window, document, timers, flush, offline: () => { online = false; }, online: () => { online = true; },
    setIdle: (value: boolean) => { idle = value; for (const listener of [...presence]) listener(); }, listeners: () => presence.size,
    advance: async (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); }
  };
};
test('shared resources poll once and unsubscribe without leaking timers', async () => {
  const f = fixture(); let calls = 0;
  const off = f.refresh.subscribe('chat', () => { calls++; });
  const off2 = f.refresh.subscribe('chat', () => { calls++; });
  await f.flush(); assert.equal(calls, 1);
  await f.advance(15_000); assert.equal(calls, 2);
  off(); await f.advance(15_000); assert.equal(calls, 3);
  off2(); assert.equal(f.timers.size, 0);
  f.window.dispatchEvent(new Event('focus')); await f.flush(); assert.equal(calls, 3);
});
test('return, reconnect and page restoration refresh immediately, coalescing focus storms', async () => {
  const f = fixture(); let calls = 0;
  f.refresh.subscribe('chat', () => { calls++; }); await f.flush();
  await f.advance(2000); f.document.dispatchEvent(new Event('visibilitychange')); f.window.dispatchEvent(new Event('focus'));
  await f.flush(); assert.equal(calls, 2);
  await f.advance(2000); f.window.dispatchEvent(new Event('pageshow')); await f.flush(); assert.equal(calls, 3);
  f.offline(); await f.advance(60_000); assert.equal(calls, 3);
  f.online(); f.window.dispatchEvent(new Event('online')); await f.flush(); assert.equal(calls, 4);
});
test('hidden tabs stop polling entirely and catch up immediately on return', async () => {
  const f = fixture(); let calls = 0;
  f.document.visibilityState = 'hidden';
  f.refresh.subscribe('chat', () => { calls++; }, 5000); await f.flush();
  assert.equal(calls, 1, 'the first load still happens');
  await f.advance(10 * 60_000); assert.equal(calls, 1, 'nothing polls while hidden');
  assert.equal(f.timers.size, 0, 'no timer is left armed');
  f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'));
  await f.flush(); assert.equal(calls, 2, 'returning refreshes at once');
  await f.advance(5000); assert.equal(calls, 3, 'visible polling resumes');
  f.document.visibilityState = 'hidden'; f.document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.timers.size, 0, 'hiding cancels the pending poll');
  await f.advance(60_000); assert.equal(calls, 3);
});
test('idle users get no polling until they interact again', async () => {
  const f = fixture(); let calls = 0;
  const off = f.refresh.subscribe('chat', () => { calls++; }, 5000); await f.flush();
  await f.advance(5000); assert.equal(calls, 2);
  f.setIdle(true);
  assert.equal(f.timers.size, 0, 'going idle cancels the pending poll');
  await f.advance(60 * 60_000); assert.equal(calls, 2, 'an idle hour costs no requests');
  f.setIdle(false); await f.flush(); assert.equal(calls, 3, 'the next interaction refreshes at once');
  await f.advance(5000); assert.equal(calls, 4, 'active polling resumes');
  off(); assert.equal(f.listeners(), 0, 'the last unsubscribe releases the presence listener');
});
test('offline connectivity hints allow first load and foreground probes without background polling', async () => {
  const f = fixture(); let calls = 0;
  f.offline();
  const off = f.refresh.subscribe('local-embeds', () => { calls++; });
  await f.flush(); assert.equal(calls, 1, 'a reachable local API gets an initial request');
  await f.advance(60_000); assert.equal(calls, 1, 'offline background polling remains paused');
  f.window.dispatchEvent(new Event('focus'));
  f.window.dispatchEvent(new Event('pageshow'));
  await f.flush(); assert.equal(calls, 2, 'foreground revalidation probes once despite the connectivity hint');
  await f.advance(60_000); assert.equal(calls, 2);
  f.online(); f.window.dispatchEvent(new Event('online'));
  await f.flush(); assert.equal(calls, 3);
  off(); assert.equal(f.timers.size, 0);
});
test('a deferred subscription still waits before its first offline probe', async () => {
  const f = fixture(); let calls = 0;
  f.offline();
  const off = f.refresh.subscribe('deferred-local', () => { calls++; }, 5000, false);
  await f.flush(); assert.equal(calls, 0);
  await f.advance(5000); assert.equal(calls, 1);
  await f.advance(5000); assert.equal(calls, 1);
  off(); assert.equal(f.timers.size, 0);
});
test('slow requests never overlap and a return during a request catches up once', async () => {
  const f = fixture(); let calls = 0, resolve!: () => void;
  const off = f.refresh.subscribe('chat', () => { calls++; return new Promise<void>(r => { resolve = r; }); }, 3000);
  await f.advance(10_000); f.window.dispatchEvent(new Event('focus')); await f.flush(); assert.equal(calls, 1);
  resolve(); await f.flush(); assert.equal(calls, 2);
  off(); resolve(); await f.flush(); assert.equal(f.timers.size, 0);
});
test('failures back off and a new foreground event can retry', async () => {
  const f = fixture(); let calls = 0;
  f.refresh.subscribe('chat', () => { calls++; throw new Error('offline'); }, 5000); await f.flush();
  await f.advance(5000); assert.equal(calls, 1);
  await f.advance(5000); assert.equal(calls, 2);
  await f.advance(2000); f.window.dispatchEvent(new Event('focus')); await f.flush(); assert.equal(calls, 3);
});
