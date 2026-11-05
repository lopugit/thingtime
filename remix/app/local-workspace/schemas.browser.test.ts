import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const base = process.env.TT_LOCAL_SCHEMAS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_SCHEMAS_ARTIFACTS;
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
async function author(page: any, name: string) {
 await page.getByRole('button', { name: 'Mine', exact: true }).click();
 await page.getByRole('button', { name: 'Create a Schema', exact: true }).click();
 await page.getByPlaceholder('Schema name — e.g. Table', { exact: true }).fill(name);
 await page.getByRole('textbox', { name: 'Field name', exact: true }).fill('note');
 await page.getByPlaceholder('description (optional)', { exact: true }).fill('Your note');
}
async function openCreated(page: any, name: string) {
 await page.getByRole('button', { name: 'Save schema ✨', exact: true }).click();
 await page.getByRole('button', { name: 'Close builder', exact: true }).waitFor({ state: 'hidden' });
 await page.getByRole('button', { name: 'Mine', exact: true }).click();
 await page.getByRole('link', { name, exact: true }).click();
 await page.getByRole('button', { name: 'Create thing', exact: true }).waitFor();
}
test('anonymous schema authoring, draft recovery, data forms, copies and saved catalogue work offline', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const writes: string[] = [], errors: string[] = [], bounds: unknown[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/schemas', base).href); assert.equal((await (await root).json()).user, null); await ready(page);
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await author(page, 'Offline schema acceptance');
  await page.reload(); await page.getByRole('button', { name: 'Create a Schema', exact: true }).click();
  await page.getByPlaceholder('Schema name — e.g. Table').filter({ visible: true }).waitFor();
  await page.waitForFunction(() => (document.querySelector('input[placeholder="Schema name — e.g. Table"]') as HTMLInputElement)?.value === 'Offline schema acceptance');
  assert.equal(await page.getByRole('textbox', { name: 'Field name', exact: true }).inputValue(), 'note');
  assert.equal(await page.getByPlaceholder('description (optional)').inputValue(), 'Your note');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(size.width, size.scrollWidth); bounds.push({ surface: 'builder', ...size });
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `schema-builder-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 }); await openCreated(page, 'Offline schema acceptance'); const schemaUrl = page.url();
  await page.getByPlaceholder('Your note', { exact: true }).fill('Draft recovered offline'); await page.reload();
  await page.waitForFunction(() => (document.querySelector('input[placeholder="Your note"]') as HTMLInputElement)?.value === 'Draft recovered offline');
  await page.getByRole('button', { name: 'Create thing', exact: true }).click();
  await page.getByRole('link', { name: 'Open thing', exact: true }).waitFor();
  assert.equal(await page.getByPlaceholder('Your note').inputValue(), '');
  await page.reload(); await page.getByRole('link', { name: 'Open thing', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Open thing', exact: true }).count(), 1);
  assert.equal(await page.getByPlaceholder('Your note').inputValue(), '');
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(size.width, size.scrollWidth); bounds.push({ surface: 'detail', ...size });
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `schema-detail-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Copy and extend', exact: true }).click();
  await page.getByPlaceholder('Schema name — e.g. Table').fill('Independent offline copy');
  await page.getByRole('button', { name: 'Save schema ✨', exact: true }).click(); await page.waitForURL(url => url.href !== schemaUrl);
  await page.getByRole('button', { name: 'Create thing', exact: true }).waitFor();
  await page.goto(new URL('/schemas', base).href); await page.getByRole('button', { name: 'Mine', exact: true }).click();
  assert.equal(await page.getByRole('link', { name: 'Offline schema acceptance', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Add to library', exact: true }).first().click();
  await page.getByRole('button', { name: 'Library', exact: true }).click(); await page.getByRole('button', { name: 'In my library', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'In my library', exact: true }).count(), 1);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'anonymous-verification.json'), JSON.stringify({ anonymous: true, offlineProbe: true, schemaDraftRecovery: true, formDraftRecovery: true, coldReload: true, independentCopy: true, libraryMembership: true, bounds, writes, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'anonymous-failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'anonymous-failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), writes, errors }, null, 2)); } throw error;
 } finally { await browser.close(); }
});

