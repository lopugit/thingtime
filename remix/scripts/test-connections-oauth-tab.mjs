import { enableCurrentPageBuilder } from './lib/current-page-builder.mjs';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const require = createRequire(join(root, 'package.json'));
const esbuild = createRequire(require.resolve('tsx'))('esbuild');
const { chromium } = require(process.env.THINGTIME_TEST_PLAYWRIGHT_MODULE || 'playwright');
const work = await mkdtemp(join(tmpdir(), 'thingtime-connections-oauth-tab-'));
const evidence = resolve(process.argv[2] || join(tmpdir(), 'thingtime-connections-oauth-tab-evidence'));
const providerOrigin = 'https://oauth-provider.example.test';
const callbackPath = '/api/v1/connections/oauth/callback';
let browser, server;

try {
  await mkdir(evidence, { recursive: true });
  await esbuild.build({
    entryPoints: [join(root, 'scripts/connections-oauth-tab.browser.tsx')], bundle: true, format: 'esm',
    platform: 'browser', target: 'esnext', outfile: join(work, 'fixture.js'), tsconfig: join(root, 'tsconfig.json'),
    define: { 'process.env.NODE_ENV': '"development"' }, loader: { '.wasm': 'file' }, logLevel: 'error'
  });
  const script = await readFile(join(work, 'fixture.js'));
  server = createServer((request, response) => {
    if (request.url === '/fixture.js') {
      response.writeHead(200, { 'Content-Type': 'application/javascript' }).end(script);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });

  for (const [label, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, serviceWorkers: 'block' });
    const endpoint = '/api/v1/connections';
    const selectedOrigin = 'https://selected-api.example.test';
    const observedOrigins = [];
    const json = (route, payload) => {
      const selected = route.request().headers()['x-thingtime-expected-api-origin'];
      return route.fulfill({ json: payload, ...(selected === selectedOrigin ? { headers: { 'x-thingtime-api-fallback': selectedOrigin } } : {}) });
    };
    const firstOwner = 'oauth-tab-fixture-owner';
    const nextOwner = 'oauth-tab-other-owner';
    let begins = 0, callbacks = 0, linked = false, holdList, listStarted, listFinished, pendingNamed;
    const savedLayouts = new Map();
    const namedRows = [];
    const namedBegins = [];
    const account = (name, id) => ({ id: id + '-link', provider: 'facebook-account', providerName: 'Facebook', contentVisibility: 'personal', account: { id, displayName: name, handle: id } });
    const pageErrors = [];
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === providerOrigin) {
        assert.equal(url.pathname, '/authorize');
        return route.fulfill({
          headers: { 'content-type': 'text/html', 'cross-origin-opener-policy': label === 'phone' ? 'same-origin' : 'unsafe-none' },
          body: `<a href="${origin}${callbackPath}?code=fixture-code">Continue</a> <a href="${origin}${callbackPath}?error=access_denied">Decline</a>`
        });
      }
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('thingtime-capabilities.json')) {
        const features = Object.fromEntries(['connections', 'connections-providers', 'connections-filters', 'connections-oauth-begin'].map(name => ['api.' + name, { version: '2.0.0' }]));
        Object.assign(features, {
          'api.connections': { version: '2.1.0' }, 'api.connections-unlink': { version: '2.1.0' }, 'api.connections-oauth-begin': { version: '2.1.0' },
          'api.connections-oauth-callback': { version: '2.1.0' }, 'api.connections-provider-icon': { version: '1.0.0' }, 'api.connections-named': { version: '1.0.0' },
          'api.mongodb-endpoint': { version: '1.1.0' }, 'api.webpages-resolve': { version: '1.6.0' },
          'api.actions-run': { version: '1.7.0' }, 'api.things': { version: '1.36.0' }
        });
        return json(route, { schemaVersion: 1, origin, features });
      }
      if (url.pathname === '/connection-provider-fallback.svg') return route.fulfill({ path: join(root, 'public/connection-provider-fallback.svg'), contentType: 'image/svg+xml' });
      if (url.pathname === '/fixture-brand-override.png') {
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B9sAAAAASUVORK5CYII=', 'base64') });
      }
      if (url.pathname === endpoint + '/provider-icon') {
        assert.equal(route.request().headers().referer, undefined);
        const provider = url.searchParams.get('provider');
        if (provider === 'lemmy') return route.fulfill({ status: 204 });
        if (process.env.THINGTIME_TEST_PROVIDER_ICON_DIR) return route.fulfill({ path: join(process.env.THINGTIME_TEST_PROVIDER_ICON_DIR, provider + '.png'), contentType: 'image/png' });
        return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/B9sAAAAASUVORK5CYII=', 'base64') });
      }
      if (url.pathname.startsWith(endpoint)) observedOrigins.push(route.request().headers()['x-thingtime-expected-api-origin']);
      if (url.pathname === endpoint + '/providers') {
        const configured = route.request().headers()['x-thingtime-expected-api-origin'] !== selectedOrigin;
        return json(route, { providers: [{ id: 'facebook-account', name: 'Facebook', icon: 'f', auth: 'oauth2', configured, contentVisibility: 'personal', about: 'Link a social account', fields: [] },
          ...(configured ? [{ id: 'google', name: 'Google account', icon: 'g', auth: 'oauth2', configured, contentVisibility: 'personal', about: 'Link a Google account', fields: [] },
            { id: 'google-drive', name: 'Google Drive for documents shared with this workspace', icon: 'g', auth: 'oauth2', configured, contentVisibility: 'personal', about: 'Select Drive scopes', fields: [] },
            ...[['google-gmail', 'Gmail'], ['google-docs', 'Google Docs'], ['google-sheets', 'Google Sheets'], ['lemmy', 'Lemmy']].map(([id, name]) =>
              ({ id, name, icon: '', auth: 'oauth2', configured, contentVisibility: 'personal', about: `Connect ${name}`, fields: [] }))] : [])] });
      }
      if (url.pathname === '/api/v1/webpages/resolve') {
        const savedLayout = savedLayouts.get(url.searchParams.get('id'));
        return savedLayout && route.request().headers()['x-thingtime-expected-actor'] === firstOwner
          ? json(route, { ok: true, source: 'user', page: savedLayout }) : route.fulfill({ status: 404 });
      }
      if (url.pathname === '/api/v1/things' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        assert.equal(route.request().headers()['x-thingtime-expected-actor'], firstOwner);
        assert.ok(['settings-connections-oauth-pending', 'settings-named-auth-connections', 'settings-connections-provider-catalog'].includes(body.crystal.pageKey));
        assert.deepEqual(body.acl, ['tt:user']);
        const savedLayout = { id: body.shareId, author: { id: firstOwner }, updatedAt: '2026-11-04T00:00:00Z', crystal: body.crystal };
        savedLayouts.set(body.crystal.pageKey, savedLayout);
        return json(route, { ok: true, thing: savedLayout });
      }
      if (url.pathname === endpoint + '/filters') {
        return json(route, { filters: route.request().headers()['x-thingtime-expected-actor'] === firstOwner
          ? [{ id: 'private-filter', name: 'First owner private filter', prompt: 'Fixture-only rule', action: 'hide', enabled: true }] : [] });
      }
      if (url.pathname === endpoint) {
        const actor = route.request().headers()['x-thingtime-expected-actor'];
        const selected = route.request().headers()['x-thingtime-expected-api-origin'];
        if (selected === selectedOrigin) return json(route, { connections: [account('Selected API connection', 'selected')] });
        assert.equal(selected, origin);
        if (actor === nextOwner) return json(route, { connections: [account('Other owner connection', 'other')] });
        assert.equal(actor, firstOwner);
        if (holdList) {
          listStarted();
          await holdList;
          return json(route, { connections: [account('Late previous owner connection', 'late')] }).catch(() => {}).finally(listFinished);
        }
        return json(route, { connections: [...(linked ? [account('OAuth fixture account', 'fixture')] : []),
          ...(url.searchParams.get('includeNamed') === '1' ? namedRows : [])] });
      }
      if (url.pathname === endpoint + '/oauth/begin') {
        const body = route.request().postDataJSON();
        if (body.named) {
          assert.equal(body.expectedOwnerId, firstOwner);
          assert.equal(body.provider, 'google');
          assert.ok(body.named.allowedOperations.includes('google.profile'));
          assert.deepEqual(body.named.requestedScopes, ['profile']);
          namedBegins.push(body.named);
          pendingNamed = body.named;
        } else assert.deepEqual(body, { provider: 'facebook-account', expectedOwnerId: 'oauth-tab-fixture-owner' });
        begins++;
        return json(route, { authorizeUrl: providerOrigin + '/authorize' });
      }
      if (url.pathname === callbackPath) {
        callbacks++;
        if (pendingNamed && !url.searchParams.has('error')) {
          const reconnectIndex = pendingNamed.reconnectId ? namedRows.findIndex(row => row.id === pendingNamed.reconnectId) : -1;
          assert.ok(!pendingNamed.reconnectId || reconnectIndex >= 0);
          const saved = { ...account('Named provider identity', 'same-google-subject'), id: reconnectIndex >= 0 ? pendingNamed.reconnectId : 'named-' + namedRows.length,
            provider: 'google', providerName: 'Google account', named: { name: pendingNamed.name, requestedScopes: ['openid', 'profile'],
              grantedScopes: ['openid', 'profile'], allowedOperations: pendingNamed.allowedOperations } };
          if (reconnectIndex >= 0) namedRows[reconnectIndex] = saved; else namedRows.push(saved);
          pendingNamed = undefined;
          return route.fulfill({ status: 302, headers: { location: origin + '/connections?connected=google' } });
        }
        if (!url.searchParams.has('error')) linked = true;
        return route.fulfill({ status: 302, headers: { location: origin + '/connections?' + (linked ? 'connected=facebook-account' : 'oauthError=declined') } });
      }
      if (url.pathname === endpoint + '/unlink') {
        assert.equal(route.request().postDataJSON().id, 'fixture-link');
        assert.equal(route.request().postDataJSON().expectedOwnerId, firstOwner);
        linked = false;
        return json(route, { ok: true });
      }
      if (url.pathname === endpoint + '/named') {
        const body = route.request().postDataJSON();
        assert.deepEqual(body, { id: 'named-1', operation: 'google.profile', expectedOwnerId: firstOwner });
        return json(route, { ok: true, result: { name: 'Named profile result' } });
      }
      if (url.pathname.startsWith('/api/')) return json(route, { ok: true });
      return route.continue();
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const initial = origin + '/connections?keep=1';
      await page.goto(initial);
      const signIn = page.getByRole('button', { name: /Default sign-in with Facebook/ });
      await signIn.waitFor();
      const catalogHost = page.locator('[data-settings-document="connections-provider-catalog"]');
      const logo = '[data-block-id="connections-provider-logo"]';
      const facebookCard = signIn.locator('..');
      const mark = facebookCard.locator(logo);
      await mark.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-block-id="connections-provider-logo"]')].some(img => img.src.includes('provider=facebook') && img.naturalWidth > 0));
      const driveMark = page.getByRole('button', { name: /Default sign-in with Lemmy/ }).locator('..').locator(logo);
      await driveMark.scrollIntoViewIfNeeded();
      await driveMark.locator('xpath=self::*[contains(@src,"connection-provider-fallback.svg")]').waitFor();
      for (const icon of [mark, driveMark]) {
        const bounds = await icon.boundingBox();
        assert.deepEqual([bounds.width, bounds.height], [24, 24]);
        assert.equal(await icon.getAttribute('aria-hidden'), 'true');
      }
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2 && document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(evidence, `provider-icons-${label}.png`), fullPage: true });
      await page.evaluate(() => window.scrollTo(0, 0));
      if (label === 'desktop') {
        await enableCurrentPageBuilder(page);
        await catalogHost.getByRole('button', { name: 'Edit provider cards', exact: true }).click();
        await catalogHost.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
        const drawer = page.getByTestId('builder-drawer');
        const picker = drawer.getByRole('combobox', { name: 'Select block', exact: true });
        for (const [id, value] of [['title', 'Service: {item.name}'], ['description', 'Details: {item.about}'], ['connect', 'Continue: {item.buttonLabel}']]) {
          await picker.selectOption('connections-provider-' + id);
          await drawer.getByRole('textbox', { name: 'Block text', exact: true }).fill(value);
        }
        await picker.selectOption('connections-provider-logo');
        assert.equal(await drawer.getByRole('button', { name: 'Upload file' }).isEnabled(), true);
        assert.equal(await drawer.getByRole('textbox', { name: 'Element src' }).count(), 0);
        await drawer.getByRole('button', { name: 'Use URL instead' }).click();
        await drawer.getByRole('textbox', { name: 'Element src' }).fill('/fixture-brand-override.png');
        await catalogHost.getByRole('button', { name: 'Save layout', exact: true }).click();
        await catalogHost.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
        await page.reload();
        await signIn.waitFor();
        await catalogHost.getByRole('heading', { name: 'Service: Facebook', exact: true }).waitFor();
        await catalogHost.getByText('Details: Link a social account', { exact: true }).waitFor();
        await catalogHost.getByRole('button', { name: 'Continue: Default sign-in with Facebook', exact: true }).waitFor();
        await catalogHost.locator(logo + '[src="/fixture-brand-override.png"]').first().waitFor();
      }
      const pendingCopy = label === 'desktop' ? 'Complete Facebook sign-in in your new tab.' : 'Finish signing in to Facebook in the new tab.';
      const stopCopy = label === 'desktop' ? 'End sign-in wait' : 'Stop waiting';
      if (label === 'desktop') {
        await enableCurrentPageBuilder(page);
        const host = page.locator('[data-settings-document="connections-oauth-pending"]');
        await host.getByRole('button', { name: 'Edit sign-in status', exact: true }).click();
        await host.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
        const drawer = page.getByTestId('builder-drawer');
        for (const [id, value] of [['connections-oauth-message', 'Complete {oauth.provider} sign-in in your new tab.'], ['connections-oauth-stop', stopCopy]]) {
          await drawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
          const field = drawer.getByRole('textbox', { name: 'Block text', exact: true });
          await field.fill(value);
          await field.blur();
        }
        await page.getByRole('button', { name: 'Close builder', exact: true }).click();
        await host.getByRole('button', { name: 'Save layout', exact: true }).click();
        await host.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
        assert.ok(savedLayouts.has('settings-connections-oauth-pending'));
        await page.reload();
        await signIn.waitFor();
      }
      await page.evaluate(() => { window.__oauthFixtureOpen = window.open; window.open = () => null; });
      await signIn.click();
      await page.getByText('Allow pop-ups for Thingtime, then try signing in again').first().waitFor();
      assert.equal(begins, 0);
      assert.equal(page.url(), initial);
      await page.evaluate(() => { window.open = window.__oauthFixtureOpen; });

      const begin = async () => {
        const popup = context.waitForEvent('page');
        await signIn.click();
        const tab = await popup;
        await tab.waitForURL(providerOrigin + '/authorize');
        assert.equal(await tab.evaluate(() => window.opener === null), true);
        assert.equal(page.url(), initial);
        await page.getByText(pendingCopy, { exact: true }).waitFor();
        assert.equal(await signIn.isDisabled(), true);
        return tab;
      };
      const declined = await begin();
      await page.screenshot({ path: join(evidence, label + '-pending.png'), fullPage: true });
      const declineClosed = declined.waitForEvent('close', { timeout: 5000 });
      await declined.getByRole('link', { name: 'Decline' }).click();
      await page.getByText('That sign-in was declined', { exact: false }).first().waitFor();
      await declineClosed;
      assert.equal(await signIn.isEnabled(), true);
      assert.equal(linked, false);

      const abandoned = await begin();
      await abandoned.close();
      await page.getByRole('button', { name: stopCopy }).click();
      assert.equal(await signIn.isEnabled(), true);
      assert.equal(callbacks, 1);

      const approved = await begin();
      const approvedClosed = approved.waitForEvent('close', { timeout: 5000 });
      await approved.getByRole('link', { name: 'Continue' }).click();
      await approvedClosed;
      const linkedCard = page.locator('[data-block-id="connections-linked-card"]').filter({ hasText: 'OAuth fixture account' });
      const linkedMark = linkedCard.locator('[data-block-id="connections-linked-logo"]');
      await linkedMark.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => [...document.querySelectorAll('[data-block-id="connections-linked-logo"]')].some(img => img.src.includes('provider=facebook') && img.naturalWidth > 0));
      assert.equal(await linkedCard.getByRole('link', { name: 'Feed', exact: true }).getAttribute('href'), '/connections/feed?connection=fixture-link');
      assert.equal(await linkedCard.getByRole('button', { name: 'Unlink', exact: true }).isEnabled(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(evidence, `provider-icons-linked-${label}.png`), fullPage: true });
      await page.getByText('OAuth fixture account').waitFor();
      assert.equal(await signIn.isEnabled(), true);
      assert.equal(page.url(), initial);
      assert.equal(begins, 3);
      assert.equal(callbacks, 2);
      let releaseList;
      holdList = new Promise(resolve => { releaseList = resolve; });
      const firstOwnerRead = new Promise(resolve => { listStarted = resolve; });
      const lateOwnerReply = new Promise(resolve => { listFinished = resolve; });
      await page.reload();
      await firstOwnerRead;
      await page.getByText('OAuth fixture account').waitFor();
      await page.getByText('First owner private filter').waitFor();
      await page.evaluate(owner => window.changeFixtureConnectionOwner(owner), nextOwner);
      await page.getByText('Other owner connection').waitFor();
      assert.equal(await page.getByText('OAuth fixture account').count(), 0);
      assert.equal(await page.getByText('First owner private filter').count(), 0);
      releaseList();
      await lateOwnerReply;
      assert.equal(await page.getByText('Late previous owner connection').count(), 0);
      await page.evaluate(() => window.changeFixtureConnectionOwner(null));
      await page.getByText('Sign in to link your apps').waitFor();
      assert.equal(await page.getByText('Other owner connection').count(), 0);
      assert.equal(await page.getByText('Late previous owner connection').count(), 0);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(evidence, label + '-returned.png'), fullPage: true });
      holdList = undefined;
      await page.evaluate(owner => window.changeFixtureConnectionOwner(owner), firstOwner);
      const namedHost = page.locator('[data-settings-document="named-auth-connections"]');
      await namedHost.getByRole('button', { name: 'Add named connection' }).waitFor();
      if (label === 'desktop') {
        await enableCurrentPageBuilder(page);
        await namedHost.getByRole('button', { name: 'Edit layout', exact: true }).click();
        await namedHost.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
        const drawer = page.getByTestId('builder-drawer');
        for (const [id, value] of [['named-name-label', 'Purpose name'], ['named-access-label', 'Choose approved operations']]) {
          await drawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
          const field = drawer.getByRole('textbox', { name: 'Block text', exact: true });
          await field.fill(value); await field.blur();
        }
        await page.getByRole('button', { name: 'Close builder', exact: true }).click();
        await namedHost.getByRole('button', { name: 'Save layout', exact: true }).click();
        await namedHost.getByText('Unsaved layout', { exact: true }).waitFor({ state: 'hidden' });
        assert.ok(savedLayouts.has('settings-named-auth-connections'));
        await page.reload();
      }
      await namedHost.getByText('Choose a provider for named access', { exact: true }).click();
      await namedHost.getByRole('button', { name: 'Add Google Drive for documents shared with this workspace connection' }).click();
      await namedHost.getByRole('textbox', { name: 'Connection name' }).fill('Drive metadata fixture');
      await namedHost.getByRole('checkbox', { name: 'View file metadata' }).check();
      assert.ok(await namedHost.getByRole('checkbox', { name: 'View file metadata' }).isChecked());
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Google profile name and photo' }).count(), 0);
      await namedHost.getByText('Provider permissions to request', { exact: true }).scrollIntoViewIfNeeded();
      const overflow = await page.evaluate(() => {
        if (document.documentElement.scrollWidth <= innerWidth + 1) return [];
        return [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1)
          .slice(0, 8).map(element => element.getAttribute('data-block-id') || element.tagName);
      });
      assert.deepEqual(overflow, [], 'Long provider names must not overflow the permission form');
      const catalog = page.getByText('Connect a 3rd party app', { exact: true }).locator('..');
      const catalogBounds = await catalog.boundingBox();
      assert.ok(catalogBounds);
      for (const card of await catalog.getByRole('button', { name: /^Default sign-in with/ }).all()) {
        const bounds = await card.locator('..').boundingBox();
        assert.ok(bounds && bounds.x >= catalogBounds.x - 1 && bounds.x + bounds.width <= catalogBounds.x + catalogBounds.width + 1,
          'Provider card must fit within the Connections content column');
      }
      await page.screenshot({ path: join(evidence, label + '-named-permission-form.png'), fullPage: true });
      await namedHost.getByRole('button', { name: 'Cancel', exact: true }).click();
      for (const name of ['Reading profile', 'Second profile with a long descriptive name for research notes']) {
        await namedHost.getByRole('button', { name: 'Add named connection' }).click();
        await namedHost.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('google');
        if (label === 'desktop') {
          await namedHost.getByText('Purpose name', { exact: true }).waitFor();
          await namedHost.getByText('Choose approved operations', { exact: true }).waitFor();
        }
        await namedHost.getByRole('textbox', { name: 'Connection name' }).fill(name);
        await namedHost.getByRole('checkbox', { name: 'Profile name and photo', exact: true }).check();
        await namedHost.getByRole('checkbox', { name: 'Google profile name and photo' }).check();
        const newPage = context.waitForEvent('page');
        await namedHost.getByRole('button', { name: 'Continue to sign in' }).click();
        const authorization = await newPage;
        await authorization.waitForURL(providerOrigin + '/authorize');
        await authorization.getByRole('link', { name: 'Continue' }).click();
        await namedHost.getByRole('heading', { name, exact: true }).waitFor();
      }
      assert.equal(namedRows.length, 2);
      await namedHost.getByRole('combobox', { name: 'Connection', exact: true }).selectOption('named-1');
      await namedHost.getByRole('button', { name: 'Google profile name and photo' }).click();
      await namedHost.getByText('name: Named profile result').waitFor();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => scrollY + innerHeight >= document.documentElement.scrollHeight - 2), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(evidence, label + '-named-connections.png'), fullPage: true });
      await writeFile(join(evidence, label + '-named-rendered-result.json'), JSON.stringify({
        viewport: { width, height }, permissionForm: label + '-named-permission-form.png',
        savedCards: label + '-named-connections.png', selectedOperation: 'google.profile', selectedId: 'named-1',
        renderedResult: await namedHost.getByText('name: Named profile result').textContent(),
        namedProfiles: namedRows.map(row => ({ id: row.id, name: row.named.name, requested: row.named.requestedScopes, confirmed: row.named.grantedScopes, allowed: row.named.allowedOperations })),
        drivePicker: { metadataSelected: true, identityOperationAvailable: true, profileOperationAvailable: false },
        separateBuilderLabelsSaved: label === 'desktop'
      }, null, 2));
      const second = namedHost.getByRole('article').filter({ hasText: 'Second profile with a long descriptive name for research notes' });
      const refreshWithoutRemount = async () => {
        const authorization = await begin();
        await authorization.getByRole('link', { name: 'Continue' }).click();
      };
      namedRows[1].named.grantedScopes = ['openid'];
      await refreshWithoutRemount();
      await second.getByText('Provider confirmed: openid', { exact: true }).waitFor();
      assert.equal(await namedHost.getByText('name: Named profile result').count(), 0);
      namedRows[1].named.grantedScopes = ['openid', 'profile'];
      await refreshWithoutRemount();
      await second.getByText('Provider confirmed: openid, profile', { exact: true }).waitFor();
      assert.equal(await namedHost.getByText('name: Named profile result').count(), 0, 'Restoring old scope metadata must not restore the old result');
      await namedHost.getByRole('button', { name: 'Google profile name and photo' }).click();
      await namedHost.getByText('name: Named profile result').waitFor();
      await second.getByRole('button', { name: 'Reconnect', exact: true }).click();
      assert.equal(await namedHost.getByText('name: Named profile result').count(), 0);
      const reconnectName = 'Second profile with a long descriptive name for research notes';
      assert.equal(await namedHost.getByRole('textbox', { name: 'Connection name' }).inputValue(), reconnectName,
        'Reconnect must prefill its saved name without requiring the user to type it again');
      assert.equal(await namedHost.getByRole('combobox', { name: 'Provider', exact: true }).isDisabled(), true);
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Profile name and photo', exact: true }).isChecked(), true);
      const reconnectPage = context.waitForEvent('page');
      await namedHost.getByRole('button', { name: 'Continue to sign in' }).click();
      const reconnectAuthorization = await reconnectPage;
      const reconnectClosed = reconnectAuthorization.waitForEvent('close', { timeout: 5000 });
      await reconnectAuthorization.getByRole('link', { name: 'Continue' }).click();
      await reconnectClosed;
      await second.getByRole('button', { name: 'Reconnect', exact: true }).waitFor();
      assert.equal(namedRows.length, 2, 'Reconnect replaces only the intended grant');
      assert.deepEqual(namedBegins.at(-1), { ...namedBegins[1], requestId: namedBegins.at(-1).requestId, reconnectId: 'named-1' });
      assert.equal(namedRows[1].named.name, reconnectName);
      assert.deepEqual(namedRows[1].named.requestedScopes, ['openid', 'profile']);
      await namedHost.getByRole('button', { name: 'Add named connection' }).click();
      await namedHost.getByRole('combobox', { name: 'Provider', exact: true }).selectOption('google');
      const nameField = namedHost.getByRole('textbox', { name: 'Connection name' });
      assert.equal(await nameField.inputValue(), '', 'A new grant must not inherit the reconnect name');
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Profile name and photo', exact: true }).isChecked(), false);
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Email address', exact: true }).isChecked(), false);
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Saved account identity', exact: true }).isChecked(), true);
      assert.equal(await namedHost.getByRole('checkbox', { name: 'Google profile name and photo', exact: true }).isChecked(), false);
      const beginsBeforeInvalid = begins;
      await namedHost.getByRole('button', { name: 'Continue to sign in' }).click();
      await namedHost.getByRole('alert').filter({ hasText: 'Enter a connection name to continue.' }).waitFor();
      assert.equal(await nameField.getAttribute('aria-invalid'), 'true');
      assert.equal(await nameField.getAttribute('aria-describedby'), 'named-form-error');
      await page.screenshot({ path: join(evidence, label + '-named-validation.png'), fullPage: true });
      await nameField.fill('New identity fixture');
      await namedHost.getByRole('checkbox', { name: 'Saved account identity', exact: true }).uncheck();
      await namedHost.getByRole('button', { name: 'Continue to sign in' }).click();
      await namedHost.getByRole('alert').filter({ hasText: 'Choose at least one allowed operation to continue.' }).waitFor();
      assert.equal(await nameField.inputValue(), 'New identity fixture', 'Validation preserves entered text');
      assert.equal(begins, beginsBeforeInvalid, 'Invalid forms never start provider authorization');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await namedHost.getByRole('button', { name: 'Cancel', exact: true }).click();
      if (label === 'desktop') {
        holdList = undefined;
        await page.close();
        await context.addInitScript(() => {
          window.thingtimeDesktop = { getInfo: () => new Promise(resolve => { window.resolveFixtureDesktopInfo = resolve; }) };
        });
        const hosted = await context.newPage();
        const nativeRequests = observedOrigins.length;
        await hosted.goto(initial);
        await hosted.waitForFunction(() => typeof window.resolveFixtureDesktopInfo === 'function');
        assert.equal(await hosted.getByRole('button', { name: 'Default sign-in with Facebook' }).count(), 0);
        assert.equal(observedOrigins.length, nativeRequests);
        await hosted.evaluate(() => window.resolveFixtureDesktopInfo({}));
        assert.equal(observedOrigins.length, nativeRequests);

        const selectOrigin = async selected => {
          await hosted.evaluate(async () => {
            window.resolveFixtureDesktopInfo = undefined;
            await window.changeFixtureConnectionOwner('oauth-tab-fixture-owner');
          });
          await hosted.waitForFunction(() => typeof window.resolveFixtureDesktopInfo === 'function');
          await hosted.evaluate(value => window.resolveFixtureDesktopInfo({ apiOrigin: value }), selected);
        };
        // The cache can paint the account and provider before all three reads
        // reach the network. Drain this generation before counting new reads.
        const firstOriginReads = Promise.all([endpoint, endpoint + '/providers', endpoint + '/filters'].map(path =>
          hosted.waitForResponse(response => new URL(response.url()).pathname === path &&
            response.request().headers()['x-thingtime-expected-api-origin'] === origin)));
        await selectOrigin(origin);
        await hosted.getByText('OAuth fixture account').waitFor();
        await hosted.getByRole('button', { name: 'Default sign-in with Facebook' }).waitFor();
        await firstOriginReads;
        const beforeSwitch = observedOrigins.length;
        await hosted.evaluate(async () => {
          window.resolveFixtureDesktopInfo = undefined;
          await window.changeFixtureConnectionOwner('oauth-tab-fixture-owner');
        });
        await hosted.waitForFunction(() => typeof window.resolveFixtureDesktopInfo === 'function');
        assert.equal(await hosted.getByText('OAuth fixture account').count(), 0);
        assert.equal(await hosted.getByRole('button', { name: 'Default sign-in with Facebook' }).count(), 0);
        assert.equal(observedOrigins.length, beforeSwitch);
        await hosted.evaluate(value => window.resolveFixtureDesktopInfo({ apiOrigin: value }), selectedOrigin);
        await hosted.getByText('Selected API connection').waitFor();
        assert.equal(await hosted.getByRole('button', { name: 'Needs setup' }).isDisabled(), true);
        assert.ok(observedOrigins.slice(beforeSwitch).every(value => value === selectedOrigin));
        await hosted.close();
      }
      if (label === 'phone') {
        const unlinkRequest = page.waitForResponse(response => new URL(response.url()).pathname === endpoint + '/unlink');
        await linkedCard.getByRole('button', { name: 'Unlink', exact: true }).click();
        assert.equal((await unlinkRequest).status(), 200);
        await linkedCard.waitFor({ state: 'detached' });
        assert.equal(linked, false);
      }
      assert.deepEqual(pageErrors, []);
      console.log(`PASS ${label}: blocked, declined, abandoned, successful, provider opener isolation, account/origin fences, named connection create/use, and layout persistence`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server?.close();
  await rm(work, { recursive: true, force: true });
}
