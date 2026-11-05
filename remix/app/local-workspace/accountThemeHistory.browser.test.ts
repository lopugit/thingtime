import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import net from 'node:net';
import { parseTimelineVersionExport } from '../timeline/exportVersion';
import { themeContentValue } from '../timeline/themeContent';
import { splitTimelineEvent } from '../timeline/records';

const base = process.env.TT_ACCOUNT_THEME_HISTORY_URL, artifacts = process.env.TT_ACCOUNT_THEME_HISTORY_ARTIFACTS,
 playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;

test('native account theme History retains offline edits and exports before independent real account acceptance',
 { skip: !base || !artifacts || !playwrightPath, timeout: 180_000 }, async t => {
 assert.equal(new URL(base!).hostname, '127.0.0.1');
 assert.ok(process.env.TT_RENDER_SESSION);
 const health = await (await fetch(base + '/api/v1/health/nitro')).json();
 assert.equal(health.testEnvironment.mode, 'isolated-agent-test');
 assert.equal(health.testEnvironment.sessionId, process.env.TT_RENDER_SESSION);
 for (const host of ['203.0.113.1', '::ffff:203.0.113.1']) {
  const code = await new Promise(resolve => { const socket = net.connect({ host, port: 443 }); socket.setTimeout(1500); socket.on('error', (error: any) => resolve(error.code)); socket.on('timeout', () => { socket.destroy(); resolve('timeout'); }); socket.on('connect', () => { socket.destroy(); resolve('CONNECTED'); }); });
  assert.ok(['EPERM', 'ENETUNREACH', 'EHOSTUNREACH'].includes(String(code)), `Direct egress must fail closed: ${code}`);
 }
 await mkdir(artifacts!, { recursive: true });
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 t.after(() => browser.close());
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }),
  guest = await browser.newContext(), foreign = await browser.newContext(), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href;
 const errors: string[] = [], offlineWrites: string[] = [], timelineResponses: number[] = [];
 let offline = false, holdContent = true, holdHistory = false, contentRefusals = 0, historyRefusals = 0, ownerId = '', thingId = '';
 page.setDefaultTimeout(25_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname); });
 page.on('response', (response: any) => { if (new URL(response.url()).pathname === '/api/v1/timeline' && response.request().method() === 'POST') timelineResponses.push(response.status()); });
 await context.route('**/api/v1/themes/sync', async (route: any) => {
  if (holdContent && route.request().postDataJSON()?.operation === 'write') {
   contentRefusals++;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Disposable test: theme content sync unavailable' }) });
  } else await route.continue();
 });
 await context.route('**/api/v1/timeline?*', async (route: any) => {
  if (holdHistory && route.request().method() === 'POST') {
   historyRefusals++;
   await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Disposable test: History sync unavailable' }) });
  } else await route.continue();
 });
 const network = await context.newCDPSession(page); await network.send('Network.enable');
 const connectivity = async (value: boolean) => { offline = value; await context.setOffline(value); await network.send('Network.overrideNetworkState', { offline: value, latency: 1, downloadThroughput: 100_000_000, uploadThroughput: 100_000_000, connectionType: 'ethernet' }); };
 const request = (path: string, data?: unknown) => page.evaluate(async ({ path, data, ownerId }) => {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', 'X-Thingtime-Expected-Actor': ownerId }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
 }, { path, data, ownerId });
 const recorded = () => page.evaluate(async ({ ownerId, thingId }) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('thingtime.local-workspaces.v1'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  try { return await new Promise<any[]>((resolve, reject) => { const r = db.transaction('records', 'readonly').objectStore('records').getAll(); r.onsuccess = () => resolve(r.result.filter(row => row.collection === 'timeline-events' && row.value.event.ownerId === ownerId && row.value.event.thingId === thingId && row.value.event.source === 'client').map(row => row.value)); r.onerror = () => reject(r.error); }); }
  finally { db.close(); }
 }, { ownerId, thingId });
 const eventually = async (check: () => Promise<boolean>, message: string, interval = 200) => { for (let i = 0; i < Math.ceil(30_000 / interval); i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, interval)); } assert.fail(message); };
 const history = page.getByRole('dialog', { name: 'History', exact: true });
 const name = 'Account History peach', accents = ['#bb8866', '#885544', '#664433'];
 try {
  await connectivity(false);
  await assert.rejects(context.request.get('http://203.0.113.1/', { timeout: 3000 }), /EPERM|ENETUNREACH|EHOSTUNREACH/);
  const username = 'theme-history-' + randomUUID().slice(0, 8);
  const registration = await context.request.post(url('/api/v1/auth/register'), { headers: { Origin: base! }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200); ownerId = (await registration.json()).user.id;
  // Authenticate through Chromium so production Secure-cookie policy remains intact on loopback.
  await page.goto(url('/.well-known/thingtime-capabilities.json'));
  const saved = await request('/api/v1/themes', { name, theme: { colors: { accent: accents[0] } }, visibility: 'private' });
  assert.equal(saved.status, 200); thingId = saved.body.theme.id;
  await page.goto(url('/themes'));
  await page.getByText(name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Apply', exact: true }).last().click();
  await page.locator(`input:not([type="color"])[value="${accents[0]}"]`).waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const name of await caches.keys()) if (name.startsWith('thingtime:offline-shell:') && await (await caches.open(name)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  assert.deepEqual(await recorded(), [], 'Remote hydration and selection do not author device edits');
  await connectivity(true); await page.reload();
  for (let i = 1; i < accents.length; i++) {
   await page.locator(`input:not([type="color"])[value="${accents[i - 1]}"]`).fill(accents[i]);
   await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
   await eventually(async () => (await recorded()).length === i, 'The native save must commit its own History');
   await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'The native save must finish applying its current look');
   await page.reload();
   await page.locator(`input:not([type="color"])[value="${accents[i]}"]`).waitFor();
  }
  const drafts = (await recorded()).sort((a, b) => a.event.occurredAt.localeCompare(b.event.occurredAt));
  assert.equal(drafts.length, 2);
  for (const [i, row] of drafts.entries()) {
   assert.equal(row.receipt, null); assert.equal(row.event.mode, 'draft');
   assert.equal((themeContentValue(row.event.before).crystal.theme.colors as any).accent, accents[i]);
   assert.equal((themeContentValue(row.event.after).crystal.theme.colors as any).accent, accents[i + 1]);
  }
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await history.getByRole('button', { name: /Edited Thing on this device/ }).first().click();
  await history.getByRole('tab', { name: 'Versions', exact: true }).click();
  const versions = history.locator('.history-version').filter({ hasText: 'Edited Thing on this device' });
  assert.equal(await versions.count(), 2);
  const exported: string[] = [];
  for (let i = 0; i < 2; i++) {
   const waiting = page.waitForEvent('download'); await versions.nth(i).getByRole('button', { name: 'Export', exact: true }).click();
   const download = await waiting, file = resolve(artifacts!, `theme-history-${i + 1}.json`); await download.saveAs(file);
   const raw = JSON.parse(await readFile(file, 'utf8'));
   assert.ok(drafts.some(row => row.event.id === raw.event.id));
   const archive = parseTimelineVersionExport(raw, { ownerId, thingId, id: raw.event.id });
   assert.equal(archive.event.ownerId, ownerId); assert.equal(archive.event.thingId, thingId); assert.equal(archive.receipt, null);
   exported.push(String((themeContentValue(archive.content).crystal.theme.colors as any).accent));
  }
  assert.deepEqual(exported.sort(), accents.slice(1).sort());
  const bounds = [];
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready);
   const details = width === 1440 ? history : page.getByRole('dialog', { name: 'Version details', exact: true });
   await details.waitFor();
   await details.evaluate(async (element: HTMLElement) => { for (const item of [element, ...element.querySelectorAll<HTMLElement>('*')]) if (item.scrollHeight > item.clientHeight) { for (let y = 0; y <= item.scrollHeight; y += 400) { item.scrollTop = y; await new Promise(requestAnimationFrame); } item.scrollTop = 0; } });
   const box = await details.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
   const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth); assert.equal(scrollWidth, width); bounds.push({ width, scrollWidth, box });
   await page.screenshot({ path: resolve(artifacts!, `account-theme-history-${width}.png`), animations: 'disabled' });
  }
  assert.deepEqual(offlineWrites, []);
  await page.setViewportSize({ width: 1440, height: 1000 }); await connectivity(false);
  await page.evaluate(() => dispatchEvent(new Event('thingtime:root-data-refresh')));
  await eventually(async () => (await recorded()).every(row => !!row.receipt), 'History must receive real server receipts independently of failed theme sync');
  assert.ok(contentRefusals > 0, 'The separate content sender was actually refused');
  assert.ok(timelineResponses.includes(200));
  const remote = await request('/api/v1/themes/sync', { operation: 'snapshot', expectedOwnerId: ownerId });
  assert.equal(remote.status, 200, remote.body.error); assert.equal(remote.body.themes.find((row: any) => row.id === thingId).theme.colors.accent, accents[0]);
  const endpoint = await request('/api/v1/timeline?' + new URLSearchParams({ thingId, ownerId, dataPlane: JSON.parse(drafts[0].scope)[1] }));
  assert.equal(endpoint.status, 200);
  for (const row of await recorded()) {
   const accepted = endpoint.body.entries.find((entry: any) => entry.event.id === row.event.id);
   assert.ok(accepted); assert.deepEqual(accepted.receipt, row.receipt); assert.deepEqual(splitTimelineEvent(accepted.event).event, row.event);
  }
  const outsider = 'theme-foreign-' + randomUUID().slice(0, 8);
  const foreignRegistration = await foreign.request.post(url('/api/v1/auth/register'), { headers: { Origin: base! }, data: { username: outsider, email: outsider + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(foreignRegistration.status(), 200); const foreignOwner = (await foreignRegistration.json()).user.id;
  const foreignPage = await foreign.newPage(); await foreignPage.goto(url('/.well-known/thingtime-capabilities.json'));
  assert.equal((await guest.request.get(url('/api/v1/themes/shared?id=' + thingId))).status(), 404);
  assert.equal((await guest.request.get(url('/api/v1/timeline?thingId=' + thingId))).status(), 401);
  assert.equal(await foreignPage.evaluate(async id => (await fetch('/api/v1/themes/shared?id=' + id)).status, thingId), 404);
  const foreignExport = '/api/v1/timeline?' + new URLSearchParams({ ownerId: foreignOwner, dataPlane: JSON.parse(drafts[0].scope)[1], eventId: drafts[0].event.id, export: '1' });
  assert.equal(await foreignPage.evaluate(async path => (await fetch(path)).status, foreignExport), 404);
  // Releasing content transport is a separate recovery step; receipts did not acknowledge that queue.
  holdContent = false; await history.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Retry theme sync', exact: true }).click();
  await eventually(async () => { const response = await request('/api/v1/themes/sync', { operation: 'snapshot', expectedOwnerId: ownerId }); return response.body.themes?.find((row: any) => row.id === thingId)?.theme.colors.accent === accents[2]; }, 'Separate theme sync must recover', 1000);
  assert.equal((await recorded()).length, 2, 'Acknowledgements do not invent extra authored versions');
  await connectivity(true); await page.reload(); await page.locator(`input:not([type="color"])[value="${accents[2]}"]`).waitFor();
  // Reverse the failure: content can settle while its device History remains queued.
  await page.locator(`input:not([type="color"])[value="${accents[2]}"]`).fill('#443322');
  await page.getByRole('button', { name: 'Save theme 💾', exact: true }).click();
  await eventually(async () => (await recorded()).length === 3, 'The third edit must retain its History');
  await eventually(() => page.getByRole('button', { name: 'Save theme 💾', exact: true }).isEnabled(), 'The third native save must finish applying its current look');
  await page.reload(); await page.locator('input:not([type="color"])[value="#443322"]').waitFor();
  holdHistory = true; await connectivity(false);
  await eventually(async () => { const response = await request('/api/v1/themes/sync', { operation: 'snapshot', expectedOwnerId: ownerId }); return response.body.themes?.find((row: any) => row.id === thingId)?.theme.colors.accent === '#443322'; }, 'Content must synchronize without waiting for History', 1000);
  await eventually(async () => historyRefusals > 0, 'The separate History sender was actually refused');
  assert.equal((await recorded()).filter(row => !row.receipt).length, 1, 'Content receipt cannot acknowledge History');
  await page.getByRole('button', { name: 'History', exact: true }).click();
  holdHistory = false; await history.getByRole('button', { name: 'Refresh', exact: true }).click();
  await eventually(async () => (await recorded()).every(row => !!row.receipt), 'History retry must accept the same retained third event');
  assert.equal((await recorded()).length, 3);
  assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ nativeOfflineEdits: 3, coldReload: true, canonicalHistoryExports: 2, realHistoryReceipts: true, independentContentRefusals: contentRefusals, independentHistoryRefusals: historyRefusals, contentSyncRecovered: true, historySyncRecovered: true, guestAndForeignRefusals: true, bounds, errors, offlineWrites, timelineResponses }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ error: String(error), body: await page.locator('body').innerText().catch(() => ''), errors, offlineWrites, timelineResponses, contentRefusals, historyRefusals }, null, 2));
  throw error;
 }
});
