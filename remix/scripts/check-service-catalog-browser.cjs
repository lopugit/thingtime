// Runs only inside the task-owned network-none browser container. All data and
// credentials below are synthetic; no provider or production account is used.
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const assert = require('node:assert/strict');
const puppeteer = require('/opt/thingtime-browser/node_modules/puppeteer-core');
const root = '/home/pwuser/credential-qa';
const results = `${root}/results`;
const owner = 'synthetic-service-owner';
const origin = 'http://127.0.0.1:17643';
const pages = new Map();
let revision = 0;
let entries = [{ id: 'ai-one', name: 'Personal', kind: 'provider', provider: 'openai' }];
const vaultActions = [];
const connectionCalls = [];
let connectionVersion = '2.0.0';
const report = { outcome: 'running', checks: [], errors: [], scope: 'Real service/AI account, overview, channel/filter blocks and Builder; synthetic identities, callbacks and HTTP responses only.' };
const record = async (check) => { report.checks.push(check); await fs.writeFile(`${results}/report.json`, JSON.stringify(report, null, 2)); console.log(check); };

async function api(req, res, url) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  const body = raw ? JSON.parse(raw) : {};
  const send = (value, status = 200) => {
    const encoded = JSON.stringify(value);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'Content-Length': Buffer.byteLength(encoded) });
    res.end(encoded);
  };
  if (url.pathname.includes('well-known')) return send({ schemaVersion: 1, origin, features: Object.fromEntries(Object.entries({
    'api.webpages-resolve': '1.6.0', 'api.actions-run': '1.39.0', 'api.mongodb-endpoint': '1.1.0',
    'api.things': '1.42.0', 'api.things-update': '1.13.0', 'api.lopu-vault': '1.4.0',
    ...Object.fromEntries(['connections-providers', 'connections', 'connections-oauth-begin', 'connections-oauth-callback', 'connections-feed', 'connections-request'].map(feature => [`api.${feature}`, connectionVersion]))
  }).map(([key, version]) => [key, { version }])) });
  if (url.pathname.startsWith('/api/v1/connections')) {
    connectionCalls.push(url.pathname);
    if (url.pathname.endsWith('/oauth/begin')) {
      assert.equal(body.provider, 'google-drive');
      return send({ ok: true, provider: body.provider, authorizeUrl: 'https://provider.invalid/synthetic-consent' });
    }
    return send({ ok: true, ownerId: owner, providers: [], connections: [], posts: [], data: { subject: 'synthetic-only' } });
  }
  if (url.pathname.endsWith('/webpages/resolve')) {
    if (req.headers['x-thingtime-expected-actor'] !== owner || req.headers['x-thingtime-expected-data-plane'] !== 'home') return send({ ok: false }, 409);
    const page = pages.get(url.searchParams.get('id'));
    return page ? send({ ok: true, source: 'user', page }) : send({ ok: false }, 404);
  }
  if (url.pathname.endsWith('/things') && ['POST', 'PATCH'].includes(req.method)) {
    if (req.headers['x-thingtime-expected-actor'] !== owner || req.headers['x-thingtime-expected-data-plane'] !== 'home') return send({ ok: false }, 409);
    const existing = pages.get(body.crystal?.pageKey);
    if (req.method === 'POST' && existing) return send({ ok: false }, 409);
    if (req.method === 'PATCH' && (!existing || body.id !== existing.id || body.expectedUpdatedAt !== existing.updatedAt)) return send({ ok: false }, 409);
    const page = { id: body.id || body.shareId, crystal: body.crystal, author: { id: owner }, updatedAt: new Date(1800000000000 + ++revision).toISOString(), acl: ['tt:user'] };
    pages.set(page.crystal.pageKey, page);
    return send({ ok: true, thing: page });
  }
  if (url.pathname.endsWith('/lopu/vault')) {
    if (req.method === 'GET') return send({ ok: true, ownerId: owner, entries, vaultConfigured: true });
    if (body.expectedOwnerId !== owner) return send({ ok: false }, 409);
    if (body.action === 'save-provider') {
      assert.equal(body.provider, 'openai');
      assert.equal(body.endpoint, 'https://api.openai.com/v1');
      assert.equal(body.name, 'Synthetic workspace');
      assert.equal(body.token, 'fixture-ai-token');
      entries.push({ id: 'ai-synthetic-saved', name: body.name, kind: 'provider', provider: body.provider });
      vaultActions.push('save-provider');
      return send({ ok: true });
    }
    if (body.action === 'delete') {
      assert.ok(entries.some(entry => entry.id === body.id));
      entries = entries.filter(entry => entry.id !== body.id);
      vaultActions.push('delete');
      return send({ ok: true });
    }
    return send({ ok: false }, 400);
  }
  return send({ ok: true, ownerId: owner, messages: [], tasks: [], things: [] });
}

