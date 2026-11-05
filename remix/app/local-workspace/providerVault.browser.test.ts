import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const base = process.env.TT_LOCAL_PROVIDER_VAULT_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH, artifacts = process.env.TT_LOCAL_PROVIDER_VAULT_ARTIFACTS;
const phrase = 'Disposable provider vault phrase 🦄', secret = ' synthetic private environment value 🦄 ', token = 'synthetic-private-provider-token', name = 'Offline environment secret';

test('anonymous Settings vault creates and retains encrypted environments and providers offline without account requests', { skip: !base || !playwrightPath || !artifacts, timeout: 180_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const writes: string[] = [], protectedRequests: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { const path = new URL(request.url()).pathname; if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push(path); if (/\/api\/v1\/(lopu\/vault|vault\/reveal|passwords)/.test(path)) protectedRequests.push(path); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 const unlock = async (password = phrase) => { await page.getByLabel('Device vault passphrase', { exact: true }).fill(password); await page.getByRole('button', { name: 'Unlock device vault', exact: true }).click(); };
 const secretRow = () => page.getByText(name, { exact: true }).locator('..').locator('..');
 const inspect = () => page.evaluate(async (needles: string[]) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try {
   const records: any[] = await new Promise((resolve, reject) => { const req = db.transaction('records').objectStore('records').getAll(); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
   const raw = JSON.stringify(records) + records.filter(row => row.value instanceof Uint8Array).map(row => new TextDecoder().decode(row.value)).join('\n') + JSON.stringify(Object.entries(localStorage));
   return { plaintextFound: needles.some(value => raw.includes(value)), accountRecords: records.filter(row => JSON.parse(row.scope)[0] === 'account').length, commands: records.filter(row => row.collection === 'provider-vault-commands').length, entries: records.filter(row => row.collection === 'provider-vault-records' && !row.value.deleted).length };
  } finally { db.close(); }
 }, [phrase, secret, token, name]);
 try {
  await mkdir(artifacts!, { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data').then(async (response: any) => { assert.equal(response.status(), 200); return response.json(); });
  const [, initial] = await Promise.all([page.goto(new URL('/settings/security#secure-vault', base).href), root]); assert.equal(initial.user, null);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase); await page.getByLabel('Confirm device vault passphrase', { exact: true }).fill(phrase);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).click();
  await page.getByLabel('New vault environment').fill('Offline personal'); await page.getByRole('button', { name: 'Add environment', exact: true }).click();
  await page.getByRole('button', { name: 'Delete Offline personal', exact: true }).waitFor();
  await page.getByLabel('Secret display name').fill(name); await page.getByLabel('Secret key', { exact: true }).fill('OFFLINE_TOKEN'); await page.getByLabel('Secret value', { exact: true }).fill(secret);
  await page.getByLabel('Secret environment', { exact: true }).selectOption({ label: 'Offline personal' }); await page.getByRole('button', { name: 'Save secret', exact: true }).click();
  await page.getByText(name, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Delete Offline personal', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Move or delete' }).waitFor();
  await page.getByLabel('Provider token', { exact: true }).fill(token); await page.getByRole('button', { name: 'Save provider', exact: true }).click();
  await page.getByRole('button', { name: 'Show OpenAI', exact: true }).waitFor();
  assert.deepEqual(await inspect(), { plaintextFound: false, accountRecords: 0, commands: 0, entries: 3 });
  await page.getByRole('button', { name: `Show ${name}`, exact: true }).click(); await page.getByLabel(`${name} credential`).waitFor();
  assert.equal(await page.getByLabel(`${name} credential`).inputValue(), secret);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.getByLabel(`${name} credential`).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: `Show ${name}`, exact: true }).click(); await page.getByLabel(`${name} credential`).waitFor();
  await page.getByLabel(`${name} credential`).waitFor({ state: 'detached', timeout: 35_000 });
  await page.getByRole('button', { name: 'Lock provider vault', exact: true }).click();
  await page.getByRole('button', { name: 'Unlock device vault', exact: true }).waitFor(); assert.equal(await page.getByText(name, { exact: true }).count(), 0);
  await unlock('wrong disposable passphrase'); await page.getByRole('alert').filter({ hasText: 'could not be unlocked' }).waitFor(); await unlock();
  const bounds = [];
  for (const [width, height] of [[1440,1000],[390,844],[320,844]]) {
   await page.setViewportSize({ width, height }); await page.reload(); await page.getByRole('button', { name: 'Unlock device vault', exact: true }).waitFor();
   await unlock(); await page.getByRole('button', { name: `Show ${name}`, exact: true }).waitFor();
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   await page.locator('#secure-vault').screenshot({ path: resolve(artifacts!, `provider-vault-${width}.png`), animations: 'disabled' });
  }
  await page.getByRole('button', { name: `Change environment for ${name}`, exact: true }).click(); await page.getByLabel(`Environment for ${name}`, { exact: true }).selectOption(''); await page.getByRole('button', { name: 'Save environment', exact: true }).click();
  await page.getByRole('button', { name: `Change environment for ${name}`, exact: true }).filter({ hasText: 'Ungrouped' }).waitFor();
  await page.getByRole('button', { name: 'Delete Offline personal', exact: true }).click(); await page.getByRole('button', { name: 'Delete Offline personal', exact: true }).waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Show OpenAI', exact: true }).click(); await page.getByLabel('OpenAI credential').waitFor(); assert.equal(await page.getByLabel('OpenAI credential').inputValue(), token); await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await secretRow().getByRole('button', { name: 'Delete', exact: true }).click(); await page.getByText(name, { exact: true }).waitFor({ state: 'detached' });
  const stored = await inspect(); assert.deepEqual(stored, { plaintextFound: false, accountRecords: 0, commands: 0, entries: 1 });
  assert.deepEqual(writes, []); assert.deepEqual(protectedRequests, []); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ anonymous: true, offline: true, encryptedStorage: true, createMoveDelete: true, wrongPhraseRefused: true, lockAndColdReload: true, selectedRevealAndBlurClear: true, timedRevealClear: true, nonemptyGroupPreserved: true, bounds, stored, writes, protectedRequests, errors }, null, 2));
 } catch (error) {
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ writes, protectedRequests, errors }, null, 2)); await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }); throw error;
 } finally { await browser.close(); }
});
