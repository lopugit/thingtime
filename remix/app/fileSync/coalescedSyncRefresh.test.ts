import assert from 'node:assert/strict';
import test from 'node:test';
import { coalescedSyncRefresh } from './coalescedSyncRefresh';
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
test('journal change storm has one reader and one trailing refresh', async () => {
 let calls = 0, active = 0, peak = 0, release!: () => void;
 const hold = new Promise<void>(resolve => { release = resolve; });
 const refresh = coalescedSyncRefresh(async () => { calls++; active++; peak = Math.max(peak, active); if (calls === 1) await hold; active--; }, 0);
 refresh.request(); for (let i = 0; i < 1000; i++) refresh.request();
 assert.equal(calls, 1); release(); await tick();
 assert.equal(calls, 2); assert.equal(peak, 1); refresh.dispose();
});
test('unmount cancels trailing read and ignores future events', async () => {
 let calls = 0, release!: () => void;
 const hold = new Promise<void>(resolve => { release = resolve; });
 const refresh = coalescedSyncRefresh(async () => { calls++; await hold; }, 0);
 refresh.request(); refresh.request(); refresh.dispose(); release(); await tick(); refresh.request(); assert.equal(calls, 1);
});
