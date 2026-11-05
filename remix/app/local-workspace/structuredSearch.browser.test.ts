import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { searchLocalThings } from './structuredSearch';
const base = process.env.TT_LOCAL_STRUCTURED_SEARCH_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_STRUCTURED_SEARCH_ARTIFACTS;
const enabled = !!base && !!playwrightPath;
async function launch() {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Disposable local fixtures only');
 const { chromium } = await import(playwrightPath!);
 return chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
}
const ready = async (page: any) => page.waitForFunction(async () => {
 await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
 for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
 return false;
});

test('anonymous native structured search filters and pages offline, preserves scope and reports invalid input', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 page.setDefaultTimeout(15_000);
 const writes: string[] = [], searches: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { const path = new URL(request.url()).pathname; if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(path); if (path === '/api/v1/things/search') searches.push(path); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('console', (message: any) => { if (/React Router caught/.test(message.text())) errors.push(message.text()); });
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user, null); await ready(page);
  await context.setOffline(true);
  const things = Array.from({ length: 25 }, (_, n) => ({ id: `card-${n}`, thingtime: ['data'], crystal: { name: `Structured card ${n}`, price: n, palette: 'Gold [peach]' } }));
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: things.map(row => row.id), things, files: [] }));
  await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Structured card 0', exact: true }).waitFor();
  await page.goto(new URL('/search?source=device&q=structured', base).href);
  await page.getByText('25 things · newest first', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Open Structured card/ }).count(), 20);
  await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await page.getByRole('link', { name: /^Open Structured card/ }).nth(24).waitFor();
  await page.getByRole('button', { name: 'Add filter', exact: true }).click();
  await page.getByPlaceholder('field (e.g. legs)', { exact: true }).fill('price');
  await page.locator('select').filter({ has: page.locator('option[value="gt"]') }).selectOption('gt');
  await page.getByPlaceholder('value', { exact: true }).fill('20');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('4 things · newest first', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Open Structured card/ }).count(), 4);
  assert.equal(new URL(page.url()).searchParams.get('source'), 'device');
  await page.reload(); await page.getByText('4 things · newest first', { exact: true }).waitFor();
  await page.getByPlaceholder('field (e.g. legs)', { exact: true }).fill('$where');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Condition field segments' }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Open Structured card/ }).count(), 4, 'an error preserves prior results');
  await page.getByPlaceholder('field (e.g. legs)', { exact: true }).fill('price');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });
  await page.getByText(/Condition field segments/).waitFor({ state: 'hidden' });
  const bounds = [];
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `structured-search-${width}.png`), fullPage: true });
  }
  assert.deepEqual(writes, []); assert.deepEqual(searches, []);
  await context.setOffline(false);
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true }); if (await reconnect.isVisible()) await reconnect.click();
  await page.getByText('4 things · newest first', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Online search', exact: true }).click();
  await page.getByRole('link', { name: /^Open Structured card/ }).first().waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'This device', exact: true }).click();
  await page.getByText('4 things · newest first', { exact: true }).waitFor();
  assert.deepEqual(writes.filter(path => path !== '/api/v1/things/search'), []);
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'anonymous-verification.json'), JSON.stringify({ anonymous: true, offline: true, coldReload: true, pageCount: 2, filtered: 4, invalidInputRetainsResults: true, sourceCacheIsolation: true, bounds, writes, searches, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'anonymous-failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'anonymous-failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), writes, searches, errors }, null, 2)); }
  throw error;
 } finally { await browser.close(); }
});

