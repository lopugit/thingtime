import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
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
    let begins = 0, callbacks = 0, linked = false, holdList, listStarted, listFinished, savedLayout;
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
          'api.mongodb-endpoint': { version: '1.1.0' }, 'api.webpages-resolve': { version: '1.6.0' },
          'api.actions-run': { version: '1.7.0' }, 'api.things': { version: '1.36.0' }
        });
        return json(route, { schemaVersion: 1, origin, features });
      }
      if (url.pathname.startsWith(endpoint)) observedOrigins.push(route.request().headers()['x-thingtime-expected-api-origin']);
      if (url.pathname === endpoint + '/providers') {
        const configured = route.request().headers()['x-thingtime-expected-api-origin'] !== selectedOrigin;
        return json(route, { providers: [{ id: 'facebook-account', name: 'Facebook', icon: 'f', auth: 'oauth2', configured, contentVisibility: 'personal', about: 'Link a social account', fields: [] }] });
      }
      if (url.pathname === '/api/v1/webpages/resolve') {
        return savedLayout && route.request().headers()['x-thingtime-expected-actor'] === firstOwner
          ? json(route, { ok: true, source: 'user', page: savedLayout }) : route.fulfill({ status: 404 });
      }
      if (url.pathname === '/api/v1/things' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        assert.equal(route.request().headers()['x-thingtime-expected-actor'], firstOwner);
        assert.equal(body.crystal.pageKey, 'settings-connections-oauth-pending');
        assert.deepEqual(body.acl, ['tt:user']);
        savedLayout = { id: body.shareId, author: { id: firstOwner }, updatedAt: '2026-11-04T00:00:00Z', crystal: body.crystal };
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
        return json(route, { connections: linked ? [account('OAuth fixture account', 'fixture')] : [] });
      }
      if (url.pathname === endpoint + '/oauth/begin') {
        const body = route.request().postDataJSON();
        assert.deepEqual(body, { provider: 'facebook-account', expectedOwnerId: 'oauth-tab-fixture-owner' });
        begins++;
        return json(route, { authorizeUrl: providerOrigin + '/authorize' });
      }
      if (url.pathname === callbackPath) {
        callbacks++;
        if (!url.searchParams.has('error')) linked = true;
        return route.fulfill({ status: 302, headers: { location: origin + '/connections?' + (linked ? 'connected=facebook-account' : 'oauthError=declined') } });
      }
      if (url.pathname.startsWith('/api/')) return json(route, { ok: true });
      return route.continue();
    });

    try {
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      const initial = origin + '/connections?keep=1';
      await page.goto(initial);
      const signIn = page.getByRole('button', { name: 'Sign in with Facebook' });
      await signIn.waitFor();
      const pendingCopy = label === 'desktop' ? 'Complete Facebook sign-in in your new tab.' : 'Finish signing in to Facebook in the new tab.';
      const stopCopy = label === 'desktop' ? 'End sign-in wait' : 'Stop waiting';
      if (label === 'desktop') {
        const host = page.locator('[data-settings-document="connections-oauth-pending"]');
        await host.getByRole('button', { name: 'Edit layout', exact: true }).click();
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
        assert.ok(savedLayout);
        await page.reload();
        await signIn.waitFor();
      }
      await page.evaluate(() => { window.__oauthFixtureOpen = window.open; window.open = () => null; });
      await signIn.click();
      await page.getByText('Allow pop-ups for Thingtime, then try signing in again').waitFor();
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
      await page.getByText('That sign-in was declined', { exact: false }).waitFor();
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
        assert.equal(await hosted.getByRole('button', { name: 'Sign in with Facebook' }).count(), 0);
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
        await hosted.getByRole('button', { name: 'Sign in with Facebook' }).waitFor();
        await firstOriginReads;
        const beforeSwitch = observedOrigins.length;
        await hosted.evaluate(async () => {
          window.resolveFixtureDesktopInfo = undefined;
          await window.changeFixtureConnectionOwner('oauth-tab-fixture-owner');
        });
        await hosted.waitForFunction(() => typeof window.resolveFixtureDesktopInfo === 'function');
        assert.equal(await hosted.getByText('OAuth fixture account').count(), 0);
        assert.equal(await hosted.getByRole('button', { name: 'Sign in with Facebook' }).count(), 0);
        assert.equal(observedOrigins.length, beforeSwitch);
        await hosted.evaluate(value => window.resolveFixtureDesktopInfo({ apiOrigin: value }), selectedOrigin);
        await hosted.getByText('Selected API connection').waitFor();
        assert.equal(await hosted.getByRole('button', { name: 'Needs setup' }).isDisabled(), true);
        assert.ok(observedOrigins.slice(beforeSwitch).every(value => value === selectedOrigin));
        await hosted.close();
      }
      assert.deepEqual(pageErrors, []);
      console.log(`PASS ${label}: blocked, declined, abandoned, successful, provider opener isolation, cached owner paint, late-response and sign-out fences`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server?.close();
  await rm(work, { recursive: true, force: true });
}
