// Read-only task fixture for the final standalone progress HTML.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
if (process.env.THINGTIME_FINAL_PLAN_READY !== '1') throw new Error('Parent must confirm final plan text.');
const repo = process.cwd(), source = path.join(repo, 'docs/progress/anonymous-local-first.html');
const output = fileURLToPath(new URL('./plan/', import.meta.url)); await mkdir(output, { recursive: true });
const html = await readFile(source), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { chromium } = createRequire(path.join(repo, 'MCP/package.json'))('playwright');
const receipt = { observedAt: new Date().toISOString(), source: 'docs/progress/anonymous-local-first.html', sourceSha256: hash(html),
  scope: 'Read-only progress-plan HTML layout, derived counts, filters, search and in-page navigation', chromiumSandbox: true,
  viewports: [], requests: [], blockedRequests: [], errors: [], artifacts: [], ok: false, browserClosed: false, serverClosed: false };
let server, browser, origin;
const save = async (page, name) => { const png = await page.screenshot(); await writeFile(path.join(output, name), png); receipt.artifacts.push({ name, bytes: png.length, sha256: hash(png) }); };
const timer = setTimeout(() => { void browser?.close(); server?.closeAllConnections(); }, 90000);
try {
  server = createServer((req, res) => {
    const url = new URL(req.url, origin);
    if (url.pathname !== '/plan.html' || url.search || req.method !== 'GET') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(html.length), 'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'" });
    res.end(html);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, timeout: 15000 }); receipt.chromiumVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.route('**/*', async route => {
    const address = route.request().url(), url = new URL(address); receipt.requests.push(address);
    if (url.origin === origin && url.pathname === '/plan.html' && !url.search && route.request().method() === 'GET') await route.continue();
    else { receipt.blockedRequests.push(address); await route.abort(); }
  });
  const page = await context.newPage(); page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(20000);
  page.on('pageerror', error => receipt.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') receipt.errors.push(message.text()); });
  await page.goto(`${origin}/plan.html`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelector('#shown')?.textContent?.includes('checklist items shown'));
  receipt.counts = await page.evaluate(() => {
    const tasks = Array.from(document.querySelectorAll('.task'));
    return { total: tasks.length, done: tasks.filter(task => task.dataset.status === 'done').length, local: tasks.filter(task => task.dataset.status === 'local').length,
      todo: tasks.filter(task => task.dataset.status === 'todo').length, displayed: Array.from(document.querySelectorAll('.stat strong')).map(node => Number(node.textContent)) };
  });
  assert.deepEqual(receipt.counts, { total: 94, done: 65, local: 25, todo: 4, displayed: [65, 25, 4] });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }, { width: 320, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-filter="all"]').click(); scrollTo({ top: 0, behavior: 'instant' }); });
    await save(page, `plan-${viewport.width}-top.png`);
    const layout = await page.evaluate(async () => {
      const height = document.documentElement.scrollHeight, step = Math.max(200, Math.floor(innerHeight * .8)), observations = [];
      for (let y = 0; y <= height; y += step) {
        scrollTo({ top: y, behavior: 'instant' });
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error(`Horizontal page overflow at scroll ${y}`);
        observations.push({ y: scrollY, width: document.documentElement.scrollWidth });
      }
      scrollTo({ top: height, behavior: 'instant' }); await new Promise(resolve => requestAnimationFrame(resolve));
      if (Math.abs(scrollY + innerHeight - document.documentElement.scrollHeight) > 2) throw new Error('Page did not reach its bottom');
      return { height, bottomReached: true, positionsChecked: observations.length, maxWidth: Math.max(...observations.map(item => item.width)) };
    });
    await save(page, `plan-${viewport.width}-bottom.png`);
    await page.locator('.stats').scrollIntoViewIfNeeded(); await save(page, `plan-${viewport.width}-counts.png`);
    const filters = [];
    for (const value of await page.locator('[data-filter]').evaluateAll(nodes => nodes.map(node => node.dataset.filter))) {
      const expected = await page.locator('.task').evaluateAll((tasks, active) => tasks.filter(task => active === 'all' || (active === 'p0' ? task.dataset.priority === 'P0' : active === 'todo' ? task.dataset.status !== 'done' : task.dataset.status === active)).length, value);
      await page.locator(`[data-filter="${value}"]`).click();
      const actual = await page.locator('.task:not([hidden])').count(); assert.equal(actual, expected);
      assert.equal(await page.locator('#shown').textContent(), `${expected} checklist items shown`);
      assert.equal(await page.locator(`[data-filter="${value}"]`).getAttribute('aria-pressed'), 'true');
      filters.push({ value, count: actual });
    }
    await page.locator('[data-filter="all"]').click();
    const query = await page.locator('.task h3').first().textContent();
    const expectedSearch = await page.locator('.task').evaluateAll((tasks, text) => tasks.filter(task => task.textContent.toLowerCase().includes(text.toLowerCase())).length, query);
    await page.locator('#search').fill(query);
    assert.equal(await page.locator('.task:not([hidden])').count(), expectedSearch);
    await page.locator('#search').fill('task-verification-no-results-727f4b'); assert.equal(await page.locator('.task:not([hidden])').count(), 0);
    assert.equal(await page.locator('#shown').textContent(), '0 checklist items shown');
    await page.locator('#search').fill(''); assert.equal(await page.locator('.task:not([hidden])').count(), 94);
    const links = await page.locator('aside a[href^="#"]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
    for (const target of links) {
      assert.equal(await page.locator(target).count(), 1);
      await page.locator(`aside a[href="${target}"]`).click();
      await page.waitForFunction(hash => location.hash === hash, target);
      await page.locator(target).evaluate(node => node.scrollIntoView({ behavior: 'instant', block: 'start' }));
      assert.ok(await page.locator(target).evaluate(node => { const rect = node.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; }));
    }
    receipt.viewports.push({ ...viewport, ...layout, filters, searchMatched: expectedSearch, emptySearch: true, navigationTargets: links.length });
  }
  assert.deepEqual(receipt.errors, []); assert.deepEqual(receipt.blockedRequests, []); assert.equal((await context.cookies()).length, 0);
  assert.equal(hash(await readFile(source)), receipt.sourceSha256, 'Plan source changed during acceptance');
  receipt.ok = true;
} catch (error) { receipt.failure = error.message; process.exitCode = 1; }
finally {
  clearTimeout(timer);
  if (browser) { await browser.close(); receipt.browserClosed = true; }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); receipt.serverClosed = true; }
  await writeFile(path.join(output, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: receipt.ok, failure: receipt.failure, counts: receipt.counts, viewports: receipt.viewports.map(v => ({ width: v.width, positions: v.positionsChecked, filters: v.filters, navigationTargets: v.navigationTargets })), output, browserClosed: receipt.browserClosed, serverClosed: receipt.serverClosed }));
