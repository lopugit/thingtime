'use strict';
// Run with electron, not node. This uses an isolated temporary profile, a real
// Chromium cookie jar and IPC sender frames. Native XPC dispatch is a fixture;
// this does not assert an installed-node or real-file transfer acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain } = require('electron');
const { DesktopFolderSync } = require('../../lib/folder-sync.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'thingtime-folder-host-'));
app.setName('Thingtime Folder Host Verification'); app.setPath('userData', profile);
let window, server, upstream, origin, apiOrigin, host;
let account = 'owner', proxyHeader = true, authRequests = 0, nativeRequests = 0, publicRequests = 0, hold;
const listen = value => new Promise(resolve => value.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${value.address().port}`)));
const timer = setTimeout(() => { console.error('Host verification timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
    upstream = http.createServer((req, res) => {
        try {
            assert.equal(req.url, '/.well-known/thingtime-capabilities.json');
            assert.equal(req.headers.cookie, undefined); assert.equal(req.headers.authorization, undefined); publicRequests++;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ schemaVersion: 1, origin: apiOrigin, features: { 'api.files': { version: '1.4.0' }, unrelated: { private: 'excluded' } } }));
        } catch (error) { res.statusCode = 500; res.end(); console.error(error); }
    });
    apiOrigin = await listen(upstream);
    server = http.createServer((req, res) => {
        if (req.url === '/api/v1/auth/me') {
            authRequests++;
            if (req.headers.cookie !== 'fixture_session=owner' || req.headers['x-thingtime-expected-actor'] !== 'owner' ||
                req.headers['x-thingtime-expected-data-plane'] !== 'home' || req.headers['x-thingtime-expected-api-origin'] !== apiOrigin) {
                res.statusCode = 401; res.end('{}'); return;
            }
            if (proxyHeader) res.setHeader('x-thingtime-api-fallback', apiOrigin);
            res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ user: { id: account, accountKind: 'user' } })); return;
        }
        res.setHeader('Content-Type', 'text/html'); res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'");
        res.setHeader('Set-Cookie', 'fixture_session=owner; HttpOnly; SameSite=Strict; Path=/');
        res.end('<!doctype html><title>Isolated folder host verification</title>' + (req.url === '/child' ? '' : '<iframe src="/child"></iframe>'));
    });
    origin = await listen(server);
    window = new BrowserWindow({ show: false, webPreferences: { preload: path.join(__dirname, 'folder-sync-host-preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
    host = new DesktopFolderSync({ context: () => ({ enabled: true, window, appOrigin: origin, apiOrigin }),
        requestNative: async (_method, request) => {
            if (request.action === 'suspend') { hold?.({ ...request, roots: [] }); return {}; }
            nativeRequests++;
            if (request.action === 'choose') return await new Promise(resolve => { hold = resolve; });
            return { ...request, roots: [], capabilities: { fileAccessVersion: '1.1.0' } };
        } });
    ipcMain.handle('fixture:folder-sync', (event, input) => host.request(event, input));
    await window.loadURL(origin);
    const input = (action = 'list') => ({ action, requestId: randomUUID(), ownerId: 'owner', deviceId: 'device', ...(action !== 'context' ? { origin: apiOrigin } : {}) });
    const request = value => window.webContents.executeJavaScript(`window.folderFixture.request(${JSON.stringify(value)})`);
    const context = await request(input('context'));
    assert.equal(context.origin, apiOrigin); assert.deepEqual(context.apiCapabilities.features, { 'api.files': { version: '1.4.0' } });
    assert.equal(authRequests, 2); assert.equal(publicRequests, 1); assert.equal(nativeRequests, 1);
    await request(input()); assert.equal(nativeRequests, 2);
    account = 'other'; await assert.rejects(request(input())); assert.equal(nativeRequests, 2); account = 'owner';
    proxyHeader = false; await assert.rejects(request(input())); assert.equal(nativeRequests, 2); proxyHeader = true;
    // A real subframe cannot impersonate the main frame even with its sender.
    const child = window.webContents.mainFrame.frames[0]; assert.ok(child);
    await assert.rejects(host.request({ sender: window.webContents, senderFrame: child }, input()));
    const active = request(input('choose')); const failed = assert.rejects(active);
    while (!hold) await new Promise(resolve => setTimeout(resolve, 10));
    const changed = (_event, cookie) => { if (cookie.name === 'fixture_session') host.invalidate(); };
    window.webContents.session.cookies.on('changed', changed);
    // Only synthetic fixture cookies in this fresh profile are accessed here.
    await window.webContents.session.cookies.remove(origin, 'fixture_session');
    await failed; window.webContents.session.cookies.removeListener('changed', changed);
    assert.equal(host.active, null);
    console.log(JSON.stringify({ ok: true, checks: ['real-session-cookie-auth', 'anonymous-server-capabilities', 'account-switch', 'proxy-destination', 'subframe-denial', 'cookie-change-cancellation'], nativeDispatch: 'fixture-only' }));
}).catch(error => { process.exitCode = 1; console.error(error); }).finally(async () => {
    clearTimeout(timer); ipcMain.removeHandler('fixture:folder-sync'); host?.invalidate(); window?.destroy();
    await Promise.all([server, upstream].filter(Boolean).map(value => new Promise(resolve => value.close(resolve))));
    fs.rmSync(profile, { recursive: true, force: true }); app.exit(process.exitCode || 0);
});
