import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import { serializeTransfer, validateTransfer } from '../utils/thingTransfer/format';
const base = process.env.TT_LOCAL_ACCOUNT_IMPORT_URL, artifacts = process.env.TT_LOCAL_ACCOUNT_IMPORT_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
test('normal account import creates editable native content offline and syncs remapped private copies after reconnect', { skip: !base || !playwrightPath, timeout: 150_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname), 'Disposable local account fixture only');
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage(); page.setDefaultTimeout(15_000);
 const headers = { Origin: new URL(base!).origin }, ids = new Set<string>(), errors: string[] = [], mutations: any[] = [], bounds: unknown[] = [];
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (['POST','PATCH','DELETE','PUT'].includes(request.method())) { const row = { path: new URL(request.url()).pathname, method: request.method(), body: request.postDataJSON(), actor: request.headers()['x-thingtime-expected-actor'], plane: request.headers()['x-thingtime-expected-data-plane'] }; mutations.push(row); if (row.path === '/api/v1/things' && row.body?.shareId) ids.add(row.body.shareId); } });
 const read = async (id: string) => { const response = await context.request.get(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href); return response.status() === 200 ? (await response.json()).thing : null; };
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = `importqa-${randomUUID().slice(0,8)}`;
  const response = await context.request.post(new URL('/api/v1/auth/register', base).href, { headers, data: { username, email: `${username}@example.test`, password: randomUUID() + randomUUID() } }); assert.equal(response.status(), 200);
  const owner = (await response.json()).user.id;
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user.id, owner);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await context.setOffline(true); const before = mutations.length;
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  const manifest = { format: 'thingtime.transfer', version: 1, roots: ['folder'], files: [], things: [
   { id: 'page', thingtime: ['webpage'], folderId: 'folder', crystal: { name: 'Offline imported page', pageKey: 'site-global', siteRoute: '/ode', blocks: [{ id: 'card', type: 'component', component: 'card' }] } },
   { id: 'data', thingtime: ['data'], folderId: 'folder', crystal: { name: 'Imported schema record', schemaId: 'schema', note: 'Imported while fully offline' } },
   { id: 'card', thingtime: ['component'], folderId: 'folder', crystal: { name: 'Imported native card', componentKey: 'offline-import-card', version: 1, render: { tag: 'article', props: { style: { padding: '24px', maxWidth: '400px', margin: '24px auto', background: '#fff4dc', borderRadius: '20px', textAlign: 'center' } }, children: 'Native account import' } } },
   { id: 'schema', thingtime: ['schema'], folderId: 'folder', crystal: { name: 'Offline import shape', fields: [{ name: 'note', type: 'string' }] } },
   { id: 'folder', thingtime: ['folder'], crystal: { name: 'Offline imported bundle' } }
  ] };
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify(manifest));
  await page.getByRole('button', { name: 'Read pasted content', exact: true }).click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Offline imported bundle', exact: true }).click();
  const pageLink = page.getByRole('link', { name: 'Offline imported page', exact: true }); await pageLink.waitFor();
  const pagePath = await pageLink.getAttribute('href'), pageId = new URL(pagePath!, base).pathname.split('/').at(-1)!;
  const folderId = new URL(page.url()).searchParams.get('folder')!; ids.add(folderId); ids.add(pageId);
  await pageLink.click(); await page.getByText('Native account import', { exact: true }).waitFor();
  await page.reload(); await page.getByText('Native account import', { exact: true }).waitFor();
  await page.goto(new URL(`/builder?page=${encodeURIComponent(pageId)}&mode=edit`, base).href);
  await page.getByText('Native account import', { exact: true }).waitFor();
  await page.getByRole('textbox').fill('Edited imported page before sync');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.goto(new URL(`/p/${pageId}`, base).href); await page.getByText('Native account import', { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(size.width, size.scrollWidth); bounds.push(size); if (artifacts) await page.screenshot({ path: resolve(artifacts, `import-preview-${width}.png`), fullPage: false }); }
  assert.deepEqual(mutations.slice(before), []); assert.equal(await read(pageId), null);
  await context.setOffline(false); await page.goto(new URL('/things', base).href);
  let remotePage: any;
  for (let n = 0; n < 120; n++) { remotePage = await read(pageId); if (remotePage?.crystal.name === 'Edited imported page before sync' && ids.size === 5 && (await Promise.all([...ids].map(read))).every(Boolean)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.equal(remotePage?.crystal.name, 'Edited imported page before sync'); assert.equal(ids.size, 5);
  const rows = [];
  for (const id of ids) { const row = await read(id); assert.ok(row); assert.equal(row.author.id, owner); assert.equal(row.visibility, 'private'); rows.push(row); }
  const card = rows.find(row => row.thingtime.includes('component')), schema = rows.find(row => row.thingtime.includes('schema')), data = rows.find(row => row.thingtime.includes('data'));
  assert.equal(remotePage.crystal.blocks[0].component, card.id); assert.equal(remotePage.folderId, folderId); assert.equal(remotePage.crystal.siteRoute, undefined); assert.notEqual(remotePage.crystal.pageKey, 'site-global');
  assert.equal(data.crystal.schemaId, schema.id); assert.equal(data.crystal.schema, schema.crystal.name); assert.notEqual(schema.crystal.name, 'Offline import shape');
  assert.equal(mutations.some(row => row.path === '/api/v1/things/import'), false);
  for (const row of mutations.filter(row => row.path === '/api/v1/things')) { assert.equal(row.actor, owner); assert.equal(row.plane, 'home'); }
  const exported = await context.request.post(new URL('/api/v1/things/export', base).href, { headers, data: { ids: [folderId], includeChildren: true, includeDependencies: true, includeFiles: false } }); assert.equal(exported.status(), 200);
  const plan = (await exported.json()).plan;
  const portable = validateTransfer({ format: 'thingtime.transfer', version: 1, roots: plan.roots, things: plan.things, files: plan.files });
  const json = serializeTransfer(portable); assert.equal(portable.things.length, 5); assert.doesNotMatch(json, /"author"|"visibility"|"revision"|"updatedAt"/);
  const copied = await context.request.post(new URL('/api/v1/things/import', base).href, { headers, data: { manifest: portable, files: {} } }); assert.equal(copied.status(), 200);
  const imported = await copied.json(); assert.equal(imported.imported, 5);
  for (const id of Object.values(imported.ids) as string[]) ids.add(id);
  const copiedPage = await read(imported.ids[pageId]), copiedSchema = await read(imported.ids[schema.id]), copiedData = await read(imported.ids[data.id]);
  assert.notEqual(copiedPage.id, pageId); assert.equal(copiedPage.crystal.blocks[0].component, imported.ids[card.id]);
  assert.equal(copiedData.crystal.schemaId, copiedSchema.id); assert.equal(copiedData.crystal.schema, copiedSchema.crystal.name);
  assert.deepEqual(errors, []);
  if (artifacts) { await writeFile(resolve(artifacts, 'exported.thingtime.json'), json); await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ offlineImport: true, nativePreview: true, offlineEdit: true, coldReload: true, zeroOfflineMutations: true, privateServerSync: true, remappedDependencies: true, noSitePlacement: true, canonicalExport: true, normalServerImportRoundTrip: true, bounds, errors }, null, 2)); }
 } catch (error) { if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), errors, mutations }, null, 2)); } throw error;
 } finally {
  await context.setOffline(false);
  // Delete only this fixture's newly allocated rows. Removing children before
  // the folder avoids a cleanup move affecting their retained timestamps.
  const ordered = [...ids]; for (const id of ordered.reverse()) await context.request.delete(new URL(`/api/v1/things?id=${encodeURIComponent(id)}`, base).href, { headers });
  await context.request.post(new URL('/api/v1/auth/logout', base).href, { headers }); await browser.close();
 }
});
