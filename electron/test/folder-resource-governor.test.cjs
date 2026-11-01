'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { ResourceGovernor } = require('../lib/folder-resource-governor.cjs');
const { governedFetch, governedHash, governedDownload } = require('../lib/folder-transfer-process.cjs');

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

test('cancelled slow pacing cannot poison immediate reuse after a policy change', async () => {
    const governor = new ResourceGovernor({ uploadBytesPerSecond: 0.001 });
    const cancel = new AbortController(), pending = governor.pace('upload', 65536, cancel.signal);
    assert.ok(governor.next.upload > performance.now() + 1000000000);
    cancel.abort(); await assert.rejects(pending);
    assert.ok(governor.next.upload <= performance.now());
    governor.setLimits({ uploadBytesPerSecond: 1e12 });
    await governor.pace('upload', 65536, AbortSignal.timeout(500));
    assert.equal(governor.pacing.upload, 0);
});
test('cancel cleanup and permit release retain live reservations and isolate directions', async () => {
    const governor = new ResourceGovernor({ uploadBytesPerSecond: 0.001, downloadBytesPerSecond: 0.001 });
    const first = new AbortController(), second = new AbortController(), downloading = new AbortController();
    const release = await governor.acquire(new AbortController().signal);
    const one = governor.pace('upload', 65536, first.signal), two = governor.pace('upload', 65536, second.signal);
    const down = governor.pace('download', 65536, downloading.signal);
    const uploadDebt = governor.next.upload, downloadDebt = governor.next.download;
    first.abort(); await assert.rejects(one); release();
    assert.equal(governor.next.upload, uploadDebt); assert.equal(governor.pacing.upload, 1);
    second.abort(); await assert.rejects(two);
    assert.ok(governor.next.upload <= performance.now()); assert.equal(governor.next.download, downloadDebt);
    downloading.abort(); await assert.rejects(down); assert.equal(governor.pacing.download, 0);
    assert.ok(governor.next.download <= performance.now());
});
test('native CPU percentages require whole integers while fractional byte rates remain valid', () => {
    assert.throws(() => new ResourceGovernor({ cpuPercent: 1.5 }));
    assert.throws(() => new ResourceGovernor({ cpuPercent: 99.9 }));
    assert.doesNotThrow(() => new ResourceGovernor({ cpuPercent: 1, uploadBytesPerSecond: 0.001, downloadBytesPerSecond: 312.5 }));
});

test('low bandwidth uses small prompt chunks and no direction exceeds its budget', async () => {
    let now = 0; const waits = [];
    const governor = new ResourceGovernor({ uploadBytesPerSecond: 312.5, downloadBytesPerSecond: 625 }, () => now, async ms => { waits.push(ms); now += ms; });
    assert.equal(governor.quantum('upload'), 31); assert.equal(governor.quantum('download'), 62);
    const reader = governor.body(Buffer.alloc(100), new AbortController().signal).getReader();
    const first = await reader.read(); assert.equal(first.value.length, 31); assert.ok(now <= 100);
    let bytes = first.value.length;
    for (;;) { const next = await reader.read(); if (next.done) break; bytes += next.value.length; }
    assert.equal(bytes, 100); assert.ok(now >= 320); assert.ok(waits.every(ms => ms <= 100));
});


test('queued PUT and GET resolve fresh targets only after child transfer admission', async () => {
    let entered, unblock, released = false, refreshed = 0;
    const firstEntered = new Promise(resolve => { entered = resolve; });
    const releaseFirst = new Promise(resolve => { unblock = resolve; });
    const paths = [];
    const server = createServer(async (request, response) => {
        paths.push(request.url);
        for await (const chunk of request) { }
        if (request.url === '/first') { entered(); await releaseFirst; }
        if (request.method === 'GET') {
            response.writeHead(206, { 'Content-Range': 'bytes 0-3/4', 'Content-Length': '4' });
            response.end('data');
        } else response.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const governor = new ResourceGovernor({ transferConcurrency: 1, uploadBytesPerSecond: 1e9 });
        const signal = AbortSignal.timeout(5000);
        const first = governedFetch(governor, globalThis.fetch, base + '/first', { signal, headers: {}, body: Buffer.from('one') });
        await firstEntered;
        const fresh = method => async () => {
            assert.equal(released, true, 'signature refreshed before queued admission'); refreshed++;
            return { url: base + '/fresh-' + method, headers: method === 'get' ? { Range: 'bytes=0-3' } : {}, expiresAt: new Date(Date.now() + 60000).toISOString() };
        };
        const put = governedFetch(governor, globalThis.fetch, base + '/stale-put',
            { signal, headers: {}, body: Buffer.from('two'), refreshTarget: fresh('put') });
        const get = governedDownload(governor, { url: base + '/stale-get', headers: { Range: 'bytes=0-3' },
            offset: 0, length: 4, size: 4, expiresAt: new Date(Date.now() + 60000).toISOString() }, signal, () => {}, fresh('get'));
        await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(refreshed, 0);
        released = true; unblock();
        const replies = await Promise.all([first, put, get]);
        assert.equal(replies[0].ok, true); assert.equal(replies[1].ok, true);
        assert.equal(Buffer.from(replies[2].bytes).toString(), 'data');
        assert.equal(refreshed, 2); assert.deepEqual(paths, ['/first', '/fresh-put', '/fresh-get']);
    } finally { unblock(); server.close(); await once(server, 'close'); }
});
