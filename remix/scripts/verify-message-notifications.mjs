#!/usr/bin/env node
// Real HTTP regression using the canonical compiled Vercel handler and a unique
// disposable loopback replica set. Product data is created/read only via APIs.
// Run after `pnpm --dir remix run build`: node remix/scripts/verify-message-notifications.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { MongoClient } from 'mongodb';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const cwd = resolve(import.meta.dirname, '..');
if (process.argv[2] === '--server') {
  // Whitelisted environment supplied by the parent; no .env files loaded.
  const { default: app } = await import(pathToFileURL(join(cwd, '.vercel/output/functions/__server.func/index.mjs')).href);
  const server = createServer(async (req, res) => {
    try {
      if (!req.url.startsWith('/api/') && !req.url.startsWith('/.well-known/')) {
        const root = join(cwd, '.vercel/output/static');
        const requested = resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
        if (requested !== root && !requested.startsWith(root + sep)) { res.writeHead(400); res.end(); return; }
        let bytes, path = requested;
        try { bytes = await readFile(path); } catch { path = join(root, 'index.html'); bytes = await readFile(path); }
        const ext = path.split('.').pop();
        res.writeHead(200, { 'content-type': ({ html: 'text/html', js: 'text/javascript', mjs: 'text/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml' })[ext] || 'application/octet-stream' });
        res.end(bytes); return;
      }
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const response = await app.fetch(new Request(`http://127.0.0.1:${process.env.PORT}${req.url}`, {
        method: req.method, headers: req.headers,
        ...(!['GET', 'HEAD'].includes(req.method) ? { body, duplex: 'half' } : {})
      }), { waitUntil(promise) { void promise.catch(() => {}); } });
      res.writeHead(response.status, {
        ...Object.fromEntries([...response.headers].filter(([key]) => key !== 'set-cookie')),
        ...(response.headers.getSetCookie().length ? { 'set-cookie': response.headers.getSetCookie() } : {})
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch { res.writeHead(500); res.end('{"ok":false,"error":"acceptance adapter error"}'); }
  });
  server.listen(Number(process.env.PORT), '127.0.0.1');
} else {
  const dir = await mkdtemp(join(tmpdir(), 'tt-message-notifications-'));
  const children = [];
  let stage = 'setup';
  async function port() {
    const probe = createServer();
    await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
    const value = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    return value;
  }
  function start(command, args, env) {
    const child = spawn(command, args, { cwd, detached: true, env, stdio: ['ignore', 'ignore', 'ignore'] });
    children.push(child);
    return child;
  }
  async function stop(child) {
    if (!child.pid) return;
    const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
    const exited = child.exitCode !== null || child.signalCode !== null;
    const exit = exited ? Promise.resolve() : once(child, 'exit');
    kill('SIGTERM');
    const timeout = setTimeout(() => kill('SIGKILL'), 3000);
    await exit; clearTimeout(timeout); kill('SIGKILL');
  }
  let mongo;
  try {
    const apiPort = await port(), dbPort = await port();
    assert.notEqual(apiPort, dbPort);
    const origin = `http://127.0.0.1:${apiPort}`;
    const replica = `messages_${randomBytes(6).toString('hex')}`;
    const mongoUri = `mongodb://127.0.0.1:${dbPort}/thingtime?replicaSet=${replica}`;
    assert.match(mongoUri, /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=messages_/);
    await mkdir(join(dir, 'db'));
    const db = start(process.env.MONGOD_BINARY || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(dbPort), '--bind_ip', '127.0.0.1', '--replSet', replica, '--nounixsocket'], { PATH: process.env.PATH });
    mongo = new MongoClient(`mongodb://127.0.0.1:${dbPort}/?directConnection=true`, { serverSelectionTimeoutMS: 500 });
    for (let n = 0; ; n++) {
      assert.equal(db.exitCode, null, 'Disposable mongod exited');
      try { await mongo.connect(); break; } catch { if (n >= 30) throw Error('Disposable mongod unavailable'); await delay(200); }
    }
    // Only infrastructure administration uses Mongo directly; never product data.
    await mongo.db('admin').command({ replSetInitiate: { _id: replica, members: [{ _id: 0, host: `127.0.0.1:${dbPort}` }] } });
    for (let n = 0; ; n++) {
      if ((await mongo.db('admin').command({ hello: 1 })).isWritablePrimary) break;
      assert(n < 100, 'Replica must elect primary'); await delay(100);
    }
    await mongo.close(); mongo = null;
    const server = start(process.execPath, [import.meta.filename, '--server'], {
      PATH: process.env.PATH, NODE_ENV: 'test', PORT: String(apiPort),
      MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('base64url'),
      THINGTIME_DATA_ENV: 'development', THINGTIME_DATA_AUTHORITY_ORIGIN: origin
    });
    for (let n = 0; ; n++) {
      assert.equal(server.exitCode, null, 'Compiled HTTP server exited');
      try { if ((await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(700) })).ok) break; } catch {}
      assert(n < 100, 'Compiled HTTP server must become ready'); await delay(200);
    }
    async function api(path, { cookie, as, body, status = 200 } = {}) {
      const response = await fetch(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', Origin: origin,
          ...(cookie ? { Cookie: cookie } : {}), ...(as ? { 'X-Thingtime-Character': as } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
      });
      assert.equal(response.status, status, `${stage}: ${path.split('?')[0]} HTTP status`);
      const data = await response.json();
      return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
    }
    stage = 'both compiled capability manifests';
    for (const path of ['/.well-known/thingtime-capabilities.json', '/api/v1/capabilities']) {
      const { data } = await api(path);
      if (path.startsWith('/.well-known')) assert.equal(data.origin, origin);
      for (const [feature, version] of Object.entries({ 'api.chats-messages': '1.7.0', 'api.notifications-list': '1.9.0', 'api.notifications-settings': '1.9.0' })) {
        const entry = data.features[feature];
        assert.equal(typeof entry === 'string' ? entry : entry?.version, version, feature);
      }
    }
    stage = 'synthetic owner, stranger and switch-only Character';
    async function register(prefix) {
      const username = prefix + randomBytes(6).toString('hex');
      return api('/api/v1/auth/register', { body: { username, email: `${username}@example.invalid`, password: randomBytes(32).toString('base64url') } });
    }
    const owner = await register('message-owner-');
    const stranger = await register('message-stranger-');
    const ownerId = owner.data.user.id;
    const character = (await api('/api/v1/auth/characters', { cookie: owner.cookie, body: {
      operation: 'create', requestId: randomUUID(), loginMode: 'switch', displayName: 'Disposable Watchdog'
    } })).data.character.user;
    const sender = { cookie: owner.cookie, as: character.id };
    const recipient = { cookie: owner.cookie, as: ownerId };
    assert.notEqual(character.id, ownerId);
    assert.equal((await api('/api/v1/auth/me', sender)).data.user.id, character.id);
    assert.equal((await api('/api/v1/auth/me', recipient)).data.user.id, ownerId);
    stage = 'Character DM pending request and notification';
    const chat = (await api('/api/v1/chats', { ...sender, body: { chatType: 'dm', memberIds: [ownerId] } })).data.chat;
    const chatId = chat.id;
    const pending = (await api('/api/v1/chats/requests', recipient)).data.requests;
    assert([...pending.follower, ...pending.unknown].some(row => row.id === chatId));
    const send = async text => {
      const body = { chatId, text, requestId: randomUUID() };
      const first = (await api('/api/v1/chats/messages', { ...sender, body })).data.message;
      const retry = (await api('/api/v1/chats/messages', { ...sender, body })).data.message;
      assert.equal(first.id, retry.id, 'Retry must reuse message identity');
      return first;
    };
    const notifications = async (history = false, identity = recipient) => (await api(`/api/v1/notifications?limit=50${history ? '&history=1' : ''}`, identity)).data;
    const seenNotices = new Set();
    async function waitNotice(message, type) {
      // Bounded deterministic wait for background fanout, not model polling.
      for (let n = 0; n < 30; n++) {
        const data = await notifications(true);
        const matching = data.notifications.filter(row => row.targetId === chatId && !seenNotices.has(row.id));
        if (matching.length) { assert.equal(matching.length, 1); assert.equal(matching[0].type, type); seenNotices.add(matching[0].id); return matching[0]; }
        await delay(100);
      }
      throw Error(`${stage}: background notification missing`);
    }
    const first = await send('First synthetic Watchdog message');
    const requestNotice = await waitNotice(first, 'chat-request');
    assert.equal(requestNotice.actorId, character.id);
    assert.equal(requestNotice.href, '/messages?view=requests');
    assert.equal((await notifications()).notifications.filter(row => row.id === requestNotice.id).length, 1);
    stage = 'accepted request and active DM';
    await api('/api/v1/chats/requests', { ...recipient, body: { chatId, accept: true } });
    const active = await send('Accepted synthetic Watchdog message');
    const activeNotice = await waitNotice(active, 'chat-message');
    assert.equal(activeNotice.href, `/messages?chat=${encodeURIComponent(chatId)}`);
    assert.equal((await notifications()).notifications.filter(row => row.id === activeNotice.id).length, 1);
    stage = 'muted delivery retains history';
    await api('/api/v1/chats/members', { ...recipient, body: { chatId, mute: true } });
    const muted = await send('Muted synthetic Watchdog message');
    const mutedNotice = await waitNotice(muted, 'chat-message');
    assert.equal((await notifications()).notifications.some(row => row.id === mutedNotice.id), false);
    stage = 'disabled preferences retain history';
    await api('/api/v1/chats/members', { ...recipient, body: { chatId, mute: false } });
    await api('/api/v1/notifications/settings', { ...recipient, body: { prefs: { push: { 'chat-message': false } } } });
    const disabled = await send('Preference-disabled synthetic Watchdog message');
    const disabledNotice = await waitNotice(disabled, 'chat-message');
    assert.equal((await notifications()).notifications.some(row => row.id === disabledNotice.id), false);
    stage = 'stranger privacy and exact message count';
    await api(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}`, { cookie: stranger.cookie, status: 403 });
    const strangerNotices = await notifications(true, { cookie: stranger.cookie });
    assert.equal(strangerNotices.notifications.some(row => row.targetId === chatId || row.id === requestNotice.id), false);
    assert.equal((await notifications(true)).notifications.filter(row => row.targetId === chatId).length, 4, 'Retries must not duplicate notification history');
    const messages = (await api(`/api/v1/chats/messages?chatId=${encodeURIComponent(chatId)}&limit=50`, recipient)).data.messages;
    assert.equal(messages.filter(row => !row.systemType).length, 4, 'Four sends plus retries must yield four messages');
    for (const message of [first, active, muted, disabled]) assert.equal(messages.filter(row => row.id === message.id).length, 1);
    if (process.argv.includes('--ui')) {
      stage = 'isolated Chrome rendered receiver acceptance';
      console.log('Checking rendered receiver in isolated Chrome');
      const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
      const evidence = resolve(process.env.MESSAGE_NOTIFICATIONS_EVIDENCE_DIR || join(tmpdir(), 'tt-message-notification-evidence'));
      await mkdir(evidence, { recursive: true });
      // Re-enable delivery to inspect the saved records in the actual receiver UI.
      await api('/api/v1/notifications/settings', { ...recipient, body: { prefs: { push: { 'chat-message': true } } } });
      const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}) });
      try {
        const context = await browser.newContext();
        await context.addCookies(owner.cookie.split('; ').map(value => {
          const equals = value.indexOf('=');
          return { name: value.slice(0, equals), value: value.slice(equals + 1), url: origin, httpOnly: true, sameSite: 'Lax' };
        }));
        const page = await context.newPage();
        for (const [name, width, height] of [['desktop', 1440, 960], ['mobile', 390, 844]]) {
          console.log(`Checking ${name} receiver history, navigation, settings and bell`);
          await page.setViewportSize({ width, height });
          await page.goto(origin + '/notifications', { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: /Disposable Watchdog sent you a message/ }).first().waitFor({ timeout: 30000 });
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} history overflow`);
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          await page.screenshot({ path: join(evidence, `history-${name}.png`), fullPage: true });
          await page.getByRole('button', { name: /Disposable Watchdog sent you a message request/ }).first().click();
          await page.waitForURL(url => url.pathname === '/messages' && url.searchParams.get('view') === 'requests');
          await page.goto(origin + '/notifications', { waitUntil: 'domcontentloaded' });
          await page.getByRole('button', { name: /Disposable Watchdog sent you a message(?! request)/ }).first().click();
          await page.waitForURL(url => url.pathname === '/messages' && url.searchParams.get('chat') === chatId);
          await page.goto(origin + '/settings/notifications', { waitUntil: 'domcontentloaded' });
          await page.getByLabel('Push: Chat messages 💬', { exact: true }).waitFor({ state: 'attached', timeout: 30000 });
          await page.locator('details').filter({ has: page.getByLabel('Push: Chat messages 💬', { exact: true }) }).locator(':scope > summary').click();
          await page.getByLabel('Email: Message requests 💬', { exact: true }).waitFor({ state: 'attached' });
          await page.getByText('Chat messages 💬', { exact: true }).waitFor();
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} settings overflow`);
          await page.screenshot({ path: join(evidence, `settings-${name}.png`), fullPage: true });
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.getByRole('button', { name: /^Notifications(?: — \d+ unread)?$/ }).click();
          await page.getByRole('button', { name: /Disposable Watchdog sent you a message/ }).first().waitFor();
          await page.screenshot({ path: join(evidence, `bell-${name}.png`), fullPage: true });
        }
        // Read the actual receiver API through the browser's own synthetic session.
        const readback = await page.request.get(origin + '/api/v1/notifications?history=1&limit=50');
        const rows = (await readback.json()).notifications.filter(row => row.targetId === chatId);
        assert.deepEqual(new Set(rows.map(row => row.id)), seenNotices);
        assert(rows.every(row => row.actorId === character.id));
        console.log(`PASS: isolated Chrome desktop/mobile history, message/request navigation, settings, bell; screenshots: ${evidence}`);
        await context.close();
      } finally { await browser.close(); }
    }
    console.log(JSON.stringify({ ok: true, productionAccess: false, checks: ['both compiled capability manifests', 'real HTTP owner/stranger registration', 'switch-only Character identity', 'pending request notification', 'accepted DM notification', 'stable request retry without duplicate messages or notifications', 'muted history-only notification', 'disabled preference retains history', 'stranger chat and notification isolation'], cleanup: 'disposable server and replica removed on exit' }));
  } catch (error) {
    console.error(`FAIL (${stage}): ${error.message}`);
    process.exitCode = 1;
  } finally {
    if (mongo) await mongo.close();
    for (const child of children.reverse()) await stop(child);
    await rm(dir, { recursive: true, force: true });
  }
}
