import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash, createCipheriv, randomBytes, randomUUID } from 'node:crypto';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const { chromium } = require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE || 'playwright');
const work = await mkdtemp(join(tmpdir(), 'password-editor-')), evidence = resolve(process.argv[2] || join(tmpdir(), 'password-editor-evidence'));
const ownerId = 'password-editor-fixture', id = '11111111-1111-4111-8111-111111111111';
// Synthetic test data only. Never use a personal vault in this fixture.
const original = { title: 'Imported fixture', passwordType: 'identity', importArchiveId: '22222222-2222-4222-8222-222222222222', onePassword: JSON.stringify({ future: 'retained', details: { documents: [{ documentId: 'fixture-file' }], passwordHistory: [{ value: 'synthetic-history-only', time: 1700000000 }] } }), fields: [
  { id: 'address', label: 'Address', type: 'address', structured: true, value: JSON.stringify({ city: 'Old town', country: 'AU', unknown: { enabled: true, count: 3 }, list: ['one', 'two'] }), sourcePath: ['details', 'sections', 0, 'fields', 0, 'value', 'address'] },
  { id: 'password', label: 'Password', type: 'password', value: 'synthetic-fixture-only' }
] };
const plain = Buffer.from('Thingtime synthetic attachment download acceptance. No private data.\n');
const key = randomBytes(32), nonce = randomBytes(8), token = randomUUID();
const fileMetadata = { version: 1, name: 'fixture-document.txt', size: plain.length, key: key.toString('base64'), nonce: nonce.toString('base64'), token };
const iv = Buffer.alloc(12); nonce.copy(iv);
const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(JSON.stringify([1, token, plain.length, 0])));
const encrypted = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
let browser, server, storage; let permitGet = false, storageOrigin;
try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, 'scripts/password-editor.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(work, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
  const script = await readFile(join(work, 'fixture.js'));
  server = createServer((request, response) => { if (request.url === '/fixture.js') response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script); else response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
  storage = createServer((request, response) => { response.writeHead(200, { 'Content-Type': 'application/octet-stream', ...(permitGet ? { 'Access-Control-Allow-Origin': origin } : {}) }).end(encrypted); });
  storage.listen(0, '127.0.0.1'); await once(storage, 'listening');
  storageOrigin = `http://127.0.0.1:${storage.address().port}`;
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const layouts = new Map(), errors = [], genericActions = [];
    let entry = structuredClone(original), revision = 1, saves = 0, currentOwner = ownerId;
    const metadata = () => ({ id, revision, title: entry.title, passwordType: entry.passwordType, updatedAt: '2026-11-11T00:00:00Z' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === storageOrigin) return route.continue();
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('thingtime-capabilities.json')) return route.fulfill({ json: { schemaVersion: 1, origin, features: Object.fromEntries(Object.entries({ 'api.passwords': '1.8.0', 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0', 'api.things': '1.36.0' }).map(([key, version]) => [key, { version }])) } });
      if (url.pathname === '/api/v1/webpages/resolve') { const page = layouts.get(url.searchParams.get('id')); return page ? route.fulfill({ json: { ok: true, source: 'user', page } }) : route.fulfill({ status: 404 }); }
      if (url.pathname === '/api/v1/things') {
        const body = route.request().postDataJSON();
        assert.equal(route.request().headers()['x-thingtime-expected-actor'], ownerId);
        assert.ok(!JSON.stringify(body).includes('synthetic-fixture-only'));
        assert.ok(!JSON.stringify(body).includes('Old town')); assert.ok(!JSON.stringify(body).includes('synthetic-history-only'));
        const page = { id: body.id || body.shareId, author: { id: ownerId }, updatedAt: `2026-11-11T00:00:${String(layouts.size).padStart(2, '0')}Z`, crystal: body.crystal };
        layouts.set(body.crystal.pageKey, page); return route.fulfill({ json: { ok: true, thing: page } });
      }
      if (url.pathname === '/api/v1/passwords') {
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
        if (!body) return route.fulfill({ json: { ok: true, ownerId: currentOwner, configured: true, entries: currentOwner === ownerId ? [metadata()] : [], nextCursor: null } });
        if (currentOwner !== ownerId) return route.fulfill({ json: { ok: true, ownerId: currentOwner, files: [], settings: { window: '5-minutes', revision: 1, reuseRecentDeviceVerification: false } } });
        assert.equal(body.expectedOwnerId, ownerId);
        if (body.operation === 'file-download') return route.fulfill({ json: {ok:true, ownerId, url: storageOrigin+'/encrypted-fixture', metadata:fileMetadata} });
        if (body.operation === 'read') return route.fulfill({ json: { ok: true, ownerId, id, revision, entry } });
        if (body.operation === 'save') { entry = body.entry; revision++; saves++; return route.fulfill({ json: { ok: true, ownerId, record: metadata() } }); }
        if (body.operation === 'file-list') return route.fulfill({ json: { ok: true, ownerId, files: body.entryIds?.includes(id) ? [{ id: '33333333-3333-4333-8333-333333333333', metadata: fileMetadata }] : [] } });
        if (body.operation === 'verification-settings') return route.fulfill({ json: { ok: true, ownerId, settings: { window: '15-minutes', revision: 1, reuseRecentDeviceVerification: true } } });
        return route.fulfill({ json: { ok: true, ownerId, files: [] } });
      }
      if (url.pathname.startsWith('/api/v1/actions')) genericActions.push(url.pathname);
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
      if (url.pathname === '/branding/generated/icon/thingtime-icon-128x128.png') return route.fulfill({ path: join(root, 'public', url.pathname), contentType: 'image/png' });
      if (url.pathname.endsWith('.png') || url.pathname.endsWith('.svg')) return route.fulfill({ status: 204 });
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin + '/passwords');
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      const editor = page.locator('[data-settings-document="password-entry-editor"]');
      const attachments = page.locator('[data-settings-document="password-attachments"]');
      await attachments.getByText('fixture-document.txt', {exact:true}).waitFor();
      permitGet = false;
      await attachments.getByRole('button', {name:'Download', exact:true}).click();
      await attachments.getByText('File unavailable. Please retry.', {exact:true}).waitFor();
      permitGet = true;
      const pendingDownload = page.waitForEvent('download', {timeout:10000});
      await attachments.getByRole('button', {name:'Download', exact:true}).click();
      const download = await pendingDownload;
      const filename = join(evidence, label+'-download.txt'); await download.saveAs(filename);
      const downloaded = await readFile(filename); assert.deepEqual(downloaded, plain);
      assert.equal(download.suggestedFilename(), 'fixture-document.txt');
      assert.deepEqual(errors, []);
      await page.screenshot({path:join(evidence,label+'-download.png'), fullPage:true});
      const result = {width, filename:download.suggestedFilename(), bytes:downloaded.length, sha256:createHash('sha256').update(downloaded).digest('hex'), expectedSha256:createHash('sha256').update(plain).digest('hex'), error:await download.failure(), syntheticEncryptedTransport:true, missingCorsRejected:true, exactOriginCorsDownloadVerified:true, realBackendVerified:false, pageErrors:errors};
      await writeFile(join(evidence,label+'-download.json'), JSON.stringify(result,null,2)); console.log(result);
    } catch (error) { await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText()); await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }); console.error('Page errors', errors); throw error; } finally { await context.close(); }
  }
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); if (storage) await new Promise(resolve => storage.close(resolve)); await rm(work, { recursive: true, force: true }); }
