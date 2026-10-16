import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_STORAGE_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_STORAGE_ARTIFACTS;
const transfer = (name: string) => JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['note'], files: [], things: [{ id: 'note', thingtime: ['data'], crystal: { name, text: 'Disposable device storage fixture.' } }] });

test('anonymous storage settings work after cold offline reload, follow other-tab writes and retain usage on errors', { skip: !base || !playwrightPath, timeout: 90_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 const page = await context.newPage(), mutations: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(new URL(request.url()).pathname); });
 await context.addInitScript(() => window.addEventListener('error', event => { const target = event.target as HTMLScriptElement | null; if (target?.tagName === 'SCRIPT' && target.type === 'module') console.warn('Storage fixture module error', target.src); }, true));
 const monitor = (tab: any) => { tab.on('pageerror', (error: Error) => errors.push(error.message)); tab.on('console', (message: any) => { if (message.text().startsWith('Storage fixture module error')) errors.push(message.text()); }); };
 monitor(page);
 const importNote = async (tab: any, name: string) => {
  await tab.getByRole('button', { name: 'Import…', exact: true }).click();
  await tab.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(transfer(name));
  const read = tab.getByRole('button', { name: 'Read pasted content', exact: true }); if (await read.isVisible()) await read.click();
  await tab.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await tab.getByRole('link', { name, exact: true }).waitFor();
 };
 try {
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user, null);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await importNote(page, 'Device storage first fixture');
  await page.goto(new URL('/settings/things', base).href);
  const panel = page.getByTestId('workspace-storage-settings'), usage = panel.getByRole('status');
  await usage.waitFor(); const first = await usage.innerText();
  assert.match(first, /of 67,108,864 bytes/); assert.doesNotMatch(first, /^0 bytes/);
  await page.getByText('Things, drafts, files and History saved in this browser. Anonymous content is never uploaded.', { exact: true }).waitFor();
  await page.reload(); await usage.waitFor(); assert.equal(await usage.innerText(), first);
  const second = await context.newPage(); monitor(second);
  await second.goto(new URL('/things', base).href); await importNote(second, 'Device storage second tab fixture');
  await panel.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await page.waitForFunction((before: string) => { const text = document.querySelector('[data-testid="workspace-storage-settings"] [role="status"]')?.textContent; return !!text && text !== before; }, first);
  const after = await usage.innerText();
  assert.ok(Number(after.replaceAll(',', '').match(/^(\d+) bytes/)![1]) > Number(first.replaceAll(',', '').match(/^(\d+) bytes/)![1]));
  await second.close();
  // Only this clean test context's anonymous ledger is damaged. The application
  // must preserve saved Things and display a retryable error, not a zero meter.
  const savedLedger = await page.evaluate(async () => {
   const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
   try { return await new Promise((resolve, reject) => { const tx = db.transaction('usage', 'readwrite'), store = tx.objectStore('usage'); const req = store.get(JSON.stringify(['anonymous', 1])); let saved: unknown; req.onsuccess = () => { saved = req.result; store.delete(JSON.stringify(['anonymous', 1])); }; tx.oncomplete = () => resolve(saved); tx.onabort = () => reject(tx.error); }); }
   finally { db.close(); }
  });
  await panel.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await panel.getByText('Device storage usage is unavailable. Your saved content has not been changed.', { exact: true }).waitFor();
  assert.equal(await usage.innerText(), `Last known usage: ${after}`);
  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'usage-error.png'), fullPage: false }); }
  await page.evaluate(async (saved: any) => { const db = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open('thingtime.local-workspaces.v1'); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); try { await new Promise<void>((resolve, reject) => { const tx = db.transaction('usage', 'readwrite'); tx.objectStore('usage').put(saved); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); }); } finally { db.close(); } }, savedLedger);
  await panel.getByRole('button', { name: 'Refresh usage', exact: true }).click();
  await page.waitForFunction((expected: string) => document.querySelector('[data-testid="workspace-storage-settings"] [role="status"]')?.textContent === expected, after);
  const protect = panel.getByRole('button', { name: 'Protect device storage', exact: true });
  if (await protect.isVisible() && await protect.isEnabled()) {
   await protect.click();
   await panel.getByText(/Protected from automatic browser eviction.|The browser did not grant protection.|This browser does not offer storage protection./).waitFor();
  }
  const protection = await panel.innerText(), bounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `storage-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await panel.getByRole('link', { name: 'Manage or export Things', exact: true }).click();
  await page.getByRole('link', { name: 'Device storage first fixture', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Device storage second tab fixture', exact: true }).waitFor();
  assert.deepEqual(mutations, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ anonymous: true, offline: true, coldReload: true, otherTabWrite: true, missingLedgerRetainsLastKnownUsage: true, contentPreserved: true, first, after, protection, bounds, mutations, errors }, null, 2));
 } catch (error) { if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.txt'), await page.locator('body').innerText()); await writeFile(resolve(artifacts, 'failure-errors.json'), JSON.stringify({ url: page.url(), errors, mutations })); } throw error; }
 finally { await browser.close(); }
});
