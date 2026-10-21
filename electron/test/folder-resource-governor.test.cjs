'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { ResourceGovernor } = require('../lib/folder-resource-governor.cjs');
const { governedFetch, governedHash } = require('../lib/folder-transfer-process.cjs');

test('aggregate byte reservations do not multiply across simultaneous files or directions', async () => {
    let now = 0; const waits = [];
    const governor = new ResourceGovernor({ uploadBytesPerSecond: 1000, downloadBytesPerSecond: 2000 }, () => now,
        async ms => { waits.push(ms); now += ms; });
    const signal = new AbortController().signal;
    await Promise.all([governor.pace('upload', 500, signal), governor.pace('upload', 500, signal)]);
    assert.equal(governor.next.upload, 1000); assert.equal(governor.next.download, 0);
    await governor.pace('download', 500, signal); assert.equal(governor.next.download, 1250);
    assert.ok(waits.every(ms => ms <= 100));
});
test('CPU uses only named attributed scopes and recovers gradually within configured ceilings', () => {
    let now = 0;
    const governor = new ResourceGovernor({ cpuPercent: 20, transferConcurrency: 8, uploadBytesPerSecond: 1000 }, () => now);
    assert.throws(() => governor.sample('device-load', 99));
    assert.equal(governor.snapshot().cpuStatus, 'unavailable');
    governor.sample('transport-process', 35);
    assert.ok(governor.concurrency() < 8); assert.ok(governor.snapshot().uploadBytesPerSecond < 1000);
    const throttled = governor.factor;
    now += 250; governor.sample('transport-process', 1); assert.ok(governor.factor > throttled && governor.factor < 1);
    for (let i = 0; i < 100; i++) { now += 250; governor.sample('transport-process', 1); }
    assert.equal(governor.concurrency(), 8); assert.equal(governor.snapshot().uploadBytesPerSecond, 1000);
    assert.equal(governor.snapshot().scopeCpuBudgetPercent, 20 / 3);
});
test('cancel interrupts a low-rate wait and a queued file admission promptly', async () => {
    const governor = new ResourceGovernor({ uploadBytesPerSecond: 0.001, transferConcurrency: 1 });
    const first = new AbortController(), second = new AbortController();
    const release = await governor.acquire(first.signal);
    const queued = governor.acquire(second.signal); const paced = governor.pace('upload', 65536, second.signal);
    second.abort(); await assert.rejects(queued); await assert.rejects(paced); release(); assert.equal(governor.active, 0);
});
test('dedicated transport process enforces aggregate streaming rate on real loopback PUTs', async () => {
    let received = 0;
    const server = createServer(async (request, response) => { for await (const chunk of request) received += chunk.length; response.end(); });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const governor = new ResourceGovernor({ uploadBytesPerSecond: 1024, transferConcurrency: 2, cpuPercent: 100 });
        const target = new URL('http://127.0.0.1:' + server.address().port);
        const signal = AbortSignal.timeout(5000);
        assert.equal(await governedHash(governor, Buffer.from('payload'), signal), require('node:crypto').createHash('sha256').update('payload').digest('hex'));
        const start = performance.now();
        const replies = await Promise.all([1, 2].map(() => governedFetch(governor, globalThis.fetch, target,
            { signal, headers: {}, body: Buffer.alloc(512) })));
        assert.ok(replies.every(r => r.ok)); assert.equal(received, 1024);
        assert.ok(performance.now() - start >= 900, 'rate multiplied by simultaneous files');
        assert.equal(governor.snapshot().cpuStatus, 'measured'); assert.deepEqual(governor.snapshot().cpuScopes, ['transport-process']);
    } finally { server.close(); await once(server, 'close'); }
});
