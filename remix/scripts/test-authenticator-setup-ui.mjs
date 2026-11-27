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
const scratch = await mkdtemp(join(tmpdir(), 'thingtime-authenticator-setup-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-authenticator-setup-evidence'));
let browser, server;
const results = [], errors = [];
try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, 'scripts/authenticator-setup.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(scratch, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
  const bundle = await readFile(join(scratch, 'fixture.js'));
  server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'application/javascript' : 'text/html', 'Cache-Control': 'no-store' });
    response.end(request.url === '/fixture.js' ? bundle : '<!doctype html><title>[LC] Synthetic authenticator setup</title><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await createRequire(join(root, '../MCP/package.json'))(process.env.TT_PLAYWRIGHT_MODULE || 'playwright').chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  for (const [label, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin);
      const create = page.getByRole('button', { name: 'Create new entry', exact: true });
      await create.waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === 'Create new entry')?.disabled);
      assert.deepEqual(await page.evaluate(() => window.nativeSetupFixture.snapshot()), { saves: 0, totpEntries: 0 });
      await page.screenshot({ path: join(evidence, `${label}-pending.png`), fullPage: true });
      await create.click();
      await page.getByText('Setup added to this draft.', { exact: false }).waitFor();
      assert.equal(await page.getByLabel('Verification code', { exact: true }).getAttribute('type'), 'password');
      assert.deepEqual(await page.evaluate(() => window.nativeSetupFixture.snapshot()), { saves: 0, totpEntries: 0 });
      await page.getByLabel('Title', { exact: true }).fill('Synthetic reviewed authenticator');
      // A later warm intake leaves the existing editable draft intact.
      await page.evaluate(() => window.nativeSetupFixture.offer());
      await page.getByRole('button', { name: 'Cancel setup', exact: true }).click();
      assert.equal(await page.getByLabel('Title', { exact: true }).inputValue(), 'Synthetic reviewed authenticator');
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await page.waitForFunction(() => window.nativeSetupFixture.snapshot().saves === 1);
      assert.deepEqual(await page.evaluate(() => window.nativeSetupFixture.snapshot()), { saves: 1, totpEntries: 1 });
      // Rendered controls are individual normal Builder blocks.
      assert.equal(await page.locator('[data-block-id="pw-setup-message"]').count(), 1);
      assert.equal(await page.locator('[data-block-id="pw-setup-retry-label"]').count(), 1);
      for (const position of ['top', 'bottom']) {
        await page.evaluate(position => window.scrollTo(0, position === 'top' ? 0 : document.documentElement.scrollHeight), position);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      }
      const setupLayout = page.locator('[data-settings-document="password-workspace-setup"]');
      await enableCurrentPageBuilder(page);
      await setupLayout.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await setupLayout.locator('[data-block-id="pw-setup-message"]').click();
      const selected = page.getByRole('combobox', { name: 'Select block', exact: true });
      assert.equal(await selected.inputValue(), 'pw-setup-message');
      await selected.selectOption('pw-setup-retry-label');
      assert.equal(await selected.inputValue(), 'pw-setup-retry-label');
      await page.screenshot({ path: join(evidence, `${label}-builder.png`), fullPage: true });
      await page.getByRole('button', { name: 'Close builder', exact: true }).click();
      await setupLayout.getByRole('button', { name: 'Done editing layout', exact: true }).click();
      await page.screenshot({ path: join(evidence, `${label}.png`), fullPage: true });
      results.push({ label, width, checks: ['cold intake', 'explicit review', 'masked setup', 'no automatic save', 'warm cancellation preserves draft', 'explicit saved-code write', 'editable nested blocks', 'top/bottom overflow'] });
    } finally { await context.close(); }
  }
  assert.deepEqual(errors, []);
  await writeFile(join(evidence, 'receipt.json'), JSON.stringify({ scope: 'synthetic browser transport; no real account or native ceremony', results }, null, 2));
  console.log(JSON.stringify({ ok: true, evidence, results }));
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await rm(scratch, { recursive: true, force: true });
}
