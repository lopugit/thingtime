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
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-sync-drafts-ui'));
const dir = await mkdtemp(join(tmpdir(), 'thingtime-sync-drafts-'));
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

 for (const [label, width, height, native] of [['remote-desktop', 1440, 1000, false], ['remote-phone', 390, 844, false], ['native-desktop', 1440, 1000, true], ['native-phone', 390, 844, true]]) {
  const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  page.on('pageerror', error => errors.push(error.message));
  const manage = page.locator('summary').filter({ hasText: 'Manage sync connections' });
  const target = origin + (native ? '?native=1' : '');
  const openManagement = async () => { if (!native) { await manage.click(); await connect(); } };
  const connect = async () => { if (!native) { await page.evaluate(() => window.remoteSyncFixture.setOnline(true)); await page.getByRole('button', { name: 'Refresh device', exact: true }).click(); } };
  const name = page.getByRole('textbox', { name: 'Connection name', exact: true });
  const add = page.getByRole('button', { name: 'Add connection', exact: true });
  const savedCard = title => page.locator('article').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
  const newCard = title => page.locator('[data-settings-section]').filter({ has: page.locator('summary span').filter({ hasText: title }) }).filter({ hasText: 'Unsaved connection settings' }).last();
  const openNew = async title => { const summary = newCard(title).locator(':scope > summary'); await summary.click(); await name.waitFor(); };
  let journalKey;
  const journal = () => page.evaluate(expectedKey => { const key = expectedKey ?? Object.keys(localStorage).find(k => k.startsWith('tt:sync-editor:v1:')); return { key, raw: localStorage.getItem(key) }; }, journalKey);
  try {
   await page.goto(target); await openManagement(); await add.waitFor();
   await savedCard('Documents backup').getByRole('button', { name: 'Expand folder', exact: true }).click();
   await page.getByRole('button', { name: 'Edit', exact: true }).click();
   await name.fill('Legacy draft retained');
   journalKey = (await journal()).key;
   // Seed the actual old on-disk payload, then let production migration read it.
   const legacy = await page.evaluate(() => { const key = Object.keys(localStorage).find(k => k.startsWith('tt:sync-editor:v1:')); const draft = JSON.parse(localStorage.getItem(key)).drafts[0]; localStorage.setItem(key, JSON.stringify(draft)); return JSON.stringify(draft); });
   await page.reload(); await openManagement();
   assert.equal((await journal()).raw, legacy, 'read preserves legacy bytes');
   await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Add connection' && !button.disabled));
   assert.equal(await add.isEnabled(), true, 'restored legacy draft does not block Add');
   await add.click(); await name.fill('First new draft');
   await page.locator('summary:visible').filter({ hasText: /^Resource limits$/ }).click();
   await page.getByRole('textbox', { name: 'Upload speed', exact: true }).fill('-');
   assert.equal(await page.getByRole('button', { name: 'Save connection', exact: true }).isDisabled(), true);
   await add.click(); await name.fill('Second new draft');
   let state = JSON.parse((await journal()).raw);
   assert.equal(state.drafts.length, 3); assert.equal(state.drafts[0].configuration.name, 'Legacy draft retained');
   await page.reload(); await openManagement();
   await openNew('First new draft');
   await page.locator('summary:visible').filter({ hasText: /^Resource limits$/ }).click();
   assert.equal(await page.getByRole('textbox', { name: 'Upload speed', exact: true }).inputValue(), '-', 'incomplete resource input survives reload');
   assert.equal(await page.getByRole('button', { name: 'Save connection', exact: true }).isDisabled(), true);
   // Collapse/reopen and switch to a saved draft and back without replacing either.
   await newCard('First new draft').locator(':scope > summary').click();
   await openNew('First new draft'); assert.equal(await name.inputValue(), 'First new draft');
   await savedCard('Documents backup').getByRole('button', { name: 'Expand folder', exact: true }).click();
   assert.equal(await name.inputValue(), 'Legacy draft retained');
   await name.fill('Legacy edited independently');
   await savedCard('Documents backup').getByRole('button', { name: 'Collapse folder', exact: true }).click();
   await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Add connection' && !button.disabled));
   assert.equal(await add.isEnabled(), true, 'collapsed existing edit does not block Add');
   await openNew('Second new draft');
   await page.getByRole('button', { name: 'Discard draft', exact: true }).click();
   state = JSON.parse((await journal()).raw);
   assert.deepEqual(state.drafts.map(d => d.configuration.name), ['Legacy edited independently', 'First new draft']);
   // Save only the old saved-connection draft; no implicit create or transfer.
   await savedCard('Documents backup').getByRole('button', { name: 'Expand folder', exact: true }).click();
   await page.getByRole('button', { name: 'Save connection', exact: true }).click();
   await page.getByRole('button', { name: 'Save connection', exact: true }).waitFor({ state: 'hidden' });
   state = JSON.parse((await journal()).raw); assert.equal(state.drafts.length, 1); assert.equal(state.drafts[0].configuration.name, 'First new draft');
   const remote = await page.evaluate(() => window.remoteSyncFixture.state());
   assert.equal(remote.writes, 1); assert.equal(remote.commands.filter(c => c.action !== 'status').length, 0);
   const original = (await journal()).raw;
   for (const query of ['?owner=other-owner', '?device=other-device']) {
    await page.goto(target + (native ? '&' + query.slice(1) : query)); await openManagement(); await add.waitFor();
     assert.equal(await page.getByText('First new draft', { exact: true }).count(), 0, 'scope does not show previous draft');
    await add.click(); await name.fill('Other scope draft');
   }
   await page.goto(target); await openManagement();
   assert.equal((await journal()).raw, original, 'other account/device journals leave original intact');
   await openNew('First new draft');
   assert.equal(await name.inputValue(), 'First new draft');
   await page.locator('summary:visible').filter({ hasText: /^Resource limits$/ }).click();
   assert.equal(await page.getByRole('textbox', { name: 'Upload speed', exact: true }).inputValue(), '-');
   await page.evaluate(() => window.scrollTo(0, 0));
   await page.screenshot({ path: join(evidence, label + '-top.png'), fullPage: true });
   await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
   await page.screenshot({ path: join(evidence, label + '-drafts.png'), fullPage: true });
   results.push({ label, legacyMigration: true, addWithDraft: true, multipleDraftReload: true, incompleteInputReload: true, collapseSwitchReopen: true, selectedOnlySaveDiscard: true, accountDeviceIsolation: true, noImplicitTransfers: true, noOverflow: true });
  } catch (error) { await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }); await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText()); throw error; } finally { await context.close(); }
 }
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
 console.log(JSON.stringify({ results, errors, evidence }));
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); }
