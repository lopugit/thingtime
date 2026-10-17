'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { DesktopFolderSync, readAccount, readCapabilities } = require('../lib/folder-sync.cjs');
const { nodeRequestTimeoutMs } = require('../lib/thingtime-node-bridge.cjs');

function fixture() {
    const frame = { url: 'http://127.0.0.1:12555/settings' }, sender = { mainFrame: frame };
    const window = { webContents: sender, isDestroyed: () => false };
    const context = { window, appOrigin: 'http://127.0.0.1:12555', apiOrigin: 'https://sync.test', enabled: true };
    const event = { sender, senderFrame: frame }, calls = [];
    let account = 'owner', run = async (_method, request) => ({ ...request, roots: [] });
    const host = new DesktopFolderSync({ context: () => context, requestNative: async (method, request) => { calls.push(request); return run(method, request); },
        capabilities: async () => ({ schemaVersion: 1, origin: context.apiOrigin, features: {} }),
        verifyAccount: async expected => { if (expected.ownerId !== account) throw Error('Account mismatch'); } });
    const input = (changes = {}) => ({ requestId: randomUUID(), ownerId: 'owner', deviceId: 'device', origin: context.apiOrigin, action: 'list', ...changes });
    return { host, context, frame, event, calls, input, account: value => { account = value; }, run: value => { run = value; } };
}
test('only the bundled main frame and exact configured origin can dispatch folder requests', async () => {
    const f = fixture();
    for (const event of [{ ...f.event, sender: {} }, { ...f.event, senderFrame: { ...f.frame } }]) await assert.rejects(f.host.request(event, f.input()));
    for (const changes of [{ origin: 'https://other.test' }, { ownerId: 'other' }, { action: 'shell' }, { requestId: 'bad' }, { data: 'x'.repeat(131072) }]) await assert.rejects(f.host.request(f.event, f.input(changes)));
    f.context.enabled = false; await assert.rejects(f.host.request(f.event, f.input())); f.context.enabled = true;
    f.frame.url = 'https://other.test/'; await assert.rejects(f.host.request(f.event, f.input())); f.frame.url = f.context.appOrigin;
    assert.equal(f.calls.length, 0);
    const input = f.input(); const result = await f.host.request(f.event, input);
    assert.equal(result.ownerId, 'owner'); assert.deepEqual(f.calls, [input]);
});
test('context derives its origin from the host, and replies must retain the full binding', async () => {
    const f = fixture(), input = f.input({ action: 'context', origin: undefined });
    assert.equal((await f.host.request(f.event, input)).origin, f.context.apiOrigin);
    for (const changes of [{ ownerId: 'other' }, { deviceId: 'other' }, { requestId: randomUUID() }, { origin: 'https://other.test' }]) {
        f.run(async (_method, request) => ({ ...request, ...changes }));
        await assert.rejects(f.host.request(f.event, f.input()));
    }
});
test('active account and endpoint are checked again before returning any native data', async () => {
    for (const change of ['account', 'endpoint', 'navigation', 'round-trip']) {
        const f = fixture();
        f.run(async (_method, request) => {
            if (change === 'account') f.account('other');
            if (change === 'endpoint') f.context.apiOrigin = 'https://other.test';
            if (change === 'navigation') f.frame.url = 'https://other.test';
            if (change === 'round-trip') { f.host.invalidate(); }
            return { ...request, roots: [{ id: randomUUID(), name: 'private' }] };
        });
        await assert.rejects(f.host.request(f.event, f.input()));
    }
});
test('matching cancellation and host invalidation retain the original native binding', async () => {
    const f = fixture(), input = f.input({ action: 'choose' }); let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    f.run(async (_method, request) => {
        if (request.action === 'suspend') { release({ ...input, roots: [] }); return {}; }
        entered(); return new Promise(resolve => { release = resolve; });
    });
    const pending = f.host.request(f.event, input); await started;
    await assert.rejects(f.host.request(f.event, f.input()));
    await f.host.request(f.event, { ...input, ownerId: 'other', action: 'suspend' });
    assert.equal(f.calls.length, 1);
    f.context.apiOrigin = 'https://next.test'; f.host.invalidate();
    await assert.rejects(pending);
    assert.deepEqual(f.calls[1], { requestId: input.requestId, ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test', action: 'suspend' });
});
test('cookie-session account read pins the proxy destination, refuses redirects and bounds bodies', async () => {
    const url = 'http://127.0.0.1:12555/api/v1/auth/me'; let mode = 'valid', requests = 0;
    const context = { appOrigin: 'http://127.0.0.1:12555', apiOrigin: 'https://sync.test', ownerId: 'owner', window: { webContents: { session: { fetch: async (target, init) => {
        requests++; assert.equal(target, url); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.credentials, 'include');
        assert.equal(init.bypassCustomProtocolHandlers, true); assert.equal(init.headers['X-Thingtime-Expected-Actor'], 'owner');
        assert.equal(init.headers.Authorization, undefined); assert.equal(init.headers.Cookie, undefined);
        const value = { user: { id: mode === 'other' ? 'other' : 'owner', accountKind: mode === 'temporary' ? 'temporary' : 'user' } };
        // Electron's Response.url can be empty; do not trust it as an origin proof.
        const response = new Response(mode === 'large' ? 'x'.repeat(65537) : JSON.stringify(value), { status: mode === 'unauthorized' ? 401 : 200,
            headers: mode === 'no-proxy' ? {} : { 'x-thingtime-api-fallback': mode === 'other-proxy' ? 'https://other.test' : 'https://sync.test' } });
        if (mode === 'redirected') Object.defineProperty(response, 'redirected', { value: true });
        return response;
    } } } } };
    await readAccount(context, new AbortController().signal);
    for (mode of ['other', 'temporary', 'large', 'unauthorized', 'no-proxy', 'other-proxy', 'redirected']) await assert.rejects(readAccount(context, new AbortController().signal));
    assert.equal(requests, 8);
});
test('folder bridge allows native consent timeout without inheriting the short telemetry timeout', () => {
    assert.equal(nodeRequestTimeoutMs('folder-sync.request'), 305000);
    assert.equal(nodeRequestTimeoutMs('node.status'), 17000);
});


test('server capability negotiation is anonymous, bounded, origin-bound and projected', async () => {
    let mode = 'valid';
    const context = { apiOrigin: 'https://sync.test', window: { webContents: { session: { fetch: async (url, init) => {
        assert.equal(url, 'https://sync.test/.well-known/thingtime-capabilities.json');
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.equal(init.bypassCustomProtocolHandlers, true);
        const value = { schemaVersion: 1, origin: mode === 'foreign' ? 'https://other.test' : 'https://sync.test',
            features: { 'api.files': { version: mode === 'bad-version' ? '1.bad.0' : '1.4.0', private: 'excluded' }, unrelated: { version: '1.0.0' } } };
        return new Response(mode === 'large' ? 'x'.repeat(1024 * 1024 + 1) : JSON.stringify(value), { status: mode === 'redirect' ? 302 : 200 });
    } } } } };
    assert.deepEqual(await readCapabilities(context, new AbortController().signal), { schemaVersion: 1, origin: 'https://sync.test', features: { 'api.files': { version: '1.4.0' } } });
    for (mode of ['foreign', 'large', 'redirect']) await assert.rejects(readCapabilities(context, new AbortController().signal));
    mode = 'bad-version'; assert.deepEqual((await readCapabilities(context, new AbortController().signal)).features, {});
});

test('streamed bytes require final browser-account verification and exact range binding', async () => {
    const f = fixture(), bytes = new Uint8Array(2 * 1024 * 1024),
        input = f.input({ action: 'read-range', rootId: 'root', path: 'file', version: 'v1', offset: 0, length: bytes.length });
    const result = request => ({ ...request, roots: [], chunk: { bytes, offset: 0, version: 'v1', length: bytes.length, size: bytes.length } });
    f.run(async (_method, request) => result(request));
    assert.equal((await f.host.request(f.event, input)).chunk.bytes.length, bytes.length);
    f.run(async (_method, request) => { f.account('other'); return result(request); });
    await assert.rejects(f.host.request(f.event, input));
    f.account('owner');
    f.run(async (_method, request) => ({ ...result(request), path: 'other' }));
    await assert.rejects(f.host.request(f.event, input));
});

test('staging accepts binary ranges only from the current main-frame account', async () => {
    const f = fixture(), bytes = new Uint8Array(2 * 1024 * 1024 + 17).fill(3),
        input = f.input({ action: 'stage-range', rootId: 'root', offset: 0, bytes });
    f.run(async (_method, request) => ({ requestId: request.requestId, ownerId: request.ownerId, deviceId: request.deviceId,
        origin: request.origin, rootId: request.rootId, roots: [], staging: { received: request.bytes.length } }));
    assert.equal((await f.host.request(f.event, input)).staging.received, bytes.length);
    for (const patch of [{ bytes: [] }, { bytes: new Uint8Array(0) }, { offset: -1 }, { other: 'x'.repeat(131072) }])
        await assert.rejects(f.host.request(f.event, { ...input, ...patch }));
    const before = f.calls.length; f.account('other');
    await assert.rejects(f.host.request(f.event, input)); assert.equal(f.calls.length, before);
});
