/** Actual browser/API acceptance. Use a disposable local database; no production sessions.
 * TT_STANDARDS_TEST_URL=http://127.0.0.1:18730 TT_STANDARDS_TEST_DATABASE_HOST=127.0.0.1:18733
 * TT_PLAYWRIGHT_MODULE=/tmp/tt-standards-tools/node_modules/playwright/index.mjs node remix/scripts/check-web-standards-browser.mjs
 */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
const origin = process.env.TT_STANDARDS_TEST_URL;
assert.ok(origin && ['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Explicit local test URL required');
const ids = new Set();
let cookie = '';
const request = async (path, body, method = body ? 'POST' : 'GET') => {
 const r = await fetch(new URL(path, origin), { method, headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, ...(body ? { body: JSON.stringify(body) } : {}) });
 const data = await r.json();
 assert.ok(r.ok, `${path}: ${r.status}`);
 return { r, data };
};
const health = (await request('/api/v1/health/mongodb')).data;
assert.equal(health.host, process.env.TT_STANDARDS_TEST_DATABASE_HOST, 'Explicit disposable database host must match');
if (process.env.TT_STANDARDS_TEST_SESSION_FILE) {
 const existing = JSON.parse(await readFile(process.env.TT_STANDARDS_TEST_SESSION_FILE, 'utf8'));
 assert.equal(existing.origin, origin, 'Test session belongs to this local stack');
 cookie = existing.cookie;
} else {
 const session = await request('/api/v1/auth/temporary', {});
 cookie = session.r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
}
assert.ok(cookie);
let browser;
try {
 const installed = (await request('/api/v1/webpages/suites/install', { key: 'web-standards', onlyMissing: true })).data;
 if (installed.created === 6) for (const group of ['componentIds', 'actionIds', 'pageIds']) for (const id of Object.values(installed[group])) ids.add(id);
 const { chromium } = await import(process.env.TT_PLAYWRIGHT_MODULE || 'playwright');
 browser = await chromium.launch({ channel: 'chrome', headless: process.env.CI === 'true' });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.addCookies(cookie.split('; ').map(v => ({ name: v.slice(0, v.indexOf('=')), value: v.slice(v.indexOf('=') + 1), url: origin })));
 const page = await context.newPage();
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 const inventory = JSON.parse(await readFile(new URL('../app/webPlatform/generated/inventory.json', import.meta.url), 'utf8')).features;
 await page.goto(origin + '/p/web-standards');
 await page.getByText(/^\d+ entries$/, { exact: true }).waitFor();
 await page.getByLabel('Search features', { exact: true }).fill('dialog');
 await page.locator('select[name=language]').selectOption('html');
 await page.getByRole('button', { name: 'Explore', exact: true }).click();
 await page.waitForURL('**q=dialog&language=html&coverage=');
 await page.getByText(/^\d+ entries$/, { exact: true }).waitFor();
 await page.locator('a[href*="feature=html-element-dialog"]').first().waitFor();
 const runButton = page.getByRole('button', { name: 'Run example', exact: true });
 const result = page.getByLabel('Execution result', { exact: true });
 const select = async (language, name) => {
  const f = inventory.find(f => f.language === language && f.name === name);
  assert.ok(f, name);
  await page.goto(origin + '/p/web-standards?feature=' + f.id);
  await runButton.click(); await result.waitFor();
 };
 await select('html', 'dialog');
 const frame = page.frameLocator('iframe[title="dialog interactive preview"]');
 await frame.getByRole('button', { name: 'Open dialog', exact: true }).click();
 assert.equal(await frame.locator('dialog').evaluate(n => n.open), true);
 await frame.getByRole('button', { name: 'Close', exact: true }).click();
 assert.equal(await frame.locator('dialog').evaluate(n => n.open), false);
 await select('css', 'display'); assert.match(await result.innerText(), /"computed": "grid"/);
 await select('javascript', 'Array.prototype.at ( index )'); assert.equal(await result.innerText(), '1');
 await page.getByLabel('Arguments (JSON array)', { exact: true }).fill('[2]');
 await runButton.click(); await result.filter({ hasText: /^4$/ }).waitFor();
 await page.getByRole('button', { name: 'Save example template', exact: true }).click();
 const saved = page.getByRole('link', { name: 'Open saved Thing →', exact: true }); await saved.waitFor();
 const id = (await saved.getAttribute('href')).split('/').at(-1); ids.add(id);
 const read = (await request('/api/v1/things?id=' + id)).data;
 assert.ok(JSON.stringify(read.thing.crystal.render).includes('tt-web-platform'));
 await page.setViewportSize({ width: 390, height: 844 });
 assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
 if (process.env.TT_STANDARDS_ARTIFACT_DIR) {
  const dir = process.env.TT_STANDARDS_ARTIFACT_DIR; await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, 'web-standards-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: join(dir, 'web-standards-desktop.png'), fullPage: true });
 }
 await page.getByText('Edit reusable program', { exact: true }).click();
 const run = async steps => {
  await page.getByLabel('Web Platform program', { exact: true }).fill(JSON.stringify({ version: 1, title: 'Sandbox check', steps }));
  await runButton.click(); await result.waitFor(); return result.innerText();
 };
 const start = Date.now();
 assert.match(await run([{ op: 'while', test: true, body: [] }]), /2-second execution limit/);
 assert.ok(Date.now() - start < 6500);
 assert.match(await run([{ op: 'return', value: { op: 'await', value: { op: 'call', target: { op: 'global', name: 'fetch' }, args: [origin + '/api/v1/health/mongodb'] } } }]), /Failed to fetch|fetch failed|Content Security Policy/);
 const runtime = page.frames().find(f => f.url().endsWith('/platform/runtime.html'));
 assert.equal(await runtime.evaluate(() => { try { void document.cookie; return false; } catch { return true; } }), true);
 assert.equal(await runtime.evaluate(() => { try { void parent.document; return false; } catch { return true; } }), true);
 await page.getByRole('button', { name: 'Stop / clear', exact: true }).click();
 assert.equal(await page.locator('iframe').count(), 0);
 const direct = await context.request.get(origin + '/platform/runtime.html');
 assert.match(direct.headers()['content-security-policy'], /sandbox allow-scripts/);
 assert.deepEqual(errors, []);
 console.log('Browser acceptance passed: search, dialog, CSS, JS, private save, mobile bounds, worker timeout, network/account isolation and Stop.');
} finally {
 await browser?.close();
 for (const id of ids) await request('/api/v1/things?id=' + id, undefined, 'DELETE');
}
