'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FolderStream } = require('../lib/folder-stream.cjs');
const { runProcess } = require('../lib/thingtime-node-bridge.cjs');
const request = (length = 8 * 1024 * 1024 + 17) => ({ id: 'wire', method: 'folder-sync.request', parameters: {
    action: 'read-range', requestId: 'request', ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test',
    rootId: 'root', path: 'file', version: 'v1', offset: 3, length
} });
const line = value => Buffer.from(JSON.stringify(value) + '\n');
const result = r => ({ type: 'result', response: { id: r.id, ok: true, result: { ...r.parameters, roots: [],
    chunk: { version: 'v1', offset: 3, size: r.parameters.length + 3, length: r.parameters.length } } } });
test('fragmented and coalesced frames reconstruct a multipart-sized binary range', () => {
    const r = request(), reader = new FolderStream(r), expected = Buffer.alloc(r.parameters.length, 19), frames = [];
    for (let at = 0; at < expected.length; at += 65536) frames.push(line({ type: 'chunk', offset: at, data: expected.subarray(at, at + 65536).toString('base64') }));
    frames.push(line(result(r)));
    const wire = Buffer.concat(frames);
    for (let at = 0; at < wire.length; at += 137091) reader.write(wire.subarray(at, at + 137091));
    assert.deepEqual(reader.finish().result.chunk.bytes, expected);
});
test('partial, repeated, reordered, oversized and mismatched streams never expose bytes', () => {
    const r = request(3), chunk = { type: 'chunk', offset: 0, data: 'AQID' };
    for (const frames of [[], [chunk], [result(r)], [chunk, chunk], [{ ...chunk, offset: 1 }],
        [{ ...chunk, data: 'AQIDBA==' }], [{ ...chunk, data: 'AR==' }],
        [chunk, { ...result(r), response: { ...result(r).response, id: 'other' } }],
        [chunk, result(r), chunk]]) {
        assert.throws(() => { const reader = new FolderStream(r); frames.forEach(f => reader.write(line(f))); reader.finish(); });
    }
    for (const key of ['ownerId', 'deviceId', 'origin', 'rootId', 'path', 'requestId']) {
        const finish = result(r); finish.response.result[key] = 'other';
        assert.throws(() => { const reader = new FolderStream(r); reader.write(line(chunk)); reader.write(line(finish)); reader.finish(); });
    }
    assert.throws(() => new FolderStream(request(32 * 1024 * 1024 + 1)));
    assert.throws(() => new FolderStream(r).write(Buffer.alloc(1048577, 65)));
});
test('late native refusal discards provisional chunks', () => {
    const r = request(3), reader = new FolderStream(r);
    reader.write(line({ type: 'chunk', offset: 0, data: 'AQID' }));
    reader.write(line({ type: 'result', response: { id: r.id, ok: false, error: { code: 'revoked' } } }));
    assert.deepEqual(reader.finish(), { id: 'wire', ok: false, error: { code: 'revoked' } });
});
test('real child pipe streams without stdout accumulation, and cancellation terminates stalled reads', async () => {
    let count = 0;
    const result = await runProcess(process.execPath, ['-e', 'process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 7))'], {
        maximumOutputBytes: 1, onStdout: bytes => { count += bytes.length; }, timeoutMs: 5000
    });
    assert.equal(result.status, 0); assert.equal(count, 2 * 1024 * 1024); assert.equal(result.stdout, '');
    const abort = new AbortController();
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'], {
        signal: abort.signal, onStdout: () => abort.abort(), timeoutMs: 5000
    }), /cancelled/);
    await assert.rejects(runProcess(process.execPath, ['-e', 'process.stdout.write("bad"); setInterval(() => {}, 1000)'], {
        onStdout: () => { throw Error('Bad frame'); }, timeoutMs: 5000
    }), /invalid stream/);
});
