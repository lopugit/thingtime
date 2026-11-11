import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
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
   ['success', 'cas', 'uncertain', 'draft', 'identity', 'ios-managed', 'photo-destination', 'photo-policy', 'remote-iphone', 'paired-iphone',
    'auto-legacy', 'auto-budget', 'auto-budget-minimum', 'auto-charging', 'auto-identity', 'auto-settings', 'auto-unsupported', 'auto-offline-pause', 'native-only', 'native-activity']) {
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
    if (scenario === 'native-activity') {
     await page.goto(origin + '/?nativeOnly=1&nativeActivity=1');
     const state = () => page.evaluate(() => window.remoteSyncFixture.nativeOnlyState());
     const card = page.locator('[aria-label="Local sync"] article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
     await card.getByText('Last transfer finished.', { exact: true }).first().waitFor();
     assert.equal((await state()).nativeCalls.filter(call => call.continueInBackground).length, 0);
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoDiscovery(0));
     const liveDiscovery = card.locator('[data-block-id="folder-card-activity-indexing"]');
     await liveDiscovery.getByText('0 of 6 assets found', { exact: true }).waitFor();
     assert.equal(await liveDiscovery.getByText(/ files?$/).count(), 0, 'unmeasured inventory stays unknown');
     const captureLabel = (kind, date) => page.evaluate(({ kind, date }) =>
      `Found 1 ${kind} taken at ${new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' }).format(new Date(date))}`, { kind, date });
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoDiscovery(1));
     await liveDiscovery.getByText('1 of 6 assets found', { exact: true }).waitFor();
     await liveDiscovery.getByText('0 photos · 1 video · 1 file', { exact: true }).waitFor();
     await liveDiscovery.getByText(await captureLabel('video', '2026-11-08T01:02:03.000Z'), { exact: true }).waitFor();
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoDiscovery(2));
     await liveDiscovery.getByText('2 of 6 assets found', { exact: true }).waitFor();
     await liveDiscovery.getByText('1 photo · 1 video · 2 files', { exact: true }).waitFor();
     await liveDiscovery.getByText(await captureLabel('photo', '2026-11-08T00:04:05.000Z'), { exact: true }).waitFor();
     await page.screenshot({ path: join(evidence, `${label}-native-index-discovery.png`), fullPage: true });
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoDiscovery());
     await card.getByRole('button', { name: 'Back up now', exact: true }).click();
     const disclosure = card.locator('summary').filter({ hasText: 'Backup activity' });
     await disclosure.getByText('Downloading an original from iCloud', { exact: true }).waitFor();
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'arm-photo-run' && call.continueInBackground).length, 1);
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'run-photo-in-background').length, 0);
     await card.getByText('iOS didn’t start background processing. You can keep Thingtime open or try again.', { exact: true }).waitFor();
     await disclosure.focus();
     await page.keyboard.press('Enter');
     await card.getByRole('progressbar', { name: 'Current iCloud download' }).waitFor();
     assert.equal(await card.getByRole('progressbar', { name: 'Current iCloud download' }).getAttribute('value'), '0');
     assert.equal(await card.getByText('3 photos · 0 videos · 4 files', { exact: true }).isVisible(), true);
     assert.equal(await card.getByText('0 of 2', { exact: true }).isVisible(), true);
     assert.equal(await card.getByText('Originals in queue', { exact: true }).count(), 0);
     assert.deepEqual(await card.locator('[data-block-id="folder-card-activity-event-time"]').evaluateAll(elements => elements.map(element => element.title)),
      ['2026-11-08T00:00:02.000Z', '2026-11-08T00:00:00.000Z']);
     await page.screenshot({ path: join(evidence, `${label}-native-activity-open.png`), fullPage: true });
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoCloudPreparation(0.42));
     await disclosure.getByText('Uploading originals', { exact: true }).waitFor();
     await card.locator('progress[value="42"]').and(card.getByRole('progressbar', { name: 'Current iCloud download' })).waitFor();
     await page.screenshot({ path: join(evidence, `${label}-native-activity-concurrent.png`), fullPage: true });
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoCloudPreparation());
     await disclosure.getByText('Downloading an original from iCloud', { exact: true }).waitFor();
     const layout = card.locator('[data-settings-document="device-sync-folder-card"]');
     await enableCurrentPageBuilder(page);
     await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
     await layout.locator('[data-block-id="folder-card-activity-title"]').click();
     const selected = page.getByRole('combobox', { name: 'Select block', exact: true });
     assert.equal(await selected.inputValue(), 'folder-card-activity-title');
     await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('My backup activity');
     await selected.selectOption('folder-card-activity-event-time');
     assert.equal(await selected.inputValue(), 'folder-card-activity-event-time');
     await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Reported {item.time}');
     await page.getByRole('button', { name: 'Close builder', exact: true }).click();
     assert.equal(await layout.locator('[data-block-id="folder-card-activity-title"]').textContent(), 'My backup activity');
     await layout.getByRole('button', { name: 'Save layout', exact: true }).click();
     await layout.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
     const savedLayout = (await page.evaluate(() => window.remoteSyncFixture.state())).rows.find(row => row.crystal.pageKey === 'settings-device-sync-folder-card');
     assert.ok(JSON.stringify(savedLayout?.crystal.blocks)?.includes('My backup activity'));
     assert.ok(JSON.stringify(savedLayout?.crystal.blocks)?.includes('Reported {item.time}'));
     await page.reload();
     await card.locator('summary').filter({ hasText: 'My backup activity' }).click();
     const eventTime = await card.locator('[data-block-id="folder-card-activity-event-time"]').first().textContent();
     assert.ok(eventTime?.startsWith('Reported '));
     await card.getByRole('button', { name: 'Run in Background', exact: true }).click();
     await page.waitForFunction(() => window.remoteSyncFixture.nativeOnlyState().nativeCalls.filter(call => call.action === 'run-photo-in-background').length === 1);
     assert.equal((await state()).webTransfers.length, 0);
     await finish(); continue;
    }
    if (scenario === 'native-only') {
     await page.clock.install();
     await page.goto(origin + '/?nativeOnly=1');
     const state = () => page.evaluate(() => window.remoteSyncFixture.nativeOnlyState());
     const card = page.locator('[aria-label="Local sync"] article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
     await card.getByText('Waiting for the selected network.', { exact: true }).waitFor();
     await card.getByText('2 photos · 1 video confirmed', { exact: true }).waitFor();
     await card.getByText('3.5 MiB transfer traffic', { exact: true }).waitFor();
     await card.getByText('Wi-Fi 1 MiB · Mobile data 2 MiB · Network unknown 512 KiB', { exact: true }).waitFor();
     assert.equal(await card.getByText('Legacy WebView progress must stay hidden.', { exact: true }).count(), 0);
     await card.getByText('Upload speed unavailable', { exact: true }).waitFor();
     const backgroundAction = card.getByRole('button', { name: 'Run in Background', exact: true });
     assert.equal(await backgroundAction.count(), 0, 'a condition-blocked run cannot request background continuation');
     const initial = await state();
     assert.equal(initial.nativeFolderContentions, 0, 'launch discovery, folder access and native status share one slot');
     const due = await page.evaluate(() => window.remoteSyncFixture.nativeOnlyState().nativeRun.retryAt - Date.now());
     assert.ok(due > 0 && due <= 300_000);
     await page.clock.fastForward(due + 10);
     await card.getByText('5 Mbps live', { exact: true }).waitFor();
     await card.getByText('Current original: 2 B of 3 B sent', { exact: true }).waitFor();
     await card.getByText('2 photos · 1 video confirmed', { exact: true }).waitFor();
     assert.equal(await page.getByRole('button', { name: 'Add folder', exact: true }).isDisabled(), true);
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'run-photo-in-background').length, 0);
     const layout = card.locator('[data-settings-document="device-sync-folder-card"]');
     await enableCurrentPageBuilder(page);
     await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
     await layout.locator('[data-block-id="folder-card-background-help"]').click();
     const selected = page.getByRole('combobox', { name: 'Select block', exact: true });
     assert.equal(await selected.inputValue(), 'folder-card-background-help');
     await selected.selectOption('folder-card-background-action');
     assert.equal(await selected.inputValue(), 'folder-card-background-action');
     await page.getByRole('button', { name: 'Close builder', exact: true }).click();
     await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'run-photo-in-background').length, 0, 'Builder selection never requests background work');
     await page.screenshot({ path: join(evidence, `${label}-native-only-control.png`), fullPage: true });
     await backgroundAction.click();
     await card.getByText(/iOS didn’t start background processing/).waitFor();
     await backgroundAction.click();
     await card.getByText('Continuing this backup with iOS background processing.', { exact: true }).waitFor();
     await page.screenshot({ path: join(evidence, `${label}-native-only-active.png`), fullPage: true });
     await page.evaluate(() => window.remoteSyncFixture.expirePhotoContinuation());
     await card.getByText(/Background processing stopped/).waitFor();
     await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
     await page.clock.fastForward(301_000);
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'run-photo-in-background').length, 2,
      'a system hold never triggers another continuation request');
     await backgroundAction.click();
     await card.getByText('Continuing this backup with iOS background processing.', { exact: true }).waitFor();
     await page.evaluate(() => window.remoteSyncFixture.setAppHidden(true));
     const hidden = await state();
     await page.clock.fastForward(26_000);
     const background = await state();
     assert.equal(background.nativeCalls.length, hidden.nativeCalls.length, 'a hidden WebView does not read or execute the native queue');
     assert.equal(background.nativeRun.queueId, initial.nativeRun.queueId);
     assert.deepEqual(background.nativeRun.confirmedPayload, [7, 8, 9]);
     assert.equal(background.nativeRun.progress.confirmed.mobileBytes, 2_097_155);
     assert.deepEqual(background.webTransfers, []);
     assert.equal(background.nativeFolderContentions, 0);
     await page.evaluate(() => window.remoteSyncFixture.setAppHidden(false));
     await card.getByText('3 photos · 1 video confirmed', { exact: true }).waitFor();
     await card.getByText('Last transfer finished.', { exact: true }).waitFor();
     assert.equal(await card.getByText('5 Mbps live', { exact: true }).count(), 0);
     assert.equal(await backgroundAction.count(), 0, 'an up-to-date backup has no finite work to continue');
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'arm-photo-run').length, 1);
     await page.reload();
     await card.getByText('3 photos · 1 video confirmed', { exact: true }).waitFor();
     assert.equal((await state()).nativeRun.queueId, initial.nativeRun.queueId);
     assert.equal((await state()).nativeCalls.filter(call => call.action === 'arm-photo-run').length, 0);
     for (const reason of ['held', 'budget']) {
      await page.evaluate(reason => window.remoteSyncFixture.setNativePhotoWait(reason), reason);
      await page.reload();
      await card.getByText(reason === 'held' ? /Background processing stopped/ : /One upload part needs at least/).waitFor();
      await page.waitForFunction(() => window.remoteSyncFixture.nativeOnlyState().nativeCalls.filter(call => call.action === 'photo-run-status').length >= 3);
      await page.clock.runFor(500);
      assert.equal((await state()).nativeCalls.filter(call => call.action === 'arm-photo-run').length, 0,
       reason + ' wait does not renew the native run');
     }
     await page.evaluate(() => window.remoteSyncFixture.setNativePhotoWait('expired'));
     await page.reload();
     await card.getByText('Last transfer finished.', { exact: true }).waitFor();
     const renewed = await state();
     assert.equal(renewed.nativeCalls.filter(call => call.action === 'arm-photo-run').length, 1);
     assert.equal(renewed.nativeRun.queueId, initial.nativeRun.queueId);
     assert.deepEqual(renewed.nativeRun.confirmedPayload, [7, 8, 9]);
     assert.equal(renewed.nativeRun.progress.confirmed.mobileBytes, 2_097_155);
     assert.deepEqual(renewed.webTransfers, []);
     await card.getByRole('button', { name: 'Pause sync', exact: true }).click();
     await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
     await page.reload();
     await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
     await page.clock.fastForward(310_000);
     assert.equal((await state()).nativeRun.progress.stage, 'paused');
     assert.deepEqual((await state()).webTransfers, []);
     await finish();
     await page.evaluate(() => window.remoteSyncFixture.changeIdentity());
     await card.waitFor({ state: 'detached' });
     continue;
    }
    if (scenario.startsWith('auto-')) {
     const variants = {
      'auto-legacy': '&legacyJob=1&inactive=1', 'auto-budget': '&budget=1',
      'auto-budget-minimum': '&minimumBudget=1',
      'auto-charging': '&chargingOnly=1', 'auto-identity': '&inactive=1',
      'auto-settings': '&paused=1', 'auto-unsupported': '&oldPhotoApp=1', 'auto-offline-pause': '&offlinePause=1'
     };
     await page.clock.install();
     await page.goto(origin + '/?autoPhotos=1' + variants[scenario]);
     const card = page.locator('[aria-label="Local sync"] article').filter({ has: page.getByRole('heading', { name: 'iPhone Photos', exact: true }) });
     await card.waitFor();
     const state = () => page.evaluate(() => window.remoteSyncFixture.photoRecovery());
     const assertPublished = async () => {
      await card.getByText('Last transfer finished.', { exact: true }).first().waitFor();
      await card.getByText(/Next automatic check at/).waitFor();
      const done = await state();
      assert.deepEqual(done.uploaded, [{ folderId: 'fixture-folder-0', bytes: [7, 8, 9] }]);
      assert.equal(done.files.length, 1);
      assert.equal(done.job.reviewed.configuration.network, 'any');
      assert.equal(done.job.reviewed.configuration.chargingOnly, scenario === 'auto-charging');
      assert.equal(done.job.intervalMs, 300_000);
      return done;
     };
     if (scenario === 'auto-legacy' || scenario === 'auto-identity') {
      await card.getByText(/Waiting for Thingtime to become active/).waitFor();
      assert.equal(await card.getByRole('alert').count(), 0, 'inactive is a waiting condition');
      assert.equal(await card.getByRole('button', { name: 'Retry transfer', exact: true }).count(), 0);
      assert.equal((await state()).uploaded.length, 0);
      if (scenario === 'auto-identity') {
       await page.evaluate(() => window.remoteSyncFixture.changeIdentity());
       await card.waitFor({ state: 'detached' });
       await page.evaluate(() => window.remoteSyncFixture.returnToApp());
       await page.clock.fastForward(330_000);
       assert.equal((await state()).uploaded.length, 0);
      } else {
       await page.screenshot({ path: join(evidence, `${label}-auto-inactive.png`), fullPage: true });
       await page.evaluate(() => window.remoteSyncFixture.returnToApp());
       const completed = await assertPublished();
       const scanCount = completed.events.filter(event => event.type === 'scan-capture').length;
       const until = await page.evaluate(async () => (await window.remoteSyncFixture.photoRecovery()).job.nextRunAt - Date.now());
       assert.ok(until > 0 && until <= 300_000);
       await page.clock.fastForward(until + 30_000);
       await page.waitForFunction(count => window.remoteSyncFixture.photoScanCount() > count, scanCount);
       assert.equal((await state()).uploaded.length, 1, 'next scheduled cycle does not reupload a committed original');
       await card.getByRole('button', { name: 'Pause sync', exact: true }).click();
       await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
       const paused = await page.evaluate(() => window.remoteSyncFixture.state().rows);
       assert.equal(paused.find(row => row.id === 'documents-sync').crystal.paused, true);
       assert.equal(paused.find(row => row.id === 'home-sync').crystal.paused, true);
       assert.equal(paused.find(row => row.id === 'home-sync').crystal.localRootId, 'no-grant');
       await page.reload();
       await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
       await page.clock.fastForward(330_000);
       assert.equal((await state()).events.filter(event => event.type === 'scan-capture' || event.type === 'upload-file').length, 0);
       assert.equal((await state()).files.length, 1);
      }
     } else if (scenario === 'auto-budget') {
      await card.getByText('Hourly upload budget reached.', { exact: true }).waitFor();
      await card.getByText(/Uploads can resume after/).waitFor();
      assert.equal((await state()).uploaded.length, 0);
      assert.equal(await card.getByRole('button', { name: 'Check again', exact: true }).count(), 0);
      const before = await page.evaluate(async () => (await window.remoteSyncFixture.photoRecovery()).job.retryAt - Date.now());
      assert.ok(before > 0 && before <= 300_000);
      await page.screenshot({ path: join(evidence, `${label}-auto-budget-wait.png`), fullPage: true });
      await page.evaluate(() => window.remoteSyncFixture.clearDataBudget());
      await page.clock.fastForward(before - 1_000);
      assert.equal((await state()).uploaded.length, 0);
      await page.clock.fastForward(31_000);
      await assertPublished();
     } else if (scenario === 'auto-budget-minimum') {
      await card.getByText(/One upload part needs at least .*bytes/).waitFor();
      assert.equal(await card.getByText(/Uploads can resume after/).count(), 0);
      assert.equal((await state()).uploaded.length, 0);
      await card.getByRole('button', { name: 'Expand folder', exact: true }).click();
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      await card.locator('summary').filter({ hasText: /^Resource limits$/ }).click();
      await card.getByRole('combobox', { name: 'Hourly data unit', exact: true }).selectOption('GB');
      await card.getByRole('textbox', { name: 'Upload data per hour', exact: true }).fill('1');
      await card.getByRole('button', { name: 'Save sync config', exact: true }).click();
      const done = await assertPublished();
      assert.equal(done.job.reviewed.configuration.photoAutomation.uploadBytesPerHour, 1_000_000_000);
     } else if (scenario === 'auto-charging') {
      await card.getByText(/Waiting for this device to charge/).waitFor();
      assert.equal((await state()).events.some(event => event.type === 'scan-capture'), false);
      await page.evaluate(() => window.remoteSyncFixture.setCharging(true));
      await assertPublished();
     } else if (scenario === 'auto-unsupported') {
      await card.getByText(/Update Thingtime on this iPhone to use automatic backup/).waitFor();
      assert.equal(await card.getByRole('button', { name: 'Start backup', exact: true }).isEnabled(), true);
      await page.clock.fastForward(330_000);
      assert.equal((await state()).job, null);
      assert.equal((await state()).events.some(event => event.type === 'scan-capture'), false);
     } else if (scenario === 'auto-offline-pause') {
      assert.equal((await state()).job, null);
      await page.evaluate(() => window.remoteSyncFixture.disconnectForPause());
      await card.getByRole('button', { name: 'Pause sync', exact: true }).click();
      await card.getByText('Backup is paused on this iPhone. The account could not confirm the pause.', { exact: true }).waitFor();
      assert.equal((await state()).job.state, 'paused');
      await page.reload();
      await card.getByRole('button', { name: 'Resume automatic backup', exact: true }).waitFor();
      await page.clock.fastForward(330_000);
      assert.equal((await state()).events.some(event => event.type === 'scan-capture' || event.type === 'upload-file'), false);
      assert.equal((await state()).job.state, 'paused');
     } else {
      const expand = card.getByRole('button', { name: 'Expand folder', exact: true });
      await expand.click();
      await card.getByRole('button', { name: 'Edit', exact: true }).click();
      const disclosure = card.locator('summary').filter({ hasText: /^Resource limits$/ });
      await disclosure.click();
      const speed = card.getByRole('textbox', { name: 'Maximum upload speed', exact: true });
      const notifications = card.getByRole('textbox', { name: 'Progress notification interval (minutes)', exact: true });
      assert.equal(await notifications.inputValue(), '30');
      const layout = card.locator('[data-settings-document="photo-backup-automation-controls"]');
      await enableCurrentPageBuilder(page);
      await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await layout.locator('[data-block-id="speed-label"]').click();
      const blocks = page.getByRole('combobox', { name: 'Select block', exact: true });
      await blocks.selectOption('speed-input');
      assert.equal(await blocks.inputValue(), 'speed-input');
      await blocks.selectOption('notification-interval-ms-input');
      assert.equal(await blocks.inputValue(), 'notification-interval-ms-input');
      await page.getByRole('button', { name: 'Close builder', exact: true }).click();
      await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
      await speed.fill('5');
      await card.getByRole('combobox', { name: 'Upload speed unit', exact: true }).selectOption('MB/s');
      assert.equal(await speed.inputValue(), '0.625');
      await card.getByRole('combobox', { name: 'Hourly data unit', exact: true }).selectOption('GB');
      const budget = card.getByRole('textbox', { name: 'Upload data per hour', exact: true });
      await budget.fill('-');
      assert.equal(await card.getByRole('button', { name: 'Save sync config', exact: true }).isDisabled(), true);
      await card.getByRole('button', { name: 'Collapse folder', exact: true }).click();
      await page.reload();
      await expand.click();
      await disclosure.click();
      assert.equal(await budget.inputValue(), '-');
      await budget.fill('1');
      await notifications.fill('0');
      await page.screenshot({ path: join(evidence, `${label}-auto-settings-open.png`), fullPage: true });
      await card.getByRole('button', { name: 'Save sync config', exact: true }).click();
      await card.getByRole('button', { name: 'Save sync config', exact: true }).waitFor({ state: 'hidden' });
      const row = await page.evaluate(() => window.remoteSyncFixture.state().rows.find(row => row.id === 'documents-sync'));
      assert.equal(row.crystal.configurationVersion, 4);
      assert.deepEqual(row.crystal.photoAutomation, { uploadBytesPerSecond: 625_000, uploadBytesPerHour: 1_000_000_000, notificationIntervalMs: 0 });
      assert.equal(row.crystal.paused, true);
      assert.equal(row.crystal.network, 'any');
      assert.equal(row.crystal.chargingOnly, false);
      assert.equal((await state()).job, null);
     }
     await finish();
     continue;
    }
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
      await accountCard.getByRole('button', { name: 'Save sync config', exact: true }).click();
      await accountCard.getByRole('button', { name: 'Save sync config', exact: true }).waitFor({ state: 'hidden' });
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
     await page.goto(origin + (scenario === 'paired-iphone' ? '/?mobilePanel=1&folderAccessInactive=1' : '/?remoteMobile=1'));
     await page.locator('summary').filter({ hasText: 'Manage folders & sync configs' }).click();
     if (scenario === 'paired-iphone') {
      await page.waitForFunction(() => window.remoteSyncFixture.pairing().pending);
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.remoteSyncFixture.deliverPause(); });
      await page.getByRole('heading', { name: 'Folders & sync configs', exact: true }).waitFor();
      await page.getByText('Folder access will refresh when Thingtime is active.', { exact: true }).waitFor();
      await page.evaluate(() => window.remoteSyncFixture.returnToApp());
      await page.getByText('Folder access will refresh when Thingtime is active.', { exact: true }).waitFor({ state: 'hidden' });
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
      const draft = card.getByRole('textbox', { name: 'Sync config name', exact: true });
      await draft.fill('Unsaved iPhone draft');
      const reads = await page.evaluate(() => window.remoteSyncFixture.state().connectionLists);
      await page.getByRole('button', { name: 'Refresh settings', exact: true }).click();
      await page.waitForFunction(reads => window.remoteSyncFixture.state().connectionLists > reads, reads);
      assert.equal(await draft.inputValue(), 'Unsaved iPhone draft');
      assert.equal(await page.getByRole('button', { name: /^(Refresh device|Start backup|Pause sync|Add folder)$/ }).count(), 0);
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
    await page.locator('summary').filter({ hasText: 'Manage folders & sync configs' }).click();
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
     await card.getByRole('textbox', { name: 'Sync config name', exact: true }).fill('Unfinished retained draft');
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
