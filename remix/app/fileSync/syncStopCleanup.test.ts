import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncStopCleanup } from './syncStopCleanup';
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
test('disable during journal opening waits for capture cleanup before journal close', async () => {
 const barrier = createSyncStopCleanup(), capture = gate(); const events: string[] = [];
 const stopping = barrier.request(); let settled = false; void stopping.then(() => { settled = true; });
 await Promise.resolve(); assert.equal(settled, false);
 barrier.install(async () => { events.push('pause'); await capture.promise; events.push('cancel-capture'); });
 const closing = barrier.finish().then(() => events.push('close-journal'));
 await Promise.resolve(); assert.equal(settled, false); assert.deepEqual(events, ['pause']);
 capture.resolve(); await stopping; await closing; assert.deepEqual(events, ['pause', 'cancel-capture', 'close-journal']);
});
test('concurrent activity and explicit Stop share one cleanup', async () => {
 let calls = 0; const barrier = createSyncStopCleanup();
 const first = barrier.request(), second = barrier.request(); assert.equal(first, second);
 barrier.install(async () => { calls++; }); await Promise.all([first, second, barrier.finish()]); assert.equal(calls, 1);
});
test('setup failure releases Stop with an explicit cleanup failure', async () => {
 const barrier = createSyncStopCleanup(async () => { throw Error('cleanup unavailable'); });
 const stop = barrier.request(); await assert.rejects(barrier.finish(), /cleanup unavailable/); await assert.rejects(stop, /cleanup unavailable/);
});
