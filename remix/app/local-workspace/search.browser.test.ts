import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const base = process.env.TT_LOCAL_SEARCH_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const enabled = !!base && !!playwrightPath;
const artifacts = process.env.TT_LOCAL_SEARCH_ARTIFACTS;
async function ready(page: any) {
 await page.waitForFunction(async () => {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) return false;
  for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
  return false;
 });
}
async function launch() {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 return chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
}
const search = (page: any) => page.getByRole('textbox', { name: 'Search all your things and computers…', exact: true });

test('anonymous library search pages nested content offline and visible checkboxes select without navigating', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch();
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
  const writes: string[] = [], searches: string[] = [];
  context.on('request', (request: any) => {
   if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname);
   if (new URL(request.url()).pathname === '/api/v1/things/search') searches.push(request.url());
  });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user, null);
  await ready(page); await context.setOffline(true);
  const things = [{ id: 'folder', thingtime: ['folder'], crystal: { name: 'Nested search examples' } },
   ...Array.from({ length: 61 }, (_, n) => ({ id: `card-${n}`, folderId: 'folder', thingtime: ['data'], crystal: { name: `Search card ${String(n).padStart(2, '0')}`, body: 'Golden needle 🌈' } }))];
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['folder'], things, files: [] }));
  await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Nested search examples', exact: true }).waitFor();
  await search(page).fill('golden needle');
  await page.getByRole('button', { name: 'Load more search results', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Search card / }).count(), 50);
  await page.getByRole('button', { name: 'Load more search results', exact: true }).click();
  await page.getByText('61 results across your things and computers', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Search card / }).count(), 61);
  await page.getByRole('button', { name: '🧩 Components', exact: true }).click();
  await page.getByText('Nothing matched that search.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '🌀 All', exact: true }).click();
  await search(page).fill('Search card 00');
  await page.getByText('1 result across your things and computers', { exact: true }).waitFor();
  for (const view of ['Grid','List']) {
   await page.getByRole('button', { name: view, exact: true }).click();
   const input = page.getByRole('checkbox', { name: 'Select Search card 00', exact: true });
   await page.locator('label').filter({ has: input }).click();
   assert.equal(await input.isChecked(), true); assert.equal(new URL(page.url()).pathname, '/things');
   await page.getByRole('button', { name: '✕ Clear', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Grid', exact: true }).click();
  await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
  await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill('Offline renamed search fixture');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await search(page).fill('Offline renamed search fixture');
  await page.getByRole('link', { name: 'Offline renamed search fixture', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('link', { name: 'Offline renamed search fixture', exact: true }).waitFor();
  await search(page).fill('x'.repeat(201));
  await page.getByRole('alert').filter({ hasText: '200 characters' }).waitFor();
  assert.equal(await page.getByText('Nothing matched that search.', { exact: true }).count(), 0);
  await search(page).fill('Offline renamed search fixture');
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  const bounds = [];
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  for (const width of [1440,390,320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const input = page.getByRole('checkbox', { name: 'Select Offline renamed search fixture', exact: true });
   await page.locator('label').filter({ has: input }).click();
   assert.equal(await input.isChecked(), true); assert.equal(new URL(page.url()).pathname, '/things');
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `anonymous-search-${width}.png`), fullPage: true });
   await page.getByRole('button', { name: '✕ Clear', exact: true }).click();
  }
  assert.deepEqual(writes, []); assert.deepEqual(searches, []);
  if (artifacts) await writeFile(resolve(artifacts, 'anonymous-search-verification.json'), JSON.stringify({ anonymous: true, offlineImportAndRename: true, coldOfflineReload: true, searchedAcrossFolders: 61, visibleMouseSelection: true, boundedError: true, writes, searches, bounds }, null, 2));
 } finally { await browser.close(); }
});

test('isolated account search retains cached results through errors and cold offline reload', { skip: !enabled || process.env.TT_LOCAL_SEARCH_ACCOUNT !== '1', timeout: 120_000 }, async () => {
 const browser = await launch();
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const ids: string[] = [];
 const headers = { Origin: new URL(base!).origin };
 try {
  const name = `searchqa-${randomUUID().slice(0,8)}`;
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username: name, email: `${name}@example.test`, password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200);
  const registered = await registration.json(); assert.ok(registered.user?.id);
  for (let n = 0; n < 2; n++) {
   const response = await context.request.post(new URL('/api/v1/things', base).href, { headers, data: { thingtime: ['data'], crystal: { name: `Account search needle ${n}` }, visibility: 'private' } });
   assert.equal(response.status(), 200); const created = await response.json(); assert.ok(created.thing?.id); ids.push(created.thing.id);
  }
  await page.goto(new URL('/things', base).href); await ready(page);
  await search(page).fill('Account search needle');
  await page.getByText('2 results across your things and computers', { exact: true }).waitFor();
  // Wait for remote refresh, not only the optimistic device results.
  await page.getByText('Showing Things saved on this device. Your account may contain more results.', { exact: true }).waitFor({ state: 'hidden' });
  await page.route('**/api/v1/things/search', (route: any) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Search fixture unavailable' }) }));
  await search(page).fill('search needle');
  await page.getByRole('button', { name: 'Retry search', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Account search needle / }).count(), 2);
  await page.unroute('**/api/v1/things/search');
  await context.setOffline(true); await page.reload();
  await page.getByText('Showing Things saved on this device. Your account may contain more results.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Account search needle / }).count(), 2);
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'account-search-offline.png'), fullPage: true });
  await context.setOffline(false);
  if (artifacts) await writeFile(resolve(artifacts, 'account-search-verification.json'), JSON.stringify({ isolatedLocalAccount: true, remoteSearch: true, cachedResultsOn503: true, coldOfflineReload: true, resultCount: 2 }, null, 2));
 } catch (error) {
  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'account-search-failure.png'), fullPage: true }); }
  console.error(error); throw error;
 } finally {
  try {
  await context.setOffline(false);
  for (const id of ids) { const response = await context.request.delete(new URL('/api/v1/things', base).href, { headers, data: { id } }); assert.equal(response.status(), 200); }
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers, data: {} });
  } finally { await browser.close(); }
 }
});
