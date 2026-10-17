'use strict';
// This process is launched only by verify-renderer-restart.mjs with a fresh
// temporary profile. It never starts the native node or reads installed state.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, session } = require('electron');
const { startRendererServer } = require('../../lib/renderer-server.cjs');
const [profile, bundle, stage, resultFile] = process.argv.slice(2);
assert.ok(path.isAbsolute(profile) && path.isAbsolute(bundle) && path.isAbsolute(resultFile));
app.setName('Thingtime Restart Verification'); app.setPath('userData', profile);
let renderer, window;
const timer = setTimeout(() => { console.error('Renderer restart verification timed out'); app.exit(1); }, 45000);
app.whenReady().then(async () => {
    await session.defaultSession.clearCache(); // Match production startup.
    process.env.NODE_ENV = 'production'; process.env.THINGTIME_DESKTOP = '1';
    // No configured remote endpoint or credentials are needed by this fixture.
    delete process.env.THINGTIME_API_FALLBACK_ORIGIN;
    try {
        renderer = await startRendererServer({ profilePath: profile, loadApplication: async ({ port }) => {
            if (stage === 'collision') throw Error('Collision unexpectedly loaded application');
            process.env.PORT = process.env.NITRO_PORT = String(port);
            process.env.HOST = process.env.NITRO_HOST = '127.0.0.1';
            const application = await import(pathToFileURL(path.resolve(__dirname, '../../dist/web/.output/server/index.mjs')).href);
            assert.equal(typeof application.middleware, 'function');
            return { ...application, middleware: (request, response) => {
                if (request.url === '/restart-fixture') {
                    response.setHeader('Content-Type', 'text/html');
                    response.end('<!doctype html><title>Restart verification</title><script src="/restart-fixture.js"></script>');
                } else if (request.url === '/restart-fixture.js') {
                    response.setHeader('Content-Type', 'text/javascript'); response.end(fs.readFileSync(bundle));
                } else return application.middleware(request, response);
            } };
        } });
    } catch (error) {
        if (stage !== 'collision') throw error;
        assert.match(error.message, /saved local address.*in use/);
        fs.writeFileSync(resultFile, JSON.stringify({ stage, refused: true })); return;
    }
    assert.notEqual(stage, 'collision');
    const shell = await fetch(renderer.origin);
    assert.equal(shell.status, 200); assert.match(await shell.text(), /id="root"/);
    window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(renderer.origin + '/') }));
    await window.loadURL(renderer.origin + '/restart-fixture');
    const result = await window.webContents.executeJavaScript(`window.verifyRestart(${JSON.stringify(stage)})`);
    window.webContents.session.flushStorageData();
    fs.writeFileSync(resultFile, JSON.stringify(result));
}).catch(error => { process.exitCode = 1; console.error(error); }).finally(async () => {
    clearTimeout(timer); window?.destroy(); await renderer?.close(); app.quit();
});
