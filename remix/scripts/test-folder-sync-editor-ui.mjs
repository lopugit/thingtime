import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, '../MCP/package.json'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-folder-sync-editor-ui'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-folder-sync-editor-'));
let browser, server;
const results = [];
try {
 await mkdir(evidence, { recursive: true });
 await require('esbuild').build({ entryPoints: [join(root, 'scripts/mobile-sync-editor.browser.tsx')], bundle: true, format: 'esm',
  platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>Folder sync editor regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const url = `http://127.0.0.1:${server.address().port}/?platform=desktop&tasks&folderEditor`;
 browser = await require('playwright').chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
 for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 375, 812]]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on('pageerror', cause => errors.push(cause.message));
  const folder = page.getByRole('region', { name: 'Downloads', exact: true });
  const add = page.getByRole('button', { name: 'Add folder', exact: true });
  const name = folder.getByRole('textbox', { name: 'Sync config name', exact: true });
  const direction = folder.getByRole('combobox', { name: 'Direction', exact: true });
  const savedRows = () => page.evaluate(() => window.syncInspectionFixture.savedRows());
  const isDownloads = row => row.thingtime.includes('file-sync') && row.crystal.localRootId === '22222222-2222-4222-8222-222222222222';
  try {
   await page.goto(url);
   await add.click();
   await name.waitFor();
   assert.equal(await name.inputValue(), 'Downloads');
   assert.equal(await direction.inputValue(), 'backup');
   await folder.getByText('Test Mac / Files / Downloads', { exact: true }).waitFor();
   assert.equal((await savedRows()).filter(isDownloads).length, 0, 'the picker only prepares a draft');
   await add.click();
   assert.equal(await folder.locator('article').count(), 1, 'reselecting the same grant reuses its first draft');
   const layout = folder.locator('[data-settings-document="file-sync-config-basics"]').filter({ visible: true });
   await enableCurrentPageBuilder(page);
   await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
   await layout.locator('[data-block-id="config-name-label"]').click();
   const select = page.getByRole('combobox', { name: 'Select block', exact: true });
   await select.selectOption('config-name-label');
   assert.equal(await select.inputValue(), 'config-name-label');
   await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('My sync config name');
   await select.selectOption('config-name');
   assert.equal(await select.inputValue(), 'config-name');
   await page.getByRole('button', { name: 'Close builder', exact: true }).click();
   await layout.getByRole('button', { name: 'Save layout', exact: true }).click();
   await layout.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
   await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
   await layout.getByText('My sync config name', { exact: true }).waitFor();
   await page.getByRole('button', { name: 'Builder on current page', exact: true }).press('Enter');
   await page.screenshot({ path: join(evidence, `${label}-first-draft.png`), fullPage: true });
   await page.evaluate(() => window.holdFixtureEnrollment());
   await folder.getByRole('button', { name: 'Save & sync', exact: true }).click();
   await page.waitForFunction(() => window.fixtureEnrollmentWaiting());
   const rows = await savedRows();
   const saved = rows.find(isDownloads);
   const pending = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.startsWith('tt:sync-editor:v1:'));
    return JSON.parse(localStorage.getItem(key)).drafts[0];
   });
   assert.equal(pending.id, saved.id);
   assert.equal(pending.enrollment.savedRevision, saved.updatedAt);
   assert.equal(await page.evaluate(id => window.readFolderEditorJob(id), saved.id), null);
   await page.getByRole('button', { name: 'Leave Files screen', exact: true }).click();
   assert.equal(await page.getByRole('heading', { name: 'Folders & sync configs', exact: true }).count(), 0);
   await page.waitForFunction(async ({ id, updatedAt }) => (await window.readFolderEditorJob(id))?.reviewed.updatedAt === updatedAt,
    { id: saved.id, updatedAt: saved.updatedAt });
   const rootRecovered = await page.evaluate(id => window.readFolderEditorJob(id), saved.id);
   assert.equal(rootRecovered.intervalMs, 300000, 'root recovery works with the folder editor unmounted');
   assert.deepEqual((await savedRows()).filter(isDownloads).map(row => [row.id, row.updatedAt]), [[saved.id, saved.updatedAt]], 'root recovery does not recreate or rewrite the config');
   await page.getByRole('button', { name: 'Reopen Files screen', exact: true }).click();
   await folder.getByRole('heading', { name: 'Downloads', exact: true }).first().waitFor();
   const leaf = rows.find(row => row.id === saved.crystal.remoteFolderId);
   assert.equal(leaf.crystal.name, 'Downloads');
   assert.equal(saved.crystal.propagateDeletes, false);
   const job = await page.evaluate(id => window.readFolderEditorJob(id), saved.id);
   assert.equal(job.reviewed.updatedAt, saved.updatedAt);
   assert.equal(job.intervalMs, 300000);
   await folder.getByRole('button', { name: 'Activity history', exact: true }).scrollIntoViewIfNeeded();
   await page.evaluate(id => window.recordFixtureSyncActivity(id), saved.id);
   await folder.getByText('Sent: 2.04 kB', { exact: true }).waitFor();
   assert.equal(await folder.getByText('Received: Unavailable', { exact: true }).count(), 1);
   await folder.getByRole('button', { name: 'Activity history', exact: true }).click();
   await folder.getByText('Finished', { exact: true }).waitFor();
   await page.screenshot({ path: join(evidence, `${label}-activity.png`), fullPage: true });
   await page.reload();
   await folder.getByRole('heading', { name: 'Downloads', exact: true }).first().waitFor();
   await add.click();
   assert.equal((await savedRows()).filter(isDownloads).length, 1);
   await folder.getByRole('button', { name: 'Add sync config', exact: true }).click();
   await layout.getByText('My sync config name', { exact: true }).waitFor();
   await name.fill('Downloads two-way');
   await direction.selectOption('two-way');
   assert.equal(await direction.inputValue(), 'two-way');
   assert.equal(await direction.locator('option[value="backup"]').textContent(), 'Backup to cloud');
   assert.equal((await savedRows()).find(row => row.id === saved.id).crystal.mode, 'backup');
   await folder.locator('summary:visible').filter({ hasText: /^Transfer options$/ }).click();
   await page.screenshot({ path: join(evidence, `${label}-multiple-configs.png`), fullPage: true });
   await page.evaluate(id => window.holdFixtureSyncTask(id), saved.id);
   await page.waitForFunction(id => window.syncInspectionFixture.task()?.scope.rootId === id && window.syncInspectionFixture.task()?.active, saved.id);
   const nativeBefore = await page.evaluate(() => window.syncInspectionFixture.observations.requests);
   await folder.getByRole('button', { name: 'Save & sync', exact: true }).click();
   const second = folder.locator('article').filter({ has: page.getByRole('heading', { name: 'Downloads two-way', exact: true }) });
   await second.getByText('Queued · checking folder access when the device is free.', { exact: true }).waitFor();
   const both = (await savedRows()).filter(isDownloads);
   assert.equal(both.length, 2);
   const twoWay = both.find(row => row.crystal.mode === 'two-way');
   assert.ok(twoWay && twoWay.crystal.remoteFolderId !== saved.crystal.remoteFolderId, 'each config keeps an independent destination');
   const queued = await page.evaluate(id => window.readFolderEditorJob(id), twoWay.id);
   assert.equal(queued.pendingFolderValidation, true);
   assert.equal(queued.reviewed.updatedAt, twoWay.updatedAt);
   assert.equal(await page.evaluate(() => window.syncInspectionFixture.observations.requests), nativeBefore, 'queuing does not compete for the native folder lane');
   await page.screenshot({ path: join(evidence, `${label}-queued-config.png`), fullPage: true });
   await page.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) { scrollTo(0, y); await new Promise(requestAnimationFrame); } scrollTo(0, 0); });
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   assert.deepEqual(errors, []);
   results.push({ label, firstDraft: true, privateDestination: true, durableAdmission: true, duplicatePrevention: true, nestedBuilderFields: true, separateDirections: true, queuedWhileBusy: true, measuredActivity: true, interruptedSetupRecovered: true });
  } catch (error) {
   await page.screenshot({ path: join(evidence, `${label}-failure.png`), fullPage: true });
   await writeFile(join(evidence, `${label}-failure.txt`), await page.locator('body').innerText());
   throw error;
  } finally { await context.close(); }
 }
 await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2));
 console.log(JSON.stringify({ evidence, results }));
} finally {
 await browser?.close();
 if (server) await new Promise(resolve => server.close(resolve));
 await rm(dir, { recursive: true, force: true });
}
