import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
export async function runSyntheticBackupWorkspace(evidence = join(tmpdir(), 'thingtime-backup-workspace-ui')) {
 evidence = resolve(evidence);
const dir = await mkdtemp(join(tmpdir(), 'thingtime-backup-workspace-'));
let browser, server;
const results = [], errors = [];
try {
 await mkdir(evidence, { recursive: true });
 await esbuild.build({ entryPoints: [join(root, 'scripts/backup-workspace.browser.tsx')], bundle: true, format: 'esm',
  platform: 'browser', target: 'esnext', outfile: join(dir, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const bundle = await readFile(join(dir, 'fixture.js'));
 server = createServer((request, response) => {
  response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
  response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>Backup workspace synthetic composition</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
 });
 server.listen(0, '127.0.0.1'); await once(server, 'listening');
 const origin = `http://127.0.0.1:${server.address().port}`;
 browser = await (process.env.PLAYWRIGHT_MODULE_PATH ? require(process.env.PLAYWRIGHT_MODULE_PATH) : createRequire(join(root, '../MCP/package.json'))('playwright')).chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : process.platform === 'linux' ? { executablePath: '/usr/bin/chromium' } : {}) });

 for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  try {
   await page.goto(origin);
   await page.locator('summary').filter({ hasText: 'Saved snapshots' }).click();
   await page.getByRole('button', { name: 'Independent backup storage · configured-unverified', exact: true }).click();
   await page.getByText('Background processing will be checked when work starts', { exact: true }).waitFor();
   assert.equal(await page.getByRole('button', { name: 'Create snapshot', exact: true }).isEnabled(), true);
   await page.getByRole('button', { name: 'Create snapshot', exact: true }).click();
   await page.getByRole('button', { name: 'Browse contents', exact: true }).click();
   await page.getByRole('checkbox').first().check();
   assert.equal(await page.getByRole('checkbox').last().isDisabled(), true);
   await page.getByRole('button', { name: 'Choose destination', exact: true }).click();
   await page.getByRole('button', { name: 'Recovered', exact: true }).click();
   await page.getByRole('button', { name: 'Restore into this folder', exact: true }).click();
   assert.equal(await page.getByRole('button', { name: 'Close folder picker', exact: true }).isVisible(), false);
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
   await page.locator('summary').filter({ hasText: 'Saved snapshots' }).click();
   await page.locator('summary').filter({ hasText: 'Saved snapshots' }).click();
   assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
   await page.getByRole('button', { name: 'Review restore', exact: true }).click();
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   assert.equal(await page.locator('details').last().getAttribute('open'), null);
   await page.locator('summary').filter({ hasText: 'Details & limitations' }).click();
   await page.getByText('Whole-account restore is unsupported.', { exact: true }).waitFor();
   await page.evaluate(() => window.backupFixture.workerUnverified());
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   assert.equal(await page.getByRole('button', { name: 'Restore selection', exact: true }).isEnabled(), true);
   await page.evaluate(() => window.backupFixture.workerUnavailable());
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   assert.equal(await page.getByRole('button', { name: 'Restore selection', exact: true }).isDisabled(), true);
   await page.evaluate(() => window.backupFixture.workerAvailable());
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   assert.equal(await page.getByRole('button', { name: 'Restore selection', exact: true }).isEnabled(), true);
   await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   await page.screenshot({ path: join(evidence, label + '-review.png'), fullPage: true });
   await page.getByRole('button', { name: 'Restore selection', exact: true }).click();
   await page.locator('summary').filter({ hasText: 'Backup & restore activity' }).click();
   await page.locator('button').filter({ hasText: /^Pause$/ }).and(page.locator(':enabled')).click();
   await page.getByRole('button', { name: 'Resume', exact: true }).and(page.locator(':enabled')).click();
   await page.getByRole('button', { name: 'Cancel job', exact: true }).and(page.locator(':enabled')).click();
   await page.evaluate(() => window.backupFixture.failNext());
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   await page.getByRole('alert').filter({ hasText: 'Storage temporarily unavailable' }).waitFor();
   assert.equal(await page.getByRole('checkbox').first().isChecked(), true);
   await page.getByRole('button', { name: 'Refresh', exact: true }).click();
   await page.evaluate(() => window.scrollTo(0, 0));
   await page.keyboard.press('Tab');
   assert.equal(await page.evaluate(() => document.activeElement !== document.body), true);
   await page.screenshot({ path: join(evidence, label + '-activity.png'), fullPage: true });
   await page.evaluate(() => window.backupFixture.changeIdentity());
   await page.getByRole('heading', { name: 'Backups', exact: true }).waitFor({ state: 'hidden' });
   results.push({ label, originalPaths: true, coverageSeparate: true, editableFieldStructureUnitChecked: true, selectionRetainedOnRefreshAndError: true, collapsedDetails: true, pauseRetry: true, noOverflow: true, identityCleared: true, syntheticOnly: true });
  } catch (error) { await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }); await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText()); throw error; } finally { await context.close(); }
 }
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
 console.log(JSON.stringify({ results, errors, evidence }));
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }

}

