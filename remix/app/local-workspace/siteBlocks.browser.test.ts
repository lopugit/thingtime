import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_SITE_BLOCKS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_SITE_BLOCKS_ARTIFACTS;
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
async function addText(page: any, text: string) {
 await page.getByRole('button', { name: 'Add the first block', exact: true }).click();
 await page.getByRole('button', { name: 'Text', exact: true }).click();
 await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(text);
}
async function save(page: any) {
 const save = page.getByRole('button', { name: /^(Save|Save my version)$/ }); await save.click();
 await page.getByRole('button', { name: 'Save', exact: true }).waitFor();
 await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(button => button.textContent === 'Save' && button.disabled));
}
async function serverGlobal(context: any, text: string) {
 for (let attempt = 0; attempt < 100; attempt++) {
  const response = await context.request.get(new URL('/api/v1/webpages/resolve?global=1', base).href);
  const value = await response.json();
  if (response.ok() && value.page?.crystal?.blocks?.some((block: any) => block.text === text)) return value;
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 assert.fail('The private global page did not synchronize through the normal server resolver');
}
test('anonymous global and site blocks edit, recover, render and refresh across tabs fully offline', { skip: !enabled, timeout: 120_000 }, async () => {
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(), viewer = await context.newPage(); page.setDefaultTimeout(15_000); viewer.setDefaultTimeout(15_000);
 const writes: string[] = [], errors: string[] = [], bounds: unknown[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 for (const tab of [page, viewer]) tab.on('pageerror', (error: Error) => errors.push(error.message));
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/builder', base).href); assert.equal((await (await root).json()).user, null); await ready(page);
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await page.goto(new URL('/builder?page=__global__', base).href); await addText(page, 'Offline global banner');
  await page.getByRole('textbox', { name: 'Page name', exact: true }).fill('My local global blocks');
  await page.reload(); await page.getByText('Offline global banner', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('textbox', { name: 'Page name', exact: true }).inputValue(), 'My local global blocks'); await save(page);
  await page.reload(); await page.getByText('Offline global banner', { exact: true }).first().waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).isDisabled(), true, 'A completed page must not reopen as an unfinished draft');
  await viewer.goto(new URL('/ode', base).href); await viewer.getByText('Offline global banner', { exact: true }).waitFor();
  assert.equal(await viewer.getByText('Ode to Thingtime', { exact: true }).count(), 1);
  await page.getByText('Offline global banner', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Discard this unfinished edit');
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await page.reload(); await page.getByText('Offline global banner', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Discard this unfinished edit', { exact: true }).count(), 0);
  await page.getByText('Offline global banner', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Updated across local tabs'); await save(page);
  await viewer.getByText('Updated across local tabs', { exact: true }).waitFor();
  await page.goto(new URL('/builder', base).href); await page.getByRole('combobox', { name: 'Site page', exact: true }).selectOption('/ode');
  await page.getByRole('link', { name: 'Edit site page', exact: true }).click();
  await page.getByText('Ode to Thingtime', { exact: true }).waitFor(); await addText(page, 'My personal Ode footer');
  await page.reload(); await page.getByText('My personal Ode footer', { exact: true }).first().waitFor(); await save(page);
  await viewer.getByText('My personal Ode footer', { exact: true }).waitFor();
  await viewer.getByText('Ode to Thingtime', { exact: true }).waitFor();
  assert.equal(await viewer.getByText('Ode to Thingtime', { exact: true }).count(), 1, 'Native sections must mount once');
  for (const width of [1440, 390, 320]) {
   await viewer.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const size = await viewer.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(size.width, size.scrollWidth); bounds.push(size);
   if (artifacts) await viewer.screenshot({ path: resolve(artifacts, `native-site-${width}.png`), fullPage: true });
  }
  await viewer.goto(new URL('/search', base).href); await viewer.getByText('Updated across local tabs', { exact: true }).waitFor();
  assert.equal(await viewer.getByText('My personal Ode footer', { exact: true }).count(), 0);
  await viewer.goto(new URL('/ode', base).href); await viewer.getByText('My personal Ode footer', { exact: true }).waitFor();
  await page.getByText('My personal Ode footer', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Unfinished edit before reset');
  await page.getByRole('button', { name: 'reset to default page', exact: true }).click();
  await viewer.getByText('My personal Ode footer', { exact: true }).waitFor({ state: 'hidden' });
  await viewer.getByText('Ode to Thingtime', { exact: true }).waitFor();
  await page.reload(); await page.getByText('Ode to Thingtime', { exact: true }).waitFor();
  assert.equal(await page.getByText('Unfinished edit before reset', { exact: true }).count(), 0);
  assert.equal(await page.getByText('My personal Ode footer', { exact: true }).count(), 0);
  await page.goto(new URL('/builder?page=__global__', base).href); await page.getByRole('button', { name: 'reset to default page', exact: true }).click();
  await viewer.getByText('Updated across local tabs', { exact: true }).waitFor({ state: 'hidden' });
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'anonymous-verification.json'), JSON.stringify({ anonymous: true, offlineProbe: true, globalDraftRecovery: true, siteDraftRecovery: true, nativeComposition: true, crossTabUpdates: true, reset: true, bounds, writes, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'anonymous-failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'anonymous-failure.json'), JSON.stringify({ editor: await page.locator('body').innerText(), viewer: await viewer.locator('body').innerText(), writes, errors }, null, 2)); } throw error;
 } finally { await browser.close(); }
});

test('account site blocks stay local offline, sync after confirmation and never cross into anonymous content', { skip: !enabled, timeout: 120_000 }, async () => {
 const { randomUUID } = await import('node:crypto');
 const browser = await launch(), context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids: string[] = [], username = `siteqa-${randomUUID().slice(0, 8)}`;
 let stalled = 0; const errors: string[] = []; page.on('pageerror', (error: Error) => errors.push(error.message));
 try {
  await page.goto(new URL('/builder?page=__global__', base).href); await ready(page);
  await addText(page, 'Anonymous workspace banner'); await save(page);
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } }); assert.equal(registration.status(), 200);
  const owner = (await registration.json()).user.id;
  await page.goto(new URL('/ode', base).href); await page.getByText('Ode to Thingtime', { exact: true }).waitFor();
  assert.equal(await page.getByText('Anonymous workspace banner', { exact: true }).count(), 0);
  await context.route('**/api/v1/drafts*', route => { if (route.request().method() === 'POST') { stalled++; return new Promise(() => {}); } return route.continue(); });
  await context.setOffline(true); await page.goto(new URL('/builder?page=__global__', base).href);
  await addText(page, 'Private account workspace banner'); await save(page);
  await page.goto(new URL('/ode', base).href); await page.getByText('Private account workspace banner', { exact: true }).waitFor();
  await page.reload(); await page.getByText('Private account workspace banner', { exact: true }).waitFor();
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await context.setOffline(false); await page.goto(new URL('/ode', base).href);
  const value = await serverGlobal(context, 'Private account workspace banner');
  ids.push(value.page.id); assert.equal(value.page.author.id, owner); assert.equal(value.source, 'user');
  assert.ok(!JSON.stringify(value).includes('Anonymous workspace banner'));
  // Edit a saved account page with draft transport permanently stalled.
  await page.goto(new URL('/builder?page=__global__', base).href); await page.getByText('Private account workspace banner', { exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Account update independent of drafts'); await save(page); assert.ok(stalled > 0);
  await serverGlobal(context, 'Account update independent of drafts');
  for (const id of ids) { const removed = await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers }); assert.equal(removed.status(), 200); } ids.length = 0;
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await page.goto(new URL('/ode', base).href);
  await page.getByText('Anonymous workspace banner', { exact: true }).waitFor(); assert.equal(await page.getByText('Account update independent of drafts', { exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'account-verification.json'), JSON.stringify({ offlineLocalCreate: true, confirmedSync: true, isolatedAnonymousContent: true, draftIndependentUpdate: true, stalledDraftRequests: stalled, errors }, null, 2));
 } finally {
  await context.setOffline(false); await context.unrouteAll({ behavior: 'ignoreErrors' });
  // Clean up only this test's private fixture rows through normal APIs.
  for (const id of ids) await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers });
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await browser.close();
 }
});

