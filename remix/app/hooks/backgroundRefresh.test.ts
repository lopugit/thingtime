import assert from 'node:assert/strict';
import test from 'node:test';
import { createBackgroundRefresh, type RefreshEnvironment } from './backgroundRefresh.ts';

const fixture = () => {
  let now = 0, online = true;
  const window = new EventTarget();
  const document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const refresh = createBackgroundRefresh({ window, document, online: () => online, now: () => now,
    setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimer: id => timers.delete(id as unknown as number)
  } as unknown as RefreshEnvironment);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  return { refresh, window, document, timers, flush, offline: () => { online = false; }, online: () => { online = true; },
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
test('hidden tabs poll slowly and immediately catch up on return', async () => {
  const f = fixture(); let calls = 0;
  f.document.visibilityState = 'hidden';
  f.refresh.subscribe('chat', () => { calls++; }, 5000); await f.flush();
  await f.advance(5000); assert.equal(calls, 1);
  await f.advance(55_000); assert.equal(calls, 2);
  await f.advance(2000); f.document.visibilityState = 'visible'; f.document.dispatchEvent(new Event('visibilitychange'));
  await f.flush(); assert.equal(calls, 3);
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
