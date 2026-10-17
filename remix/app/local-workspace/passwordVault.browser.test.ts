import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importPasswordCsv } from '../passwords/transfer';
const base = process.env.TT_LOCAL_PASSWORDS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_PASSWORDS_ARTIFACTS;
const phrase = 'Disposable offline device vault phrase 🦄', secret = ' synthetic offline credential 🦄  ', title = 'Disposable encrypted device login';

test('anonymous native password editor saves encrypted entries offline, locks on reload and round-trips normal exports', { skip: !base || !playwrightPath || !artifacts, timeout: 180_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const writes: string[] = [], passwordRequests: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { const path = new URL(request.url()).pathname; if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(path); if (path === '/api/v1/passwords') passwordRequests.push(path); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 const unlock = async (password = phrase) => { await page.getByLabel('Device vault passphrase', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock device vault', exact: true }).click(); };
 const leaks = () => page.evaluate(async (needles: string[]) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('thingtime.local-workspaces.v1'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  try {
   const records: any[] = await new Promise((resolve, reject) => { const request = db.transaction('records').objectStore('records').getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
   const byteValues = records.filter(row => row.value instanceof Uint8Array).map(row => new TextDecoder().decode(row.value));
   const stored = JSON.stringify(records) + byteValues.join('\n') + JSON.stringify(Object.entries(localStorage));
   return { secretFound: needles.some(value => stored.includes(value)), accountRecords: records.filter(row => JSON.parse(row.scope)[0] === 'account').length, commands: records.filter(row => row.collection === 'password-vault-commands').length, protectedRecords: records.filter(row => row.collection === 'password-vault-records').length };
  } finally { db.close(); }
 }, [phrase, secret, title]);
 try {
  await mkdir(artifacts!, { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data').then(async (response: any) => { assert.equal(response.status(), 200); return response.json(); });
  const [, initial] = await Promise.all([page.goto(new URL('/settings/security', base).href), root]); assert.equal(initial.user, null);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  const link = page.getByRole('link', { name: 'Open device password manager', exact: true });
  await page.locator('details').filter({ has: page.getByRole('link', { name: 'Open device password manager', exact: true, includeHidden: true }) }).locator(':scope > summary').click(); await link.click();
  await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase);
  await page.getByLabel('Confirm device vault passphrase', { exact: true }).fill(phrase);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).click();
  await page.getByRole('button', { name: 'Add password', exact: true }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Username', { exact: true }).fill('offline-fixture');
  await page.getByLabel('Password', { exact: true }).fill(secret);
  await page.getByLabel('Website', { exact: true }).fill('https://example.test');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).waitFor();
  assert.deepEqual(await leaks(), { secretFound: false, accountRecords: 0, commands: 0, protectedRecords: 1 });
  await page.getByRole('button', { name: 'Lock vault', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock device vault', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
  await unlock('wrong disposable passphrase'); await page.getByRole('alert').filter({ hasText: 'could not be unlocked' }).waitFor();
  await unlock(); await page.getByRole('button', { name: `${title} login`, exact: true }).waitFor();
  const bounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height }); await page.reload();
   await page.getByRole('button', { name: 'Unlock device vault', exact: true }).waitFor();
   assert.equal(await page.getByRole('button', { name: `${title} login`, exact: true }).count(), 0);
   await unlock(); await page.getByRole('button', { name: `${title} login`, exact: true }).click();
   assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), secret);
   assert.equal(await page.getByLabel('Password', { exact: true }).getAttribute('type'), 'password');
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   await page.screenshot({ path: resolve(artifacts!, `passwords-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  // Each tab unlocks independently. A competing save must preserve the first
  // tab's unsaved field and report a revision conflict, never silently replace it.
  const second = await context.newPage(); second.on('pageerror', (error: Error) => errors.push(error.message));
  await second.goto(new URL('/passwords', base).href);
  await second.getByLabel('Device vault passphrase', { exact: true }).fill(phrase);
  await second.getByRole('button', { name: 'Unlock device vault', exact: true }).click();
  await second.getByRole('button', { name: `${title} login`, exact: true }).click();
  await second.getByLabel('Username', { exact: true }).fill('other-tab-author');
  await second.getByRole('button', { name: 'Save entry', exact: true }).click();
  await second.waitForFunction(async () => {
   const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
   try { return await new Promise<boolean>((resolve, reject) => { const req = db.transaction('records').objectStore('records').getAll(); req.onsuccess = () => resolve(req.result.some((row: any) => row.collection === 'password-vault-records' && row.value.revision === 2)); req.onerror = () => reject(req.error); }); }
   finally { db.close(); }
  });
  await page.getByLabel('Username', { exact: true }).fill('first-tab-unsaved');
  await page.getByRole('button', { name: 'Save entry', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'This entry changed elsewhere. Reopen it before saving.' }).waitFor();
  assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'first-tab-unsaved');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).click();
  assert.equal(await page.getByLabel('Username', { exact: true }).inputValue(), 'other-tab-author');
  await second.close();
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await page.getByLabel('Export format', { exact: true }).selectOption('chrome');
  await page.getByText('I understand the downloaded file contains unencrypted secrets.', { exact: true }).click();
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download export', exact: true }).click();
  const path = resolve(artifacts!, 'synthetic-passwords.csv'); await (await downloading).saveAs(path);
  const exported = importPasswordCsv(await readFile(path, 'utf8'));
  assert.equal(exported.entries.length, 1); assert.equal(exported.entries[0].fields.find(field => field.id === 'password')?.value, secret);
  await page.getByRole('button', { name: `${title} login`, exact: true }).click();
  await page.getByRole('button', { name: 'Delete entry', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByLabel('Import password file', { exact: true }).setInputFiles(path);
  await page.getByRole('button', { name: 'Import entries', exact: true }).click();
  await page.getByRole('button', { name: `${title} login`, exact: true }).click();
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), secret);
  const stored = await leaks(); assert.equal(stored.secretFound, false); assert.equal(stored.accountRecords, 0); assert.equal(stored.commands, 0);
  assert.deepEqual(writes, []); assert.deepEqual(passwordRequests, []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ anonymous: true, offline: true, encryptedStorage: true, wrongPhraseRefused: true, lockAndColdReload: true, normalExportImport: true, independentTabUnlockAndRevisionConflict: true, bounds, stored, writes, passwordRequests, errors }, null, 2));
 } catch (error) {
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ writes, passwordRequests, errors }, null, 2));
  await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }); throw error;
 } finally { await browser.close(); }
});
