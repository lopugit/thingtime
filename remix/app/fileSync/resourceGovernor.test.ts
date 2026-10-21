import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SyncResourceGovernor, parseSyncResourceStatus } from './resourceGovernor';
const sample = (cpuPercent: number) => ({ version: 1 as const, cpuPercent, cpuStatus: 'measured' as const, effectiveTransferConcurrency: 4, effectiveIndexingConcurrency: 4 });
test('concurrent transfers share directional byte budgets', async () => {
 let now = 0; const waits: number[] = [];
 const g = new SyncResourceGovernor({ uploadBytesPerSecond: 1000, downloadBytesPerSecond: 2000 }, () => now, async ms => { waits.push(ms); now += ms; });
 await Promise.all([g.pace('upload', 100), g.pace('upload', 100)]); assert.equal(now, 200); assert.deepEqual(waits, [100, 100]);
 await g.pace('download', 200); assert.equal(now, 300);
});
test('scoped CPU feedback reduces and recovers within user ceilings; unknown CPU stays unknown', () => {
 const g = new SyncResourceGovernor({ cpuPercent: 20, transferConcurrency: 8, indexingConcurrency: 4, uploadBytesPerSecond: 1000 });
 assert.equal(g.status().cpuPercent, null); g.observe(sample(60)); assert.equal(g.status().effectiveTransferConcurrency, 6); assert.equal(g.status().uploadBytesPerSecond, 750);
 for (let i = 0; i < 30; i++) g.observe(sample(1));
 assert.equal(g.status().effectiveTransferConcurrency, 8); assert.equal(g.status().uploadBytesPerSecond, 1000);
 g.observe({ ...sample(0), cpuPercent: null, cpuStatus: 'unavailable' }); assert.equal(g.status().cpuPercent, null);
 assert.throws(() => parseSyncResourceStatus(sample(101)));
});
test('transfer slot queues cancel immediately and releases are idempotent', async () => {
 const g = new SyncResourceGovernor({ transferConcurrency: 1 }), release = await g.acquire();
 const cancel = new AbortController(), blocked = g.acquire(cancel.signal); cancel.abort(); await assert.rejects(blocked, { name: 'AbortError' }); release();
 const next = await g.acquire(); next(); next(); const final = await g.acquire(); final();
});
test('Pause interrupts active and queued rate waits without poisoning the lane', async () => {
 const g = new SyncResourceGovernor({ uploadBytesPerSecond: 1 }), first = new AbortController(), second = new AbortController();
 const active = g.pace('upload', 10, first.signal), queued = g.pace('upload', 10, second.signal);
 second.abort(); await assert.rejects(queued, { name: 'AbortError' }); first.abort(); await assert.rejects(active, { name: 'AbortError' }); await g.pace('upload', 0);
});
test('stream backpressure emits bounded slices from an existing chunk', async () => {
 let now = 0; const g = new SyncResourceGovernor({ downloadBytesPerSecond: 1_000_000 }, () => now, async ms => { now += ms; });
 const original = new Uint8Array(150_000).fill(7), reader = g.stream('download', new ReadableStream({ start(c) { c.enqueue(original); c.close(); } })).getReader();
 let size = 0; for (;;) { const next = await reader.read(); if (next.done) break; assert.ok(next.value.length <= 65536); size += next.value.length; }
 assert.equal(size, original.length); assert.ok(now >= 150);
});
