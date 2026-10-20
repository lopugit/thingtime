'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { createServer } = require('node:http');
const { once } = require('node:events');
const { uploadFolderPart } = require('../lib/folder-upload.cjs');
const { DesktopFolderSync } = require('../lib/folder-sync.cjs');
const { signDesktopUploadPart } = require('../lib/folder-sync.cjs');
const bytes = Buffer.from('real nonempty fixture bytes');
const hash = createHash('sha256').update(bytes).digest('hex');
test('desktop signing POST passes the loopback expected-actor origin fence using only the trusted context', async () => {
    let origin, accepted = 0;
    const diagnostics = [];
    const server = createServer((request, response) => {
        // Same guard as the desktop Nitro expected-actor proxy. No CORS or
        // permissive fallback: absent and mismatched origins must fail closed.
        if (request.headers['sec-fetch-site'] === 'cross-site' ||
            (request.method !== 'GET' && request.headers.origin !== origin)) {
            response.writeHead(403, { 'Content-Type': 'application/json' }); response.end('{}'); return;
        }
        assert.equal(request.url, '/api/v1/attachments/uploads/parts');
        assert.equal(request.headers['x-thingtime-expected-actor'], 'fixture-owner');
        assert.equal(request.headers['x-thingtime-expected-api-origin'], 'https://fixture.invalid');
        accepted++;
        response.writeHead(200, { 'Content-Type': 'application/json', 'x-thingtime-api-fallback': 'https://fixture.invalid' });
        response.end('{"parts":[]}');
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    origin = `http://127.0.0.1:${server.address().port}`;
    const context = { ownerId: 'fixture-owner', appOrigin: origin, apiOrigin: 'https://fixture.invalid',
        window: { webContents: { session: { fetch: (url, options) => fetch(url, options) } } } };
    try {
        for (const badOrigin of [undefined, 'https://untrusted.invalid']) {
            const headers = badOrigin ? { Origin: badOrigin } : {};
            assert.equal((await fetch(origin + '/api/v1/attachments/uploads/parts', { method: 'POST', headers })).status, 403);
        }
        assert.deepEqual(await signDesktopUploadPart(context, { uploadId: 'fixture', parts: [], origin: 'https://untrusted.invalid' },
            new AbortController().signal, 20_000, value => diagnostics.push(value)), { parts: [] });
        assert.equal(accepted, 1); assert.deepEqual(diagnostics, []);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('signer diagnostics contain fixed phase/status only, including bodies and transport messages with private values', async () => {
    const records = [], signal = new AbortController().signal;
    const context = { ownerId: 'private-owner', appOrigin: 'http://127.0.0.1:54000', apiOrigin: 'https://private.invalid',
        window: { webContents: { session: { fetch: async () => new Response('private-body-secret', { status: 403 }) } } } };
    await assert.rejects(signDesktopUploadPart(context, {}, signal, 20_000, value => records.push(value)));
    context.window.webContents.session.fetch = async () => { throw Error('https://private.invalid/path?credential=secret'); };
    await assert.rejects(signDesktopUploadPart(context, {}, signal, 20_000, value => records.push(value)));
    assert.deepEqual(records, [ { phase: 'upload-sign', code: 'http-rejected', status: 403 },
        { phase: 'upload-sign', code: 'transport-refused', status: 0 } ]);
    assert.ok(!/private|secret|credential|https|owner/.test(JSON.stringify(records)));
});
function fixture() {
    const controller = new AbortController(), events = [];
    const input = { requestId: randomUUID(), ownerId: 'owner', deviceId: 'device', rootId: randomUUID(),
        upload: { uploadId: 'att_fixture', requestId: randomUUID(), partNumber: 1, offset: 0, length: bytes.length,
            source: { id: 'inode', kind: 'file', path: 'file', version: 'v1', size: bytes.length } } };
    const f = { input, context: { ownerId: 'owner', apiOrigin: 'https://api.test' }, signal: controller.signal,
        authorize: async () => { events.push('authorize'); },
        requestNative: async request => {
            events.push(request.action);
            assert.ok(request.length > 0, 'The native reader rejects zero-length read requests');
            assert.ok(request.offset >= 0 && request.offset <= bytes.length);
            return { ...request, chunk: { size: bytes.length, version: 'v1', offset: request.offset, length: request.length,
                ...(request.action === 'read-range' ? { bytes: new Uint8Array(bytes) } : {
                    data: bytes.subarray(request.offset, request.offset + request.length).toString('base64') }) } };
        },
        signPart: async body => { events.push('sign'); return { parts: [{ ...body.parts[0],
            url: 'https://bucket.s3.ap-southeast-2.amazonaws.com/objects/fixture?partNumber=1&uploadId=opaque&x-id=UploadPart',
            headers: { 'x-amz-checksum-sha256': body.parts[0].checksumSha256 } }] }; },
        fetchUpload: async (target, options) => {
            events.push('put'); assert.equal(target.protocol, 'https:'); assert.equal(options.credentials, 'omit');
            assert.equal(options.redirect, 'error'); assert.deepEqual(Buffer.from(options.body), bytes);
            assert.deepEqual(Object.keys(options.headers), ['x-amz-checksum-sha256']); return new Response(null, { status: 200 });
        }
    };
    return { f, controller, events };
}
test('host-issued part signing retains exact native source and digest receipt', async () => {
    const { f, events } = fixture(); const result = await uploadFolderPart(f);
    assert.equal(result.uploadedPart.sha256, hash); assert.equal(result.uploadedPart.requestId, f.input.upload.requestId);
    assert.equal(result.requestId, f.input.requestId); assert.equal(result.rootId, f.input.rootId);
    assert.deepEqual(events.filter(x => x !== 'authorize'), ['read-range', 'sign', 'read', 'put', 'read']);
});
test('EOF revalidation rejects mismatched offsets or nonempty returned data before publication', async () => {
    for (const phase of ['before-put', 'after-put']) for (const field of ['offset', 'data']) {
        const { f, events } = fixture(), native = f.requestNative;
        let checks = 0;
        f.requestNative = async request => {
            const result = await native(request);
            if (request.action === 'read' && ++checks === (phase === 'before-put' ? 1 : 2)) {
                result.chunk[field] = field === 'offset' ? 0 : 'YQ==';
            }
            return result;
        };
        await assert.rejects(uploadFolderPart(f));
        assert.equal(events.includes('put'), phase === 'after-put');
    }
});
test('invalid part bounds and source receipts cannot sign or send bytes', async () => {
    for (const patch of [{ partNumber: 0 }, { offset: 1 }, { length: bytes.length - 1 }, { uploadId: 'bad/id' },
        { source: { size: 0 } }, { source: { size: 40 * 1024 * 1024 * 10000 } }]) {
        const { f, events } = fixture();
        f.input.upload = { ...f.input.upload, ...patch, ...(patch.source ? { source: { ...f.input.upload.source, ...patch.source } } : {}) };
        await assert.rejects(uploadFolderPart(f)); assert.equal(events.includes('put'), false); assert.equal(events.includes('sign'), false);
    }
    for (const field of ['ownerId', 'deviceId', 'rootId', 'path', 'origin', 'requestId']) {
        const { f, events } = fixture(), read = f.requestNative;
        f.requestNative = async request => ({ ...await read(request), [field]: 'changed' });
        await assert.rejects(uploadFolderPart(f)); assert.equal(events.includes('sign'), false);
    }
});
test('server destination, checksum and response checks fail closed', async () => {
    for (const change of [p => { p.url = 'http://internal.test/private'; }, p => { p.url = 'https://user:pass@bucket.test/'; },
        p => { p.url += '#fragment'; }, p => { p.headers.Authorization = 'must-never-send'; },
        p => { p.headers['x-amz-checksum-sha256'] = 'wrong'; }, p => { p.partNumber = 2; }]) {
        const { f, events } = fixture(), sign = f.signPart;
        f.signPart = async body => { const value = await sign(body); change(value.parts[0]); return value; };
        await assert.rejects(uploadFolderPart(f)); assert.equal(events.includes('put'), false);
    }
    const { f } = fixture(); f.fetchUpload = async () => new Response(null, { status: 403 });
    await assert.rejects(uploadFolderPart(f));
});
test('cancellation, authority loss and source revision changes stop upload and receipt publication', async () => {
    for (const phase of ['sign', 'before-put', 'after-put']) {
        const { f, controller, events } = fixture(); let reads = 0;
        const sign = f.signPart, read = f.requestNative, put = f.fetchUpload;
        f.signPart = async body => { const value = await sign(body); if (phase === 'sign') controller.abort(); return value; };
        f.requestNative = async request => { reads++; const value = await read(request);
            if (phase === 'before-put' && reads === 2) value.chunk.version = 'changed'; return value; };
        f.fetchUpload = async (...args) => { const value = await put(...args); if (phase === 'after-put') controller.abort(); return value; };
        await assert.rejects(uploadFolderPart(f)); if (phase !== 'after-put') assert.equal(events.includes('put'), false);
    }
    const { f, events } = fixture(); let checks = 0;
    f.authorize = async () => { if (++checks === 3) throw Error('revoked'); };
    await assert.rejects(uploadFolderPart(f)); assert.equal(events.includes('put'), false);
});
test('dynamic desktop loopback origin uploads S3-shaped part without browser CORS or cookies', async t => {
    let received;
    const server = createServer(async (request, response) => {
        if (request.method === 'OPTIONS') { response.writeHead(403); response.end(); return; }
        if (request.url === '/api/v1/attachments/uploads/parts') {
            assert.equal(request.headers['x-thingtime-expected-actor'], 'owner');
            assert.equal(request.headers['x-thingtime-expected-api-origin'], 'https://api.test');
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const value = JSON.parse(Buffer.concat(chunks)); response.setHeader('x-thingtime-api-fallback', 'https://api.test');
            response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ parts: [{ ...value.parts[0],
                url: 'https://bucket.s3.ap-southeast-2.amazonaws.com/objects/fixture?partNumber=1&uploadId=opaque&x-id=UploadPart',
                headers: { 'x-amz-checksum-sha256': value.parts[0].checksumSha256 } }] })); return;
        }
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        received = { bytes: Buffer.concat(chunks), origin: request.headers.origin, cookie: request.headers.cookie,
            checksum: request.headers['x-amz-checksum-sha256'], path: request.url };
        response.setHeader('ETag', '"fixture-part"'); response.writeHead(200); response.end();
    });
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(() => { server.closeAllConnections(); server.close(); });
    const appOrigin = `http://127.0.0.1:${server.address().port}`;
    const { f } = fixture(), frame = { url: appOrigin + '/settings/things' };
    const sender = { mainFrame: frame, session: { fetch: globalThis.fetch } };
    const window = { webContents: sender, isDestroyed: () => false };
    const context = { enabled: true, window, appOrigin, apiOrigin: 'https://api.test' };
    const host = new DesktopFolderSync({ context: () => context, verifyAccount: async () => {},
        capabilities: async () => ({ features: { 'api.attachment-upload-parts': { version: '1.1.0' } } }),
        requestNative: async (_method, request) => f.requestNative(request),
        fetchUpload: async (target, options) => {
            assert.equal(target.hostname, 'bucket.s3.ap-southeast-2.amazonaws.com');
            return fetch(appOrigin + target.pathname + target.search, options);
        } });
    const result = await host.request({ sender, senderFrame: frame }, { ...f.input, action: 'upload-part', origin: context.apiOrigin });
    assert.equal(result.uploadedPart.sha256, hash); assert.deepEqual(received.bytes, bytes);
    assert.equal(received.origin, undefined); assert.equal(received.cookie, undefined);
    assert.equal(received.checksum, createHash('sha256').update(bytes).digest('base64'));
    assert.match(received.path, /x-id=UploadPart/);
    assert.equal(host.active, null);
});

test('host part capability requires compatible binary reads and missing signing capabilities prevent source reads', async () => {
    for (const version of ['1.1.0', '1.2.0', '1.11.0', '2.0.0']) {
        const { f } = fixture(), appOrigin = 'http://127.0.0.1:55212', frame = { url: appOrigin + '/settings' };
        const sender = { mainFrame: frame }, window = { webContents: sender, isDestroyed: () => false };
        const context = { enabled: true, window, appOrigin, apiOrigin: 'https://api.test' };
        const host = new DesktopFolderSync({ context: () => context, verifyAccount: async () => {},
            capabilities: async () => ({ features: { 'api.devices-node-identity': { version: '1.0.0' } } }),
            requestNative: async (_method, request) => ({ ...request, capabilities: { fileAccessVersion: version } }) });
        const event = { sender, senderFrame: frame };
        const result = await host.request(event, { ...f.input, action: 'context', origin: undefined });
        assert.equal(result.capabilities.fileUploadVersion, ['1.2.0', '1.11.0'].includes(version) ? '1.0.0' : undefined);
        host.requestNative = async () => { throw Error('must not read before signing capability negotiation'); };
        await assert.rejects(host.request(event, { ...f.input, action: 'upload-part', origin: context.apiOrigin }),
            /selected server does not support/);
    }
});

test('host upload network failures never expose a signed URL or error description', async () => {
    const { f } = fixture(); f.fetchUpload = async () => { throw Error('https://private.test/?secret=do-not-report'); };
    await assert.rejects(uploadFolderPart(f), { message: 'The pinned upload part could not be verified.' });
});

test('same-operation retry preserves upload identity and refuses a changed source after PUT', async () => {
    const { f } = fixture();
    const first = await uploadFolderPart(f), retry = await uploadFolderPart(f);
    assert.deepEqual(retry.uploadedPart, first.uploadedPart);
    let reads = 0; const read = f.requestNative;
    f.requestNative = async request => { const value = await read(request); if (++reads === 3) value.chunk.version = 'changed'; return value; };
    await assert.rejects(uploadFolderPart(f));
});

test('PUT transport and retryable HTTP failures use one sanitized recoverable marker; trust and auth failures do not', async () => {
    const marker = '[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.';
    for (const failure of [Object.assign(new Error('private signed URL'), { cause: { code: 'ECONNRESET' } }),
        new DOMException('private signed URL', 'TimeoutError'), Object.assign(new Error('private signed URL'), { code: 'ENETUNREACH' }),
        ...[408, 429, 500, 503].map(status => new Response(null, { status }))]) {
        const { f } = fixture();
        f.fetchUpload = async () => { if (failure instanceof Response) return failure; throw failure; };
        await assert.rejects(uploadFolderPart(f), { message: marker });
    }
    for (const failure of [Object.assign(new Error('private signed URL'), { cause: { code: 'CERT_HAS_EXPIRED' } }),
        ...[401, 403, 404].map(status => new Response(null, { status }))]) {
        const { f } = fixture();
        f.fetchUpload = async () => { if (failure instanceof Response) return failure; throw failure; };
        await assert.rejects(uploadFolderPart(f), { message: 'The pinned upload part could not be verified.' });
    }
});

test('signing outages and body timeouts remain recoverable; auth, origin and malformed data stay terminal', async () => {
    const { signDesktopUploadPart } = require('../lib/folder-sync.cjs');
    const context = { ownerId: 'owner', appOrigin: 'http://127.0.0.1:55212', apiOrigin: 'https://api.test',
        window: { webContents: { session: { fetch: async () => { throw Error('unset'); } } } } };
    const signal = new AbortController().signal;
    const marker = '[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.';
    for (const status of [408, 429, 500, 503]) {
        context.window.webContents.session.fetch = async () => new Response(null, { status });
        await assert.rejects(signDesktopUploadPart(context, {}, signal), { message: marker });
    }
    for (const code of ['ECONNRESET', 'ETIMEDOUT']) {
        context.window.webContents.session.fetch = async () => { throw Object.assign(new Error('private sign URL'), { cause: { code } }); };
        await assert.rejects(signDesktopUploadPart(context, {}, signal), { message: marker });
    }
    for (const status of [401, 403]) {
        context.window.webContents.session.fetch = async () => new Response(null, { status });
        await assert.rejects(signDesktopUploadPart(context, {}, signal), error => !error.message.includes('folder_upload_retry'));
    }
    context.window.webContents.session.fetch = async () => new Response('private invalid JSON', { headers: { 'x-thingtime-api-fallback': context.apiOrigin } });
    await assert.rejects(signDesktopUploadPart(context, {}, signal), error => !/private|folder_upload_retry/.test(error.message));
    context.window.webContents.session.fetch = async () => new Response('{}', { headers: { 'x-thingtime-api-fallback': 'https://other.test' } });
    await assert.rejects(signDesktopUploadPart(context, {}, signal), error => !error.message.includes('folder_upload_retry'));
});

test('signer TLS failures and explicit wrong-origin outage responses stay terminal and redacted', async () => {
    const { signDesktopUploadPart } = require('../lib/folder-sync.cjs');
    const context = { ownerId: 'owner', appOrigin: 'http://127.0.0.1:55212', apiOrigin: 'https://api.test',
        window: { webContents: { session: { fetch: async () => { throw Object.assign(new Error('private sign URL'), { cause: { code: 'CERT_HAS_EXPIRED' } }); } } } } };
    const signal = new AbortController().signal;
    await assert.rejects(signDesktopUploadPart(context, {}, signal), error => !/private|folder_upload_retry/.test(error.message));
    context.window.webContents.session.fetch = async () => new Response(null, { status: 503, headers: { 'x-thingtime-api-fallback': 'https://other.test' } });
    await assert.rejects(signDesktopUploadPart(context, {}, signal), error => !error.message.includes('folder_upload_retry'));
});

test('signing body stream AbortError uses the composed timeout reason but explicit cancellation stays cancellation', async () => {
    const { signDesktopUploadPart } = require('../lib/folder-sync.cjs');
    const marker = '[folder_upload_retry] Folder upload is temporarily unavailable. Retry after reconnecting.';
    for (const explicit of [false, true]) {
        const outer = new AbortController(); let bodyAborted = false;
        const context = { ownerId: 'owner', appOrigin: 'http://127.0.0.1:55212', apiOrigin: 'https://api.test',
            window: { webContents: { session: { fetch: async (_target, options) => {
                const stream = new ReadableStream({ start(controller) {
                    options.signal.addEventListener('abort', () => { bodyAborted = true; controller.error(new DOMException('private response URL', 'AbortError')); }, { once: true });
                    if (explicit) queueMicrotask(() => outer.abort(new DOMException('Cancelled', 'AbortError')));
                } });
                return new Response(stream, { headers: { 'x-thingtime-api-fallback': 'https://api.test' } });
            } } } } };
        // AbortSignal.timeout is unref'ed; keep only this bounded fixture alive.
        const keepAlive = setTimeout(() => {}, 1000);
        try {
            await assert.rejects(signDesktopUploadPart(context, {}, outer.signal, 5), error => {
                assert.equal(bodyAborted, true);
                if (explicit) assert.equal(error, outer.signal.reason);
                else assert.equal(error.message, marker);
                assert.doesNotMatch(error.message, /private/); return true;
            });
        } finally { clearTimeout(keepAlive); }
    }
});
