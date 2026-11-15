import assert from 'node:assert/strict';
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-platform-log-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-platform-log-evidence'));
let browser, server;
const results = [], errors = [];
try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, 'scripts/platform-reporting.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(scratch, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
  const bundle = await readFile(join(scratch, 'fixture.js'));
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
    response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>[LC] Synthetic platform reporting</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await createRequire(join(root, '../MCP/package.json'))(process.env.TT_PLAYWRIGHT_MODULE || 'playwright').chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin);
      await page.getByText('Reporting is unconfigured and disabled.', { exact: true }).waitFor();
      await page.getByLabel('Owning account username', { exact: true }).fill('@thingtime');
      await page.getByLabel('Reporting Character username', { exact: true }).fill('thingtime-platform');
      await page.getByLabel('Private audience group', { exact: true }).selectOption('synthetic-group');
      await page.getByLabel('Enable private run logs', { exact: true }).check();
      await page.getByRole('button', { name: 'Save reporting settings', exact: true }).click();
      await page.getByText('Reporting settings saved and verified.', { exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.platformReportingFixture.snapshot())).saves, 1);
      await page.getByLabel('Owning account username', { exact: true }).fill('retained-draft');
      await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('section[aria-label="Private scheduled run logs"]')?.getAttribute('aria-busy')?.includes('true'));
      assert.equal(await page.getByLabel('Owning account username', { exact: true }).inputValue(), 'retained-draft');
      await page.evaluate(() => window.platformReportingFixture.externalChange());
      await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
      await page.getByRole('button', { name: 'Use saved configuration', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Save reporting settings', exact: true }).isDisabled(), true);
      await page.getByRole('button', { name: 'Use saved configuration', exact: true }).click();
      assert.equal(await page.getByLabel('Owning account username', { exact: true }).inputValue(), 'thingtime');
      await page.getByLabel('New private group name', { exact: true }).fill('Uncertain synthetic group');
      await page.evaluate(() => window.platformReportingFixture.failNextGroup());
      await page.getByRole('button', { name: 'Create private group', exact: true }).click();
      await page.getByText('Synthetic response lost after creation', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Create private group', exact: true }).click();
      await page.getByText('Choose an existing matching group from the audience list. A repeated creation will not be submitted.', { exact: true }).waitFor();
      assert.equal((await page.evaluate(() => window.platformReportingFixture.snapshot())).groupCreates, 1);
      await page.getByLabel('Private audience group', { exact: true }).selectOption('synthetic-group-1');
      for (const position of ['top', 'bottom']) {
        await page.evaluate(position => window.scrollTo(0, position === 'top' ? 0 : document.documentElement.scrollHeight), position);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      await page.screenshot({ path: join(evidence, `${label}.png`), fullPage: true });
      const layout = page.locator('[data-settings-document="platform-reporting-settings"]');
      await enableCurrentPageBuilder(page);
      await layout.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await layout.locator('[data-block-id="platform-log-owner-username-label"]').click();
      const selected = page.getByRole('combobox', { name: 'Select block', exact: true });
      assert.equal(await selected.inputValue(), 'platform-log-owner-username-label');
      await selected.selectOption('platform-log-owner-username-input');
      assert.equal(await selected.inputValue(), 'platform-log-owner-username-input');
      await selected.selectOption('platform-log-group-label');
      assert.equal(await selected.inputValue(), 'platform-log-group-label');
      await page.screenshot({ path: join(evidence, `${label}-builder.png`), fullPage: true });
      await page.getByRole('button', { name: 'Close builder', exact: true }).click();
      await layout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
      // A selection change while a profile lookup is pending cannot save old draft data.
      await page.getByLabel('Owning account username', { exact: true }).fill('thingtime');
      await page.evaluate(() => window.platformReportingFixture.holdProfiles());
      await page.getByRole('button', { name: 'Save reporting settings', exact: true }).click();
      await page.evaluate(() => window.platformReportingFixture.invalidate());
      await page.waitForTimeout(350);
      assert.equal(await page.getByLabel('Owning account username', { exact: true }).count(), 0);
      assert.equal((await page.evaluate(() => window.platformReportingFixture.snapshot())).saves, 1);
      results.push({ label, width, checks: ['unconfigured disabled', 'exact actor and profile resolution', 'save/readback', 'draft-preserving reload', 'revision conflict', 'uncertain group creation does not duplicate', 'individual Builder blocks', 'top/bottom overflow', 'identity abort'] });
    } catch (error) { await page.screenshot({path:join(evidence, `${label}-failure.png`),fullPage:true}); console.error(JSON.stringify({errors,body:await page.locator('body').innerText()})); throw error; } finally { await context.close(); }
  }
  const refusal = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  try {
    const page = await refusal.newPage();
    await page.goto(`${origin}/?custom=1`);
    await page.getByText('Select the Home data plane to manage private scheduled run logs.', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Owning account username', { exact: true }).count(), 0);
    assert.deepEqual(await page.evaluate(() => { const state=window.platformReportingFixture.snapshot(); return {saves:state.saves,reportingReads:state.reportingReads,groupReads:state.groupReads,groupCreates:state.groupCreates}; }), {saves:0,reportingReads:0,groupReads:0,groupCreates:0});
    await page.getByRole('button', { name: 'Reload saved settings', exact: true }).click();
    assert.equal((await page.evaluate(() => window.platformReportingFixture.snapshot())).reportingReads, 0);
    await page.screenshot({ path: join(evidence, 'custom-plane-refusal.png'), fullPage: true });
    results.push({label:'custom-plane',checks:['home-only refusal','no reporting/group requests','no protected fields or writes']});
  } finally { await refusal.close(); }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'receipt.json'), JSON.stringify({ scope: 'synthetic browser transport; no real account or native ceremony', results }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence, results }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
