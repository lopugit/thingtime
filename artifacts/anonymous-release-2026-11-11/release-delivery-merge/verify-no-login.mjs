// Task-owned acceptance harness. It consumes an existing build and never builds.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
if (process.env.THINGTIME_FINAL_DRAFT_ASSETS_READY !== '1') throw new Error('Parent must confirm final built draft assets before acceptance.');
const repo = process.cwd();
const output = fileURLToPath(new URL('./browser/', import.meta.url));
await mkdir(output, { recursive: true });
const require = createRequire(path.join(repo, 'MCP/package.json'));
const { chromium } = require('playwright');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetPath = path.join(repo, 'remix/dist/draft-preview');
const html = await readFile(path.join(assetPath, 'index.html'));
const runner = await readFile(path.join(assetPath, 'runner.js'));
const policyBytes = await readFile(path.join(assetPath, 'policy.json'));
const policy = JSON.parse(policyBytes).contentSecurityPolicy;
assert.match(policy, /sandbox allow-scripts allow-downloads(?:;|$)/);
assert.match(policy, /connect-src 'none'/);
const fixtureText = await readFile(path.join(repo, 'MCP/test/fixtures/affirmation.transfer.json'), 'utf8');
const fixture = JSON.parse(fixtureText);
const component = fixture.things.find(thing => thing.thingtime.includes('component'));
const exact = component.crystal.args.find(arg => arg.name === 'message').default;
const assets = new Map([
  ['/draft-preview/index.html', { bytes: html, type: 'text/html; charset=utf-8' }],
  ['/draft-preview/runner.js', { bytes: runner, type: 'text/javascript; charset=utf-8' }]
]);
const sourceFiles = ['remix/app/components/Kinds/HtmlThingRenderer.tsx', 'remix/app/components/Builder/WebpageBlocksRenderer.tsx',
  'remix/app/draftPreview/entry.tsx', 'remix/app/draftPreview/prepare.ts', 'remix/vite.draft.config.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, hash(await readFile(path.join(repo, file)))])));
const git = args => { const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' }); return result.status === 0 ? result.stdout.trim() : null; };
const result = { observedAt: new Date().toISOString(), scope: 'Final merged-source no-login draft UI against real built assets; no MCP/provider/deployment/native-install claim',
  sourceAssociation: { head: git(['rev-parse', 'HEAD']), fetchedMain: git(['rev-parse', 'origin/main']), files: sourceHashes },
  runnerSha256: hash(runner), htmlSha256: hash(html), policySha256: hash(policyBytes), fixtureSha256: hash(fixtureText), policy,
  chromiumSandbox: true, cleanContext: true, requests: [], blockedRequests: [], errors: [], viewports: [], artifacts: [], ok: false, browserClosed: false, serverClosed: false };
let origin, browser, context, server;
const deadline = setTimeout(() => { void browser?.close(); server?.closeAllConnections(); }, 90000);
async function save(name, bytes) {
  await writeFile(path.join(output, name), bytes);
  const item = { name, bytes: bytes.length, sha256: hash(bytes) };
  if (name.endsWith('.png')) { item.width = bytes.readUInt32BE(16); item.height = bytes.readUInt32BE(20); }
  result.artifacts.push(item);
}
try {
  server = createServer((req, res) => {
    const url = new URL(req.url, origin);
    const asset = url.origin === origin && !url.search && req.method === 'GET' ? assets.get(url.pathname) : undefined;
    if (!asset) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': asset.type, 'Content-Length': String(asset.bytes.length), 'Content-Security-Policy': policy, 'Cache-Control': 'no-store' });
    res.end(asset.bytes);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 });
  result.chromiumVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
  await context.route('**/*', async route => {
    const address = route.request().url(); result.requests.push(address);
    const url = new URL(address);
    if (url.origin === origin && !url.search && assets.has(url.pathname) && route.request().method() === 'GET') await route.continue();
    else { result.blockedRequests.push(address); await route.abort(); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => result.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(message.text()); });
  const navigation = await page.goto(`${origin}/draft-preview/index.html`, { waitUntil: 'load' });
  assert.equal(navigation.status(), 200);
  assert.equal(navigation.headers()['content-security-policy'], policy);
  assert.equal(navigation.headers()['cache-control'], 'no-store');
  await page.waitForFunction(() => window.thingtimeDraft?.version === 1);
  await page.evaluate(() => document.addEventListener('securitypolicyviolation', event => { document.body.dataset.cspFailure = event.violatedDirective; }));
  assert.equal(await page.getByRole('button', { name: 'Download JSON', exact: true }).isDisabled(), true);
  await page.getByLabel('Thing / transfer JSON', { exact: true }).fill(fixtureText);
  await page.getByRole('button', { name: 'Render draft', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok": true'));
  const actualText = () => page.locator('#native-preview').textContent();
  assert.equal(await actualText(), exact); result.exactText = true;
  result.opaqueStorageDenied = await page.evaluate(() => { try { localStorage.getItem('acceptance-probe'); return false; } catch { return true; } });
  assert.equal(result.opaqueStorageDenied, true);
  assert.equal((await context.cookies()).length, 0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON', exact: true }).click();
  const download = await downloadEvent;
  const json = await readFile(await download.path(), 'utf8');
  const exported = JSON.parse(json), exportedComponent = exported.things.find(thing => thing.thingtime.includes('component'));
  assert.equal(exported.format, 'thingtime.transfer'); assert.equal(exported.things.length, 2);
  assert.equal(exportedComponent.id, component.id);
  assert.equal(exportedComponent.crystal.args.find(arg => arg.name === 'message').default, exact);
  assert.ok(exported.things.find(thing => thing.thingtime.includes('webpage')).crystal.blocks.some(block => block.component === exportedComponent.id));
  result.componentComplete = true; result.jsonSha256 = hash(json);
  assert.equal(JSON.parse(await page.locator('#diagnostics').textContent()).hash, result.jsonSha256);
  await save('thingtime-draft.json', Buffer.from(json));
  const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
    // Exercise the full host editor before switching to its shipped capture view.
    await page.evaluate(() => { delete document.body.dataset.capture; scrollTo(0, 0); });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Editor has horizontal overflow');
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    assert.ok(await page.getByRole('button', { name: 'Download JSON', exact: true }).isEnabled());
    await page.evaluate(() => scrollTo(0, 0));
    await save(`editor-${viewport.width}x${viewport.height}.png`, await page.screenshot({ fullPage: true }));
    await page.evaluate(() => { document.body.dataset.capture = 'true'; scrollTo(0, 0); });
    const geometry = await page.evaluate(() => {
      const preview = document.querySelector('#native-preview');
      const selected = preview.querySelector('[data-draft-block="card"]');
      const card = selected.querySelector('[data-live] > :not(style)');
      const rect = card.getBoundingClientRect(), style = getComputedStyle(card);
      const nodes = Array.from(preview.querySelectorAll('*')).filter(element => element.tagName !== 'STYLE');
      const overflow = nodes.some(element => { const box = element.getBoundingClientRect(); return box.width > 0 && box.height > 0 &&
        (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1 || element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 2); });
      return { documentWidth: document.documentElement.scrollWidth, card: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom },
        font: style.fontFamily, whiteSpace: style.whiteSpace, overflow, exact: preview.textContent };
    });
    assert.equal(geometry.exact, exact); assert.equal(geometry.overflow, false);
    assert.ok(geometry.documentWidth <= viewport.width + 1);
    assert.ok(Math.abs(geometry.card.width / geometry.card.height - 5 / 7) < 0.005);
    assert.ok(geometry.card.x >= 23 && geometry.card.right <= viewport.width - 23);
    assert.equal(geometry.whiteSpace, 'pre-wrap'); assert.match(geometry.font, /Georgia/);
    if (viewport.width === 1440) assert.equal(geometry.card.width, 400);
    result.viewports.push({ ...viewport, ...geometry });
    await save(`viewport-${viewport.width}x${viewport.height}.png`, await page.screenshot());
    if (viewport.width === 1440) await save('card.png', await page.screenshot({ clip: { x: geometry.card.x, y: geometry.card.y, width: geometry.card.width, height: geometry.card.height } }));
    await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.evaluate(() => { delete document.body.dataset.capture; scrollTo(0, 0); });
  }
  await page.getByLabel('Thing / transfer JSON', { exact: true }).fill('{bad');
  await page.getByRole('button', { name: 'Render draft', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#diagnostics')?.textContent?.includes('"ok":false'));
  assert.equal(await actualText(), exact); result.lastGoodPreviewRetained = true;
  assert.equal(await page.getByRole('button', { name: 'Download JSON', exact: true }).isDisabled(), true); result.invalidJsonRejected = true;
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => window.thingtimeDraft?.version === 1);
  assert.equal(await page.getByLabel('Thing / transfer JSON', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('#native-preview').count(), 0); result.emptyAfterReload = true;
  assert.equal((await context.cookies()).length, 0);
  assert.equal(result.requests.filter(address => new URL(address).pathname.startsWith('/api/')).length, 0); result.privateApiRequests = 0;
  assert.deepEqual(result.blockedRequests, []); assert.deepEqual(result.errors, []);
  assert.equal(await page.getAttribute('body', 'data-csp-failure'), null);
  assert.equal(hash(await readFile(path.join(assetPath, 'runner.js'))), result.runnerSha256, 'Final built runner changed during acceptance');
  result.ok = true;
} catch (error) {
  result.failure = error.message;
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  if (browser) { await browser.close(); result.browserClosed = true; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); result.serverClosed = true; }
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: result.ok, failure: result.failure, runnerSha256: result.runnerSha256, output, browserClosed: result.browserClosed, serverClosed: result.serverClosed }));
