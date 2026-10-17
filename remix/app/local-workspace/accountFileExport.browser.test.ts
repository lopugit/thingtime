import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { decodeTransferArchive } from '../utils/thingTransfer/archive';
import { serializeTransfer } from '../utils/thingTransfer/format';

const base = process.env.TT_LOCAL_FILE_EXPORT_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_FILE_EXPORT_ARTIFACTS;
test('account files download as a canonical ZIP offline and import through the anonymous native dialog', { skip: !base || !playwrightPath, timeout: 150_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!), browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const account = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true }), guest = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
 const page = await account.newPage(), anonymous = await guest.newPage(), errors: string[] = [], mutations: string[] = [];
 const url = (path: string) => new URL(path, base).href;
 let offline = false;
 for (const surface of [page, anonymous]) { surface.setDefaultTimeout(20_000); surface.on('pageerror', (e: Error) => errors.push(e.message)); surface.on('request', (request: any) => { if (offline && !['GET','HEAD','OPTIONS'].includes(request.method())) mutations.push(new URL(request.url()).pathname); }); }
 const ready = async (surface: any) => surface.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const username = 'file-export-' + randomUUID().slice(0,8);
  const response = await account.request.post(url('/api/v1/auth/register'), { headers: { Origin: new URL(base!).origin }, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
  assert.equal(response.status(), 200, await response.text());
  await page.goto(url('/things?files=thingtime')); await anonymous.goto(url('/things'));
  const files = page.getByTestId('filesystem-browser'); await files.getByRole('button', { name: 'Add files', exact: true }).waitFor();
  await Promise.all([ready(page), ready(anonymous)]);
  const bytes = Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 168; const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#f4cfad'; ctx.fillRect(0,0,120,168); ctx.fillStyle = '#984b39'; ctx.font = '16px serif'; ctx.fillText('Portable file', 12,80); return canvas.toDataURL('image/png').split(',')[1]; }), 'base64');
  offline = true; await account.setOffline(true); await guest.setOffline(true);
  await files.getByRole('button', { name: 'New folder', exact: true }).click();
  await files.getByRole('textbox', { name: 'New folder name' }).fill('Portable offline folder');
  await files.getByRole('button', { name: 'Create', exact: true }).click();
  await files.getByText('Portable offline folder', { exact: true }).first().dblclick();
  await page.waitForURL('**/things?files=thingtime&folder=*');
  await files.locator('input[type=file]').setInputFiles({ name: 'portable-native.png', mimeType: 'image/png', buffer: bytes });
  await files.getByText('portable-native.png', { exact: true }).first().waitFor();
  await page.goto(url('/things')); await page.reload();
  const folder = page.getByRole('link', { name: 'Portable offline folder', exact: true }); await folder.waitFor();
  await folder.click({ button: 'right' }); await page.getByRole('menuitem', { name: '📥 Download…', exact: true }).click();
  for (const width of [1440,390,320]) { await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(() => document.fonts.ready); const box = await page.getByRole('dialog').evaluate((node: HTMLElement) => ({ width: node.getBoundingClientRect().width, client: node.clientWidth, scroll: node.scrollWidth })); assert.ok(box.width <= width); assert.equal(box.client, box.scroll); if (artifacts) await page.screenshot({ path: resolve(artifacts, `file-export-dialog-${width}.png`) }); }
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  const download = await downloading, zip = await readFile((await download.path())!), bundle = await decodeTransferArchive(zip);
  assert.equal(bundle.manifest.things.length, 2); assert.equal(bundle.manifest.files.length, 1);
  assert.deepEqual(Buffer.from(bundle.files.get(bundle.manifest.files[0].id)!), bytes);
  assert.doesNotMatch(serializeTransfer(bundle.manifest), /"author"|"acl"|"requestId"|"localAttachment"|"accountFileId"/);
  await anonymous.reload(); await anonymous.getByRole('button', { name: 'Import…', exact: true }).click();
  await anonymous.getByLabel('Thingtime transfer files', { exact: true }).setInputFiles({ name: 'portable.thingtime.zip', mimeType: 'application/zip', buffer: zip });
  await anonymous.getByText('2 Things · 1 files', { exact: false }).waitFor();
  await anonymous.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await anonymous.getByRole('link', { name: 'Portable offline folder', exact: true }).click();
  const imported = anonymous.getByRole('link', { name: 'portable-native.png', exact: true }); await imported.waitFor();
  const href = await imported.getAttribute('href'); assert.ok(href); assert.ok(!href!.includes(bundle.manifest.files[0].targetId));
  await imported.click(); await anonymous.waitForURL(value => value.pathname !== '/things'); await anonymous.reload();
  const image = anonymous.locator('img[src^="blob:"]').first(); await anonymous.getByRole('link', { name: 'Download', exact: true }).scrollIntoViewIfNeeded(); await image.waitFor(); await image.evaluate((img: HTMLImageElement) => img.decode());
  assert.equal(await image.evaluate((img: HTMLImageElement) => img.naturalWidth), 120);
  const original = anonymous.waitForEvent('download'); await anonymous.getByRole('link', { name: 'Download', exact: true }).click();
  assert.deepEqual(await readFile((await (await original).path())!), bytes);
  for (const width of [1440,390,320]) { await anonymous.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await image.scrollIntoViewIfNeeded(); assert.equal(await anonymous.evaluate(() => document.documentElement.scrollWidth), width); if (artifacts) await anonymous.screenshot({ path: resolve(artifacts, `imported-file-${width}.png`) }); }
  assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
  if (artifacts) { await writeFile(resolve(artifacts, 'exported.thingtime.zip'), zip); await writeFile(resolve(artifacts, 'exported.thingtime.json'), serializeTransfer(bundle.manifest)); await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ coldAccountReload: true, normalOfflineDownloadDialog: true, exactBytes: true, normalAnonymousImport: true, remappedIds: true, coldAnonymousReload: true, nativePreview: [120,168], viewports: [1440,390,320], mutations, errors }, null, 2)); }
 } catch (error) { if (artifacts) for (const [name,surface] of [['account',page],['anonymous',anonymous]] as const) { await surface.screenshot({ path: resolve(artifacts, name+'-failure.png') }).catch(() => {}); await writeFile(resolve(artifacts, name+'-failure.txt'), await surface.locator('body').innerText().catch(() => '')); } throw error;
 } finally { await browser.close(); }
});
