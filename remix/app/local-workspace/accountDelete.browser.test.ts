import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_ACCOUNT_DELETE_URL, artifacts = process.env.TT_LOCAL_ACCOUNT_DELETE_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test('account deletion and site reset persist offline, drain folders and resolve real server conflicts', { skip: !base || !playwrightPath, timeout: 150_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Disposable local fixture only');
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids: string[] = [], errors: string[] = [], mutations: any[] = [], bounds: unknown[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (['POST','PATCH','DELETE','PUT'].includes(request.method())) mutations.push({ path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON(), actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] }); });
 const server = (id: string) => context.request.get(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href);
 const until = async (check: () => Promise<boolean>) => { for (let n = 0; n < 120; n++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail('Expected server state did not converge'); };
 const create = async (kind: string, crystal: unknown, extra = {}) => {
  const response = await context.request.post(new URL('/api/v1/things', base).href, { headers, data: { thingtime: [kind], crystal, visibility: 'private', ...extra } }); assert.equal(response.status(), 200); const row = (await response.json()).thing; ids.push(row.id); return row;
 };
 const remove = async (name: string) => {
  const checkbox = page.getByRole('checkbox', { name: `Select ${name}`, exact: true }); await page.locator('label').filter({ has: checkbox }).click();
  await page.getByRole('button', { name: '🗑️ Delete', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Delete', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('link', { name, exact: true }).waitFor({ state: 'hidden' });
 };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = `deleteqa-${randomUUID().slice(0,8)}`;
  const registered = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } }); assert.equal(registered.status(), 200);
  const owner = (await registered.json()).user.id;
  const folder = await create('folder', { name: 'Offline delete folder' });
  const child = await create('data', { name: 'Child survives deletion' }, { folderId: folder.id });
  const conflict = await create('data', { name: 'Delete conflict fixture' });
  const global = await create('webpage', { name: 'Account global reset', pageKey: 'site-global', blocks: [{ id: 'banner', type: 'text', text: 'Reset me entirely offline' }] });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/builder?page=__global__', base).href); assert.equal((await (await root).json()).user.id, owner);
  await page.getByText('Reset me entirely offline', { exact: true }).first().waitFor();
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await page.goto(new URL(`/things?folder=${folder.id}`, base).href); await page.getByRole('link', { name: 'Child survives deletion', exact: true }).waitFor();
  await page.goto(new URL('/things', base).href); await page.getByRole('link', { name: 'Delete conflict fixture', exact: true }).waitFor();
  await context.setOffline(true); const before = mutations.length;
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await remove('Offline delete folder'); await page.getByRole('link', { name: 'Child survives deletion', exact: true }).waitFor();
  await remove('Delete conflict fixture');
  await page.goto(new URL('/builder?page=__global__', base).href); await page.getByRole('button', { name: 'reset to default page', exact: true }).click();
  await page.getByText('Reset me entirely offline', { exact: true }).waitFor({ state: 'hidden' });
  await page.goto(new URL('/things', base).href); await page.reload(); await page.getByRole('link', { name: 'Child survives deletion', exact: true }).waitFor();
  assert.equal(await page.getByRole('link', { name: 'Offline delete folder', exact: true }).count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Delete conflict fixture', exact: true }).count(), 0);
  assert.deepEqual(mutations.slice(before), []);
  assert.equal((await server(folder.id)).status(), 200); assert.equal((await server(global.id)).status(), 200);
  const edit = await context.request.patch(new URL('/api/v1/things', base).href, { headers, data: { id: conflict.id, crystal: { name: 'Changed account version' }, expectedUpdatedAt: conflict.updatedAt } }); assert.equal(edit.status(), 200);
  await context.setOffline(false); await page.goto(new URL('/things', base).href);
  await page.getByText('Review sync', { exact: true }).click();
  await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
  await page.getByText('Review this deletion', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(size.width, size.scrollWidth); bounds.push(size); if (artifacts) await page.screenshot({ path: resolve(artifacts, `delete-conflict-${width}.png`), fullPage: true }); }
  await page.getByRole('button', { name: 'Keep account version', exact: true }).click();
  await page.getByRole('link', { name: 'Changed account version', exact: true }).waitFor();
  await until(async () => (await server(folder.id)).status() === 404 && (await server(global.id)).status() === 404);
  assert.equal((await (await server(child.id)).json()).thing.folderId, null);
  // A second conflict exercises the explicit reviewed delete, never a blind retry.
  await context.setOffline(true); await remove('Changed account version');
  const current = (await (await server(conflict.id)).json()).thing;
  const secondEdit = await context.request.patch(new URL('/api/v1/things', base).href, { headers, data: { id: conflict.id, crystal: { name: 'Newer account version' }, expectedUpdatedAt: current.updatedAt } }); assert.equal(secondEdit.status(), 200);
  await context.setOffline(false); await page.goto(new URL('/things', base).href);
  await page.getByText('Review sync', { exact: true }).click(); await page.getByRole('button', { name: 'Compare versions', exact: true }).click();
  await page.getByRole('button', { name: 'Delete reviewed account version', exact: true }).click();
  await until(async () => (await server(conflict.id)).status() === 404);
  await page.reload(); await page.getByRole('link', { name: 'Child survives deletion', exact: true }).waitFor(); assert.equal(await page.getByRole('link', { name: 'Newer account version', exact: true }).count(), 0);
  const deletes = mutations.filter(row => row.method === 'DELETE' && row.path === '/api/v1/things'); assert.ok(deletes.length >= 3);
  for (const row of deletes) { assert.equal(row.actor, owner); assert.equal(row.plane, 'home'); assert.ok(row.body.expectedUpdatedAt); }
  assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ offlineDeleteAndReset: true, folderChildrenPreserved: true, zeroOfflineMutations: true, serverReadback: true, conflictKeepAccount: true, conflictReviewedDelete: true, conditionalDeletes: deletes.length, bounds, errors }, null, 2));
 } catch (error) { if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), mutations, errors }, null, 2)); } throw error;
 } finally {
  await context.setOffline(false);
  for (const id of ids.reverse()) await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers });
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await browser.close();
 }
});
