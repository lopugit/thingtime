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
    const json = (route, payload) => route.fulfill({ json: payload });
    let begins = 0, callbacks = 0, linked = false;
    const pageErrors = [];
    context.on('page', page => page.on('pageerror', error => pageErrors.push(error.message)));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin === providerOrigin) {
        assert.equal(url.pathname, '/authorize');
        return route.fulfill({
          headers: { 'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin' },
          body: `<a href="${origin}${callbackPath}?code=fixture-code">Continue</a> <a href="${origin}${callbackPath}?error=access_denied">Decline</a>`
        });
      }
      if (url.origin !== origin) return route.abort();
      if (url.pathname.endsWith('thingtime-capabilities.json')) {
        const features = Object.fromEntries(['connections', 'connections-providers', 'connections-filters', 'connections-oauth-begin'].map(name => ['api.' + name, { version: '2.0.0' }]));
        return json(route, { schemaVersion: 1, origin, features });
      }
      if (url.pathname === endpoint + '/providers') {
        return json(route, { providers: [{ id: 'facebook-account', name: 'Facebook', icon: 'f', auth: 'oauth2', configured: true, contentVisibility: 'personal', about: 'Link a social account', fields: [] }] });
      }
      if (url.pathname === endpoint + '/filters') return json(route, { filters: [] });
      if (url.pathname === endpoint) return json(route, { connections: linked ? [{ id: 'fixture-link', provider: 'facebook-account', providerName: 'Facebook', contentVisibility: 'personal', account: { id: 'fixture-account', displayName: 'OAuth fixture account', handle: 'fixture' } }] : [] });
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
        await page.getByText('Finish signing in to Facebook in the new tab.').waitFor();
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
      await page.getByRole('button', { name: 'Stop waiting' }).click();
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
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await page.screenshot({ path: join(evidence, label + '-returned.png'), fullPage: true });
      assert.deepEqual(pageErrors, []);
      console.log(`PASS ${label}: blocked, declined, abandoned, successful, provider opener isolation and preserved Connections page`);
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  server?.close();
  await rm(work, { recursive: true, force: true });
}
