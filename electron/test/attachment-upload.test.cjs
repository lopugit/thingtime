'use strict';

const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { once } = require('node:events');
const { createServer } = require('node:http');
const test = require('node:test');
const { DesktopAttachmentUpload } = require('../lib/attachment-upload.cjs');

const origin = 'https://thingtime.example';
const uploadId = 'att_' + 'a'.repeat(64);
const sha = bytes => createHash('sha256').update(bytes).digest('base64');
const refused = /File upload could not be verified/;
const chunkSize = 256 * 1024;

function fixture(put, overrides = {}) {
    const appOrigin = 'http://127.0.0.1:54000';
    const frame = { url: appOrigin + '/things' };
    const sender = { mainFrame: frame };
    const event = { sender, senderFrame: frame };
    const context = { enabled: true, appOrigin, apiOrigin: origin, window: { webContents: sender, isDestroyed: () => false } };
    const host = new DesktopAttachmentUpload({
        context: () => context,
        verifyAccount: async context => assert.equal(context.ownerId, 'owner'),
        capabilities: async () => ({ features: { 'api.attachment-upload-parts': { version: '1.1.0' } } }),
        signPart: async (context, input) => {
            assert.equal(context.apiOrigin, origin);
            assert.equal(input.uploadId, uploadId);
            const [{ partNumber, checksumSha256 }] = input.parts;
            const target = new URL('https://fixture.s3.ap-southeast-2.amazonaws.com/objects/' + uploadId);
            target.search = new URLSearchParams({
                partNumber: String(partNumber), uploadId: 'multipart-id', 'x-id': 'UploadPart',
                'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Signature': 'fixture',
                'X-Amz-SignedHeaders': 'content-length;host;x-amz-checksum-sha256'
            });
            return { parts: [{ partNumber, url: target.href, headers: { 'x-amz-checksum-sha256': checksumSha256 } }] };
        },
        put,
        ...overrides
    });
    const identity = { version: '1.0.0', requestId: randomUUID() };
    const request = (action, args = {}, sender = event) => host.request(sender, { ...identity, action, ...args });
    const open = (bytes, args = {}) => request('open', {
        origin, ownerId: 'owner', uploadId, partNumber: 1, length: bytes.length, checksum: sha(bytes), ...args
    });
    return { host, context, event, request, open };
}

test('selected Mac Files bytes stream into the signed PUT without renderer CORS or credentials', async t => {
    const payload = Buffer.alloc(3 * chunkSize + 31, 73);
    let received;
    const receiver = createServer(async (request, response) => {
        if (request.method === 'OPTIONS') return response.writeHead(403).end();
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        received = { method: request.method, headers: request.headers, body: Buffer.concat(chunks) };
        response.writeHead(200).end();
    }).listen(0, '127.0.0.1');
    await once(receiver, 'listening');
    t.after(() => { receiver.closeAllConnections(); receiver.close(); });
    const f = fixture((target, options) => {
        assert.equal(target.hostname, 'fixture.s3.ap-southeast-2.amazonaws.com');
        return fetch(new URL(target.pathname + target.search, 'http://127.0.0.1:' + receiver.address().port), options);
    });
    await f.open(payload);
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
        await f.request('chunk', { offset, bytes: payload.subarray(offset, offset + chunkSize) });
    }
    await f.request('finish');
    assert.equal(received.method, 'PUT');
    assert.equal(received.headers.origin, undefined);
    assert.equal(received.headers.cookie, undefined);
    assert.equal(received.headers['content-length'], String(payload.length));
    assert.equal(received.headers['x-amz-checksum-sha256'], sha(payload));
    assert.deepEqual(received.body, payload);
    assert.equal(f.host.active.size, 0);
});

test('refuses a foreign frame, origin, account, incompatible capability and unsigned destination', async () => {
    let puts = 0;
    const put = async () => { puts++; return new Response(); };
    const payload = Buffer.from('fixture');
    const f = fixture(put);
    await assert.rejects(f.request('open', {}, { ...f.event, senderFrame: { url: f.context.appOrigin } }), refused);
    await assert.rejects(f.open(payload, { origin: 'https://other.example' }), refused);
    await assert.rejects(f.open(payload, { ownerId: 'other' }), refused);
    await assert.rejects(fixture(put, { capabilities: async () => ({ features: {} }) }).open(payload), refused);
    await assert.rejects(fixture(put, { signPart: async (_context, { parts }) => ({ parts: [
        { partNumber: 1, url: 'https://attacker.example/objects/' + uploadId,
            headers: { 'x-amz-checksum-sha256': parts[0].checksumSha256 } }
    ] }) }).open(payload), refused);
    assert.equal(puts, 0);
});

test('cancellation releases backpressure and account invalidation fences publication', async () => {
    const pendingPut = (_target, options) => once(options.signal, 'abort').then(() => { throw options.signal.reason; });
    const payload = Buffer.alloc(chunkSize * 2);
    const f = fixture(pendingPut);
    await f.open(payload);
    const waiting = f.request('chunk', { offset: 0, bytes: payload.subarray(0, chunkSize) });
    const cancelled = assert.rejects(waiting, refused);
    await f.request('cancel');
    await cancelled;
    assert.equal(f.host.active.size, 0);

    const done = fixture(async (_target, options) => {
        for await (const _ of options.body) { /* drain bytes */ }
        return new Response();
    });
    await done.open(payload);
    done.host.invalidate();
    await assert.rejects(done.request('chunk', { offset: 0, bytes: payload.subarray(0, chunkSize) }), refused);
    assert.equal(done.host.active.size, 0);
});

test('refuses oversized chunks, wrong offsets, incomplete parts and corrupted bytes', async () => {
    const payload = Buffer.alloc(chunkSize + 1);
    const f = fixture(async (_target, options) => {
        for await (const _ of options.body) { /* drain bytes */ }
        return new Response();
    });
    await f.open(payload);
    await assert.rejects(f.request('chunk', { offset: 0, bytes: payload }), refused);
    await f.open(payload);
    await assert.rejects(f.request('chunk', { offset: 1, bytes: payload.subarray(0, chunkSize) }), refused);
    await f.open(payload);
    await assert.rejects(f.request('finish'), refused);
    await f.open(Buffer.from('expected'));
    await assert.rejects(f.request('chunk', { offset: 0, bytes: Buffer.from('tampered') }), refused);
    await assert.rejects(f.request('finish'), refused);
    assert.equal(f.host.active.size, 0);
});