test('account schema and data creation complete while every draft mutation is stalled', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids: string[] = [], errors: string[] = []; let stalled = 0;
 const username = `schemaqa-${randomUUID().slice(0, 8)}`;
 try {
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } }); assert.equal(registration.status(), 200);
  await context.route('**/api/v1/drafts*', route => { if (route.request().method() === 'POST') { stalled++; return new Promise(() => {}); } return route.continue(); });
  page.on('pageerror', (error: Error) => errors.push(error.message));
  await page.goto(new URL('/schemas', base).href); await ready(page); await author(page, 'Account draft-independent schema');
  await openCreated(page, 'Account draft-independent schema');
  const schemaId = decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!); ids.push(schemaId);
  await page.getByPlaceholder('Your note', { exact: true }).fill('Created without draft completion');
  await page.getByRole('button', { name: 'Create thing', exact: true }).click(); await page.getByRole('link', { name: 'Open thing', exact: true }).waitFor();
  const dataId = (await page.getByRole('link', { name: 'Open thing', exact: true }).getAttribute('href')).split('/').pop(); ids.push(dataId);
  assert.ok(stalled > 0, 'The test must exercise a genuinely pending draft write');
  for (const id of ids) {
   await page.waitForFunction(async id => { const response = await fetch(`/api/v1/things?id=${encodeURIComponent(id)}`); const value = await response.json(); return response.ok && value.ok && !!value.thing; }, id);
   const result = await context.request.get(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href); const content = (await result.json()).thing;
   assert.equal(content.author.username, username); if (id === dataId) assert.equal(content.crystal.schemaId, schemaId);
  }
  await page.reload(); await page.getByRole('link', { name: 'Open thing', exact: true }).waitFor(); assert.equal(await page.getByPlaceholder('Your note').inputValue(), '');
  assert.deepEqual(errors, []);
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'account-draft-independent.png'), fullPage: true }); await writeFile(resolve(artifacts, 'account-verification.json'), JSON.stringify({ stalledDraftRequests: stalled, schemaAndDataCreated: true, nativeReload: true, dependencySync: true, errors }, null, 2)); }
 } finally {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  for (const id of ids.reverse()) await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers });
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await browser.close();
 }
});

test('malformed device recovery stays intact and cannot crash or block schema creation', { skip: !enabled, timeout: 60_000 }, async () => {
 const browser = await launch(), context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(15_000);
 try {
  await page.goto(new URL('/schemas', base).href); await ready(page); await context.setOffline(true); await author(page, 'Recovery preservation fixture');
  await page.getByRole('status').filter({ hasText: 'Saved to your drafts' }).waitFor();
  const saved = await page.evaluate(() => {
   const key = Object.keys(localStorage).find(key => key.startsWith('tt-account-draft:') && key.includes(':schema-builder:new:workspace:') && !key.includes(':retired:'))!;
   const value = JSON.parse(localStorage.getItem(key)!);
   const malformed = { name: 'Unrecoverable field tree', description: '', fields: [{ id: 'broken', children: null }] };
   value.content.snapshot = JSON.stringify(malformed); if (value.pending) value.pending.content.snapshot = value.content.snapshot;
   const raw = JSON.stringify(value); localStorage.setItem(key, raw); return { key, raw };
  });
  await page.reload(); await page.getByRole('button', { name: 'Create a Schema', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'The saved draft could not be restored and has been kept.' }).waitFor();
  await page.getByPlaceholder('Schema name — e.g. Table').fill('Created with recovery paused');
  await page.getByRole('textbox', { name: 'Field name', exact: true }).fill('note');
  await openCreated(page, 'Created with recovery paused');
  assert.equal(await page.evaluate(key => localStorage.getItem(key), saved.key), saved.raw);
 } finally { await browser.close(); }
});
