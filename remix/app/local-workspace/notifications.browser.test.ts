import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_NOTIFICATIONS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_NOTIFICATIONS_ARTIFACTS;

test('anonymous Lopu messages survive cold offline navigation and render through the normal history UI', { skip: !base || !playwrightPath, timeout: 90_000 }, async () => {
 assert.ok(['localhost','127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const writes: string[] = [], errors: string[] = [];
 context.on('request', (request: any) => { if (!['GET','HEAD','OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 await context.addInitScript(() => window.addEventListener('error', event => { const target = event.target as HTMLScriptElement | null; if (target?.tagName === 'SCRIPT' && target.type === 'module') console.warn('Notification fixture module error', target.src); }, true));
 page.on('console', (message: any) => { if (message.text().startsWith('Notification fixture module error') || /React Router caught/.test(message.text())) errors.push(message.text()); });
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user, null);
  await page.waitForFunction(async () => { await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false; for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true; return false; });
  const otherTab = await context.newPage();
  otherTab.on('pageerror', (error: Error) => errors.push(error.message));
  await otherTab.goto(new URL('/notifications', base).href);
  await otherTab.getByText('All quiet — nothing here yet', { exact: true }).waitFor();
  await context.setOffline(true);
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify({ format: 'thingtime.transfer', version: 1, roots: ['note'], files: [], things: [{ id: 'note', thingtime: ['data'], crystal: { name: 'Notification history fixture', text: 'Disposable local fixture.' } }] }));
  const read = page.getByRole('button', { name: 'Read pasted content', exact: true }); if (await read.isVisible()) await read.click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  await page.getByRole('link', { name: 'Notification history fixture', exact: true }).waitFor();
  // Navigate using the discoverable anonymous nav control, then cold reload.
  await page.getByRole('link', { name: 'Notification history', exact: true }).first().click();
  await page.getByText('Anonymous messages stay on this device and never sync to an account.', { exact: true }).waitFor();
  await page.getByText(/1 notification · 0 unread/).waitFor();
  await otherTab.getByText(/1 notification · 0 unread/).waitFor();
  await otherTab.reload();
  await otherTab.getByText(/1 notification · 0 unread/).waitFor();
  await page.reload();
  await page.getByText(/1 notification · 0 unread/).waitFor();
  await page.getByRole('textbox', { name: 'Search notifications' }).fill('no message will match this fixture');
  await page.getByText('Nothing matches these filters', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByText(/1 notification · 0 unread/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Account history', exact: true }).count(), 0);
  const bounds = [];
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth })); assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
   await page.evaluate(() => scrollTo(0, 0));
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `notifications-${width}.png`), fullPage: true });
  }
  await context.setOffline(false);
  const reconnect = page.getByRole('button', { name: 'Reconnect', exact: true }); if (await reconnect.isVisible()) await reconnect.click();
  await page.reload(); await page.getByText(/1 notification · 0 unread/).waitFor();
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ anonymous: true, offline: true, coldReload: true, nativeHistory: true, crossTabHistory: true, search: true, bounds, writes, errors }, null, 2));
 } catch (error) {
  if (artifacts) { await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText(), errors, writes }, null, 2)); }
  throw error;
 } finally { await browser.close(); }
});
