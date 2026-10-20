'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { DesktopFolderSync, readAccount, readCapabilities } = require('../lib/folder-sync.cjs');
const { nodeRequestTimeoutMs } = require('../lib/thingtime-node-bridge.cjs');

test('single-path inspection uses the same host account and origin fences', async () => {
    const f = fixture(), input = f.input({ action: 'inspect', rootId: randomUUID(), path: 'nested/file.bin' });
    f.run(async (_method, request) => ({ ...request, roots: [], complete: true, entry: null }));
    assert.equal((await f.host.request(f.event, input)).entry, null);
    assert.deepEqual(f.calls, [input]);
    f.account('other');
    await assert.rejects(f.host.request(f.event, f.input({ ...input, requestId: randomUUID() })));
    assert.equal(f.calls.length, 1);
});

test('all inventory capture lifecycle operations retain policy and host identity fences', async () => {
    for (const action of ['scan-stream', 'scan-changes', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-skips', 'scan-page', 'scan-discard']) {
        const f = fixture(), input = f.input({ action, rootId: randomUUID(), inventoryDeviceId: 'device',
            capturePolicy: ['scan-stream', 'scan-changes'].includes(action) ? 'one-way-supported' : 'backup-supported', ignoreRules: 'node_modules/\n!keep/', excludedPaths: ['Library'] });
        f.run(async (_method, request) => ({ ...request, roots: [], complete: true }));
        assert.equal((await f.host.request(f.event, input)).complete, true);
        assert.equal(f.calls[0].action, action);
        assert.equal(f.calls[0].ignoreRules, input.ignoreRules);
        assert.deepEqual(f.calls[0].excludedPaths, ['Library']);
        f.run(async (_method, request) => { f.account('other'); return { ...request, roots: [], complete: true }; });
        await assert.rejects(f.host.request(f.event, f.input({ ...input, requestId: randomUUID() })));
        assert.equal(f.calls.length, 2);
        await assert.rejects(f.host.request(f.event, f.input({ ...input, requestId: randomUUID() })));
        assert.equal(f.calls.length, 2);
    }
});

test('streaming long-poll has a separate lane while ordinary reads queue and retain identity fences', async () => {
    const f = fixture();
    let releaseWait, releaseInspect, enteredWait, enteredInspect;
    const waiting = new Promise(resolve => { enteredWait = resolve; });
    const inspecting = new Promise(resolve => { enteredInspect = resolve; });
    const waitGate = new Promise(resolve => { releaseWait = resolve; });
    const inspectGate = new Promise(resolve => { releaseInspect = resolve; });
    f.run(async (_method, request) => {
        if (request.action === 'scan-changes') { enteredWait(); await waitGate; }
        if (request.action === 'inspect') { enteredInspect(); await inspectGate; }
        return request.action === 'read-range' ? { ...request, chunk: { bytes: new Uint8Array(1), length: 1, offset: 0, version: 'v1' } } : { ...request, roots: [] };
    });
    const pendingWait = f.host.request(f.event, f.input({ action: 'scan-changes', waitMilliseconds: 25_000, afterSequence: 0, pageSize: 128 }));
    await waiting;
    const pendingInspect = f.host.request(f.event, f.input({ action: 'inspect' }));
    await inspecting;
    const range = f.host.request(f.event, f.input({ action: 'read-range', rootId: randomUUID(), path: 'file', version: 'v1', offset: 0, length: 1 }));
    assert.deepEqual(f.calls.map(call => call.action), ['scan-changes', 'inspect']);
    releaseInspect(); await pendingInspect;
    assert.equal((await range).chunk.bytes.length, 1);
    assert.equal(f.host.streamWaiter?.input.action, 'scan-changes');
    releaseWait(); await pendingWait;
    assert.equal(f.host.active, null); assert.equal(f.host.streamWaiter, null);
});

test('host invalidation aborts queued ordinary requests before native dispatch', async () => {
    const f = fixture(); let entered, release;
    const started = new Promise(resolve => { entered = resolve; });
    f.run(async (_method, request) => {
        if (request.action === 'suspend') { release(); return {}; }
        entered(); await new Promise(resolve => { release = resolve; }); return { ...request, roots: [] };
    });
    const active = f.host.request(f.event, f.input({ action: 'inspect' })); await started;
    const queued = f.host.request(f.event, f.input({ action: 'read' }));
    const rejected = [assert.rejects(active), assert.rejects(queued)];
    f.context.apiOrigin = 'https://other.test'; f.host.invalidate();
    await Promise.all(rejected);
    assert.deepEqual(f.calls.map(call => call.action), ['inspect', 'suspend']);
    assert.equal(f.host.ordinaryQueue.length, 0);
});

function fixture() {
    const frame = { url: 'http://127.0.0.1:12555/settings' }, sender = { mainFrame: frame };
    const window = { webContents: sender, isDestroyed: () => false };
    const context = { window, appOrigin: 'http://127.0.0.1:12555', apiOrigin: 'https://sync.test', enabled: true };
    const event = { sender, senderFrame: frame }, calls = [];
    let account = 'owner', run = async (_method, request) => ({ ...request, roots: [] });
    const host = new DesktopFolderSync({ context: () => context, requestNative: async (method, request) => { calls.push(request); return run(method, request); },
        capabilities: async () => ({ schemaVersion: 1, origin: context.apiOrigin, features: { 'api.devices-node-identity': { version: '1.0.0' } } }),
        verifyAccount: async expected => { if (expected.ownerId !== account) throw Error('Account mismatch'); } });
    const input = (changes = {}) => ({ requestId: randomUUID(), ownerId: 'owner', deviceId: 'device', origin: context.apiOrigin, action: 'list', ...changes });
    return { host, context, frame, event, calls, input, account: value => { account = value; }, run: value => { run = value; } };
}
test('non-interactive approval checks cannot escape host identity and endpoint fences', async () => {
    const f = fixture(), approval = { scope: { origin: f.context.apiOrigin, ownerId: 'owner', deviceId: 'device', dataPlane: 'home', rootId: 'connection' },
        configurationRevision: '1', configurationHash: 'a'.repeat(64) };
    const input = f.input({ action: 'write-check', rootId: randomUUID(), approval });
    f.run(async (_method, request) => ({ ...request, roots: [], writeApproval: approval }));
    assert.deepEqual((await f.host.request(f.event, input)).writeApproval, approval);
    f.run(async (_method, request) => { f.account('other'); return { ...request, roots: [], writeApproval: approval }; });
    await assert.rejects(f.host.request(f.event, input));
    const dispatched = f.calls.length;
    await assert.rejects(f.host.request(f.event, input));
    assert.equal(f.calls.length, dispatched);
    assert.ok(f.calls.every(call => call.action === 'write-check'));
});
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
test('unsupported server is explained before native access while compatible servers still verify pairing', async () => {
    const f = fixture();
    for (const version of [undefined, '2.0.0', '1.bad.0', '1.01.0']) {
        f.host.capabilities = async () => ({ features: { 'api.devices-node-identity': { version } } });
        await assert.rejects(f.host.request(f.event, f.input({ action: 'context' })),
            { message: 'The selected server does not support this version of folder sync.' });
    }
    assert.equal(f.calls.length, 0);
    f.host.capabilities = async () => ({ features: { 'api.devices-node-identity': { version: '1.1.0' } } });
    f.run(async () => { throw Error('Native pairing denied'); });
    await assert.rejects(f.host.request(f.event, f.input({ action: 'context' })), /Native pairing denied/);
    assert.equal(f.calls.length, 1);
});
test('account and endpoint changes during capability negotiation stop before native access', async () => {
    for (const change of ['account', 'endpoint', 'cancel']) {
        const f = fixture();
        f.host.capabilities = async () => {
            if (change === 'account') f.account('other');
            if (change === 'endpoint') f.context.apiOrigin = 'https://other.test';
            if (change === 'cancel') f.host.invalidate();
            return { features: { 'api.devices-node-identity': { version: '1.0.0' } } };
        };
        await assert.rejects(f.host.request(f.event, f.input({ action: 'context' })));
        assert.equal(f.calls.length, 0);
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
test('Quit before renderer pagehide preserves a fixed lifecycle wait and forbids new native work', async () => {
    for (const cancelled of [false, true]) {
        const f = fixture(), input = f.input({ action: 'scan-page' });
        let entered, finish;
        const started = new Promise(resolve => { entered = resolve; });
        f.run(async (_method, request) => {
            if (request.action === 'suspend') { finish(); return {}; }
            entered();
            return new Promise((resolve, reject) => {
                finish = () => cancelled
                    ? reject(Object.assign(Error('Folder access was cancelled.'), { name: 'ThingtimeNodeBridgeError', code: 'cancelled' }))
                    : resolve({ ...request, roots: [] });
            });
        });
        const pending = f.host.request(f.event, input); await started;
        f.host.quit(); f.host.quit();
        await assert.rejects(pending, { message: '[folder_sync_shutdown] Thingtime is closing. Saved sync work can resume when reopened.' });
        assert.deepEqual(f.calls[1], { requestId: input.requestId, ownerId: 'owner', deviceId: 'device', origin: 'https://sync.test', action: 'suspend' });
        await assert.rejects(f.host.request(f.event, f.input()), /\[folder_sync_shutdown\]/);
        assert.equal(f.calls.length, 2);
        assert.equal(f.host.active, null);
    }
});
test('Quit during verification preserves cancellation but never relabels an actual authority refusal', async () => {
    for (const refused of [false, true]) {
        const f = fixture(); let entered, finish;
        const started = new Promise(resolve => { entered = resolve; });
        f.host.verifyAccount = async (_context, signal) => {
            entered(); await new Promise(resolve => { finish = resolve; });
            if (refused) throw Error('Account mismatch');
            signal.throwIfAborted();
        };
        const pending = f.host.request(f.event, f.input()); await started;
        f.host.quit(); finish();
        await assert.rejects(pending, refused ? /Account mismatch/ : /\[folder_sync_shutdown\]/);
        assert.equal(f.calls.length, 0);
    }
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

test('host identity HTTP cooldowns retain a redacted retry marker but never dispatch or disclose without verification', async () => {
    for (const status of [408, 429, 500, 503]) {
        for (const afterDispatch of [false, true]) {
            const f = fixture(); let reads = 0;
            f.context.window.webContents.session = { fetch: async () => {
                reads++;
                return new Response(reads === 1 && afterDispatch ? JSON.stringify({ user: { id: 'owner', accountKind: 'user' } }) : 'private upstream body', {
                    status: reads === 1 && afterDispatch ? 200 : status, headers: { 'x-thingtime-api-fallback': f.context.apiOrigin }
                });
            } };
            f.host.verifyAccount = readAccount;
            await assert.rejects(f.host.request(f.event, f.input({ action: 'scan-status' })), error => {
                assert.match(error.message, /\[folder_identity_retry\]/);
                assert.doesNotMatch(error.message, /private upstream body/); return true;
            });
            assert.equal(f.calls.length, afterDispatch ? 1 : 0);
            assert.equal(f.host.active, null);
        }
    }
    for (const status of [401, 403]) {
        const f = fixture();
        f.context.window.webContents.session = { fetch: async () => new Response('', { status }) };
        await assert.rejects(readAccount(f.context, new AbortController().signal), error => !error.message.includes('[folder_identity_retry]'));
    }
});

test('capability HTTP outages are retryable without accepting an unverified manifest', async () => {
    const context = { apiOrigin: 'https://sync.test', window: { webContents: { session: {
        fetch: async () => new Response('private body', { status: 503 })
    } } } };
    await assert.rejects(readCapabilities(context, new AbortController().signal), /\[folder_identity_retry\]/);
});

test('Chromium connection errors are retryable and redacted while certificate or redirect refusals remain terminal', async () => {
    for (const code of ['TIMED_OUT', 'CONNECTION_RESET', 'INTERNET_DISCONNECTED', 'NAME_NOT_RESOLVED', 'CERT_AUTHORITY_INVALID', 'TOO_MANY_REDIRECTS', 'BLOCKED_BY_CLIENT']) {
        for (const read of [readAccount, readCapabilities]) {
            const f = fixture();
            f.context.window.webContents.session = { fetch: async () => { throw Error(`net::ERR_${code} at private-url`); } };
            await assert.rejects(read(f.context, new AbortController().signal), error => {
                const retryable = !['CERT_AUTHORITY_INVALID', 'TOO_MANY_REDIRECTS', 'BLOCKED_BY_CLIENT'].includes(code);
                assert.equal(error.message.includes('[folder_identity_retry]'), retryable);
                if (retryable) assert.doesNotMatch(error.message, /private-url/);
                return true;
            });
        }
    }
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

test('native trash and restoration use the same live main-frame account boundary', async () => {
    for (const action of ['trash', 'trash-lookup', 'trash-inspect', 'trash-restore']) {
        const f = fixture(), trash = { operation: { id: randomUUID() } }, input = f.input({ action, rootId: randomUUID(), trash });
        f.account('foreign');
        await assert.rejects(f.host.request(f.event, input));
        assert.equal(f.calls.length, 0);
        f.account('owner');
        await f.host.request(f.event, input);
        assert.deepEqual(f.calls[0], input);
        f.run(async (_method, request) => { f.account('foreign'); return { ...request, retainedEntry: { private: true } }; });
        await assert.rejects(f.host.request(f.event, f.input({ action, rootId: input.rootId, trash })));
    }
});


test('larger inventory pages negotiate native 1.10 once within the live account and device scope', async () => {
    const f = fixture();
    let checks = 0;
    const verify = f.host.verifyAccount;
    f.host.verifyAccount = async (...args) => { checks++; return verify(...args); };
    f.run(async (_method, request) => ({ ...request, roots: [], capabilities: { fileAccessVersion: '1.10.0' } }));
    const first = f.input({ action: 'scan-page', pageSize: 4096, offset: 0 });
    assert.equal((await f.host.request(f.event, first)).pageSize, 4096);
    assert.deepEqual(f.calls.map(call => call.action), ['context', 'scan-page']);
    assert.notEqual(f.calls[0].requestId, first.requestId);
    assert.equal(f.calls[0].pageSize, undefined);
    assert.deepEqual([f.calls[0].ownerId, f.calls[0].deviceId, f.calls[0].origin], ['owner', 'device', f.context.apiOrigin]);
    assert.equal(checks, 3); // Before negotiation, after negotiation, after the page.
    checks = 0;
    await f.host.request(f.event, f.input({ action: 'scan-skips', pageSize: 512, offset: 4096 }));
    assert.equal(checks, 2); // Cached capability never replaces either live account check.
    assert.deepEqual(f.calls.map(call => call.action), ['context', 'scan-page', 'scan-skips']);
    await f.host.request(f.event, f.input({ action: 'scan-page', pageSize: 512, deviceId: 'another-device' }));
    assert.deepEqual(f.calls.slice(-2).map(call => call.action), ['context', 'scan-page']);
    f.host.invalidate();
    await f.host.request(f.event, f.input({ action: 'scan-page', pageSize: 512 }));
    assert.deepEqual(f.calls.slice(-2).map(call => call.action), ['context', 'scan-page']);
});

test('explicit native context warms page negotiation and older native hosts retain legacy paging', async () => {
    const f = fixture();
    f.run(async (_method, request) => ({ ...request, roots: [], capabilities: { fileAccessVersion: '1.11.0' } }));
    await f.host.request(f.event, f.input({ action: 'context' }));
    await f.host.request(f.event, f.input({ action: 'scan-page', pageSize: 512 }));
    assert.deepEqual(f.calls.map(call => call.action), ['context', 'scan-page']);
    for (const version of [undefined, '1.9.9', '2.0.0', '1.010.0', '1.10.0-beta', '1.10.99999999999999999999']) {
        const old = fixture();
        old.run(async (_method, request) => ({ ...request, roots: [], capabilities: { fileAccessVersion: version } }));
        await assert.rejects(old.host.request(old.event, old.input({ action: 'scan-page', pageSize: 512 })), /larger inventory pages/);
        assert.deepEqual(old.calls.map(call => call.action), ['context']);
        await old.host.request(old.event, old.input({ action: 'scan-page' }));
        assert.deepEqual(old.calls.map(call => call.action), ['context', 'scan-page']);
        assert.equal(old.calls[1].pageSize, undefined);
    }
});

test('invalid page sizes and page sizes on unrelated actions never reach native', async () => {
    const f = fixture();
    for (const action of ['scan-page', 'scan-skips'])
        for (const pageSize of [null, undefined, true, '512', 0, -1, 4097, 1.5, Number.MAX_SAFE_INTEGER + 1])
            await assert.rejects(f.host.request(f.event, f.input({ action, pageSize })));
    for (const action of ['context', 'list', 'choose', 'scan', 'scan-capture', 'scan-status', 'scan-cancel', 'scan-discard', 'read', 'suspend'])
        await assert.rejects(f.host.request(f.event, f.input({ action, pageSize: 512 })));
    assert.equal(f.calls.length, 0);
});

test('native page negotiation and large responses preserve post-operation account and identity fences', async () => {
    for (const boundary of ['negotiation-account', 'negotiation-binding', 'page-account']) {
        const f = fixture();
        f.run(async (_method, request) => {
            const result = { ...request, roots: [], capabilities: { fileAccessVersion: '1.10.0' } };
            if (boundary === 'negotiation-account' && request.action === 'context') f.account('foreign');
            if (boundary === 'negotiation-binding' && request.action === 'context') result.ownerId = 'foreign';
            if (boundary === 'page-account' && request.action === 'scan-page') f.account('foreign');
            return result;
        });
        await assert.rejects(f.host.request(f.event, f.input({ action: 'scan-page', pageSize: 4096 })));
        assert.deepEqual(f.calls.map(call => call.action), boundary === 'page-account' ? ['context', 'scan-page'] : ['context']);
    }
});

test('verification deadlines remain retryable while explicit cancellation remains cancellation', async () => {
    for (const read of [readAccount, readCapabilities]) {
        for (const name of ['TimeoutError', 'AbortError']) {
            const f = fixture(), reason = new DOMException('private transport detail', name);
            f.context.window.webContents.session = { fetch: async () => { throw reason; } };
            await assert.rejects(read(f.context, AbortSignal.abort(reason)), error => {
                assert.equal(error.message.includes('[folder_identity_retry]'), name === 'TimeoutError');
                if (name === 'TimeoutError') assert.doesNotMatch(error.message, /private transport detail/);
                else assert.equal(error, reason);
                return true;
            });
        }
    }
});


test('a concurrent deadline cannot turn a verified HTTP authority refusal into a retry', async () => {
    for (const status of [401, 403]) {
        const f = fixture();
        f.context.window.webContents.session = { fetch: async () => new Response('', { status }) };
        const signal = AbortSignal.abort(new DOMException('deadline', 'TimeoutError'));
        await assert.rejects(readAccount(f.context, signal), error => !error.message.includes('[folder_identity_retry]'));
    }
});

test('native transport interruptions remain resumable and record only closed request diagnostics', async () => {
    const { ThingtimeNodeBridgeError } = require('../lib/thingtime-node-bridge.cjs');
    for (const code of ['node_timeout', 'node_unavailable', 'folder_unavailable', 'node_protocol_error', 'cancelled', 'unsupported_feature']) {
        const f = fixture(), diagnostics = [];
        f.host.diagnostic = value => diagnostics.push(value);
        f.run(async () => { throw new ThingtimeNodeBridgeError(code, '/private/source?credential=never-log'); });
        await assert.rejects(f.host.request(f.event, f.input({ action: 'inspect' })), error => {
            assert.equal(error.message.includes('[folder_transport_retry]'), ['node_timeout', 'node_unavailable'].includes(code));
            return true;
        });
        assert.deepEqual(diagnostics, [{ phase: 'folder-request', action: 'inspect', step: 'native-request', code }]);
        assert.doesNotMatch(JSON.stringify(diagnostics), /private|credential|never-log|owner|device/);
    }
});

test('native identity retry crosses Electron as a plain fixed Error while authority failures remain terminal', async () => {
    const { ThingtimeNodeBridgeError } = require('../lib/thingtime-node-bridge.cjs');
    const f = fixture(), marker = '[folder_identity_retry] Folder identity verification is temporarily unavailable. Retry after reconnecting.';
    f.run(async () => { throw new ThingtimeNodeBridgeError('folder_identity_retry', marker); });
    await assert.rejects(f.host.request(f.event, f.input()), error => error.name === 'Error' && error.message === marker);
});

test('authority drift wins over a concurrent native transport interruption and diagnostics never break a request', async () => {
    const { ThingtimeNodeBridgeError }=require('../lib/thingtime-node-bridge.cjs');
    const f=fixture(); f.host.diagnostic=()=>{throw Error('diagnostic sink unavailable');};
    f.run(async()=>{f.context.apiOrigin='https://other.test';throw new ThingtimeNodeBridgeError('node_unavailable','private');});
    await assert.rejects(f.host.request(f.event,f.input()),error=>!error.message.includes('[folder_transport_retry]'));
    const fresh=fixture(); fresh.host.diagnostic=()=>{throw Error('diagnostic sink unavailable');};
    fresh.run(async()=>{throw new ThingtimeNodeBridgeError('node_timeout','private');});
    await assert.rejects(fresh.host.request(fresh.event,fresh.input()),/\[folder_transport_retry\]/);
});

test('public capabilities negotiate once per exact live binding while every native request freshly verifies account', async () => {
 const f = fixture(); let capabilities = 0, accounts = 0;
 f.host.capabilities = async context => { capabilities++; return { schemaVersion: 1, origin: context.apiOrigin, features: { 'api.devices-node-identity': { version: '1.0.0' } } }; };
 f.host.verifyAccount = async () => { accounts++; };
 f.run(async (_method, request) => ({ ...request, roots: [], capabilities: { fileAccessVersion: '1.12.0' }, conditions: { network: 'wifi', charging: true } }));
 await f.host.request(f.event, f.input({ action: 'context' }));
 await f.host.request(f.event, f.input({ action: 'context' }));
 assert.equal(capabilities, 1); assert.equal(accounts, 5); assert.equal(f.calls.length, 2);
 f.host.invalidate();
 await f.host.request(f.event, f.input({ action: 'context' }));
 assert.equal(capabilities, 2); assert.equal(accounts, 8);
 await f.host.request(f.event, f.input({ action: 'context', deviceId: 'other-device' }));
 assert.equal(capabilities, 3); assert.equal(accounts, 11);
 await f.host.request(f.event, f.input({ action: 'context', deviceId: 'other-device', ownerId: 'other-owner' }));
 assert.equal(capabilities, 4); assert.equal(accounts, 14);
 f.context.apiOrigin = 'https://new.test';
 await f.host.request(f.event, f.input({ action: 'context', origin: 'https://new.test' }));
 assert.equal(capabilities, 5); assert.equal(accounts, 17);
 f.context.window = { ...f.context.window };
 await f.host.request(f.event, f.input({ action: 'context', origin: 'https://new.test' }));
 assert.equal(capabilities, 6); assert.equal(accounts, 20);
 f.host.verifyAccount = async () => { throw Error('Account revoked'); };
 await assert.rejects(f.host.request(f.event, f.input({ action: 'context', origin: 'https://new.test' })), /revoked/);
 assert.equal(f.calls.length, 7);
});
