import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-explicit-sync-start-ui'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-explicit-sync-start-'));
let browser, server;
const results = [], errors = [];
try {
 await mkdir(evidence, { recursive: true });
 await esbuild.build({ entryPoints: [join(root, 'scripts/remote-device-sync.browser.tsx')], bundle: true, format: 'esm',
  platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>Remote device sync regression</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const origin = `http://127.0.0.1:${server.address().port}`;
 browser = await createRequire(join(root, '../MCP/package.json'))('playwright').chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : process.platform === 'linux' ? { executablePath: '/usr/bin/chromium' } : {}) });
 for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
  for (const scenario of process.env.TT_PHOTO_DESTINATION_TEST ? ['photo-destination'] : process.env.TT_SYNC_UI_SCENARIOS?.split(',') ??
   ['success', 'cas', 'uncertain', 'draft', 'identity', 'ios-managed', 'photo-destination', 'photo-policy', 'remote-iphone', 'paired-iphone']) {
   const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
   await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
   const page = await context.newPage(); page.setDefaultTimeout(12_000); page.on('pageerror', error => errors.push(error.message));
   try {
    const finish = async () => {
     await page.screenshot({ path: join(evidence, `${label}-${scenario}.png`), fullPage: true });
     await page.evaluate(async () => { for (let y=0; y<document.documentElement.scrollHeight; y+=innerHeight) { scrollTo(0,y); await new Promise(requestAnimationFrame); } });
     assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
     results.push({ viewport: label, scenario, passed: true });
    };
    if (scenario === 'photo-destination' || scenario === 'photo-policy') {
     const editing = scenario === 'photo-policy';
     await page.goto(origin + '/?photoRecovery=1' + (editing ? '&editPhotos=1' : ''));
     const card = page.locator('[aria-label="Local sync"] article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
     await card.getByText(/An unfinished sync job belongs to different settings/).waitFor();
     if (editing) {
      const accountCard = page.locator('[aria-label="Account settings"] article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
      await accountCard.getByRole('button', { name: 'Expand folder', exact: true }).click();
      await accountCard.getByRole('button', { name: 'Edit', exact: true }).click();
      await accountCard.locator('summary').filter({ hasText: /^Transfer options$/ }).click();
      await accountCard.getByRole('combobox', { name: 'Network', exact: true }).selectOption('any');
      await accountCard.getByText('Only while charging', { exact: true }).click();
      assert.equal(await accountCard.getByRole('checkbox', { name: 'Only while charging', exact: true }).isChecked(), true);
      await accountCard.getByRole('button', { name: 'Save connection', exact: true }).click();
      await accountCard.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
      const state = await page.evaluate(() => window.remoteSyncFixture.state());
      assert.equal(state.writes, 1);
      assert.equal(state.rows.find(row => row.id === 'documents-sync').crystal.remoteFolderId, 'fixture-folder-0');
      assert.equal(state.commands.length, 0, 'account settings save never dispatches a Mac worker command to iOS');
     }
     await card.getByRole('button', { name: 'Retry transfer', exact: true }).click();
     await card.getByText(editing ? /Waiting for this device to charge/ : /Waiting for Wi-Fi\. Connect to Wi-Fi to continue/).first().waitFor();
     const { events, job, oldPhotoEpoch } = await page.evaluate(() => window.remoteSyncFixture.photoRecovery());
     const cancel = events.findIndex(event => event.type === 'cancel-deferred-upload');
     const waiting = events.findIndex(event => event.type === 'conditions');
     assert.ok(cancel > 0 && waiting > cancel);
     assert.deepEqual(events[cancel], { type: 'cancel-deferred-upload', rootId: '4d3c4fd6-6232-4b07-9c9d-3bfd3550437a',
      configurationId: 'documents-sync', deviceId: 'sync-iphone', jobId: 'previous-photos-job' });
     assert.ok(events.slice(0, cancel).some(event => event.type === 'destination'));
     assert.ok(events.slice(cancel + 1, waiting).some(event => event.type === 'configuration'));
     assert.ok(events.every(event => ['list', 'configuration', 'destination', 'cancel-deferred-upload', 'conditions'].includes(event.type)));
     assert.notEqual(job.id, 'previous-photos-job');
     assert.ok(job.photoQueueEpoch && job.photoQueueEpoch !== oldPhotoEpoch);
     assert.equal(job.reviewed.configuration.remoteFolderId, 'fixture-folder-0');
     assert.equal(job.reviewed.configuration.network, editing ? 'any' : 'wifi');
     assert.equal(job.reviewed.configuration.paused, false);
     if (editing) {
      const saved = await page.evaluate(() => window.remoteSyncFixture.state().rows.find(row => row.id === 'documents-sync'));
      assert.equal(job.reviewed.updatedAt, saved.updatedAt, 'the first local Retry uses the revision saved in the account editor');
      assert.equal(job.reviewed.configuration.chargingOnly, true);
      await page.screenshot({ path: join(evidence, `${label}-waiting-for-power.png`), fullPage: true });
      await page.evaluate(() => window.remoteSyncFixture.setCharging(true));
      await card.getByRole('button', { name: 'Check again', exact: true }).click();
      await card.getByText('Last transfer finished.', { exact: true }).first().waitFor();
      const done = await page.evaluate(() => window.remoteSyncFixture.photoRecovery());
      assert.deepEqual(done.uploaded, [{ folderId: 'fixture-folder-0', bytes: [7, 8, 9] }]);
      assert.equal(done.files.length, 1);
      assert.equal(done.files[0].folderId, 'fixture-folder-0');
      assert.equal(done.job.id, job.id, 'retry after power is restored resumes the same admission');
      assert.equal(done.job.state, 'complete');
      await page.screenshot({ path: join(evidence, `${label}-photo-finished.png`), fullPage: true });
      await page.evaluate(() => window.remoteSyncFixture.changeElsewhere());
      await card.getByRole('button', { name: 'Start backup', exact: true }).click();
      const changed = page.locator('[aria-label="Local sync"] article').filter({ has: page.getByRole('heading', { name: 'Changed on another browser', exact: true }) });
      await changed.getByText(/This connection changed elsewhere.*No transfer was started/).waitFor();
      assert.equal((await page.evaluate(() => window.remoteSyncFixture.photoRecovery())).uploaded.length, 1);
     }
     await finish();
     continue;
    }
    if (scenario === 'remote-iphone' || scenario === 'paired-iphone') {
     await page.goto(origin + (scenario === 'paired-iphone' ? '/?mobilePanel=1' : '/?remoteMobile=1'));
     await page.locator('summary').filter({ hasText: 'Manage sync connections' }).click();
     if (scenario === 'paired-iphone') {
      await page.waitForFunction(() => window.remoteSyncFixture.pairing().pending);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.remoteSyncFixture.deliverPause(); });
      const jump = page.getByRole('link', { name: 'Go to this device’s sync controls', exact: true });
      await jump.click();
      await page.waitForFunction(() => document.activeElement?.id === 'local-mobile-sync');
      assert.equal(await page.getByRole('button', { name: 'Start backup', exact: true }).first().isEnabled(), true);
      assert.equal(await page.getByText(/Device connection paused/).count(), 0);
      assert.equal(await page.getByText('iPhone · downloads received', { exact: true }).filter({ visible: true }).count(), 2);
      assert.equal((await page.evaluate(() => window.remoteSyncFixture.pairing())).reads, 2, 'one foreground status recheck, no re-pair');
     } else {
      const card = page.locator('article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
      await card.getByText('iPhone · downloads received', { exact: true }).waitFor();
      await page.getByText('Edit saved settings here. To start, pause, or check a transfer, open Thingtime on the device.', { exact: true }).waitFor();
      await card.getByRole('button', { name: 'Expand folder', exact: true }).click();
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      const draft = card.getByRole('textbox', { name: 'Connection name', exact: true });
      await draft.fill('Unsaved iPhone draft');
      const reads = await page.evaluate(() => window.remoteSyncFixture.state().connectionLists);
      await page.getByRole('button', { name: 'Refresh settings', exact: true }).click();
      await page.waitForFunction(reads => window.remoteSyncFixture.state().connectionLists > reads, reads);
      assert.equal(await draft.inputValue(), 'Unsaved iPhone draft');
      assert.equal(await page.getByRole('button', { name: /^(Refresh device|Start backup|Pause sync|Choose device folder)$/ }).count(), 0);
      assert.equal(await page.getByText('Device offline', { exact: true }).count(), 0);
      await finish();
      await page.evaluate(() => window.remoteSyncFixture.changeIdentity());
      await draft.waitFor({ state: 'detached' });
      assert.equal((await page.evaluate(() => window.remoteSyncFixture.state())).writes, 0);
      assert.equal((await page.evaluate(() => window.remoteSyncFixture.state())).commands.length, 0);
      continue;
     }
     await finish();
     continue;
    }
    await page.goto(origin + '/?paused=1' + (scenario === 'ios-managed' ? '&iosResources=1' : ''));
    await page.locator('summary').filter({ hasText: 'Manage sync connections' }).click();
    await page.getByRole('button', { name: 'Refresh device', exact: true }).waitFor();
    await page.evaluate(() => window.remoteSyncFixture.setOnline(true));
    await page.getByRole('button', { name: 'Refresh device', exact: true }).click();
    const target = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Documents backup', exact: true }) });
    const home = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Home backup', exact: true }) });
    const start = target.getByRole('button', { name: 'Start backup', exact: true });
    await start.waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('article')].some(article => article.querySelector('h4')?.textContent === 'Documents backup' && [...article.querySelectorAll('button')].some(button => button.textContent === 'Start backup' && !button.disabled)));
    const before = await page.evaluate(() => window.remoteSyncFixture.state());
    assert.equal(before.rows.find(row => row.id === 'documents-sync').crystal.paused, true);
    assert.equal(before.commands.filter(command => command.action === 'start').length, 0, 'opening paused cards never starts or unpauses them');
    if (scenario === 'draft' || scenario === 'success') {
     const card = scenario === 'draft' ? target : home;
     await card.getByRole('button', { name: 'Expand folder', exact: true }).click();
     await card.getByRole('button', { name: 'Edit', exact: true }).click();
     await card.getByRole('textbox', { name: 'Connection name', exact: true }).fill('Unfinished retained draft');
     await card.getByRole('button', { name: 'Collapse folder', exact: true }).click();
    }
    if (scenario === 'ios-managed') {
     await target.getByRole('button', { name: 'Expand folder', exact: true }).click();
     await target.getByRole('button', { name: 'Edit', exact: true }).click();
     await target.locator('summary').filter({ hasText: /^Resource limits$/ }).click();
     await target.getByText(/iOS manages scheduling/).waitFor();
     assert.equal(await target.getByRole('textbox', { name: 'Upload speed', exact: true }).isDisabled(), true);
     await target.getByRole('button', { name: 'Discard draft', exact: true }).click();
    }
    if (scenario === 'draft') {
     assert.equal(await start.isDisabled(), true);
     const state = await page.evaluate(() => window.remoteSyncFixture.state());
     assert.equal(state.resumeWrites.length, 0); assert.equal(state.commands.filter(command => command.action === 'start').length, 0);
     assert.equal(state.rows.find(row => row.id === 'documents-sync').crystal.paused, true);
    } else {
     if (!['success', 'ios-managed'].includes(scenario)) await page.evaluate(mode => window.remoteSyncFixture.failResume(mode), scenario);
     await start.click();
     if (scenario === 'success' || scenario === 'ios-managed') {
      await page.waitForFunction(() => window.remoteSyncFixture.state().commands.some(command => command.action === 'start' && command.connectionId === 'documents-sync'));
      const state = await page.evaluate(() => window.remoteSyncFixture.state());
      assert.equal(state.rows.find(row => row.id === 'documents-sync').crystal.paused, false);
      assert.deepEqual(state.resumeWrites.map(write => write.id), ['documents-sync']);
      assert.deepEqual(state.rows.filter(row => row.id !== 'documents-sync'), before.rows.filter(row => row.id !== 'documents-sync'));
      assert.equal(state.rows.find(row => row.id === 'home-sync').crystal.paused, true);
      if (scenario === 'success') assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith('tt:sync-editor:') && localStorage.getItem(key).includes('Unfinished retained draft'))), true);
      if (scenario === 'ios-managed') {
       await page.getByText(/iOS manages scheduling/).first().waitFor();
       assert.equal(await page.getByRole('spinbutton', { name: 'CPU target (%)', exact: true }).count(), 0);
       assert.equal(await page.getByText(/512 MiB indexer budget/).count(), 0);
       assert.equal(await page.getByText(/15% target/).count(), 0);
      }
      await target.getByRole('button', { name: 'Pause sync', exact: true }).click();
     } else if (scenario === 'identity') {
      await page.waitForFunction(() => window.remoteSyncFixture.state().identityPending);
      const state = await page.evaluate(() => window.remoteSyncFixture.state());
      assert.equal(state.resumeWrites.length, 0); assert.equal(state.commands.filter(command => command.action === 'start').length, 0);
     } else {
      await page.getByText(scenario === 'cas' ? /This connection changed elsewhere/ : /Resume could not be confirmed/).first().waitFor();
      const state = await page.evaluate(() => window.remoteSyncFixture.state());
      assert.equal(state.commands.filter(command => command.action === 'start').length, 0);
      assert.equal(state.rows.find(row => row.id === 'documents-sync').crystal.paused, scenario === 'cas');
      assert.equal(state.rows.find(row => row.id === 'home-sync').crystal.paused, true);
      if (scenario === 'uncertain') {
       await start.click(); await page.getByText(/This connection changed elsewhere/).first().waitFor();
       assert.equal((await page.evaluate(() => window.remoteSyncFixture.state())).resumeWrites.length, 1, 'retry never blindly repeats an uncertain resume save');
      }
     }
    }
    await finish();
   } catch(error) {
    await page.screenshot({ path: join(evidence, `${label}-${scenario}-failure.png`), fullPage: true }).catch(()=>{});
    if (scenario.startsWith('photo-')) console.error(await page.locator('[aria-label="Local sync"] [role="alert"]').allTextContents(), errors);
    throw error;
   }
   finally { await context.close(); }
  }
 }
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
 console.log(JSON.stringify({ ok: true, results, evidence }));
} finally {
 await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true });
}
