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
  for (const scenario of ['success', 'cas', 'uncertain', 'draft', 'identity', 'ios-managed']) {
   const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
   await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
   const page = await context.newPage(); page.setDefaultTimeout(12_000); page.on('pageerror', error => errors.push(error.message));
   try {
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
    await page.screenshot({ path: join(evidence, `${label}-${scenario}.png`), fullPage: true });
    await page.evaluate(async () => { for (let y=0; y<document.documentElement.scrollHeight; y+=innerHeight) { scrollTo(0,y); await new Promise(requestAnimationFrame); } });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    results.push({ viewport: label, scenario, passed: true });
   } catch(error) { await page.screenshot({ path: join(evidence, `${label}-${scenario}-failure.png`), fullPage: true }).catch(()=>{}); throw error; }
   finally { await context.close(); }
  }
 }
 assert.deepEqual(errors, []);
 await writeFile(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2));
 console.log(JSON.stringify({ ok: true, results, evidence }));
} finally {
 await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true });
}
