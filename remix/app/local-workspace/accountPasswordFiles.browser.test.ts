import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';
const fixturePath = process.env.TT_ACCOUNT_PASSWORD_FILES_FIXTURE, base = process.env.TT_ACCOUNT_PASSWORD_FILES_URL;
const artifacts = process.env.TT_ACCOUNT_PASSWORD_FILES_ARTIFACTS, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const phrase = 'Disposable attachment device vault 🦊', title = 'Offline attachment acceptance', secret = 'synthetic attachment credential only';
const bytes = Buffer.from('Synthetic account attachment bytes 🦊\nwith exact whitespace  '), filename = 'synthetic-account-attachment.txt';

test('native account attachments save and round-trip offline, sync independently, and retain into a fresh device', { skip: !fixturePath || !base || !artifacts || !playwrightPath, timeout: 360_000 }, async () => {
 const fixture = JSON.parse(await readFile(fixturePath!, 'utf8'));
 assert.equal(fixture.fixtureKind, 'password-file-sync-qa'); assert.match(fixture.username, /^passwordfiles-[a-f0-9]{8}$/);
 assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const milestones: { step: string; at: string }[] = [];
 const mark = async (step: string) => { milestones.push({ step, at: new Date().toISOString() }); await writeFile(resolve(artifacts!, 'progress.json'), JSON.stringify(milestones, null, 2)); };
 const contexts = [context], errors: string[] = [], bounds: unknown[] = [], offlineWrites: string[] = [];
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin };
 let offline = false, succeeded = false;
 const previous = new Set<string>(), created = new Set<string>();
 await mkdir(artifacts!, { recursive: true });
 const watch = (ctx: any, isOffline: () => boolean) => { ctx.on('page', (p: any) => p.on('pageerror', (error: Error) => errors.push(error.message))); ctx.on('request', (request: any) => { if (isOffline() && !['GET','HEAD','OPTIONS'].includes(request.method())) offlineWrites.push(new URL(request.url()).pathname); }); };
 watch(context, () => offline); page.on('pageerror', (error: Error) => errors.push(error.message));
 const login = async (ctx: any) => { const response = await ctx.request.post(url('/api/v1/login'), { headers, data: { username: fixture.username, password: fixture.password } }); assert.equal(response.status(), 200); };
 const api = async (input: unknown) => { const response = await context.request.post(url('/api/v1/passwords'), { headers, data: { expectedOwnerId: fixture.ownerId, ...input as object } }); assert.equal(response.status(), 200); return response.json(); };
 const entries = async () => { const all: any[] = []; let cursor: string | undefined; do { const result = await api({ operation: 'export', ...(cursor ? { cursor } : {}) }); all.push(...result.entries); cursor = result.nextCursor || undefined; } while (cursor); return all; };
 const unlock = async (p: any) => { await p.getByLabel('Device vault passphrase', { exact: true }).fill(phrase); await p.getByRole('button', { name: 'Unlock device vault', exact: true }).click(); };
 const setup = async (p: any) => { await p.goto(url('/passwords')); await p.getByRole('button', { name: 'Create device vault', exact: true }).waitFor(); await p.getByLabel('Device vault passphrase', { exact: true }).fill(phrase); await p.getByLabel('Confirm device vault passphrase', { exact: true }).fill(phrase); await p.getByRole('button', { name: 'Create device vault', exact: true }).click(); await p.getByRole('button', { name: 'Add password', exact: true }).waitFor(); };
 const shell = (p: any) => p.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
 const open = async (p: any) => p.getByRole('button', { name: `${title} login`, exact: true }).first().click();
 const backup = async (p: any, name: string) => { await p.getByRole('button', { name: 'Export', exact: true }).click(); await p.getByLabel('Export format', { exact: true }).selectOption('1pux'); await p.getByText('I understand the downloaded file contains unencrypted secrets.', { exact: true }).click(); const download = p.waitForEvent('download'); await p.getByRole('button', { name: 'Download export', exact: true }).click(); const path = resolve(artifacts!, name); await (await download).saveAs(path); return path; };
 const verifyBackup = async (path: string) => { const archive = unzipSync(await readFile(path)); assert.ok(Object.values(archive).some(value => Buffer.from(value).equals(bytes))); assert.ok(new TextDecoder().decode(archive['export.data']).includes(secret)); };
 try {
  await login(context); for (const row of await entries()) previous.add(row.id);
  await setup(page); await shell(page); await mark('first device ready'); offline = true; await context.setOffline(true);
  await page.getByRole('button', { name: 'Add password', exact: true }).click(); await page.getByLabel('Title', { exact: true }).fill(title); await page.getByLabel('Password', { exact: true }).fill(secret); await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByLabel('Add password attachment', { exact: true }).setInputFiles({ name: filename, mimeType: 'text/plain', buffer: bytes });
  await page.getByText(`${filename} ·`, { exact: false }).waitFor();
  for (const [width, height] of [[1440,1000],[390,844],[320,844]]) {
   await page.setViewportSize({ width, height }); await page.reload(); await unlock(page); await open(page);
   await page.getByText(`${filename} ·`, { exact: false }).waitFor();
   await page.evaluate(() => window.scrollTo(0, 0));
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   await page.screenshot({ path: resolve(artifacts!, `account-files-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click(); const downloaded = resolve(artifacts!, filename); await (await downloading).saveAs(downloaded); assert.deepEqual(await readFile(downloaded), bytes);
  const exported = await backup(page, 'offline-account-files.1pux'); await verifyBackup(exported); await mark('offline save reload download and export passed');
  await page.getByRole('button', { name: 'Import', exact: true }).click(); await page.getByLabel('Import password file', { exact: true }).setInputFiles(exported);
  await page.getByRole('button', { name: 'Import entries', exact: true }).waitFor(); await page.getByRole('button', { name: 'Import entries', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).nth(1).waitFor();
  assert.deepEqual(offlineWrites, []); await mark('offline import passed');
  offline = false; await context.setOffline(false); await page.getByRole('button', { name: 'Refresh account sync', exact: true }).click();
  await page.getByText('Device vault · no pending account changes', { exact: true }).waitFor({ timeout: 90_000 });
  const synced = await entries(); for (const row of synced) if (!previous.has(row.id)) created.add(row.id);
  const matching = synced.filter(row => row.entry.title === title); assert.equal(matching.length, 2); assert.notEqual(matching[0].id, matching[1].id);
  const files = (await api({ operation: 'file-list', entryIds: matching.map(row => row.id) })).files; assert.equal(files.length, 2); assert.notEqual(files[0].metadata.token, files[1].metadata.token);
  await mark('real entry and attachment sync passed');
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } }); contexts.push(fresh); let freshOffline = false; watch(fresh, () => freshOffline);
  await login(fresh); const second = await fresh.newPage(); let failDownload = true;
  await second.route('**/api/v1/passwords', async (route: any) => {
   const input = route.request().postDataJSON();
   if (failDownload && input?.operation === 'file-download') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'Synthetic unavailable object' }) });
   return route.continue();
  });
  await setup(second); await open(second); await second.getByText(/synthetic-account-attachment\.txt.*Not available offline yet/).waitFor();
  await second.getByRole('button', { name: 'Export', exact: true }).click(); await second.getByText('I understand the downloaded file contains unencrypted secrets.', { exact: true }).click(); await second.getByRole('button', { name: 'Download export', exact: true }).click();
  await second.getByRole('alert').filter({ hasText: 'not available on this device' }).waitFor(); await mark('missing remote bytes visible and export refused');
  await second.getByRole('button', { name: 'Cancel', exact: true }).click(); failDownload = false;
  await second.getByRole('button', { name: 'Refresh account sync', exact: true }).click();
  await second.getByText(/synthetic-account-attachment\.txt.*Not available offline yet/).waitFor({ state: 'hidden' });
  await shell(second); freshOffline = true; await fresh.setOffline(true); await second.reload(); await unlock(second); await open(second);
  const retained = await backup(second, 'fresh-device-offline.1pux'); await verifyBackup(retained); await mark('fresh device cold offline backup passed');
  assert.deepEqual(errors, []); assert.deepEqual(offlineWrites, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ local: true, offlineSave: true, coldReload: true, offlineImportExport: true, independentSync: true, freshDeviceRetention: true, failedDownloadsVisible: true, incompleteBackupRefused: true, duplicateEntriesRemapped: true, bounds, errors, offlineWrites }, null, 2));
  succeeded = true;
 } catch (error) { for (const [index, ctx] of contexts.entries()) for (const p of ctx.pages()) await p.screenshot({ path: resolve(artifacts!, `failure-device-${index}.png`), fullPage: true }).catch(() => {}); await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }).catch(() => {}); await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ name: (error as Error).name, message: (error as Error).message, errors, offlineWrites }, null, 2)); throw error; }
 finally {
  await context.setOffline(false); const pendingCleanup: string[] = [];
  for (const row of await entries().catch(() => [])) if (!previous.has(row.id)) { created.add(row.id); await api({ operation: 'delete', id: row.id, revision: row.revision }).catch(() => { pendingCleanup.push(row.id); }); }
  await writeFile(resolve(artifacts!, 'cleanup.json'), JSON.stringify({ entriesCreated: created.size, pendingCleanup }));
  for (const ctx of contexts) await ctx.close(); await browser.close();
  if (succeeded) assert.deepEqual(pendingCleanup, []);
 }
});
