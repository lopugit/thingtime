import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
const base = process.env.TT_LOCAL_ACCOUNT_MOVE_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_ACCOUNT_MOVE_ARTIFACTS;

test('isolated account bulk moves persist offline and sync conditionally after verified reconnect', { skip: !base || !playwrightPath, timeout: 120_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Only a disposable local account fixture is permitted');
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const headers = { Origin: new URL(base!).origin }, created: string[] = [], errors: string[] = [], writes: any[] = [];
 let fixtureOwner = ''; const pointers: unknown[] = [], consoleErrors: string[] = []; page.setDefaultTimeout(10_000);
 page.on('console', (message: any) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
 const pointer = async () => { pointers.push(await page.evaluate(() => localStorage.getItem('thingtime:local-workspace-root:v1'))); };
 page.on('pageerror', (error: Error) => errors.push(error.message));
 await context.addInitScript(() => window.addEventListener('error', event => { const script = event.target as HTMLScriptElement | null; if (script?.tagName === 'SCRIPT' && script.type === 'module') console.warn('Account move module error', script.src); }, true));
 page.on('console', (message: any) => { if (message.text().startsWith('Account move module error')) errors.push(message.text()); });
 page.on('request', (request: any) => { if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push({ path: new URL(request.url()).pathname, method: request.method(), headers: { actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] }, body: request.postDataJSON() }); });
 const read = async (id: string) => {
  const response = await context.request.get(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href); assert.equal(response.status(), 200); return (await response.json()).thing;
 };
 const select = async (name: string) => { const input = page.getByRole('checkbox', { name: `Select ${name}`, exact: true }); await page.locator('label').filter({ has: input }).click(); };
 const move = async (destination: string) => {
  await page.getByRole('button', { name: '📁 Move', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByText(destination, { exact: true }).click();
  await dialog.getByRole('button', { name: 'Move here', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
 };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const name = `moveqa-${randomUUID().slice(0,8)}`;
  const registration = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username: name, email: `${name}@example.test`, password: randomUUID() + randomUUID() } });
  assert.equal(registration.status(), 200); fixtureOwner = (await registration.json()).user.id;
  for (const [kind, title] of [['folder','Move destination'],['data','Move first fixture'],['data','Move second fixture']]) {
   const response = await context.request.post(new URL('/api/v1/things', base).href, { headers, data: { thingtime: [kind], crystal: { name: title }, visibility: 'private' } });
   assert.equal(response.status(), 200); created.push((await response.json()).thing.id);
  }
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user.id, fixtureOwner);
  await page.getByRole('link', { name: 'Move first fixture', exact: true }).waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await pointer();
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  const before = writes.length;
  await select('Move first fixture'); await select('Move second fixture'); await move('Move destination');
  await page.getByRole('link', { name: 'Move first fixture', exact: true }).waitFor({ state: 'hidden' });
  await pointer();
  await page.goto(new URL(`/things?folder=${created[0]}`, base).href);
  await page.getByRole('link', { name: 'Move first fixture', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Move second fixture', exact: true }).waitFor();
  await page.reload(); await page.getByRole('link', { name: 'Move first fixture', exact: true }).waitFor();
  assert.equal(writes.slice(before).filter(item => item.path.startsWith('/api/v1/things')).length, 0, 'offline moves never send Thing mutations');
  for (const id of created.slice(1)) assert.equal((await read(id)).folderId, null, 'API request context proves the server has not moved yet');
  const bounds = [];
  for (const width of [1440,390,320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const value = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(value.width, value.scrollWidth); bounds.push(value);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `account-move-${width}.png`), fullPage: true });
  }
  await context.setOffline(false);
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true }); if (await reconnect.isVisible()) await reconnect.click();
  let synced = false;
  for (let attempt = 0; attempt < 100; attempt++) {
   const rows = await Promise.all(created.slice(1).map(read));
   if (rows.every(row => row.folderId === created[0])) { synced = true; break; }
   await new Promise(resolve => setTimeout(resolve, 200));
  }
  assert.equal(synced, true);
  const patches = writes.filter(item => item.path === '/api/v1/things' && item.method === 'PATCH'); assert.equal(patches.length, 2);
  for (const patch of patches) { assert.equal(patch.headers.actor, fixtureOwner); assert.equal(patch.headers.plane, 'home'); assert.ok(patch.body.expectedUpdatedAt); assert.equal(patch.body.folderId, created[0]); }
  assert.equal(writes.some(item => item.path.endsWith('/things/bulk')), false);
  for (const id of created.slice(1)) { const row = await read(id); assert.equal(row.author.id, fixtureOwner); assert.equal(row.visibility, 'private'); }
  assert.deepEqual(errors, []); assert.equal(consoleErrors.some(error => /React Router caught|WorkspaceError:/.test(error)), false);
  const ancillaryWriteAttempts = writes.filter(item => item.path !== '/api/v1/things').map(item => ({ path: item.path, method: item.method }));
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ isolatedAccount: true, coldOfflineReload: true, offlineServerUnchanged: true, conditionalReconnect: true, patchCount: patches.length, ancillaryWriteAttempts, bounds, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), errors, writes, pointers, consoleErrors, lastPointer: await page.evaluate(() => localStorage.getItem('thingtime:local-workspace-root:v1')) }, null, 2)); }
  throw error;
 } finally {
  try { await context.setOffline(false); for (const id of created.reverse()) { const response = await context.request.delete(new URL('/api/v1/things', base).href, { headers, data: { id } }); assert.equal(response.status(), 200); } await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers, data: {} }); }
  finally { await browser.close(); }
 }
});
