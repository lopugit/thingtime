import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.TT_LOCAL_THING_DRAFTS_URL, playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_THING_DRAFTS_ARTIFACTS;
test('native generic Thing drafts save and reopen anonymously after a cold offline reload', {
 skip: !base || !playwrightPath, timeout: 120_000
}, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const writes: string[] = [], errors: string[] = [], bounds: unknown[] = [];
 context.on('request', (request: any) => { if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) writes.push(new URL(request.url()).pathname); });
 page.on('pageerror', (error: Error) => errors.push(error.message));
 page.setDefaultTimeout(20_000);
 const editor = page.locator('.string-atomic-wrapper [contenteditable="true"]');
 const picker = page.getByRole('button', { name: 'Load drafts & templates', exact: true });
 const saved = page.getByText('Draft saved on this device ✓', { exact: true });
 const text = 'My anonymous Thing stays editable offline.';
 try {
  if (artifacts) await mkdir(resolve(artifacts), { recursive: true });
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/editor/Notes', base).href);
  assert.equal((await (await root).json()).user, null);
  await picker.waitFor();
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready; if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  await context.setOffline(true); await page.reload(); await picker.waitFor();
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data?generic-draft-offline-probe', { cache: 'no-store' }); return false; } catch { return true; } }), true);
  // Start a native text Thing through its normal type menu, then edit its value.
  await page.locator('[contenteditable="true"]').last().click({ button: 'right' });
  await page.getByText('Change type…', { exact: true }).click(); await page.getByText('string', { exact: true }).click();
  await editor.fill(text); await saved.waitFor(); await picker.click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Your drafts & templates' });
  await dialog.getByRole('button', { name: /Notes/ }).waitFor();
  for (const width of [1440, 390, 320]) {
   await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
   await page.evaluate(async () => { await document.fonts.ready; });
   const box = await dialog.boundingBox(); assert.ok(box && box.x >= 0 && box.x + box.width <= width + 1);
   bounds.push({ width, box });
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `thing-draft-${width}.png`), animations: 'disabled' });
  }
  await page.reload(); await picker.click();
  await dialog.getByRole('button', { name: /Notes/ }).click();
  await dialog.waitFor({ state: 'hidden' }); assert.equal(await editor.innerText(), text);
  const changed = text + ' A later edit survives too.';
  await editor.fill(changed); await saved.waitFor({ state: 'hidden' }); await saved.waitFor(); await page.reload();
  assert.equal(await editor.innerText(), changed);
  // Corrupt only this disposable browser's scoped recovery copy. A failed
  // decode must show a useful error and retain the bytes for recovery.
  const corrupt = await page.evaluate(() => {
   const keys = Object.keys(localStorage).filter(key => key.startsWith('tt-account-draft:') && key.includes(':thing:Notes:workspace-store:'));
   if (keys.length !== 1) throw Error('Expected one scoped fixture draft');
   const value = JSON.parse(localStorage.getItem(keys[0])!);
   value.content.snapshot = JSON.stringify({ path: ['Notes'], serialized: 'invalid serialization' });
   const raw = JSON.stringify(value); localStorage.setItem(keys[0], raw);
   return { key: keys[0], raw };
  });
  await page.reload();
  await page.getByRole('alert').filter({ hasText: 'The saved draft could not be restored and has been kept.' }).waitFor();
  await editor.fill('Editing the Thing remains available while draft recovery is paused.');
  assert.equal(await page.evaluate((key: string) => localStorage.getItem(key), corrupt.key), corrupt.raw);
  assert.deepEqual(writes, []); assert.deepEqual(errors, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ anonymous: true, coldOfflineReload: true, nativeTypeCreation: true, draftPickerRestoration: true, laterEdit: true, corruptRecoveryPreserved: true, bounds, writes, errors }, null, 2));
 } catch (error) {
  if (artifacts) {
   await page.screenshot({ path: resolve(artifacts, 'failure.png') }).catch(() => {});
   await writeFile(resolve(artifacts, 'failure.json'), JSON.stringify({ body: await page.locator('body').innerText().catch(() => ''), errors, writes }, null, 2));
  }
  throw error;
 } finally { await browser.close(); }
});
