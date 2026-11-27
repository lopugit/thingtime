/** Actual React/Builder controls with synthetic transport; not production/native acceptance. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-device-details-evidence'));
const build = await mkdtemp(join(tmpdir(), 'thingtime-device-details-'));
const origin = `http://127.0.0.1:${Number(process.env.TT_DEVICE_DETAILS_FIXTURE_PORT || 23743)}`;
let browser, server;
const results = [];
const locationBlocks = [
 { id: 'locations', type: 'collection', props: { itemsPath: 'location.observations', itemKey: 'id', transparent: true, templateEach: true }, children: [{ id: 'location-row', type: 'element', tag: 'p', text: '{item.id}', props: { 'data-location-row': '{item.id}' }, css: { padding: '8px', margin: '4px 0', border: '1px solid #e4e4e7' } }] },
 { id: 'more-condition', type: 'condition', condition: { arg: 'location.hasMore', equals: true }, children: [{ id: 'more', type: 'element', tag: 'button', text: 'Show more', props: { type: 'button', disabled: '{location.busy}', 'data-tt-action': '$transient', 'data-tt-action-inputs': { operation: 'more' } }, css: { 'min-height': '44px', padding: '8px 12px', border: '1px solid #d4d4d8', 'border-radius': '8px' } }] }
];
try {
 await mkdir(evidence, { recursive: true });
 await esbuild.build({ entryPoints: [join(root, 'scripts/device-details.browser.fixture.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(build, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
 const js = await readFile(join(build, 'fixture.js'));
 server = createServer((request, response) => { response.writeHead(200, { 'Content-Type': request.url === '/fixture.js' ? 'text/javascript' : 'text/html' }); response.end(request.url === '/fixture.js' ? js : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>[LC] Device details fixture</title><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
 server.listen(Number(new URL(origin).port), '127.0.0.1'); await once(server, 'listening');
 const { chromium } = process.env.TT_PLAYWRIGHT_MODULE ? await import(process.env.TT_PLAYWRIGHT_MODULE) : createRequire(join(root, '../MCP/package.json'))('playwright');
 browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.TT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.TT_CHROMIUM_EXECUTABLE } : {}) });
 for (const [name, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const context = await browser.newContext({ viewport, hasTouch: name === 'mobile', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  const errors = [], reads = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/.well-known/thingtime-capabilities.json', route => route.fulfill({ json: { origin, schemaVersion: 1, features: { 'api.devices-observations': { version: '1.0.0' }, 'api.webpages-resolve': { version: '1.99.0' }, 'api.mongodb-endpoint': { version: '1.99.0' }, 'api.things': { version: '1.99.0' }, 'api.actions-run': { version: '1.99.0' } } } }));
  await page.route('**/api/v1/webpages/resolve?*', route => {
   const query = new URL(route.request().url()).searchParams;
   if (query.get('path') === '/devices/location') return route.fulfill({ json: { ok: true, source: 'user', page: { id: 'fixture-location-page', author: { id: 'fixture-owner' }, crystal: { blocks: locationBlocks } }, components: [] } });
   if (query.get('id') === 'settings-device-location-settings') return route.fulfill({ json: { ok: true, source: 'user', page: { id: 'fixture-location-settings', author: { id: 'fixture-owner' }, updatedAt: '2026-11-12T00:00:00Z', crystal: { pageKey: 'settings-device-location-settings', name: 'Location settings', blocks: [{ id: 'settings-retention', type: 'element', tag: 'p', text: 'Synthetic retention settings' }] } } } });
   return route.fulfill({ json: { ok: true, source: 'none', page: null } });
  });
  await page.route('**/api/v1/devices/observations?*', route => {
   const url = new URL(route.request().url()); reads.push(Object.fromEntries(url.searchParams)); assert.equal(url.searchParams.get('limit'), '10');
   const offset = Number(url.searchParams.get('cursor') || 0);
   return route.fulfill({ json: { ok: true, observations: Array.from({ length: offset < 20 ? 10 : 5 }, (_, i) => ({ id: `Location ${String(offset + i + 1).padStart(2, '0')}`, deviceId: 'fixture-device', type: 'location', observedAt: new Date(Date.now() - (offset + i) * 60000).toISOString(), receivedAt: new Date().toISOString(), value: { latitude: -37, longitude: 144, accuracyMeters: 20 } })), latest: null, settings: { enabled: true, retentionMs: null, collectionId: 'fixture-collection' }, nextCursor: offset < 20 ? String(offset + 10) : null } });
  });
  try {
   await page.goto(origin + '?setup=paired');
   await page.getByRole('button', { name: 'Expand Device overview', exact: true }).waitFor();
   assert.equal(await page.getByRole('button', { name: /^Collapse / }).count(), 0);
   const collapsed = await page.getByRole('button', { name: /^Expand / }).count();
   assert.equal(collapsed, 16);
   await page.locator('[data-setup-state="paired"]').waitFor({ state: 'attached' });
   assert.equal(await page.getByRole('link', { name: 'Device setup', exact: true }).count(), 0);
   assert.equal(await page.getByRole('button', { name: 'Show Folder', exact: true }).count(), 0);
   await page.screenshot({ path: join(evidence, `${name}-collapsed.png`), fullPage: true });
   const deviceActions = page.getByRole('button', { name: 'Device actions', exact: true });
   await deviceActions.focus(); await page.keyboard.press('Enter');
   await page.getByText('Show Folder', { exact: true }).waitFor();
   await page.screenshot({ path: join(evidence, `${name}-device-menu.png`), fullPage: true });
   await page.keyboard.press('Escape');
   await page.getByText('Show Folder', { exact: true }).waitFor({ state: 'hidden' });
   if (name === 'mobile') await deviceActions.tap(); else await page.getByRole('heading', { name: 'Fixture Mac', exact: true }).click({ button: 'right' });
   await page.getByText('Show Folder', { exact: true }).waitFor();
   await page.keyboard.press('Escape');
   await page.getByText('Show Folder', { exact: true }).waitFor({ state: 'hidden' });
   await page.getByRole('button', { name: 'Expand Location history', exact: true }).click();
   await page.locator('[data-block-id="location-row"]').nth(9).waitFor(); assert.equal(await page.locator('[data-block-id="location-row"]').count(), 10);
   const more = page.getByRole('button', { name: 'Show more', exact: true }); await more.waitFor();
   const settings = page.locator('summary').filter({ hasText: /^Location settings$/ }); await settings.waitFor();
   assert.equal(await page.getByText('Synthetic retention settings', { exact: true }).isVisible(), false);
   await settings.click(); await page.getByText('Synthetic retention settings', { exact: true }).waitFor();
   await settings.click();
   assert.equal(await page.evaluate(() => { const rows = document.querySelectorAll('[data-block-id="location-row"]'); const button = document.querySelector('[data-block-id="more"]'); return !!button && !!(rows[rows.length - 1].compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING); }), true);
   await page.screenshot({ path: join(evidence, `${name}-location-ten.png`), fullPage: true });
   await more.click(); await page.locator('[data-block-id="location-row"]').nth(19).waitFor();
   await more.click(); await page.locator('[data-block-id="location-row"]').nth(24).waitFor(); await more.waitFor({ state: 'hidden' });
   assert.deepEqual(reads.map(row => row.cursor || null), [null, '10', '20']);
   await page.getByRole('button', { name: 'Collapse Location history', exact: true }).click();
   await page.getByRole('button', { name: 'Expand Device overview', exact: true }).click();
   await page.screenshot({ path: join(evidence, `${name}-overview-open.png`), fullPage: true });
   await page.reload(); await page.getByRole('button', { name: 'Collapse Device overview', exact: true }).waitFor();
   await page.goto(origin + '?setup=unknown'); assert.equal(await page.getByRole('link', { name: 'Device setup', exact: true }).count(), 0);
   await page.goto(origin + '?setup=unpaired'); await page.getByRole('link', { name: 'Device setup', exact: true }).waitFor();
   await page.screenshot({ path: join(evidence, `${name}-unpaired-setup.png`), fullPage: true });
   await page.evaluate(() => scrollTo(0, document.body.scrollHeight)); await page.getByText('End of fixture', { exact: true }).waitFor();
   assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
   results.push({ viewport: name, collapsedSections: collapsed, observations: 25, cursorPages: 3, deviceMenuRendered: true, expansionRetained: true, setupStates: ['paired-hidden', 'unknown-hidden', 'unpaired-visible'], synthetic: true });
  } catch (error) { await writeFile(join(evidence, `${name}-failure.txt`), String(error) + '\n' + errors.join('\n') + '\n' + await page.locator('body').innerText()); await page.screenshot({ path: join(evidence, `${name}-failure.png`), fullPage: true }); throw error; } finally { await context.close(); }
 }
 await writeFile(join(evidence, 'results.json'), JSON.stringify(results, null, 2)); console.log('DEVICE_DETAILS_BROWSER_PASS ' + evidence);
} finally { await browser?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await rm(build, { recursive: true, force: true }); }
