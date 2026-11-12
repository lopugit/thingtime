import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
const root = resolve(import.meta.dirname, '..'), require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const { chromium } = require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE || 'playwright');
const work = await mkdtemp(join(tmpdir(), 'password-editor-')), evidence = resolve(process.argv[2] || join(tmpdir(), 'password-editor-evidence'));
const ownerId = 'password-editor-fixture', id = '11111111-1111-4111-8111-111111111111';
// Synthetic test data only. Never use a personal vault in this fixture.
const original = { title: 'Imported fixture', passwordType: 'identity', importArchiveId: '22222222-2222-4222-8222-222222222222', onePassword: JSON.stringify({ future: 'retained', details: { documents: [{ documentId: 'fixture-file' }], passwordHistory: [{ value: 'synthetic-history-only', time: 1700000000 }] } }), fields: [
  { id: 'address', label: 'Address', type: 'address', structured: true, value: JSON.stringify({ city: 'Old town', country: 'AU', unknown: { enabled: true, count: 3 }, list: ['one', 'two'] }), sourcePath: ['details', 'sections', 0, 'fields', 0, 'value', 'address'] },
  { id: 'password', label: 'Password', type: 'password', value: 'synthetic-fixture-only' }
] };
let browser, server;
try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({ entryPoints: [join(root, 'scripts/password-editor.browser.tsx')], bundle: true, format: 'esm', platform: 'browser', target: 'esnext', outfile: join(work, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'), define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error' });
  const script = await readFile(join(work, 'fixture.js'));
  server = createServer((request, response) => { if (request.url === '/fixture.js') response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script); else response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>'); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const layouts = new Map(), errors = [], genericActions = [];
    let entry = structuredClone(original), revision = 1, saves = 0, currentOwner = ownerId;
    const metadata = () => ({ id, revision, title: entry.title, passwordType: entry.passwordType, updatedAt: '2026-11-11T00:00:00Z' });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('thingtime-capabilities.json')) return route.fulfill({ json: { schemaVersion: 1, origin, features: Object.fromEntries(Object.entries({ 'api.passwords': '1.8.0', 'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.7.0', 'api.mongodb-endpoint': '1.1.0', 'api.things': '1.36.0' }).map(([key, version]) => [key, { version }])) } });
      if (url.pathname === '/api/v1/webpages/resolve') { const page = layouts.get(url.searchParams.get('id')); return page ? route.fulfill({ json: { ok: true, source: 'user', page } }) : route.fulfill({ status: 404 }); }
      if (url.pathname === '/api/v1/things') {
        const body = route.request().postDataJSON();
        assert.equal(route.request().headers()['x-thingtime-expected-actor'], ownerId);
        assert.ok(!JSON.stringify(body).includes('synthetic-fixture-only'));
        assert.ok(!JSON.stringify(body).includes('Old town')); assert.ok(!JSON.stringify(body).includes('synthetic-history-only'));
        const page = { id: body.id || body.shareId, author: { id: ownerId }, updatedAt: `2026-11-11T00:00:${String(layouts.size).padStart(2, '0')}Z`, crystal: body.crystal };
        layouts.set(body.crystal.pageKey, page); return route.fulfill({ json: { ok: true, thing: page } });
      }
      if (url.pathname === '/api/v1/passwords') {
        const body = route.request().method() === 'POST' ? route.request().postDataJSON() : undefined;
        if (!body) return route.fulfill({ json: { ok: true, ownerId: currentOwner, configured: true, entries: currentOwner === ownerId ? [metadata()] : [], nextCursor: null } });
        if (currentOwner !== ownerId) return route.fulfill({ json: { ok: true, ownerId: currentOwner, files: [], settings: { window: '5-minutes', revision: 1, reuseRecentDeviceVerification: false } } });
        assert.equal(body.expectedOwnerId, ownerId);
        if (body.operation === 'read') return route.fulfill({ json: { ok: true, ownerId, id, revision, entry } });
        if (body.operation === 'save') { entry = body.entry; revision++; saves++; return route.fulfill({ json: { ok: true, ownerId, record: metadata() } }); }
        if (body.operation === 'file-list') return route.fulfill({ json: { ok: true, ownerId, files: body.entryIds?.includes(id) ? [{ id: '33333333-3333-4333-8333-333333333333', metadata: { name: 'fixture-document.txt', size: 4 } }] : [] } });
        if (body.operation === 'verification-settings') return route.fulfill({ json: { ok: true, ownerId, settings: { window: '15-minutes', revision: 1, reuseRecentDeviceVerification: true } } });
        return route.fulfill({ json: { ok: true, ownerId, files: [] } });
      }
      if (url.pathname.startsWith('/api/v1/actions')) genericActions.push(url.pathname);
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { ok: true } });
      if (url.pathname === '/branding/generated/icon/thingtime-icon-128x128.png') return route.fulfill({ path: join(root, 'public', url.pathname), contentType: 'image/png' });
      if (url.pathname.endsWith('.png') || url.pathname.endsWith('.svg')) return route.fulfill({ status: 204 });
      return route.continue();
    });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin + '/passwords');
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      const editor = page.locator('[data-settings-document="password-entry-editor"]');
      await editor.getByLabel('Property: City', { exact: true }).fill('New town');
      const numeric = editor.getByLabel('Property: unknown / count', { exact: true });
      await numeric.fill('not a number');
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      assert.equal(saves, 0, 'Invalid typed values must block save');
      await numeric.fill('7.5');
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-block-id="pw-entry-heading"]')?.textContent === 'Edit entry');
      await page.locator('[data-block-id="pw-close"]').click();
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      assert.equal(await editor.getByLabel('Property: City', { exact: true }).inputValue(), 'New town');
      assert.equal(JSON.parse(entry.fields[0].value).unknown.count, 7.5);
      assert.equal(entry.onePassword, original.onePassword); assert.equal(entry.importArchiveId, original.importArchiveId);
      assert.deepEqual(entry.fields[0].sourcePath, original.fields[0].sourcePath);
      await editor.getByRole('button', { name: 'Move Address down', exact: true }).click();
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await page.waitForTimeout(100);
      assert.equal(entry.fields[0].id, 'password');
      // Nested template edits, independently persisted as ordinary blocks.
      await enableCurrentPageBuilder(page);
      await editor.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await editor.locator('[data-block-id="password-title-label-caption"]').click();
      const drawer = page.locator('.ttBuilderDrawer'); await drawer.waitFor();
      await drawer.getByRole('textbox', { name: 'Block text', exact: true }).fill('Entry title');
      await drawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption('password-field-copy-label');
      await drawer.getByRole('textbox', { name: 'Block text', exact: true }).fill('Copy field');
      await page.getByRole('button', { name: 'Close builder', exact: true }).click();
      await editor.getByRole('button', { name: 'Save layout', exact: true }).click();
      await editor.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
      assert.ok(JSON.stringify(layouts.get('settings-password-entry-editor')).includes('Entry title'));
      const toolbar = page.locator('[data-settings-document="password-workspace-toolbar"]');
      await toolbar.getByRole('button', { name: 'Edit layout', exact: true }).click();
      await toolbar.locator('[data-block-id="pw-add-label"]').click();
      await drawer.getByRole('textbox', { name: 'Block text', exact: true }).fill('New password');
      await page.getByRole('button', { name: 'Close builder', exact: true }).click();
      await toolbar.getByRole('button', { name: 'Save layout', exact: true }).click();
      await toolbar.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
      await page.reload();
      await page.getByRole('button', { name: 'New password', exact: true }).waitFor();
      const search = page.getByRole('searchbox', { name: 'Search passwords', exact: true });
      await search.fill('Imported'); await page.waitForTimeout(300); assert.equal(await search.evaluate(el => el === document.activeElement), true);
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      await editor.getByText('Entry title', { exact: true }).waitFor();
      await editor.getByLabel('Property: City', { exact: true }).waitFor();
      const source = page.locator('[data-settings-document="password-source"]');
      await source.locator('summary').filter({ hasText: 'Original item data' }).click();
      await source.getByRole('button', { name: 'Reveal original item', exact: true }).click();
      assert.equal(await source.getByLabel('Original 1Password item', { exact: true }).inputValue(), entry.onePassword);
      await source.getByRole('button', { name: 'Hide original item', exact: true }).click();
      await source.locator('summary').filter({ hasText: 'Password history' }).click();
      assert.equal(await source.getByLabel('Previous password', { exact: true }).getAttribute('type'), 'password');
      await source.getByRole('button', { name: 'Reveal previous password', exact: true }).click();
      assert.equal(await source.getByLabel('Previous password', { exact: true }).inputValue(), 'synthetic-history-only');
      await source.getByRole('button', { name: 'Hide previous password', exact: true }).click();
      await page.locator('[data-settings-document="password-attachments"]').getByText('fixture-document.txt', { exact: true }).waitFor();
      const password = editor.getByLabel('Password', { exact: true });
      await editor.getByRole('button', { name: 'Show Password', exact: true }).click();
      assert.equal(await password.getAttribute('type'), 'text');
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      assert.equal(await password.getAttribute('type'), 'password'); assert.equal(await password.inputValue(), '');
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      assert.equal(await password.inputValue(), 'synthetic-fixture-only');
      // An old positional property binding must not edit a reshaped JSON draft.
      const city = editor.getByLabel('Property: City', { exact: true });
      const staleBinding = await city.getAttribute('data-tt-action-inputs');
      await editor.getByRole('button', { name: 'Edit JSON', exact: true }).click();
      await editor.getByLabel('Address', { exact: true }).fill(JSON.stringify({ country: 'AU', city: 'New town', unknown: { enabled: true, count: 7.5 }, list: ['one', 'two'] }));
      await editor.getByRole('button', { name: 'Edit individual properties', exact: true }).click();
      const freshBinding = await city.getAttribute('data-tt-action-inputs');
      assert.notEqual(staleBinding, freshBinding);
      await city.evaluate((el, binding) => el.setAttribute('data-tt-action-inputs', binding), staleBinding);
      await city.fill('stale-binding-must-not-apply');
      await page.getByRole('button', { name: 'Save entry', exact: true }).click();
      await page.waitForTimeout(100);
      assert.deepEqual(JSON.parse(entry.fields.find(field => field.id === 'address').value), { country: 'AU', city: 'New town', unknown: { enabled: true, count: 7.5 }, list: ['one', 'two'] });
      await city.evaluate((el, binding) => el.setAttribute('data-tt-action-inputs', binding), freshBinding);
      await city.fill('New town');
      await page.evaluate(() => window.dispatchEvent(new Event('thingtime:hide-vault-values')));
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-tt-private-control]').count(), 0);
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      await editor.getByLabel('Password', { exact: true }).waitFor();
      currentOwner = 'password-editor-other-fixture';
      await page.evaluate(owner => window.changeFixturePasswordOwner(owner), currentOwner);
      await editor.waitFor({ state: 'hidden' });
      assert.equal(await page.locator('[data-tt-private-control]').count(), 0);
      currentOwner = ownerId;
      await page.evaluate(owner => window.changeFixturePasswordOwner(owner), currentOwner);
      await page.getByRole('button', { name: /Imported fixture/ }).click();
      await editor.getByLabel('Password', { exact: true }).waitFor();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.screenshot({ path: join(evidence, label + '.png'), fullPage: true });
      assert.equal(genericActions.length, 0); assert.deepEqual(errors, []);
      await writeFile(join(evidence, label + '.json'), JSON.stringify({ saves, layoutKeys: [...layouts.keys()], genericActions: 0, pageErrors: errors, sourceAndAttachmentsPreserved: true, blurLockAccountSwitchAndStaleBindings: true, width }, null, 2));
      console.log(label + ': structured save/readback, order, nested Builder persistence and privacy passed');
    } catch (error) { await writeFile(join(evidence, label + '-failure.txt'), await page.locator('body').innerText()); await page.screenshot({ path: join(evidence, label + '-failure.png'), fullPage: true }); console.error('Page errors', errors); throw error; } finally { await context.close(); }
  }
} finally { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); await rm(work, { recursive: true, force: true }); }