test('device field semantics agree with real server searches without exposing private fixtures anonymously', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext(), ids: string[] = [], compared: unknown[] = [];
 const headers = { Origin: new URL(base!).origin };
 try {
  const username = `grammarqa-${randomUUID().slice(0, 8)}`;
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200);
  const rows = [];
  for (const crystal of [{ name: 'Golden [card]', price: 5, enabled: true, nil: null, list: [{ value: 4 }, { value: 9 }] }, { name: 'Peach card', price: 12, enabled: false, values: [1, 8] }, { name: 'Rose card', price: '5' }]) {
   const response = await context.request.post(new URL('/api/v1/things', base).href, { headers, data: { thingtime: ['data'], crystal, tags: ['gold'], visibility: 'private' } });
   assert.equal(response.status(), 200); const thing = (await response.json()).thing; ids.push(thing.id); rows.push({ ...thing, revision: 1 });
  }
  const cases = [
   ['price', 'eq', 5], ['price', 'ne', 5], ['price', 'gt', 5], ['price', 'gte', 5], ['price', 'lt', 6], ['price', 'lte', 5], ['price', 'in', [5, 12]], ['price', 'nin', [5, 12]],
   ['name', 'contains', '[CARD]'], ['name', 'startsWith', 'peach'], ['name', 'endsWith', 'card'], ['list.value', 'gte', 8], ['values', 'gt', 7], ['tags', 'eq', 'gold'],
   ['nil', 'eq', null], ['nil', 'ne', null], ['nil', 'exists', true], ['nil', 'exists', false], ['nil', 'type', 'null'], ['list', 'type', 'array'], ['price', 'type', 'number'], ['price', 'type', 'string'], ['enabled', 'type', 'boolean'], ['list.0.value', 'eq', 4]
  ].map(([field, op, value]) => [{ field, op, value }]);
  cases.push([{ field: 'createdAt', op: 'gte', value: '2026-01-01' }]);
  for (const conditions of cases) {
   const response = await context.request.post(new URL('/api/v1/things/search', base).href, { headers, data: { conditions, thingtime: 'data', author: username, sort: 'oldest' } });
   assert.equal(response.status(), 200, JSON.stringify(conditions));
   const server = (await response.json()).things.map((row: any) => row.id).sort();
   const device = (await searchLocalThings(rows, { conditions, thingtime: 'data' }, 'fixture-account')).things.map(row => row.id).sort();
   assert.deepEqual(device, server, JSON.stringify(conditions)); compared.push(conditions);
  }
  const publicContext = await browser.newContext();
  const anonymous = await publicContext.request.post(new URL('/api/v1/things/search', base).href, { headers, data: { author: username, conditions: [{ field: 'tags', op: 'eq', value: 'gold' }] } });
  assert.equal(anonymous.status(), 200); assert.deepEqual((await anonymous.json()).things, []); await publicContext.close();
  const invalid = await context.request.post(new URL('/api/v1/things/search', base).href, { headers, data: { conditions: [{ field: 'price', op: 'type', value: 'constructor' }] } }); assert.equal(invalid.status(), 400);
  const page = await context.newPage(); page.setDefaultTimeout(15_000);
  await page.goto(new URL('/things', base).href); await page.getByRole('link', { name: 'Golden [card]', exact: true }).waitFor(); await ready(page);
  await context.setOffline(true);
  await page.goto(new URL('/search?source=device&q=card', base).href);
  await page.getByText('3 things · newest first', { exact: true }).waitFor();
  await page.reload(); await page.getByText('3 things · newest first', { exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: /^Open (Golden|Peach|Rose)/ }).count(), 3);
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'account-device-search.png'), fullPage: true });
  await context.setOffline(false);
  const isolated = await browser.newContext(), visitor = await isolated.newPage();
  await visitor.goto(new URL('/search?source=device&q=card', base).href);
  await visitor.getByText('0 things · newest first', { exact: true }).waitFor();
  assert.equal(await visitor.getByRole('link', { name: /^Open (Golden|Peach|Rose)/ }).count(), 0);
  await isolated.close();

  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await writeFile(resolve(artifacts, 'grammar-verification.json'), JSON.stringify({ isolatedAccount: true, privateFixtures: ids.length, compared, anonymousPrivateResults: 0, invalidPrototypeType: 400, accountDeviceColdReload: true, independentAnonymousResults: 0 }, null, 2)); }
 } finally {
  try { for (const id of ids) { const response = await context.request.delete(new URL('/api/v1/things', base).href, { headers, data: { id } }); assert.equal(response.status(), 200); } await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers, data: {} }); }
  finally { await browser.close(); }
 }
});
