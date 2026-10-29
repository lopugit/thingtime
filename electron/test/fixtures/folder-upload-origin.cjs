'use strict';
// Real Electron session.fetch, isolated profile and OS loopback-only network.
// No renderer, real account, cookie, credential or native file is used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { app, session } = require('electron');
const { signDesktopUploadPart } = require('../../lib/folder-sync.cjs');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'thingtime-upload-origin-'));
app.setPath('userData', profile);
let server;
app.whenReady().then(async () => {
    let receivedOrigin, accepted = 0;
    server = http.createServer((request, response) => {
        receivedOrigin = request.headers.origin;
        if (request.method !== 'POST' || request.headers.origin !== origin) {
            response.writeHead(403, { 'Content-Type': 'application/json' }); response.end('{}'); return;
        }
        accepted++;
        response.writeHead(200, { 'Content-Type': 'application/json', 'x-thingtime-api-fallback': apiOrigin });
        response.end(JSON.stringify({ parts: [] }));
    });
    await new Promise(resolve => server.listen(Number(process.env.TT_FOLDER_ORIGIN_PORT), '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`, apiOrigin = 'https://fixture.invalid';
    const context = { appOrigin: origin, apiOrigin, ownerId: 'fixture-owner',
        window: { webContents: { session: session.defaultSession } } };
    const value = await signDesktopUploadPart(context, { uploadId: 'fixture-upload', parts: [] }, new AbortController().signal);
    assert.equal(receivedOrigin, origin, 'Host signing POST must carry the pinned desktop origin');
    assert.equal(accepted, 1); assert.deepEqual(value, { parts: [] });
    console.log('DESKTOP_UPLOAD_PINNED_ORIGIN_PASS');
}).then(() => finish(0), error => { console.error(error.name + ': ' + error.message); finish(1); });
function finish(code) {
    server?.closeAllConnections(); server?.close();
    fs.rmSync(profile, { recursive: true, force: true }); app.exit(code);
}
