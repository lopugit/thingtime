import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_ACCOUNT_THEME_HISTORY_URL;
const artifacts = process.env.TT_ACCOUNT_THEME_HISTORY_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('Home theme History keeps native import, move, title, delete and offline export under a real custom database',
  { skip: !base || !artifacts || !playwrightPath || !process.env.TT_RENDER_SESSION, timeout: 300_000 }, async t => {
    assert.equal(new URL(base).hostname, '127.0.0.1');
    const health = await (await fetch(base + '/api/v1/health/nitro')).json();
    assert.equal(health.testEnvironment?.mode, 'isolated-agent-test');
    assert.equal(health.testEnvironment?.sessionId, process.env.TT_RENDER_SESSION);
    await mkdir(artifacts, { recursive: true });
    const { chromium } = await import(playwrightPath);
    const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    const page = await context.newPage();
    // The container has loopback only; advertise that usable loopback link to
    // Chromium without giving the browser or backend any external interface.
    const network = await context.newCDPSession(page);
    await network.send('Network.enable');
    const errors = [], writes = [], bounds = [];
    let offline = false;
    const connectivity = async value => {
      if (!value) offline = false;
      await context.setOffline(value);
      await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' });
      if (value) offline = true;
    };
    await connectivity(false);
    page.setDefaultTimeout(25_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
    const url = path => new URL(path, base).href;
    const post = (path, body, ownerId) => page.evaluate(async ({ path, body, ownerId }) => {
      const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Actor': ownerId }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body, ownerId });
    const rows = (ownerId, thingId) => page.evaluate(async ({ ownerId, thingId }) => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('thingtime.local-workspaces.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise((resolve, reject) => { const r = db.transaction('records', 'readonly').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.filter(row => row.collection === 'timeline-events' && row.value.event.ownerId === ownerId && row.value.event.thingId === thingId && row.value.event.source === 'client').map(row => row.value)); r.onerror = () => reject(r.error); }); }
      finally { db.close(); }
    }, { ownerId, thingId });
    const localThingByName = name => page.evaluate(async name => {
      const db = await new Promise((resolve, reject) => { const r = indexedDB.open('thingtime.local-workspaces.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      try { return await new Promise((resolve, reject) => { const r = db.transaction('records', 'readonly').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.find(row => row.collection === 'things' && row.value.crystal?.name === name)?.value ?? null); r.onerror = () => reject(r.error); }); }
      finally { db.close(); }
    }, name);
    const importBundle = async (things, roots) => {
      await page.getByRole('button', { name: 'Import…', exact: true }).click();
      await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots, files: [], things }));
      await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
      await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    };
    const eventually = async (check, message) => { for (let i = 0; i < 100; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 200)); } assert.fail(message); };
    let ownerId, thingId, customPlane, importedId, folderId;
    try {
      const username = 'history-custom-' + randomUUID().slice(0, 8);
      const registration = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: base }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
      assert.equal(registration.status(), 200);
      ownerId = (await registration.json()).user.id;
      await page.goto(url('/themes'));
      await page.locator('input:not([type="color"])').first().fill('#bb8866');
      await page.getByPlaceholder(/remix/).fill('Custom plane History peach');
      await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
      await page.getByText('Custom plane History peach').first().waitFor();
      await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'Initial native save did not finish');
      await page.locator('input:not([type="color"])[value="#bb8866"]').waitFor();
      thingId = (await localThingByName('Custom plane History peach'))?.id;
      assert.ok(thingId);
      await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
      await page.locator('input:not([type="color"])[value="#bb8866"]').fill('#885544');
      await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
      await eventually(async () => (await rows(ownerId, thingId)).length === 2, 'Native create and edit did not retain distinct History drafts');
      await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'Native save did not finish applying its current look');
      await page.locator('input:not([type="color"])[value="#885544"]').waitFor();
      assert.ok((await rows(ownerId, thingId)).every(row => row.event.after.adapter === 'theme-content'));
      const customUrl = 'mongodb://127.0.0.1:27017/thingtime_history_custom_' + randomUUID().replaceAll('-', '');
      const selected = await post('/api/v1/mongodb/endpoint', { url: customUrl }, ownerId);
      assert.equal(selected.status, 200, JSON.stringify(selected.body));
      assert.equal(selected.body.endpoint.custom, true);
      const root = await page.evaluate(async () => (await fetch('/api/root-data')).json());
      assert.equal(root.user?.id, ownerId);
      customPlane = root.dataPlane;
      assert.match(customPlane, /^custom-/);
      await page.goto(url('/history?storage=home'), { waitUntil: 'domcontentloaded' });
      const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true });
      if (await reconnect.isVisible()) await reconnect.click();
      await page.getByRole('button', { name: 'Home account', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Home account', exact: true }).getAttribute('aria-pressed'), 'true');
      await page.getByText('Custom plane History peach').first().waitFor();
      await page.getByRole('button', { name: 'Selected database', exact: true }).click();
      await page.getByText('Custom plane History peach').first().waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Home account', exact: true }).click();
      await page.getByText('Custom plane History peach').first().waitFor();
      await page.screenshot({ path: resolve(artifacts, 'custom-plane-home-history.png'), animations: 'disabled' });
      const homeLibrary = '/things?' + new URLSearchParams({ localPlane: 'home', workspaceOwner: ownerId });
      await page.goto(url(homeLibrary), { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: 'Custom plane History peach' }).waitFor();
      await page.goto(url('/themes'), { waitUntil: 'domcontentloaded' });
      await page.getByText('Custom plane History peach').first().waitFor();
      await page.getByRole('button', { name: 'History', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'History', exact: true });
      await dialog.getByRole('button', { name: /Edited Thing on this device/ }).click();
      await dialog.getByRole('tab', { name: 'Versions', exact: true }).click();
      const version = dialog.locator('.history-version').filter({ hasText: 'Edited Thing on this device' }).first();
      await connectivity(true);
      assert.equal(await page.evaluate(() => navigator.onLine), false);
      const ready = page.waitForEvent('download'); await version.getByRole('button', { name: 'Export', exact: true }).click();
      const download = await ready; const file = resolve(artifacts, 'custom-plane-theme-version.json'); await download.saveAs(file);
      const exported = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(exported.event.thingId, thingId); assert.equal(exported.event.ownerId, ownerId);
      assert.equal(exported.content.adapter, 'theme-content');
      assert.equal(exported.content.value.crystal.name, 'Custom plane History peach');
      assert.equal(exported.content.value.crystal.theme.colors.accent, '#885544');
      await page.goto(url(homeLibrary), { waitUntil: 'domcontentloaded' });
      const folderName = 'History folder ' + randomUUID().slice(0, 6);
      const importedName = 'Imported History look ' + randomUUID().slice(0, 6);
      const title = 'Renamed History look ' + randomUUID().slice(0, 6);
      await importBundle([
        { id: 'folder', thingtime: ['folder'], crystal: { name: folderName } },
        { id: 'theme', thingtime: ['theme'], crystal: { name: importedName, theme: { colors: { accent: '#bf8068' } } } }
      ], ['folder', 'theme']);
      const importedLink = page.getByRole('link', { name: importedName, exact: true });
      await importedLink.waitFor();
      importedId = (await localThingByName(importedName))?.id;
      folderId = (await localThingByName(folderName))?.id;
      assert.ok(importedId && folderId);
      assert.notEqual(importedId, 'theme'); assert.notEqual(folderId, 'folder');
      await importedLink.click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Rename/ }).click();
      await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill(title);
      await page.getByRole('dialog').getByRole('button', { name: 'Rename', exact: true }).click();
      await page.getByRole('link', { name: title, exact: true }).waitFor();
      const selectTheme = async () => {
        const input = page.getByRole('checkbox', { name: 'Select ' + title, exact: true });
        if (!await input.isChecked()) {
          await page.getByRole('link', { name: title, exact: true }).hover();
          await page.locator('label').filter({ has: input }).click();
        }
      };
      await selectTheme();
      await page.getByRole('button', { name: '📁 Move', exact: true }).click();
      await page.getByRole('dialog').getByText(folderName, { exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Move here', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.goto(url(homeLibrary + '&folder=' + encodeURIComponent(folderId)), { waitUntil: 'domcontentloaded' });
      await page.getByRole('link', { name: title, exact: true }).waitFor();
      await selectTheme();
      await page.getByRole('button', { name: '🗑️ Delete', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('link', { name: title, exact: true }).waitFor({ state: 'hidden' });
      await eventually(async () => (await rows(ownerId, importedId)).length === 4, 'Import, title, move and delete must author four History versions');
      const importedHistory = await rows(ownerId, importedId);
      assert.deepEqual(importedHistory.map(row => row.event.operation).sort(), ['create', 'delete', 'update', 'update']);
      assert.ok(importedHistory.every(row => row.event.after?.adapter === 'theme-content' || row.event.operation === 'delete'));
      assert.ok(importedHistory.some(row => row.event.after?.value?.crystal?.title === title));
      assert.ok(importedHistory.some(row => row.event.after?.value?.folderId === folderId));
      const removed = importedHistory.find(row => row.event.operation === 'delete');
      assert.equal(removed.event.before.value.crystal.title, title);
      assert.equal(removed.event.before.value.folderId, folderId);
      await page.goto(url('/history?' + new URLSearchParams({ storage: 'home', thing: importedId })), { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /Deleted Thing on this device/ }).first().click();
      await page.getByRole('tab', { name: 'Versions', exact: true }).click();
      const deletedVersion = page.locator('.history-version').filter({ hasText: 'Deleted Thing on this device' }).first();
      const deletedReady = page.waitForEvent('download'); await deletedVersion.getByRole('button', { name: 'Export', exact: true }).click();
      const deletedDownload = await deletedReady; const deletedFile = resolve(artifacts, 'custom-plane-deleted-theme-version.json'); await deletedDownload.saveAs(deletedFile);
      const deletedExport = JSON.parse(await readFile(deletedFile, 'utf8'));
      assert.equal(deletedExport.event.id, removed.event.id);
      assert.equal(deletedExport.content.adapter, 'theme-content');
      assert.equal(deletedExport.content.value.crystal.name, importedName);
      assert.equal(deletedExport.content.value.crystal.title, title);
      assert.equal(deletedExport.content.value.folderId, folderId);
      assert.equal(deletedExport.content.value.crystal.theme.colors.accent, '#bf8068');
      for (const width of [1440, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
        await page.evaluate(async () => {
          await document.fonts.ready;
          const root = document.scrollingElement;
          root.scrollTop = 0; await new Promise(requestAnimationFrame);
          root.scrollTop = root.scrollHeight; await new Promise(requestAnimationFrame);
          for (const element of document.querySelectorAll('[role="dialog"] *')) {
            if (element.scrollHeight > element.clientHeight && element.clientHeight > 0) {
              element.scrollTop = element.scrollHeight;
              await new Promise(requestAnimationFrame);
            }
          }
        });
        const dimensions = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.scrollingElement.scrollHeight, clientHeight: document.scrollingElement.clientHeight }));
        assert.equal(dimensions.scrollWidth, width); bounds.push({ width, ...dimensions });
        if (width < 820) {
          const details = page.getByRole('dialog', { name: 'Version details', exact: true });
          const box = await details.boundingBox();
          assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1, 'Mobile version sheet must fit the viewport');
          await details.getByRole('button', { name: 'Export', exact: true }).first().waitFor();
        }
        await page.screenshot({ path: resolve(artifacts, `custom-plane-deleted-history-${width}.png`), animations: 'disabled' });
      }
      await connectivity(false);
      const detailHandle = await page.getByRole('dialog', { name: 'Version details', exact: true }).elementHandle().catch(() => null);
      const nextUrl = 'mongodb://127.0.0.1:27017/thingtime_history_next_' + randomUUID().replaceAll('-', '');
      const next = await post('/api/v1/mongodb/endpoint', { url: nextUrl }, ownerId);
      assert.equal(next.status, 200, JSON.stringify(next.body));
      await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
      await page.getByRole('dialog', { name: 'Version details', exact: true }).waitFor({ state: 'hidden' });
      if (detailHandle) assert.equal(await detailHandle.evaluate(element => element.isConnected), false, 'Old version detail must detach after a selected-plane change');
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.deepEqual(writes, [], 'Offline import, edits and downloads must make no mutation requests');
      assert.deepEqual(errors, []);
      await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ source: 'compiled isolated app', ownerId, thingId, importedId, folderId, customPlane, homeHistoryUnderCustomPlane: true, selectedPlaneExcludesHomeHistory: true, importedHistoryOperations: importedHistory.map(row => row.event.operation), offlineVersionExports: [file, deletedFile], staleDetailDetached: true, bounds, offlineWrites: writes, errors }, null, 2));
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
      const liveRoot = await page.evaluate(async () => { const r = await fetch('/api/root-data'); const b = await r.json(); return { status: r.status, userId: b.user?.id, temporary: b.user?.temporary, dataPlane: b.dataPlane, clientIdentityGeneration: b.clientIdentityGeneration }; }).catch(() => null);
      await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), ownerId, thingId, customPlane, liveRoot, historyEvents: ownerId && thingId ? (await rows(ownerId, thingId).catch(() => [])).map(row => ({ id: row.event.id, mode: row.event.mode, after: row.event.after?.adapter })) : [], errors, writes }, null, 2));
      throw error;
    } finally { await context.close(); }
  });
