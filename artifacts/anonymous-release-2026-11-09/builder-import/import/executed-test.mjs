import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const origin = process.env.TT_IMPORT_ORIGIN;
const output = process.env.TT_IMPORT_ARTIFACTS;
const expectedSession = process.env.TT_IMPORT_SESSION;
const bundlePath = process.env.TT_IMPORT_BUNDLE;
const outageFile = '/tmp/qa-offline.flag';
const anonymousScope = JSON.stringify(['anonymous', 1]);

test('normal Things importer retains the complete exact anonymous draft after reload', { timeout: 170_000 }, async () => {
 const health = await (await fetch(origin + '/api/v1/health/nitro')).json();
 assert.deepEqual(health.testEnvironment, { mode: 'isolated-agent-test', sessionId: expectedSession, version: '1.0.0' });
 const manifest = await (await fetch(origin + '/.well-known/thingtime-capabilities.json')).json();
 assert.equal(manifest.origin, origin);
 assert.match(manifest.features['api.things-import'].version, /^1\./);
 const bytes = await readFile(bundlePath);
 const bundle = JSON.parse(bytes);
 const root = bundle.things.find(item => item.id === bundle.roots[0]);
 const dependency = bundle.things.find(item => item.id === root.crystal.blocks[0].component);
 assert.equal(bundle.format, 'thingtime.transfer');
 assert.equal(bundle.version, 1);
 assert.equal(bundle.roots.length, 1);
 assert.equal(bundle.things.length, 2);
 assert.equal(bundle.files.length, 0);
 assert.equal(bundle.links?.length ?? 0, 0);
 assert.ok(dependency);
 const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 let page = await context.newPage();
 const observe = target => { target.setDefaultTimeout(20_000); target.on('pageerror', error => errors.push(error.message)); };
 const requests = [], errors = [], widths = [], peerEvidence = {};
 let stage = 'navigation', offlineReloadFailure = null, ownsOutage = false;
 context.on('request', request => {
  const url = new URL(request.url());
  if (url.origin === origin && url.pathname.startsWith('/api/')) requests.push({ method: request.method(), path: url.pathname });
 });
 observe(page);
 const readWorkspace = () => page.evaluate(async names => {
  const db = await new Promise((done, fail) => {
   const opening = indexedDB.open('thingtime.local-workspaces.v1');
   opening.onsuccess = () => done(opening.result);
   opening.onerror = () => fail(opening.error);
  });
  try {
   const rows = await new Promise((done, fail) => {
    const request = db.transaction('records', 'readonly').objectStore('records').getAll();
    request.onsuccess = () => done(request.result);
    request.onerror = () => fail(request.error);
   });
   return {
    things: rows.filter(row => row.collection === 'things' && names.includes(row.value.crystal?.name)).map(row => ({ scope: row.scope, value: row.value })),
    nonAnonymousRecords: rows.filter(row => row.scope !== JSON.stringify(['anonymous', 1])).length
   };
  } finally { db.close(); }
 }, [root.crystal.name, dependency.crystal.name]);
 try {
  await page.goto(origin + '/things');
  const importer = () => page.getByRole('button', { name: 'Import…', exact: true });
  await importer().waitFor();
  assert.equal((await context.cookies()).filter(cookie => cookie.httpOnly).length, 0, 'fresh browser has no account-session cookies');
  assert.deepEqual(await readWorkspace(), { things: [], nonAnonymousRecords: 0 });
  stage = 'offline readiness';
  await page.waitForFunction(async () => {
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  }, undefined, { timeout: 85_000 });
  await writeFile(outageFile, '', { flag: 'wx' });
  ownsOutage = true;
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-import-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  stage = 'normal import dialog';
  await importer().click();
  await page.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles({ name: 'thingtime-draft.thingtime.json', mimeType: 'application/json', buffer: bytes });
  const dialog = page.getByRole('dialog', { name: 'Import Things' });
  await dialog.getByText('2 Things · 0 files · 0 links · 0.0 MiB', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await dialog.getByRole('button', { name: 'Import private copies', exact: true }).scrollIntoViewIfNeeded();
   const bounds = await dialog.evaluate(el => ({ width: el.getBoundingClientRect().width, client: el.clientWidth, scroll: el.scrollWidth }));
   assert.ok(bounds.width <= width);
   assert.equal(bounds.client, bounds.scroll);
   await page.screenshot({ path: resolve(output, 'dialog-' + width + '.png') });
   widths.push({ width, dialog: bounds });
  }
  await dialog.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  const afterImport = await readWorkspace();
  assert.equal(afterImport.things.length, 2, 'normal importer created the complete closure');
  assert.equal(afterImport.nonAnonymousRecords, 0);
  stage = 'exact cold readback';
  const previousTimeOrigin = await page.evaluate(() => performance.timeOrigin);
  try {
   await page.goto(origin + '/things'); await importer().waitFor();
  } catch (error) {
   offlineReloadFailure = error.message;
   await unlink(outageFile); ownsOutage = false;
   await page.close(); page = await context.newPage(); observe(page);
   await page.goto(origin + '/things'); await importer().waitFor();
  }
  assert.notEqual(await page.evaluate(() => performance.timeOrigin), previousTimeOrigin);
  const retained = await readWorkspace();
  assert.equal(retained.nonAnonymousRecords, 0);
  assert.equal(retained.things.length, 2);
  assert.ok(retained.things.every(row => row.scope === anonymousScope));
  const localRoot = retained.things.find(row => row.value.crystal.name === root.crystal.name).value;
  const localDependency = retained.things.find(row => row.value.crystal.name === dependency.crystal.name).value;
  assert.match(localRoot.id, /^local-/);
  assert.match(localDependency.id, /^local-/);
  assert.notEqual(localRoot.id, localDependency.id);
  assert.deepEqual(localRoot.thingtime, root.thingtime);
  assert.deepEqual(localDependency.thingtime, dependency.thingtime);
  assert.deepEqual(localDependency.crystal, dependency.crystal);
  assert.deepEqual(localRoot.crystal, { ...root.crystal, blocks: [{ ...root.crystal.blocks[0], component: localDependency.id }] });
  assert.ok([localRoot, localDependency].every(row => !row.author && !row.acl && !row.shareId));
  stage = 'rendered imported page';
  await page.goto(origin + '/p/' + localRoot.id);
  const card = page.getByRole('article').filter({ hasText: 'I am happy to be me.' });
  const expectedText = dependency.crystal.args[0].default;
  await card.getByText('I am happy to be me.', { exact: false }).waitFor();
  assert.equal(await card.textContent(), expectedText);
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const bounds = await card.evaluate(el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, height: r.height, docWidth: document.documentElement.scrollWidth, foreground: getComputedStyle(el).color, whiteSpace: getComputedStyle(el).whiteSpace }; });
   assert.ok(bounds.height > 0 && bounds.left >= 0 && bounds.right <= width + 1);
   assert.ok(bounds.docWidth <= width);
   assert.equal(bounds.whiteSpace, 'pre-wrap');
   await page.screenshot({ path: resolve(output, 'imported-' + width + '.png') });
   widths.find(entry => entry.width === width).rendered = bounds;
  }
  stage = 'no public readback';
  if (ownsOutage) { await unlink(outageFile); ownsOutage = false; }
  const peer = await browser.newContext();
  try {
   const response = await peer.request.get(origin + '/api/v1/webpages/resolve?id=' + encodeURIComponent(localRoot.id));
   const body = await response.json();
   assert.equal(response.status(), 404);
   assert.notEqual(body.ok, true);
   peerEvidence.publicResolverStatus = response.status();
   const peerPage = await peer.newPage();
   await peerPage.goto(origin + '/p/' + localRoot.id);
   await peerPage.getByText('Page not found', { exact: false }).waitFor({ timeout: 8_000 }).catch(() => {});
   assert.equal(await peerPage.getByText('I am happy to be me.', { exact: false }).count(), 0);
   peerEvidence.freshBrowserContentFound = false;
  } finally { await peer.close(); }
  assert.deepEqual(requests.filter(r => !['GET', 'HEAD', 'OPTIONS'].includes(r.method)), []);
  assert.deepEqual(errors, []);
  await writeFile(resolve(output, 'verification.json'), JSON.stringify({
   origin, sessionId: expectedSession, bundleSha256: createHash('sha256').update(bytes).digest('hex'),
   normalImportDialog: true, importOffline: true, coldReload: true, coldReloadOffline: !offlineReloadFailure, offlineReloadFailure, anonymousScope, initialSessionCookies: 0,
   exactDependencyCrystal: true, exactRootCrystalWithRemappedReference: true,
   noAuthoredSharingEnvelope: true, root: localRoot, dependency: localDependency,
   nonAnonymousRecords: retained.nonAnonymousRecords, peerEvidence, widths, requests, errors
  }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(output, 'failure.png') }).catch(() => {});
  const body = await page.locator('body').innerText().catch(() => '');
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ stage, error: error.message, body, requests, errors, widths, peerEvidence, offlineReloadFailure }, null, 2));
  throw error;
 } finally {
  try { if (ownsOutage) await unlink(outageFile); } finally { await browser.close(); }
 }
});