/** Build once into the server-owned temporary directory. No listener or backend
 * is created here; the canonical disposable runner serves these assets. */
export async function buildBackupWorkspaceBrowser(directory) {
 await mkdir(directory, { recursive: true });
 await esbuild.build({ entryPoints: [join(root, 'scripts/backup-workspace.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(directory, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const html = '<!doctype html><meta charset="utf-8"><title>[LC] Backup workspace isolated acceptance</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>';
 await writeFile(join(directory, 'index.html'), html);
 return { bundlePath: join(directory, 'fixture.js'), htmlPath: join(directory, 'index.html') };
}

/** All credentials belong to the disposable runner and remain transient.
 * verifyRestored is the runner's independent API/file/history oracle. */
export async function runBackupWorkspaceHttpAcceptance({ origin, account, deviceId, sourceRootId, evidence, verifyRestored, exerciseRecovery = false }) {
 assert.equal(new URL(origin).hostname, '127.0.0.1');
 assert.equal(new URL(origin).port, '28176');
 assert.ok(account?.id && deviceId && sourceRootId && typeof verifyRestored === 'function');
 await mkdir(evidence, { recursive: true });
 const playwright = process.env.PLAYWRIGHT_MODULE_PATH ? require(process.env.PLAYWRIGHT_MODULE_PATH) : createRequire(join(root, '../MCP/package.json'))('playwright');
 const browser = await playwright.chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
 const results = [], errors = [];
 try {
  for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
   const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
   const page = await context.newPage(); page.setDefaultTimeout(20000);
   page.on('pageerror', error => errors.push(error.message));
   const headers = { Origin: origin, 'X-Thingtime-Expected-Actor': account.id, 'X-Thingtime-Expected-Data-Plane': 'home' };
   const read = async path => { const response = await context.request.get(origin + path, { headers }); assert.equal(response.ok(), true, `GET ${path} failed with ${response.status()}`); return response.json(); };
   const submit = async (path, data) => { const response = await context.request.post(origin + path, { headers, data }); assert.equal(response.ok(), true, `POST ${path} failed with ${response.status()}`); return response.json(); };
   const waitJob = async (id, expected = 'completed') => {
    const deadline = Date.now() + 180000;
    for (;;) {
     const value = (await read('/api/v1/backups/workspace?view=job&id=' + encodeURIComponent(id))).job;
     if (value.status === expected || ['completed', 'cancelled', 'needs-attention'].includes(value.status)) { assert.equal(value.status, expected, `Backup ${value.kind} stopped: ${value.issue || value.status}`); return value; }
     assert.ok(Date.now() < deadline, 'Durable job did not finish before acceptance deadline');
     await new Promise(done => setTimeout(done, 1000));
    }
   };
   const clickCommand = async (name, action, jobId) => {
    const response = page.waitForResponse(response => response.url() === origin + '/api/v1/backups/workspace' && response.request().method() === 'POST' && response.request().postDataJSON()?.action === action);
    const control = page.getByRole('button', { name, exact: true });
    await (jobId ? control.and(page.locator('[data-tt-action-inputs*=' + JSON.stringify('"id":"' + jobId + '"') + ']')) : control).click();
    const accepted = await response; assert.equal(accepted.ok(), true, `UI ${action} admission failed`);
    const result = await accepted.json(); assert.ok(result.ok && result.job?.id); return result.job;
   };
   const scroll = async suffix => {
    await page.evaluate(() => scrollTo(0, 0)); let previous = -1;
    for (;;) {
     const state = await page.evaluate(() => ({ top: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight, width: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
     assert.ok(state.width <= state.viewportWidth, `${label} ${suffix}: horizontal overflow`);
     if (state.top + state.viewport >= state.height - 1) break;
     assert.notEqual(state.top, previous, 'Page stopped scrolling before bottom'); previous = state.top;
     await page.evaluate(() => scrollBy(0, Math.max(200, innerHeight * 0.7)));
    }
    await page.screenshot({ path: join(evidence, label + '-' + suffix + '.png'), fullPage: true });
   };
   try {
    const login = await context.request.post(origin + '/api/v1/login', { headers: { Origin: origin }, data: { username: account.username, password: account.password } });
    assert.equal(login.ok(), true, 'Disposable account sign-in failed');
    const logged = await login.json(); assert.equal(logged.ok, true); assert.equal((await read('/api/v1/auth/me')).user?.id, account.id);
    const destinationName = `Recovered ${label} ${randomUUID().slice(0, 8)}`;
    const created = await submit('/api/v1/things', { shareId: randomUUID(), thingtime: ['folder'], crystal: { name: destinationName }, acl: ['tt:user'] });
    assert.ok(created.ok && created.thing?.timelineHeadId); const destinationId = created.thing.id;
    const entryUrl = origin + '/?acceptance=real&device=' + encodeURIComponent(deviceId);
    const openEntry = async () => {
     await page.goto(entryUrl);
     const summary = page.locator('[data-block-id="backup-workspace-disclosure-summary"]');
     await summary.waitFor();
     assert.equal(await page.locator('[data-block-id="backup-workspace-disclosure"]').getAttribute('open'), null);
     await summary.click();
     await page.getByRole('heading', { name: 'Backups', exact: true }).waitFor();
    };
    await openEntry();
    const catalog = await read('/api/v1/backups/workspace?view=catalog');
    assert.equal(catalog.storage.available, true); assert.equal(catalog.worker.available, true); assert.ok(catalog.destinations.length);
    const storage = catalog.destinations[0];
    await page.getByRole('button', { name: `${storage.label} · ${storage.state}`, exact: true }).click();
    if (exerciseRecovery && label === 'desktop') await page.locator('summary').filter({ hasText: 'Backup & restore activity' }).click();
    const snapshotJob = await clickCommand('Create snapshot', 'snapshot');
    if (exerciseRecovery && label === 'desktop') {
     const paused = await clickCommand('Pause', 'pause', snapshotJob.id); assert.equal(paused.status, 'paused');
     assert.equal((await read('/api/v1/backups/workspace?view=job&id=' + encodeURIComponent(snapshotJob.id))).job.status, 'paused');
     await clickCommand('Resume', 'resume', snapshotJob.id);
     await waitJob(snapshotJob.id, 'needs-attention');
     await page.getByRole('button', { name: 'Refresh', exact: true }).click();
     await clickCommand('Retry', 'retry', snapshotJob.id);
    }
    if (label === 'desktop') await page.goto('about:blank');
    await waitJob(snapshotJob.id);
    if (label === 'desktop') await openEntry();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Saved snapshots' }).click();
    await page.getByRole('button', { name: 'Browse contents', exact: true }).first().click();
    // The selected snapshot is exactly the job admitted by this UI action.
    const chosen = (await read('/api/v1/backups/workspace?view=catalog')).snapshots.items[0];
    assert.equal(chosen.id, snapshotJob.id); assert.equal(chosen.integrity, 'verified');
    let cursor, selectedEntry;
    const seen = new Set();
    do {
     const entries = await read('/api/v1/backups/workspace?view=snapshot&id=' + encodeURIComponent(snapshotJob.id) + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
     selectedEntry = entries.items.find(item => item.id === sourceRootId);
     if (selectedEntry) break;
     assert.ok(entries.nextCursor && !seen.has(entries.nextCursor), 'Selected source graph absent or pagination repeated');
     cursor = entries.nextCursor; seen.add(cursor);
     await page.getByRole('button', { name: 'More contents', exact: true }).click();
    } while (cursor);
    assert.ok(selectedEntry?.selectable);
    const sourceChoice = page.locator('input[type="checkbox"][data-tt-action-inputs*=' + JSON.stringify('"id":"' + sourceRootId + '"') + ']');
    assert.equal(await sourceChoice.count(), 1, 'Choose the original source ID, never a same-name restored copy');
    await sourceChoice.check();
    await page.getByRole('button', { name: 'Choose destination', exact: true }).click();
    const picker = page.locator('[data-block-id="backup-folder-shared-browser"]');
    await picker.getByText(destinationName, { exact: true }).first().dblclick();
    await page.getByRole('button', { name: 'Restore into this folder', exact: true }).click();
    await page.getByRole('button', { name: 'Close folder picker', exact: true }).waitFor({ state: 'hidden' });
    const reviewJob = await clickCommand('Review restore', 'review'); await waitJob(reviewJob.id);
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('button', { name: 'Restore selection', exact: true }).waitFor();
    await page.locator('summary').filter({ hasText: 'Details & limitations' }).click();
    const savedReview = (await read('/api/v1/backups/workspace?view=review&id=' + encodeURIComponent(reviewJob.id))).review;
    assert.equal(savedReview.sourceRootId, sourceRootId); assert.equal(savedReview.destination.id, destinationId); assert.equal(savedReview.destination.revision, created.thing.timelineHeadId); assert.ok(savedReview.hash && savedReview.executable);
    await page.getByText('Integrity reference: ' + savedReview.hash, { exact: true }).waitFor();
    await scroll('review');
    const restoreJob = await clickCommand('Restore selection', 'restore'); await waitJob(restoreJob.id);
    await verifyRestored({ request: context.request, headers, destinationId, jobId: restoreJob.id, label });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('summary').filter({ hasText: 'Backup & restore activity' }).click();
    await scroll('activity');
    // The same account-backed editable document persists nested ordinary blocks.
    const layout = page.locator('[data-settings-document="backup-workspace"]');
    await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
    await page.locator('[data-block-id="backup-description"]').click();
    const edited = `Backup library ${label} · saved editable description`;
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill(edited);
    await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('backup-entry-history');
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Saved history: {item.history}');
    await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('backup-job-cancel');
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Cancel ' + label + ' job');
    await page.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('backup-review-coverage');
    await page.getByRole('textbox', { name: 'Block text', exact: true }).fill('Coverage: {backup.review.coverage}');
    await page.getByRole('button', { name: 'Close builder', exact: true }).click();
    await layout.getByRole('button', { name: 'Save layout', exact: true }).click();
    await layout.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
    await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
    await openEntry(); await page.getByText(edited, { exact: true }).waitFor();
    const document = await read('/api/v1/webpages/resolve?id=settings-backup-workspace');
    assert.equal(document.page.author.id, account.id);
    const find = (blocks, id) => blocks.flatMap(block => [block, ...((block.children && flatten(block.children)) || [])]).find(block => block.id === id);
    const flatten = blocks => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
    assert.equal(find(document.page.crystal.blocks, 'backup-description').text, edited);
    assert.equal(find(document.page.crystal.blocks, 'backup-entry-history').text, 'Saved history: {item.history}');
    assert.equal(find(document.page.crystal.blocks, 'backup-job-cancel').text, 'Cancel ' + label + ' job');
    assert.equal(find(document.page.crystal.blocks, 'backup-review-coverage').text, 'Coverage: {backup.review.coverage}');
    await scroll('builder-reloaded');
    results.push({ label, realHttp: true, realAdapter: true, syntheticAccountOnly: true, snapshotId: snapshotJob.id, reviewId: reviewJob.id, restoreJobId: restoreJob.id, destinationId, sourceRootId, normalRemoteDeviceEntry: true, collapsedDefault: true, pageIndependentSnapshotProgress: label === 'desktop', realPauseResumeRetry: exerciseRecovery && label === 'desktop', sharedFolderPicker: true, immutableReview: true, independentRestoreOracle: true, nestedBuilderSavedReloaded: true, noOverflow: true });
   } catch (error) { await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }).catch(() => {}); await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText().catch(() => 'Page unavailable')); throw error; }
   finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
  return { results, errors, evidence };
 } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
 if (process.argv[2] === '--build-only') {
  const directory = resolve(process.argv[3]); await buildBackupWorkspaceBrowser(directory); console.log(directory);
 } else if (process.argv[2] === '--real') {
  assert.equal(typeof process.send, 'function', 'Real acceptance requires the canonical isolated runner IPC');
  const origin = new URL(process.argv[3]).origin;
  assert.equal(origin, 'http://127.0.0.1:28176');
  process.send({ type: 'backup-workspace-ready' });
  const initial = await new Promise((done, fail) => {
   const deadline = setTimeout(() => fail(Error('Missing isolated account handoff')), 30000);
   process.once('message', value => { clearTimeout(deadline); done(value); });
  });
  assert.equal(initial.type, 'backup-workspace-test');
  const verifyRestored = ({ destinationId, jobId, label }) => new Promise((done, fail) => {
   const requestId = randomUUID();
   const deadline = setTimeout(() => { process.off('message', onReply); fail(Error('Independent restore oracle did not finish')); }, 180000);
   function onReply(value) {
    if (value?.type !== 'restore-verified' || value.requestId !== requestId) return;
    clearTimeout(deadline); process.off('message', onReply);
    value.ok === true ? done() : fail(Error('Independent current/history file restore verification failed'));
   }
   process.on('message', onReply); process.send({ type: 'verify-restored', requestId, destinationId, jobId, label });
  });
  try {
   const result = await runBackupWorkspaceHttpAcceptance({ origin, account: initial.account, deviceId: initial.deviceId, sourceRootId: initial.sourceRootId, evidence: initial.evidence, verifyRestored, exerciseRecovery: initial.exerciseRecovery === true });
   process.send({ type: 'backup-workspace-result', ...result });
  } finally { process.disconnect(); }
 } else await runSyntheticBackupWorkspace(process.argv[2]);
}
