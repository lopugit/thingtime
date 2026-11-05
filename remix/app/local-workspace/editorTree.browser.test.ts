import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { stringifyThingtimeForStorage } from '../Providers/thingtimeSerialization';

const base = process.env.TT_LOCAL_EDITOR_TREE_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_EDITOR_TREE_ARTIFACTS;
// Only disposable browser storage is seeded. Account fixtures use the real API.
async function legacy(page: any, key: string, value?: string) {
 return page.evaluate(async ({ key, value }: { key: string; value?: string }) => {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
   const req = indexedDB.open('localforage');
   req.onupgradeneeded = () => req.result.createObjectStore('keyvaluepairs');
   req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
  });
  try { return await new Promise((resolve, reject) => {
   const tx = db.transaction('keyvaluepairs', value === undefined ? 'readonly' : 'readwrite');
   const request = value === undefined ? tx.objectStore('keyvaluepairs').get(key) : tx.objectStore('keyvaluepairs').put(value, key);
   tx.oncomplete = () => resolve(request.result); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
 }, { key, value });
}
async function offlineReady(page: any) {
 await page.waitForFunction(async () => {
  await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
  for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
  return false;
 });
}
for (const account of [false, true]) test(`native legacy tree ${account ? 'account review and independent copy' : 'anonymous migration'} survives offline reload`, {
 skip: !base || !playwrightPath, timeout: 120_000
}, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const url = (path: string) => new URL(path, base).href, headers = { Origin: new URL(base!).origin };
 const errors: string[] = [], writes: string[] = [], bounds: unknown[] = [];
 let owner = '', offline = false;
 const directory = artifacts && resolve(artifacts, account ? 'account' : 'anonymous');
 page.setDefaultTimeout(20_000);
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.on('request', (request: any) => { if (offline && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 const source: any = { EarlierNotes: 'Earlier editable device notes', Date: new Date('2026-10-17T00:00:00Z'), settings: { theme: 'legacy-only-fixture' } }; source.Cycle = { note: 'Keep this cyclic value' }; source.Cycle.self = source.Cycle;
 if (account) source.LargeNote = 'x'.repeat(600 * 1024);
 let original = stringifyThingtimeForStorage(source);
 const editor = page.locator('.string-atomic-wrapper [contenteditable="true"]');
 try {
  if (directory) await mkdir(directory, { recursive: true });
  if (account) {
   const username = 'treeqa-' + randomUUID().slice(0, 8);
   const registered = await context.request.post(url('/api/v1/auth/register'), { headers, data: { username, email: username + '@example.test', password: randomUUID() + randomUUID() } });
   assert.equal(registered.status(), 200, await registered.text()); owner = (await registered.json()).user.id;
  }
  // An inert API document gives fixture storage the correct origin before the app hydrates.
  await page.goto(url('/api/root-data'));
  const key = account ? `thingtime:account:${owner}` : 'thingtime';
  await legacy(page, key, original);
  await page.goto(url(account ? '/editor/CurrentNotes' : '/editor/EarlierNotes'));
  await page.getByRole('button', { name: 'Load drafts & templates', exact: true }).waitFor();
  await offlineReady(page); offline = true; await context.setOffline(true);
  if (account) {
   const recover = page.getByRole('button', { name: 'Recover earlier device tree', exact: true }); await recover.waitFor();
   assert.equal(await page.evaluate(() => window.getThingtime(['EarlierNotes'])), undefined, 'Owner-only data is never auto-assigned to this plane');
   await page.locator('[contenteditable="true"]').last().click({ button: 'right' });
   await page.getByText('Change type…', { exact: true }).click(); await page.getByText('string', { exact: true }).click();
   await editor.fill('Keep current workspace notes');
   await page.getByText('Draft saved on this device ✓', { exact: true }).waitFor();
   const settings = await page.evaluate(() => window.flatted.stringify(window.getThingtime(['settings'])));
   await recover.click();
   const dialog = page.getByRole('dialog').filter({ hasText: 'Earlier device workspace' });
   await dialog.getByText(/Earlier roots:/).waitFor();
   source.EarlierNotes = 'Changed while the review was open'; original = stringifyThingtimeForStorage(source);
   await legacy(page, key, original);
   await dialog.getByRole('button', { name: 'Copy into this workspace', exact: true }).click();
   await dialog.getByRole('alert').filter({ hasText: 'The earlier device tree changed.' }).waitFor();
   await dialog.getByRole('button', { name: 'Cancel', exact: true }).click(); await recover.click();
   await dialog.locator('pre').filter({ hasText: source.EarlierNotes }).waitFor();
   await dialog.getByLabel('Recovered workspace name').fill('CurrentNotes');
   await dialog.getByRole('button', { name: 'Copy into this workspace', exact: true }).click();
   await dialog.getByRole('alert').filter({ hasText: 'That name already exists.' }).waitFor();
   await dialog.getByLabel('Recovered workspace name').fill('Recovered device workspace');
   for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 }); await page.evaluate(async () => { await document.fonts.ready; });
    const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1); bounds.push({ width, box });
    const copy = dialog.getByRole('button', { name: 'Copy into this workspace', exact: true });
    await copy.scrollIntoViewIfNeeded();
    assert.equal(await copy.evaluate((button: HTMLElement) => {
     const box = button.getBoundingClientRect();
     return [0.1, 0.5, 0.9].every(part => button.contains(document.elementFromPoint(box.x + box.width * part, box.y + box.height / 2)));
    }), true, 'The entire copy control stays above or clear of floating controls');
    if (directory) await page.screenshot({ path: resolve(directory, `review-${width}.png`), animations: 'disabled' });
   }
   await dialog.getByRole('button', { name: 'Copy into this workspace', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
   assert.equal(await page.evaluate(() => window.flatted.stringify(window.getThingtime(['settings']))), settings);
   await page.reload(); await editor.waitFor(); assert.equal(await editor.innerText(), 'Keep current workspace notes');
  } else {
   assert.equal(await editor.innerText(), source.EarlierNotes);
   await editor.fill('Later anonymous edit'); await page.getByText('Draft saved on this device ✓', { exact: true }).waitFor();
   await page.reload(); await editor.waitFor(); assert.equal(await editor.innerText(), 'Later anonymous edit');
  }
  const retained = await page.evaluate((account: boolean) => {
   const tree = window.getThingtime(account ? ['Recovered device workspace'] : []);
   return { date: tree.Date instanceof Date && tree.Date.toISOString(), cycle: tree.Cycle.self === tree.Cycle, text: tree.EarlierNotes, largeNoteLength: tree.LargeNote?.length };
  }, account);
  assert.equal(retained.date, '2026-10-17T00:00:00.000Z'); assert.equal(retained.cycle, true);
  assert.equal(retained.text, account ? source.EarlierNotes : 'Later anonymous edit');
  if (account) assert.equal(retained.largeNoteLength, 600 * 1024, 'Root persistence is independent of draft snapshot limits');
  assert.equal(await legacy(page, key), original, 'Original device bytes remain unchanged');
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (directory) await writeFile(resolve(directory, 'verification.json'), JSON.stringify({ account, coldOfflineReload: true, originalPreserved: true, retained, writes, errors, bounds }, null, 2));
 } catch (error) {
  if (directory) { await page.screenshot({ path: resolve(directory, 'failure.png') }).catch(() => {}); await writeFile(resolve(directory, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText().catch(() => ''), errors, writes }, null, 2)); }
  throw error;
 } finally {
  try { if (owner) { offline = false; await context.setOffline(false); await context.request.post(url('/api/v1/auth/logout'), { headers, data: {} }); } }
  finally { await browser.close(); }
 }
});
