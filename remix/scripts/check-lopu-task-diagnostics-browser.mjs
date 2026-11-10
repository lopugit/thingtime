// Run inside an OS deny-network sandbox; no backend, credentials or real data.
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE);
const port = 13964, origin = `http://127.0.0.1:${port}`, root = new URL('..', import.meta.url).pathname;
await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(1500) }), e => e.cause?.code === 'EPERM');
const server = await createServer({ root, configFile: false, envDir: false, resolve: { alias: { '~': `${root}/app` } }, server: { host: '127.0.0.1', port, strictPort: true }, esbuild: { jsx: 'automatic' } });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const evidence = '/tmp/oauth-task-diagnostics-browser'; await mkdir(evidence, { recursive: true });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/scripts/lopu-task-diagnostics.browser.html`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
    await page.getByLabel('Root task ID', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Root task ID', { exact: true }).inputValue(), 'synthetic-root');
    assert.equal(await page.getByLabel('Application finalized at').inputValue(), 'Unknown — no recorded evidence');
    assert.equal(await page.getByRole('region', { name: 'Task diagnostics' }).locator('input:not([readonly]),textarea:not([readonly])').count(), 0);
    assert.equal(await page.locator('textarea[readonly]').evaluateAll(elements => elements.every(element => element.scrollHeight <= element.clientHeight + 2)), true, 'Long identifiers grow without clipping');
    for (let y = 0; y < await page.evaluate(() => document.documentElement.scrollHeight); y += 600) {
      await page.evaluate(y => scrollTo(0, y), y);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `${width} no overflow`);
    }
    await page.getByRole('button', { name: 'Refresh diagnostics' }).click();
    await page.waitForFunction(() => window.diagnosticReads() === 2);
    await page.screenshot({ path: `${evidence}/${width}-open.png`, fullPage: true });
    await page.getByRole('button', { name: 'Hide diagnostics' }).click();
    assert.equal(await page.getByRole('region', { name: 'Task diagnostics' }).count(), 0);
    await page.getByRole('button', { name: 'Diagnostics', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByLabel('Root task ID', { exact: true }).waitFor();
    for (const change of ['changeDiagnosticScope', 'changeDiagnosticOwner']) {
      const oldRun = await page.getByLabel('Workflow run ID', { exact: true }).inputValue();
      await page.evaluate(async change => { await window[change](); }, change);
      assert.equal(await page.getByRole('region', { name: 'Task diagnostics' }).count(), 0, `${change}: existing evidence removed for same task ID`);
      await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
      await page.getByLabel('Root task ID', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('Root task ID', { exact: true }).inputValue(), 'synthetic-root');
      if (change === 'changeDiagnosticScope') assert.notEqual(await page.getByLabel('Workflow run ID', { exact: true }).inputValue(), oldRun);
    }
    assert.deepEqual(errors, []);
  }
  console.log(JSON.stringify({ passed: true, viewports: [1440,390], evidence }));
} finally { await browser?.close(); await server.close(); }