test('native site and global component sources run in their own local page runtimes', { skip: !enabled, timeout: 90_000 }, async () => {
 const browser = await launch(), context = await browser.newContext(), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const writes: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(request.url()); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 try {
  await page.goto(new URL('/things', base).href); await ready(page); await context.setOffline(true);
  const source = (text: string) => ({ id: 'result', type: 'component', component: 'component', source: { action: 'action', inputs: { text } } });
  const things = [
   { id: 'action', thingtime: ['action'], crystal: { name: 'Local site source', actionKey: 'site-source-test', version: 1, inputs: [{ name: 'text', type: 'string', required: true }], capabilities: [], steps: [{ op: 'return', value: { message: '$input.text' } }] } },
   { id: 'component', thingtime: ['component'], crystal: { name: 'Local site result', componentKey: 'site-result-test', version: 1, render: { tag: 'p', children: ['{result.message}'] } } },
   { id: 'global', thingtime: ['webpage'], crystal: { name: 'Global local source', pageKey: 'site-global', blocks: [source('Global source ran offline')] } },
   { id: 'route', thingtime: ['webpage'], crystal: { name: 'Route local source', pageKey: 'route-ode', siteRoute: '/ode', blocks: [{ id: 'native', type: 'native', native: 'ode-poem' }, source('Route source ran offline')] } }
  ];
  // The normal importer validates the complete dependency bundle and remaps IDs.
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['global', 'route'], things, files: [] }));
  await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Global local source', exact: true }).waitFor();
  await page.goto(new URL('/ode', base).href);
  await page.getByText('Global source ran offline', { exact: true }).waitFor();
  await page.getByText('Route source ran offline', { exact: true }).waitFor();
  await page.getByText('Ode to Thingtime', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('Global source ran offline', { exact: true }).waitFor();
  await page.getByText('Route source ran offline', { exact: true }).waitFor();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
 } catch (error) { if (artifacts) await writeFile(resolve(artifacts, 'source-failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), errors, writes }, null, 2)); throw error; } finally { await browser.close(); }
});
