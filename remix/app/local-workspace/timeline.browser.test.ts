import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_TIMELINE_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_TIMELINE_ARTIFACTS;
const fixture = { format: 'thingtime.transfer', version: 1, roots: ['page'], things: [
 { id: 'page', thingtime: ['webpage'], crystal: { name: 'Offline history page', blocks: [{ id: 'card', type: 'component', component: 'card' }] } },
 { id: 'card', thingtime: ['component'], crystal: { name: 'Offline history component', componentKey: 'history-card', version: 1, render: { tag: 'p', children: 'A saved local version stays here.' } } }
], files: [] };

test('clean anonymous offline import, rename, history reload and native recorded preview never call account Timeline', { skip: !base || !playwrightPath, timeout: 120_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const mutations: string[] = [], timelineRequests: string[] = [], failures: string[] = [];
 context.on('request', (request: any) => {
  const url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(url.pathname);
  if (url.pathname.startsWith('/api/v1/timeline')) timelineRequests.push(url.pathname);
 });
 page.on('pageerror', (error: Error) => failures.push(error.message));
 try {
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data');
  await page.goto(new URL('/things', base).href); assert.equal((await (await root).json()).user, null);
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready;
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify(fixture));
  const read = page.getByRole('button', { name: 'Read pasted content', exact: true });
  if (await read.isVisible()) await read.click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  const link = page.getByRole('link', { name: 'Offline history page', exact: true });
  await link.waitFor(); const thingId = new URL(await link.getAttribute('href'), base).pathname.split('/').at(-1)!;
  await page.getByRole('textbox', { name: 'Search all your things and computers…', exact: true }).fill('Offline history page');
  await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
  await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill('Offline renamed history page');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('link', { name: 'Offline renamed history page', exact: true }).waitFor();
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  await page.getByText('Saved on this device · never uploaded', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  await page.getByRole('tab', { name: 'Message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Add a note to this change', exact: true }).fill('Kept locally, even without a connection.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByText('Note saved on this device. It will never be uploaded.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Ask Lopu to explain', exact: true }).isDisabled(), true);
  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'note-saved-desktop.png'), fullPage: false }); }
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Preview page', exact: true }).click();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  await page.getByText(/Using the component definitions recorded with this version/).waitFor();
  assert.equal(await page.getByText('Synced to your account', { exact: true }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  await page.getByRole('button', { name: 'Preview page', exact: true }).click();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  await page.getByText('Kept locally, even without a connection.', { exact: true }).first().waitFor();
  const bounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   // The responsive detail panel remounts as a phone drawer. Reopen its
   // preview so each screenshot proves the native renderer at that size.
   const preview = page.getByRole('button', { name: 'Preview page', exact: true });
   if (await preview.isVisible()) await preview.click();
   await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
   await page.getByRole('button', { name: 'Hide page preview', exact: true }).waitFor();
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); bounds.push(measured);
   if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, `history-${width}.png`), fullPage: false }); }
  }
  await page.getByRole('tab', { name: 'Message', exact: true }).click();
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'note-saved-320.png'), fullPage: false });
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByText('Note removed from this device.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Kept locally, even without a connection.', { exact: true }).count(), 0);
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  await page.getByRole('tab', { name: 'Message', exact: true }).click();
  await page.getByRole('textbox', { name: 'Add a note to this change', exact: true }).waitFor();
  assert.equal(await page.getByText('Kept locally, even without a connection.', { exact: true }).count(), 0);
  for (let n = 0; n < 8; n++) {
   await page.getByRole('textbox', { name: 'Add a note to this change', exact: true }).fill(`Bounded offline note ${n}`);
   await page.getByRole('button', { name: 'Save note', exact: true }).click();
   await page.getByText(`Bounded offline note ${n}`, { exact: true }).first().waitFor();
   await page.getByText('Note saved on this device. It will never be uploaded.', { exact: true }).waitFor();
  }
  await page.getByRole('textbox', { name: 'Add a note to this change', exact: true }).fill('Ninth note stays available for review.');
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByText(/Needs attention · This change already has 8 notes/).first().waitFor();
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await page.getByText('Note command cancelled. Your change remains in History.', { exact: true }).waitFor();
  assert.equal(await page.getByText('Ninth note stays available for review.', { exact: true }).count(), 0);
  await page.getByRole('tab', { name: 'Versions', exact: true }).click();
  const namedForm = page.locator('form.history-version-controls').filter({ has: page.locator('input[aria-label="Version name"]:enabled') }).first();
  await namedForm.getByRole('textbox', { name: 'Version name', exact: true }).fill('Offline checkpoint');
  await namedForm.getByRole('button', { name: 'Save', exact: true }).click();
  await namedForm.getByText('Named this version “Offline checkpoint”.', { exact: true }).waitFor();
  await namedForm.getByRole('textbox', { name: 'Version name', exact: true }).fill('Renamed offline checkpoint');
  await namedForm.getByRole('button', { name: 'Save', exact: true }).click();
  await namedForm.getByText('Renamed this version “Renamed offline checkpoint”.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  await page.getByRole('tab', { name: 'Versions', exact: true }).click();
  assert.equal(await namedForm.getByRole('textbox', { name: 'Version name', exact: true }).inputValue(), 'Renamed offline checkpoint');
  if (artifacts) await page.screenshot({ path: resolve(artifacts, 'named-version-320.png'), fullPage: false, animations: 'disabled' });
  await namedForm.getByRole('button', { name: 'Clear', exact: true }).click();
  await namedForm.getByText('Removed the version name.', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  await page.getByRole('tab', { name: 'Versions', exact: true }).click();
  assert.equal(await namedForm.getByRole('textbox', { name: 'Version name', exact: true }).inputValue(), '');
  assert.equal(await namedForm.getByRole('button', { name: 'Clear', exact: true }).count(), 0);
  await page.getByRole('tab', { name: 'Changes', exact: true }).click();
  await page.getByRole('button', { name: 'Preview page', exact: true }).click();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Try a variation', exact: true }).click();
  await page.getByRole('textbox', { name: 'Variation name', exact: true }).fill('Offline variation');
  await page.getByRole('button', { name: 'Create variation', exact: true }).click();
  await page.getByText('Branch saved on this device. It will never be uploaded.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Edit variation', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Edit branch', exact: true });
  await editor.getByRole('textbox', { name: 'name value', exact: true }).fill('Edited variation fields');
  await editor.getByRole('button', { name: 'Save to branch', exact: true }).click();
  await editor.getByText('Saved to Offline variation on this device.', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Open in Builder', exact: true }).click();
  await page.getByText('Branch: Offline variation', { exact: true }).waitFor();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  await page.getByText('Using recorded component definitions. Live data and actions are paused.', { exact: true }).waitFor();
  const branchUrl = page.url();
  assert.equal(new URL(branchUrl).searchParams.get('dataPlane'), 'local-workspace');
  assert.equal(await page.getByRole('textbox').inputValue(), 'Edited variation fields');
  await page.getByRole('textbox').fill('Native Builder variation edit');
  await page.getByRole('toolbar', { name: 'Page controls' }).getByRole('button', { name: 'Save to branch', exact: true }).click();
  await page.getByText('Saved to Offline variation on this device.', { exact: true }).waitFor();
  await page.reload();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Native Builder variation edit');
  const branchBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   if (width < 768 && await page.getByRole('button', { name: 'Close builder', exact: true }).isVisible()) await page.getByRole('button', { name: 'Close builder', exact: true }).click();
   await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); branchBounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `branch-builder-${width}.png`), fullPage: false, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL(`/builder?page=${encodeURIComponent(thingId)}&mode=edit`, base).href);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline renamed history page', 'branch saves never replace the current Thing');
  assert.deepEqual(timelineRequests, []); assert.deepEqual(mutations, []); assert.deepEqual(failures, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ anonymous: true, offlineImportAndRename: true, coldOfflineReload: true, nativeRecordedComponent: true, offlineNoteSaveReloadRemove: true, rejectedNinthNotePreservedAndDismissed: true, offlineVersionNameRenameClearReload: true, offlineVariationFieldsAndBuilderSaveReload: true, currentThingUnchanged: true, branchBounds, mutations, timelineRequests, failures, bounds }, null, 2));
 } catch (error) {
  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.txt'), await page.locator('body').innerText()); }
  throw error;
 } finally { await browser.close(); }
});
