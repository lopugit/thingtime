import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
const base = process.env.TT_LOCAL_TIMELINE_URL;
const playwrightPath = process.env.TT_SHARED_PLAYWRIGHT_PATH;
const artifacts = process.env.TT_LOCAL_TIMELINE_ARTIFACTS;
const networkMode = process.env.TT_LOCAL_TIMELINE_NETWORK_MODE || 'offline-emulation';
const fixture = { format: 'thingtime.transfer', version: 1, roots: ['page'], things: [
 { id: 'page', thingtime: ['webpage'], crystal: { name: 'Offline history page', blocks: [{ id: 'card', type: 'component', component: 'card' }] } },
 { id: 'card', thingtime: ['component'], crystal: { name: 'Offline history component', componentKey: 'history-card', version: 1, render: { tag: 'p', children: 'A saved local version stays here.' } } }
], files: [] };

test('clean anonymous offline import, rename, history reload and native recorded preview never call account Timeline', { skip: !base || !playwrightPath, timeout: 180_000 }, async () => {
 assert.ok(['localhost', '127.0.0.1'].includes(new URL(base!).hostname));
 assert.ok(['blocked-requests', 'offline-emulation'].includes(networkMode));
 const { chromium } = await import(playwrightPath!);
 const browser = await chromium.launch({ executablePath: process.env.TT_SHARED_CHROME_PATH, headless: true, chromiumSandbox: true });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), page = await context.newPage();
 const mutations: string[] = [], timelineRequests: string[] = [], failures: string[] = [], diagnostics: string[] = [], restoredPublicReads: string[] = [];
 context.on('request', (request: any) => {
  const url = new URL(request.url());
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) mutations.push(url.pathname);
  if (url.pathname.startsWith('/api/v1/timeline')) timelineRequests.push(url.pathname);
  if (url.pathname === '/api/v1/things' && [url.searchParams.get('id'), url.searchParams.get('target')].some(id => id?.startsWith('restored-'))) restoredPublicReads.push(url.pathname + url.search);
 });
 context.on('requestfailed', (request: any) => diagnostics.push(`${request.url()}: ${request.failure()?.errorText}`));
 await context.addInitScript(() => window.addEventListener('error', event => {
  const target = event.target as HTMLScriptElement | null;
  if (target?.tagName === 'SCRIPT' && target.type === 'module') console.warn('Timeline fixture boot resource', JSON.stringify({ src: target.src, url: location.href, ready: document.readyState }));
 }, true));
 page.on('console', (message: any) => {
  const moduleFailure = message.text().startsWith('Timeline fixture boot resource');
  if (moduleFailure) failures.push(message.text()); // A recovered module failure is still a startup failure.
  if (message.type() === 'error' || moduleFailure) diagnostics.push(message.text());
 });
 page.on('pageerror', (error: Error) => failures.push(error.message));
 try {
  const root = page.waitForResponse((response: any) => new URL(response.url()).pathname === '/api/root-data').then(async (response: any) => {
   assert.equal(response.status(), 200); return response.json();
  });
  const [, initial] = await Promise.all([page.goto(new URL('/things', base).href), root]);
  assert.equal(initial.user, null);
  await page.waitForFunction(async () => {
   await navigator.serviceWorker.ready;
   if (!navigator.serviceWorker.controller) return false;
   for (const key of await caches.keys()) if (key.startsWith('thingtime:offline-shell:') && await (await caches.open(key)).match('/__thingtime_offline_shell_complete__')) return true;
   return false;
  });
  // Use actual offline emulation by default. Request routing can miss browser
  // requests while a service worker controls the page; the explicit root probe
  // below must pass in either mode. Keep module failures fatal, even if recovered.
  if (networkMode === 'offline-emulation') await context.setOffline(true);
  else await context.route('**/*', (route: any) => route.abort('internetdisconnected'));
  assert.equal(await page.evaluate(async () => { try { await fetch('/api/root-data', { cache: 'no-store' }); return false; } catch { return true; } }), true, 'account/root network reads must be unavailable');
  await page.getByRole('button', { name: 'Import…', exact: true }).click();
  await page.getByRole('textbox', { name: 'Copied Thingtime content', exact: true }).fill(JSON.stringify(fixture));
  const read = page.getByRole('button', { name: 'Read pasted content', exact: true });
  if (await read.isVisible()) await read.click();
  await page.getByRole('button', { name: 'Import private copies', exact: true }).click();
  const link = page.getByRole('link', { name: 'Offline history page', exact: true });
  await link.waitFor(); const thingId = new URL(await link.getAttribute('href'), base).pathname.split('/').at(-1)!;
  const timelineFolderLink = page.getByRole('link', { name: 'Timeline', exact: true });
  await timelineFolderLink.waitFor();
  await timelineFolderLink.click();
  await page.waitForURL((url: URL) => url.searchParams.get('folder') === 'timeline-folder-local-workspace');
  await page.getByText('Saved on this device · never uploaded', { exact: true }).waitFor();
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).waitFor();
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history component/ }).waitFor();
  const folderBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); folderBounds.push(measured);
   if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, `timeline-folder-${width}.png`), fullPage: false, animations: 'disabled' }); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: '← Things', exact: true }).click();
  await link.waitFor();
  await page.getByRole('textbox', { name: 'Search all your things and computers…', exact: true }).fill('history page');
  await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
  await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill('Offline renamed history page');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('link', { name: 'Offline renamed history page', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('link', { name: 'Offline renamed history page', exact: true }).waitFor();
  assert.deepEqual(timelineRequests, []); assert.deepEqual(mutations, []); assert.deepEqual(failures, []);
  if (artifacts) await writeFile(resolve(artifacts, 'folder-verification.json'), JSON.stringify({ anonymous: true, networkMode, folderBounds, offlineFolderAndColdRenameReload: true, mutations, timelineRequests, failures }, null, 2));
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  await page.getByText('Saved on this device · never uploaded', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Page + related', exact: true }).click();
  await page.getByRole('button', { name: /Created Thing Offline history component/ }).waitFor();
  // The list responds optimistically before React Router commits the URL.
  // Reload the completed navigation, rather than aborting it at the old URL.
  await page.waitForURL((url: URL) => url.searchParams.get('scope') === 'related');
  await page.reload();
  await page.getByRole('button', { name: /Created Thing Offline history component/ }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('scope'), 'related');
  const relatedBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); relatedBounds.push(measured);
   if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, `related-history-${width}.png`), fullPage: false, animations: 'disabled' }); }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'This Thing', exact: true }).click();
  await page.getByRole('button', { name: /Created Thing Offline history component/ }).waitFor({ state: 'hidden' });
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
  await page.getByText('Kept locally, even without a connection.', { exact: true }).first().waitFor({ state: 'hidden' });
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
  const downloadReady = page.waitForEvent('download');
  await namedForm.getByRole('button', { name: 'Export', exact: true }).click();
  const downloaded = await downloadReady;
  assert.equal(await downloaded.failure(), null);
  const archive = JSON.parse(await readFile((await downloaded.path())!, 'utf8'));
  assert.equal(archive.formatVersion, 1); assert.equal(archive.event.thingId, thingId); assert.equal(archive.event.ownerId, 'local-workspace');
  assert.equal(archive.name.name, 'Renamed offline checkpoint'); assert.equal(archive.content.adapter, 'thing-content');
  assert.equal(archive.content.value.crystal.blocks[0].type, 'component'); assert.ok(archive.event.dependencies.length);
  assert.match(downloaded.suggestedFilename(), /^history-.*\.json$/);
  await namedForm.getByText(/Exported Renamed offline checkpoint/).waitFor();
  if (artifacts) { await downloaded.saveAs(resolve(artifacts, 'history-version.json')); await page.screenshot({ path: resolve(artifacts, 'history-export-320.png'), fullPage: false, animations: 'disabled' }); }

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
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  await page.getByRole('button', { name: /Edited Thing Offline renamed history page/ }).click();
  await page.getByRole('button', { name: 'Try a variation', exact: true }).click();
  // Wait for the cached branch row; the selected version also has a separate
  // current-content merge button while the branch list is loading.
  await page.getByRole('button', { name: 'Edit variation', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Review and combine…', exact: true }).first().click();
  const mergeReview = page.getByRole('region', { name: 'Review branch merge', exact: true });
  await mergeReview.getByText(/Both versions changed/).waitFor();
  await page.getByRole('button', { name: 'Close preview', exact: true }).click();
  assert.equal(await mergeReview.getByRole('button', { name: 'Review choices', exact: true }).isDisabled(), true);
  await mergeReview.getByRole('button', { name: 'Use this version', exact: true }).click();
  await mergeReview.getByRole('button', { name: 'Review choices', exact: true }).click();
  await mergeReview.getByRole('button', { name: 'Save merge to branch', exact: true }).waitFor();
  await mergeReview.getByRole('button', { name: 'Preview merge result', exact: true }).click();
  await mergeReview.getByText('A saved local version stays here.', { exact: true }).waitFor();
  const mergeBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   await mergeReview.getByText('A saved local version stays here.', { exact: true }).scrollIntoViewIfNeeded();
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); mergeBounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `branch-merge-${width}.png`), fullPage: false, animations: 'disabled' });
  }
  await mergeReview.getByRole('button', { name: 'Save merge to branch', exact: true }).click();
  await mergeReview.getByText('Merge saved to Offline variation on this device.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(branchUrl);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline renamed history page', 'the explicitly chosen incoming title survives a cold branch reload');
  await page.goto(new URL(`/builder?page=${encodeURIComponent(thingId)}&mode=edit`, base).href);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline renamed history page', 'merging the branch never writes current content');
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  await page.getByRole('button', { name: /Edited Thing Offline renamed history page/ }).click();
  await page.getByRole('button', { name: 'Undo this change…', exact: true }).click();
  await page.getByRole('heading', { name: 'Review undo', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Undo this change', exact: true }).click();
  await page.getByText('Undid this change. Every version is still in your Timeline.', { exact: true }).waitFor();
  await page.goto(new URL(`/builder?page=${encodeURIComponent(thingId)}&mode=edit`, base).href);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline history page');
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  for(const width of [1440,390,320]) {
   await page.setViewportSize({width,height:width===1440?1000:844});
   await page.reload();
   await page.getByRole('button', { name: /Edit Offline variation Native Builder variation edit/ }).click();
   await page.getByRole('tab',{name:'Versions',exact:true}).click();
   const controls=page.locator('.history-version[data-selected="true"]');
   if(width===1440){
    await controls.getByRole('textbox',{name:'Version name',exact:true}).fill('Anonymous draft experiment');
    await controls.getByRole('button',{name:'Save',exact:true}).click();
    await controls.getByText('Named this version “Anonymous draft experiment”.',{exact:true}).waitFor();
   }
   assert.equal(await controls.getByRole('textbox',{name:'Version name',exact:true}).inputValue(),'Anonymous draft experiment');
   const ready=page.waitForEvent('download');await controls.getByRole('button',{name:'Export',exact:true}).click();
   const download=await ready,exported=JSON.parse(await readFile((await download.path())!,'utf8'));
   assert.equal(exported.event.mode,'draft');assert.equal(exported.event.source,'client');
   assert.equal(exported.name.name,'Anonymous draft experiment');assert.equal(exported.event.ownerId,'local-workspace');
   assert.ok(exported.receipt);assert.equal(exported.content.value.crystal.name,'Native Builder variation edit');
   if(artifacts)await download.saveAs(resolve(artifacts,`anonymous-draft-${width}.json`));
   await controls.getByText(/Exported Anonymous draft experiment/).waitFor();
   await controls.scrollIntoViewIfNeeded();

   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
   if(artifacts)await page.screenshot({path:resolve(artifacts,`anonymous-draft-name-${width}.png`),animations:'disabled'});
  }
  await page.setViewportSize({width:1440,height:1000});await page.reload();
  await page.getByRole('button', { name: /Edit Offline variation Native Builder variation edit/ }).click();
  await page.getByRole('button', { name: 'Review and combine…', exact: true }).click();
  await page.getByRole('button', { name: 'Apply merge', exact: true }).click();
  await page.getByText('Version saved. The previous versions are still in your Timeline.', { exact: true }).waitFor();
  await page.goto(new URL(`/builder?page=${encodeURIComponent(thingId)}&mode=edit`, base).href);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Native Builder variation edit');
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}`, base).href);
  await page.getByRole('button', { name: /Created Thing Offline history page/ }).click();
  const restoreBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   // Wait for the responsive detail host to remount before inspecting its controls.
   await page.getByRole(width <= 820 ? 'dialog' : 'complementary', { name: 'Version details', exact: true }).waitFor();
   const openRestore = page.getByRole('button', { name: 'Restore this version…', exact: true });
   if (await openRestore.isVisible()) await openRestore.click();
   await page.getByRole('heading', { name: 'Review restore', exact: true }).waitFor();
   const native = page.getByText('A saved local version stays here.', { exact: true });
   if (!await native.isVisible()) await page.getByRole('button', { name: 'Preview result', exact: true }).click();
   await native.waitFor(); await native.scrollIntoViewIfNeeded();
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); restoreBounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `restore-${width}.png`), fullPage: false, animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
  await page.getByText('Version saved. The previous versions are still in your Timeline.', { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(new URL(`/builder?page=${encodeURIComponent(thingId)}&mode=edit`, base).href);
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline history page');
  await page.reload();
  await page.getByText('A saved local version stays here.', { exact: true }).waitFor();
  assert.equal(await page.getByRole('textbox').inputValue(), 'Offline history page');
  await page.goto(new URL('/things', base).href);
  await page.getByRole('textbox', { name: 'Search all your things and computers…', exact: true }).fill('Offline history component');
  const restoredLink = page.locator('a[href*="/thing/restored-"]').filter({ hasText: 'Offline history component' }).first();
  await restoredLink.waitFor(); const restoredId = new URL(await restoredLink.getAttribute('href'), base).pathname.split('/').at(-1)!;
  assert.match(restoredId, /^restored-[a-f0-9]{48}$/);
  await restoredLink.click();
  await page.getByTestId('thing-component-live').getByText('A saved local version stays here.', { exact: true }).waitFor();
  await page.getByRole('heading', { name: 'Comments', exact: true }).waitFor();
  await page.getByPlaceholder('Write a comment… 💬', { exact: true }).fill('A restored component has its own local discussion.');
  await page.getByRole('button', { name: 'Send comment', exact: true }).click();
  await page.getByLabel('Comments results').getByText('A restored component has its own local discussion.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Reply to Local workspace', exact: true }).click();
  await page.getByPlaceholder('Reply to Local workspace… 💬', { exact: true }).fill('A nested reply stays offline.');
  await page.getByRole('button', { name: 'Send reply', exact: true }).click();
  await page.getByLabel('Comments results').getByRole('paragraph').filter({ hasText: 'A nested reply stays offline.' }).waitFor();
  await page.getByRole('button', { name: 'Thing actions', exact: true }).click();
  await page.getByRole('menuitem', { name: '✏️ Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'Thing title', exact: true }).fill('Restored component edited offline');
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.getByRole('heading', { name: 'Restored component edited offline', exact: true }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'Restored component edited offline', exact: true }).waitFor();
  await page.getByLabel('Comments results').getByText('A restored component has its own local discussion.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'View replies', exact: true }).click();
  await page.getByLabel('Comments results').getByRole('paragraph').filter({ hasText: 'A nested reply stays offline.' }).waitFor();
  const restoredDetailBounds = [];
  for (const [width, height] of [[1440, 1000], [390, 844], [320, 844]]) {
   await page.setViewportSize({ width, height });
   const measured = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
   assert.equal(measured.width, measured.scrollWidth); restoredDetailBounds.push(measured);
   if (artifacts) await page.screenshot({ path: resolve(artifacts, `restored-detail-${width}.png`), fullPage: true, animations: 'disabled' });
  }
  await page.goto(new URL(`/history?thing=${encodeURIComponent(thingId)}&scope=related`, base).href);
  await page.getByRole('button', { name: /Edited Thing Restored component edited offline/ }).waitFor();
  assert.equal(await page.getByRole('button', { name: /Created Thing Offline history component/ }).count(), 0, 'the prior component leaves the cached related membership');
  await page.reload();
  await page.getByRole('button', { name: /Edited Thing Restored component edited offline/ }).waitFor();
  assert.deepEqual(timelineRequests, []); assert.deepEqual(mutations, []); assert.deepEqual(failures, []); assert.deepEqual(restoredPublicReads, []);
  if (artifacts) await writeFile(resolve(artifacts, 'verification.json'), JSON.stringify({ anonymous: true, networkMode, offlineTimelineFolderReload: true, folderBounds, offlineImportAndRename: true, coldOfflineReload: true, nativeRecordedComponent: true, offlineNoteSaveReloadRemove: true, rejectedNinthNotePreservedAndDismissed: true, offlineVersionNameRenameClearReload: true, anonymousDraftNamingReload: true, offlineVariationFieldsAndBuilderSaveReload: true, currentThingUnchanged: true, offlineBranchMergeConflictReviewSaveReload: true, offlineHistoryArchiveDownload: true, offlineUndoCurrentMergeRecordedRestoreReload: true, relatedHistoryOfflineColdReload: true, relatedMembershipResetAfterRestore: true, relatedBounds, restoredDetailRoutingCommentsRenameReload: true, restoredPublicReads, restoredDetailBounds, restoreBounds, mergeBounds, branchBounds, mutations, timelineRequests, failures, bounds }, null, 2));
 } catch (error) {
  if (artifacts) { await mkdir(resolve(artifacts), { recursive: true }); await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }); await writeFile(resolve(artifacts, 'failure.txt'), await page.locator('body').innerText()); await writeFile(resolve(artifacts, 'failure-diagnostics.json'), JSON.stringify({ url: page.url(), networkMode, failures, diagnostics }, null, 2)); }
  throw error;
 } finally { await browser.close(); }
});