let browser, server;
(async () => {
  await fs.mkdir(results, { recursive: true });
  try {
    assert.equal(Object.values(os.networkInterfaces()).flat().filter(item => !item.internal).length, 0);
    assert.equal((await fs.readFile('/proc/net/route', 'utf8')).trim().split('\n').length, 1);
    await assert.rejects(fetch('http://1.1.1.1', { signal: AbortSignal.timeout(2000) }));
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, origin);
        if (url.pathname.startsWith('/api/') || url.pathname.includes('well-known')) return await api(req, res, url);
        if (url.pathname === '/redirect-test') { res.writeHead(302, { location: 'http://1.1.1.1' }); res.end(); return; }
        const file = root + '/dist' + (url.pathname === '/' ? '/scripts/service-catalog.browser.html' : url.pathname);
        res.setHeader('Content-Type', file.endsWith('.js') ? 'application/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
        res.end(await fs.readFile(file));
      } catch (error) {
        if (error.code === 'ENOENT') { res.writeHead(404); res.end(); return; }
        report.errors.push(error.message); res.writeHead(500); res.end();
      }
    });
    await new Promise(resolve => server.listen(17643, '127.0.0.1', resolve));
    const descriptor = JSON.parse(await fs.readFile('/opt/thingtime-browser/browser.json', 'utf8'));
    browser = await puppeteer.launch({ executablePath: descriptor.executable, headless: true, pipe: true, userDataDir: root + '/profile', args: ['--no-proxy-server', '--disable-background-networking'] });
    assert.ok(!browser.process().spawnargs.includes('--no-sandbox'));
    const page = await browser.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await assert.rejects(page.goto(origin + '/redirect-test', { timeout: 4000 }));
    await record('kernel network boundary blocks backend direct IP and browser redirect; Chromium sandbox retained');
    await page.tracing.start({ path: results + '/trace.json', screenshots: false });
    const delay = () => new Promise(resolve => setTimeout(resolve, 150));
    const block = (id) => `[data-block-id="${id}"]`;
    const catalog = '[data-settings-document="services-catalog"]';
    const ai = '[data-settings-document="services-ai"]';
    const overview = '[data-settings-document="connections-overview"]';
    const tools = '[data-settings-document="connections-tools"]';
    const appPassword = 'fieldset[aria-label="App password"]';
    const google = 'fieldset[aria-label="Google Drive"]';
    const openai = `${ai} section[aria-label="OpenAI"]`;
    const clickText = async (scope, text) => {
      await page.waitForFunction((scope, text) => [...document.querySelectorAll(`${scope} button`)].some(button => button.textContent.trim() === text && !button.disabled), {}, scope, text);
      await page.evaluate((scope, text) => [...document.querySelectorAll(`${scope} button`)].find(button => button.textContent.trim() === text && !button.disabled).click(), scope, text);
      await delay();
    };
    const eventList = () => page.$eval('[data-testid="events"]', element => JSON.parse(element.textContent));
    const assertWidth = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1).then(value => assert.ok(value, 'horizontal overflow'));
    const scrollPage = () => page.evaluate(async () => {
      const bottom = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      for (let top = 0; top < bottom; top += Math.max(1, innerHeight * 0.75)) {
        window.scrollTo(0, top);
        await new Promise(resolve => setTimeout(resolve, 40));
        if (document.documentElement.scrollWidth > innerWidth + 1) throw new Error('horizontal overflow while scrolling');
      }
      window.scrollTo(0, bottom);
      await new Promise(resolve => setTimeout(resolve, 80));
      if (Math.abs(window.scrollY - bottom) > 2) throw new Error('page bottom was not reached');
      window.scrollTo(0, 0);
    });
    const editText = async (selector, value) => {
      await page.click(selector);
      await page.waitForSelector('textarea[aria-label="Block text"]');
      await page.click('textarea[aria-label="Block text"]');
      await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
      await page.type('textarea[aria-label="Block text"]', value);
      await page.keyboard.press('Escape');
    };
    // Execute the actual shared hook used by Connections, including the new
    // major requirement map. No provider URL is opened by this probe.
    const probeConnections = () => page.evaluate(async () => {
      const api = window.__connectionsApi;
      const operations = [() => api.providers(), () => api.list(),
        () => api.connect({ provider: 'demo', fields: { handle: 'synthetic-only' }, expectedOwnerId: 'synthetic-service-owner' }),
        () => api.oauthBegin({ provider: 'google-drive', expectedOwnerId: 'synthetic-service-owner' }),
        () => api.feed({ limit: 1 }), () => api.request({ connectionId: 'synthetic-one', operation: 'account.profile' })];
      const results = [];
      for (const operation of operations) {
        try { await operation(); results.push('accepted'); } catch { results.push('refused'); }
      }
      return results;
    });
    connectionVersion = '1.1.1';
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__connectionsApi));
    assert.deepEqual(await probeConnections(), Array(6).fill('refused'));
    assert.equal(connectionCalls.length, 0, 'legacy manifest allowed a Connections HTTP operation');
    connectionVersion = '2.0.0';
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__connectionsApi));
    assert.deepEqual(await probeConnections(), Array(6).fill('accepted'));
    assert.deepEqual(connectionCalls, ['/api/v1/connections/providers', '/api/v1/connections', '/api/v1/connections',
      '/api/v1/connections/oauth/begin', '/api/v1/connections/feed', '/api/v1/connections/request']);
    await record('actual shared Connections API refuses all six operations before HTTP on legacy manifests and accepts the origin-scoped major-2 synthetic contract');
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: 1000 });
      await page.goto(origin, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector(`${google} ${block('account-name')}`);
      assert.equal(await page.$$eval(`${google} ${block('account-name')}`, nodes => nodes.length), 2);
      await assertWidth();
      await scrollPage();
      await page.click(`${appPassword} ${block('provider-add')}`);
      await page.waitForSelector(`${appPassword} input[name="login"]`);
      await page.click(`${appPassword} ${block('provider-submit')}`);
      await page.focus(`${appPassword} input[name="login"]`);
      await page.keyboard.press('Enter');
      await delay();
      assert.ok(!(await eventList()).includes('credential-submitted'), 'empty required fields submitted');
      await page.type(`${appPassword} input[name="login"]`, 'fixture');
      await page.type(`${appPassword} input[name="password"]`, 'synthetic-only');
      if (width === 390) await page.keyboard.press('Enter');
      else await page.click(`${appPassword} ${block('provider-submit')}`);
      await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="events"]').textContent).includes('credential-submitted'));
      await page.waitForSelector(`${appPassword} input[name="password"]`, { hidden: true });
      await page.$$eval(`${google} ${block('account-card')}`, cards => cards.find(card => card.textContent.includes('Account one')).querySelector('[data-block-id="account-disconnect"]').click());
      await page.waitForFunction(() => !document.querySelector('fieldset[aria-label="Google Drive"]').textContent.includes('Account one'));
      assert.ok(await page.$eval(google, element => element.textContent.includes('Account two')));
      await page.click(`${google} ${block('account-check')}`);
      await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="events"]').textContent).includes('verify:two'));
      await page.screenshot({ path: `${results}/${width}-services.png`, fullPage: true });
      await record(`${width}px: required credential fields block click/Enter; explicit synthetic submit succeeds; removing one account preserves the other and its action`);
    }

    await page.setViewport({ width: 1440, height: 1000 });
    await page.click(`${openai} ${block('ai-account-add')}`);
    await page.waitForSelector(`${openai} input[name="accountName"]`);
    await page.click(`${openai} ${block('ai-save')}`);
    await page.focus(`${openai} input[name="accountName"]`);
    await page.keyboard.press('Enter');
    await delay();
    assert.deepEqual(vaultActions, []);
    await page.type(`${openai} input[name="accountName"]`, 'Synthetic workspace');
    await page.type(`${openai} input[name="accountToken"]`, 'fixture-ai-token');
    await page.click(`${openai} ${block('ai-save')}`);
    await page.waitForSelector(`${openai} input[name="accountToken"]`, { hidden: true });
    await page.waitForFunction(() => document.querySelector('[data-settings-document="services-ai"]').textContent.includes('Synthetic workspace'));
    assert.deepEqual(vaultActions, ['save-provider']);
    await page.$$eval(`${openai} ${block('ai-account')}`, cards => cards.find(card => card.textContent.includes('Personal')).querySelector('[data-block-id="ai-account-remove"]').click());
    await page.waitForFunction(() => !document.querySelector('[data-settings-document="services-ai"]').textContent.includes('Personal'));
    assert.deepEqual(vaultActions, ['save-provider', 'delete']);
    assert.equal(entries.length, 1);
    await record('AI account form blocks empty click/Enter, submits only explicit synthetic token to fixed provider endpoint, and removes only selected saved account');

    await page.click(`${tools} ${block('channel-search-button')}`);
    await delay();
    assert.ok(!(await eventList()).includes('channels.search'));
    await page.type(`${tools} ${block('channel-query')}`, 'Synthetic channel');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${tools} ${block('channel-subscribe')}`);
    await page.click(`${tools} ${block('channel-subscribe')}`);
    await page.waitForSelector(`${tools} ${block('channel-unsubscribe')}`);
    await page.click(`${tools} ${block('channel-unsubscribe')}`);
    await page.waitForSelector(`${tools} ${block('channel-unsubscribe')}`, { hidden: true });
    await page.click(`${tools} ${block('filter-create-button')}`);
    await delay();
    assert.ok(!(await eventList()).includes('filters.create'));
    await page.type(`${tools} ${block('filter-name-input')}`, 'Synthetic filter');
    await page.type(`${tools} ${block('filter-prompt-input')}`, 'Synthetic topic');
    await page.select(`${tools} ${block('filter-action-input')}`, 'hide');
    await page.click(`${tools} ${block('filter-create-button')}`);
    await page.waitForSelector(`${tools} ${block('filter-toggle')}`);
    assert.equal(await page.$eval(`${tools} ${block('filter-toggle')}`, element => element.checked), true);
    assert.equal(await page.$eval(`${tools} ${block('filter-action')}`, element => element.textContent), 'hide');
    await page.click(`${tools} ${block('filter-toggle')}`);
    await page.waitForFunction(() => document.querySelector('[data-block-id="filter-toggle"]').checked === false);
    await page.click(`${tools} ${block('filter-remove')}`);
    await page.waitForSelector(`${tools} ${block('filter-toggle')}`, { hidden: true });
    for (const expected of ['channels.search', 'channels.subscribe', 'channels.unsubscribe', 'filters.create', 'filters.toggle', 'filters.remove']) assert.ok((await eventList()).includes(expected));
    await record('Channel search/subscribe/unsubscribe and filter create/select/toggle/remove operate through editable controls; empty required fields prevent callbacks');

    // Keep a form visible so its nested input can be authored independently.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector(`${appPassword} ${block('provider-add')}`);
    await page.click(`${appPassword} ${block('provider-add')}`);
    await page.waitForSelector(`${appPassword} input[name="login"]`);
    await clickText(catalog, 'Edit layout');
    await editText(`${catalog} ${block('account-name')}`, 'Saved {item.displayName}');
    await editText(`${catalog} ${block('provider-icon')}`, 'Service {item.icon}');
    await page.click(`${appPassword} ${block('provider-field-input')}`);
    await page.waitForSelector('input[aria-label="Element title"]');
    await page.type('input[aria-label="Element title"]', 'Saved credential field');
    await page.type('input[aria-label="Element defaultValue"]', 'synthetic-forbidden-default');
    await page.waitForFunction(() => document.querySelector('[data-settings-document="services-catalog"]').textContent.includes('Private input values cannot be saved'));
    assert.equal(await page.$eval('input[aria-label="Element defaultValue"]', input => input.value), '');
    assert.equal(pages.has('settings-services-catalog'), false);
    await page.keyboard.press('Escape');
    await clickText(catalog, 'Save layout');
    await page.waitForFunction(() => !document.querySelector('[data-settings-document="services-catalog"]').textContent.includes('Unsaved layout'));
    const saved = pages.get('settings-services-catalog');
    assert.ok(saved);
    const authored = JSON.stringify(saved.crystal);
    for (const forbidden of ['synthetic-only', 'fixture-ai-token', 'one@example.test', 'two@example.test', 'ai-one', 'ai-synthetic-saved', 'Account one', 'Account two']) assert.ok(!authored.includes(forbidden), 'live account data entered authored document');
    assert.ok(authored.includes('Saved {item.displayName}'));
    assert.ok(authored.includes('Service {item.icon}'));
    assert.ok(authored.includes('Saved credential field'));
    await clickText(catalog, 'Done editing layout');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-settings-document="services-catalog"]').textContent.includes('Saved Account one'));
    assert.ok(await page.$eval(`${google} ${block('provider-icon')}`, element => element.textContent.startsWith('Service ')));
    await page.click(`${appPassword} ${block('provider-add')}`);
    await page.waitForSelector(`${appPassword} input[name="login"]`);
    assert.equal(await page.$eval(`${appPassword} input[name="login"]`, element => element.title), 'Saved credential field');
    await page.type(`${appPassword} input[name="login"]`, 'fixture');
    await page.type(`${appPassword} input[name="password"]`, 'synthetic-only');
    await page.click(`${appPassword} ${block('provider-submit')}`);
    await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="events"]').textContent).includes('credential-submitted'));
    await page.screenshot({ path: `${results}/builder-saved.png`, fullPage: true });
    await page.setViewport({ width: 390, height: 1000 });
    await clickText(catalog, 'Edit layout');
    await page.click(`${catalog} ${block('account-name')}`);
    await page.waitForSelector('textarea[aria-label="Block text"]');
    await assertWidth();
      await scrollPage();
    await page.screenshot({ path: `${results}/390-builder.png` });
    await record('Builder independently edits repeated account-name template, provider icon and credential field; private default injection is rejected before storage; layout saves/reloads without live identities/secrets; credential action still works; mobile inspector checked');
    await page.keyboard.press('Escape');
    await clickText(catalog, 'Done editing layout');
    await page.setViewport({ width: 1440, height: 1000 });
    await clickText(overview, 'Edit layout');
    await editText(`${overview} ${block('connections-title')}`, 'My service accounts');
    await clickText(overview, 'Save layout');
    await page.waitForFunction(() => !document.querySelector('[data-settings-document="connections-overview"]').textContent.includes('Unsaved layout'));
    await clickText(overview, 'Done editing layout');
    await page.type(`${tools} ${block('channel-query')}`, 'Synthetic channel');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${tools} ${block('channel-subscribe')}`);
    await page.click(`${tools} ${block('channel-subscribe')}`);
    await page.waitForSelector(`${tools} ${block('channel-title')}`);
    await clickText(tools, 'Edit layout');
    await editText(`${tools} ${block('channels-title')}`, 'My channels');
    await editText(`${tools} ${block('channel-title')}`, 'Channel {item.title}');
    await page.click(`${tools} ${block('filter-name-input')}`);
    await page.waitForSelector('input[aria-label="Element title"]');
    await page.type('input[aria-label="Element title"]', 'Describe the filter');
    await page.keyboard.press('Escape');
    await clickText(tools, 'Save layout');
    await page.waitForFunction(() => !document.querySelector('[data-settings-document="connections-tools"]').textContent.includes('Unsaved layout'));
    await clickText(tools, 'Done editing layout');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelector('[data-block-id="connections-title"]')?.textContent === 'My service accounts');
    await page.waitForFunction(() => document.querySelector('[data-block-id="channels-title"]')?.textContent === 'My channels');
    assert.equal(await page.$eval(`${tools} ${block('filter-name-input')}`, element => element.title), 'Describe the filter');
    const toolsLayout = JSON.stringify(pages.get('settings-connections-tools').crystal);
    assert.ok(toolsLayout.includes('Channel {item.title}'));
    for (const forbidden of ['Synthetic channel', 'channel-fixture', 'Synthetic filter', 'filter-fixture', 'Synthetic topic']) assert.ok(!toolsLayout.includes(forbidden), 'live tools state entered authored document');
    await page.type(`${tools} ${block('channel-query')}`, 'Synthetic channel');
    await page.keyboard.press('Enter');
    await page.waitForSelector(`${tools} ${block('channel-subscribe')}`);
    await page.click(`${tools} ${block('channel-subscribe')}`);
    await page.waitForFunction(() => document.querySelector('[data-block-id="channel-title"]')?.textContent === 'Channel Synthetic channel');
    await page.screenshot({ path: `${results}/1440-full-saved.png`, fullPage: true });
    await page.setViewport({ width: 390, height: 1000 });
    await assertWidth();
      await scrollPage();
    await page.screenshot({ path: `${results}/390-full-saved.png`, fullPage: true });
    await record('Page heading, channel heading/repeated template and filter field independently save/reload; callbacks still work; desktop/mobile full-page layout fits');
    await page.tracing.stop();
    assert.deepEqual(report.errors, []);
    report.outcome = 'passed';
  } catch (error) {
    report.outcome = 'failed'; report.error = error.stack;
    if (browser) { const page = (await browser.pages()).at(-1); await page.screenshot({ path: `${results}/failure.png` }).catch(() => {}); await fs.writeFile(`${results}/failure.html`, await page.content()).catch(() => {}); await page.tracing.stop().catch(() => {}); }
  } finally {
    await browser?.close(); server?.close();
    await fs.writeFile(`${results}/report.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report)); process.exitCode = report.outcome === 'passed' ? 0 : 1;
  }
})();
