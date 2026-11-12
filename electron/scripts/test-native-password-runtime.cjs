'use strict';
// Real Electron/OS encryption and browser consumer acceptance with synthetic
// HTTP fixtures only. This does not claim a production vault/account ceremony.
const { app, safeStorage, session, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { spawn } = require('node:child_process');
const { NativePasswordBroker } = require('../lib/native-passwords/broker.cjs');
const { PasswordBrowser } = require('../lib/native-passwords/consumers.cjs');
const { startPasswordControl } = require('../lib/native-passwords/control.cjs');
const { createNativePasswordApproval } = require('../lib/native-passwords/approval.cjs');
const root = process.env.THINGTIME_NATIVE_PASSWORD_TEST_ROOT;
if (!root || !path.isAbsolute(root)) throw new Error('An explicit isolated test root is required.');
app.setName('Thingtime Password Test'); app.setPath('userData', path.join(root, 'electron-profile'));
app.on('window-all-closed', () => {}); // The fixture exits only after all assertions and cleanup.
if (process.platform === 'linux') app.commandLine.appendSwitch('password-store', 'gnome-libsecret');

app.whenReady().then(async () => {
  const records = new Map(); let server, broker, control, browser, approval, parent, stage = 'setup';
  const report = { platform: process.platform, arch: process.arch, electron: process.versions.electron, fixtureOnly: true };
  try {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    server = http.createServer(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      if (req.url === '/form') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Native autofill fixture</title><form method="post" action="/accept"><label>Account<input id="user" name="username" autocomplete="username"></label><label>Password<input id="password" name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>'); return; }
      if (req.url === '/passwords/provider?view=vault') {
        res.setHeader('Content-Type', 'text/html');
        // This tests the actual sandboxed window/preload/IPC, not vault proof
        // issuance (the separate real-API UI integration covers that boundary).
        res.end(`<title>Isolated approval IPC fixture</title><script>
          history.replaceState({idx:0}, '');
          (async()=>{const bridge=window.thingtimeDesktop;
            const request=await bridge.passwordApprovalReady('synthetic-owner');
            await bridge.passwordApprovalRespond({id:request.id,ownerId:request.expectedOwnerId,proof:{requestId:request.id,binding:request.requestHash,
              context:{purpose:'fill',rp:new URL(request.origin).hostname,entryId:request.entryId,origin:request.origin,requestHash:request.requestHash}}});
          })();
        </script>`); return;
      }
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/.well-known/thingtime-capabilities.json') { res.end(JSON.stringify({ schemaVersion: 1, origin, features: { 'api.passwords': { version: '1.7.0' } } })); return; }
      if (req.url !== '/api/v1/passwords') { res.statusCode = 404; res.end('{}'); return; }
      try {
        let input = ''; for await (const chunk of req) input += chunk;
        const body = JSON.parse(input); assert.equal(body.expectedOwnerId, 'synthetic-owner'); assert.equal(req.headers['x-thingtime-expected-api-origin'], origin);
        let value;
        if (body.operation === 'catalog') value = { catalog: [], nextCursor: null };
        else if (body.operation === 'save') { records.set(body.id, structuredClone(body.entry)); value = { record: { id: body.id } }; }
        else if (body.operation === 'read' && records.has(body.id)) value = { id: body.id, entry: records.get(body.id) };
        else { res.statusCode = 404; value = {}; }
        res.end(JSON.stringify({ ok: res.statusCode === 200, ownerId: 'synthetic-owner', ...value }));
      } catch { res.statusCode = 500; res.end('{}'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = { origin, endpoint: origin, session: session.fromPartition(`native-password-fixture-${randomUUID()}`) };
    stage = 'approval-window';
    parent = new BrowserWindow({ show: false, webPreferences: { session: context.session, sandbox: true, contextIsolation: true, nodeIntegration: false } });
    approval = createNativePasswordApproval({ BrowserWindow, ipcMain, preload: path.resolve(__dirname, '../preload.cjs'), context: () => context, window: () => parent, timeout: 15000 });
    const approvedEntry = randomUUID();
    let sameDocumentStartup = false;
    app.once('browser-window-created', (_event, window) => {
      window.webContents.on('did-start-navigation', details => {
        if (details.isMainFrame && details.isSameDocument && details.url === `${origin}/passwords/provider?view=vault`) sameDocumentStartup = true;
      });
    });
    const proof = await approval.approve({ scope: { origin, ownerId: 'synthetic-owner' }, target: { kind: 'website', origin: 'https://fixture.example' }, entryId: approvedEntry, assertCurrent() {} });
    assert.equal(proof.context.entryId, approvedEntry); assert.equal(proof.context.origin, 'https://fixture.example');
    assert.equal(sameDocumentStartup, true, 'The runtime exercised the approval route’s startup history replacement.');
    approval.close(); approval = null;
    report.sandboxedApprovalWindow = true;
    stage = 'encryption'; broker = new NativePasswordBroker({ userData: path.join(root, 'profile'), safeStorage, context: () => context, approve: async () => true });
    assert.equal(broker.store.available(), true, 'An actual OS-backed key store is required; basic_text must fail');
    await broker.connection('connect', 'synthetic-owner');
    stage = 'ipc'; control = await startPasswordControl(broker);
    const grantFile = path.join(root, 'grant.json');
    const cli = (method, input = {}, grant = false) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.resolve(__dirname, 'password-agent.mjs'), method, '--profile', path.join(root, 'profile'), ...(grant ? ['--grant-file', grantFile] : [])], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', reject); child.once('close', code => code === 0 ? resolve({ value: JSON.parse(stdout), stdout, stderr }) : reject(new Error(`Fixture CLI ${method} failed; inspect the synthetic test locally.`))); child.stdin.end(JSON.stringify(input));
    });
    stage = 'cli'; const capability = await cli('manifest'); assert.equal(capability.value.features['native.passwords'].version, '1.0.0');
    await cli('authorize', { origin, ownerId: 'synthetic-owner', taskId: 'runtime-fixture', target: { kind: 'website', origin: 'https://fixture.example' } }, true);
    const entryId = randomUUID();
    const generated = await cli('generate', { requestId: entryId, title: 'Runtime fixture', username: 'fixture-user' }, true);
    assert.equal(generated.value.saved, true);
    const password = records.get(entryId).fields.find(field => field.id === 'password').value;
    assert.equal(generated.stdout.includes(password), false); assert.equal(generated.stderr.includes(password), false);
    const marker = randomBytes(32).toString('base64url');
    const state = await broker.store.read(); state.pending.fixture = { marker }; await broker.store.write(state);
    const disk = await fs.readFile(broker.store.file); assert.equal(disk.includes(Buffer.from(marker)), false); assert.equal((await broker.store.read()).pending.fixture.marker, marker);
    delete state.pending.fixture; await broker.store.write(state);
    report.osEncryption = true; report.transport = process.platform === 'win32' ? 'named-pipe' : 'unix-socket'; report.cliSecretFree = true;
    stage = 'browser-open'; browser = new PasswordBrowser({ directory: path.join(root, 'browser'), headless: true });
    await browser.open({ kind: 'website', origin }, `${origin}/form`);
    stage = 'browser-fill';
    // A malicious page cannot forge our isolated-world origin/form checks.
    await browser.page.evaluate(() => { window.URL = class { constructor() { this.origin = location.origin; } }; });
    const bound = await browser.bind({ username: '#user', password: '#password' });
    await bound.deliver({ username: 'fixture-user', password }); await bound.close();
    assert.equal(await browser.page.$eval('#password', node => node.value), password);
    assert.equal(browser.driver.browser.process().spawnargs.includes('--no-sandbox'), false);
    stage = 'browser-render';
    await browser.page.screenshot({ path: path.join(root, 'browser-desktop.png') });
    await browser.page.setViewport({ width: 390, height: 844 }); await browser.page.screenshot({ path: path.join(root, 'browser-mobile.png') });
    stage = 'browser-document-fences';
    const stale = await browser.bind({ password: '#password' }); await browser.page.reload({ waitUntil: 'domcontentloaded' });
    await assert.rejects(stale.deliver({ username: '', password }), { code: 'TARGET_CHANGED' }); await stale.close();
    await browser.page.$eval('form', form => { form.action = 'https://different.example'; });
    await browser.page.evaluate(() => { window.URL = class { constructor() { this.origin = location.origin; } }; });
    await assert.rejects(browser.bind({ password: '#password' }), { code: 'INVALID_TARGET' });
    report.browserDirectDelivery = true; report.navigationRefused = true; report.crossOriginFormRefused = true; report.chromiumSandbox = true;
    await cli('release', {}, true); report.grantReleased = true;
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    process.stdout.write(JSON.stringify(report) + '\n');
  } catch (error) {
    process.stderr.write(`Native password runtime fixture failed at ${stage}: ${error.code || error.name || 'Error'}.\n`); app.exitCode = 1;
  } finally {
    approval?.close(); parent?.destroy();
    await browser?.close(); if (control) await control.close(); else await broker?.close();
    if (server) await new Promise(resolve => server.close(resolve)); app.exit(app.exitCode || 0);
  }
}).catch(() => app.exit(1));
