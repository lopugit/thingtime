import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_ACCOUNT_PROVIDERS_URL;
const artifacts = process.env.TT_ACCOUNT_PROVIDERS_ARTIFACTS;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const phrase = 'Disposable provider identity passphrase';
const secret = ' synthetic provider identity race value ';

test('native account switches retire provider proof responses and pending selected-value encryption', {
 skip: !base || !artifacts || !playwrightPath, timeout: 180_000
}, async () => {
 const origin = new URL(base!).origin;
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true });
 const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
 const control = await context.newPage(), page = await context.newPage();
 await control.setViewportSize({ width: 1440, height: 1000 });
 const errors: string[] = [], evidence: string[] = [];
 const users: { id: string; username: string; password: string }[] = [];
 const headers = { Origin: origin, 'X-Thingtime-Expected-Data-Plane': 'home' };
 const url = (path: string) => new URL(path, origin).href;
 let id = '', release = () => {}, heldResponse: Promise<void> | undefined;
 for (const tab of [control, page]) { tab.setDefaultTimeout(20_000); tab.on('pageerror', (error: Error) => errors.push(error.message)); }
 const post = (data: unknown) => context.request.post(url('/api/v1/lopu/vault'), { headers, data });
 const switchTo = async (user: typeof users[number]) => {
  const disclosure = control.locator('details').filter({ has: control.getByText('Your signed-in accounts, storage, and session.', { exact: true }) });
  if (!await disclosure.evaluate((element: HTMLDetailsElement) => element.open)) await disclosure.locator('summary').click();
  await control.getByRole('button', { name: new RegExp('^Switch to .*' + user.username) }).click();
  for (const tab of [control, page]) {
   if (tab.url() === 'about:blank') continue;
   await tab.waitForFunction((id: string) => {
    try { return JSON.parse(localStorage.getItem('thingtime:local-workspace-root:v1') || 'null')?.[3] === id; } catch { return false; }
   }, user.id);
  }
 };
 const unlock = async () => {
  await page.getByRole('button', { name: 'Unlock device vault', exact: true }).waitFor();
  await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase);
  await page.getByRole('button', { name: 'Unlock device vault', exact: true }).click();
  await page.getByText('Identity selected value', { exact: true }).waitFor();
 };
 const verify = async () => {
  await page.getByRole('button', { name: 'Show Identity selected value', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill(users[0].password);
  await page.getByRole('button', { name: 'Verify and show', exact: true }).click();
 };
 const rows = () => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
  try { return await new Promise<any[]>((resolve, reject) => { const req = db.transaction('records').objectStore('records').getAll(); req.onsuccess = () => resolve(req.result.filter((r: any) => r.collection.startsWith('provider-vault'))); req.onerror = () => reject(req.error); }); }
  finally { db.close(); }
 });
 try {
  await mkdir(artifacts!, { recursive: true });
  for (let index = 0; index < 2; index++) {
   const username = 'provider-race-' + randomUUID().slice(0, 8), password = randomUUID() + randomUUID();
   const response = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, password, email: username + '@example.test' } });
   assert.equal(response.status(), 200); users.push({ id: (await response.json()).user.id, username, password });
   if (!index) { const created = await post({ action: 'save-secret', name: 'Identity selected value', key: 'IDENTITY_FIXTURE', value: secret, groupId: null }); assert.equal(created.status(), 200); id = (await created.json()).entry.id; }
  }
  await control.goto(url('/settings/account'));
  await switchTo(users[0]);
  await page.goto(url('/settings/security#secure-vault'));
  await page.getByRole('button', { name: 'Create device vault', exact: true }).waitFor();
  await page.getByLabel('Device vault passphrase', { exact: true }).fill(phrase);
  await page.getByLabel('Confirm device vault passphrase', { exact: true }).fill(phrase);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).click();
  await page.getByText('Identity selected value', { exact: true }).waitFor();
  const initial = await rows(); assert.equal(initial.some(row => row.collection === 'provider-vault-commands'), false);
  let started = () => {}; const ready = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/vault/reveal', async (route: any) => {
   heldResponse = (async () => {
    const response = await route.fetch(); assert.equal(response.status(), 200);
    started(); await gate;
    // Fulfil the real response even after cancellation; the caller must discard it.
    await route.fulfill({ response }).catch(() => {});
   })(); await heldResponse;
  });
  await verify(); await ready;
  await switchTo(users[1]); release(); await heldResponse;
  await page.getByRole('button', { name: 'Create device vault', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Identity selected value credential', { exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Keep this value offline', exact: true }).count(), 0);
  assert.deepEqual(await rows(), initial);
  evidence.push('real successful proof response delayed across native cross-tab account switch: no display or retention');
  await page.unroute('**/api/v1/vault/reveal');
  await switchTo(users[0]); await unlock(); await verify();
  await page.getByLabel('Identity selected value credential', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Identity selected value credential', { exact: true }).inputValue(), secret);
  await switchTo(users[1]);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Identity selected value credential', { exact: true }).count(), 0);
  assert.deepEqual(await rows(), initial);
  evidence.push('already displayed value and retention consent clear on native account switch');
  await switchTo(users[0]); await unlock(); await verify();
  await page.getByLabel('Identity selected value credential', { exact: true }).waitFor();
  await page.evaluate(() => {
   const original = crypto.subtle.encrypt;
   (window as any).__heldProviderEncryption = { started: false, release: null };
   crypto.subtle.encrypt = async function(...args: Parameters<SubtleCrypto['encrypt']>) {
    crypto.subtle.encrypt = original;
    const result = await original.apply(this, args);
    (window as any).__heldProviderEncryption.started = true;
    await new Promise<void>(resolve => { (window as any).__heldProviderEncryption.release = resolve; });
    return result;
   };
  });
  await page.getByRole('button', { name: 'Keep this value offline', exact: true }).click();
  await page.waitForFunction(() => (window as any).__heldProviderEncryption.started);
  await switchTo(users[1]);
  await page.getByRole('button', { name: 'Create device vault', exact: true }).waitFor();
  await page.evaluate(() => (window as any).__heldProviderEncryption.release());
  await page.evaluate(() => new Promise(requestAnimationFrame));
  assert.deepEqual(await rows(), initial);
  evidence.push('actual encryption completion delayed across account switch: atomic local retention cancelled');
  await switchTo(users[0]); await unlock();
  await page.getByRole('button', { name: 'Show Identity selected value', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Identity selected value credential', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const persisted = JSON.stringify(await rows()) + await page.evaluate(() => JSON.stringify(Object.entries(localStorage)));
  assert.equal(persisted.includes(secret), false); assert.equal(persisted.includes(phrase), false); assert.deepEqual(errors, []);
  await writeFile(resolve(artifacts!, 'verification.json'), JSON.stringify({ evidence, encryptedRowsUnchanged: true, noCrossAccountRetention: true, errors }, null, 2));
 } catch (error) {
  await page.screenshot({ path: resolve(artifacts!, 'failure.png'), fullPage: true }).catch(() => {});
  await control.screenshot({ path: resolve(artifacts!, 'control-failure.png') }).catch(() => {});
  await writeFile(resolve(artifacts!, 'control-failure.json'), JSON.stringify({ body: await control.locator('body').innerText() }, null, 2));
  await writeFile(resolve(artifacts!, 'failure.json'), JSON.stringify({ message: (error as Error).message, evidence, errors }, null, 2)); throw error;
 } finally {
  release(); await heldResponse?.catch(() => {});
  try {
   if (id && users[0]) {
    const login = await context.request.post(url('/api/v1/login'), { headers, data: { username: users[0].username, password: users[0].password } }); assert.equal(login.status(), 200);
    const removed = await post({ action: 'delete', id }); assert.equal(removed.status(), 200);
    const remaining = await post({ action: 'sync-metadata', expectedOwnerId: users[0].id }); assert.equal(remaining.status(), 200); assert.deepEqual((await remaining.json()).entries, []);
    await writeFile(resolve(artifacts!, 'cleanup.json'), JSON.stringify({ fixtureOnly: true, entriesCleaned: true }));
   }
  } finally { await context.close(); await browser.close(); }
 }
});
