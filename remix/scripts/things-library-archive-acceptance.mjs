#!/usr/bin/env node
// Disposable real API + isolated Chrome acceptance. Prerequisite: node-server
// Nitro build; PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE may select tooling.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const source = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'tt-library-archive-'));
const evidence = process.env.THINGTIME_ARCHIVE_EVIDENCE;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const freePort = async () => {
  const server = createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
};
const db = await freePort(), apiPort = await freePort(), web = await freePort(), hmr = await freePort();
const origin = `http://127.0.0.1:${apiPort}`, webOrigin = `http://127.0.0.1:${web}`;
const mongoUri = `mongodb://127.0.0.1:${db}/thingtime?replicaSet=libraryarchive`;
const env = { PATH: process.env.PATH, HOME: temp, TMPDIR: temp, HOST: '127.0.0.1', PORT: String(apiPort), NODE_ENV: 'production',
  MONGODB_CONNECTION_STRING: mongoUri, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
  TT_WEB_PORT: String(web), TT_API_PORT: String(apiPort), TT_HMR_PORT: String(hmr) };
const children = [];
const start = (command, args, cwd = temp, override = {}) => {
  const child = spawn(command, args, { cwd, env: { ...env, ...override }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const running = { child, output: '' }; children.push(running);
  for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { running.output = (running.output + chunk).slice(-8000); });
  return running;
};
async function waitFor(check, label, running) {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (running && running.child.exitCode !== null) throw Error(label + ' exited: ' + running.output);
    try { if (await check()) return; } catch { /* bounded readiness */ }
    await delay(250);
  }
  throw Error('Timed out: ' + label + (running ? '\n' + running.output : ''));
}
const manifestPath = '/.well-known/thingtime-capabilities.json';
async function api(path, { body, cookie, requestOrigin = origin, token, status = 200 } = {}) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Origin: requestOrigin, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const data = await response.json();
  assert.equal(response.status, status, path + ': ' + (data.error || 'unexpected response'));
  return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
const register = username => api('/api/v1/auth/register', { body: { username, email: `${username}@example.invalid`, password: randomBytes(24).toString('hex') } });
const paths = { things: '/api/v1/things', bulk: '/api/v1/things/bulk', search: '/api/v1/things/search' };
let mongo, browser;
try {
  if (evidence) await mkdir(evidence, { recursive: true });
  await mkdir(join(temp, 'db'));
  const dbProcess = start(process.env.MONGOD_PATH || 'mongod', ['--dbpath', join(temp, 'db'), '--port', String(db), '--bind_ip', '127.0.0.1', '--replSet', 'libraryarchive', '--nounixsocket']);
  mongo = new MongoClient(`mongodb://127.0.0.1:${db}/?directConnection=true`, { serverSelectionTimeoutMS: 600 });
  await waitFor(async () => !!await mongo.connect(), 'disposable Mongo', dbProcess);
  await mongo.db('admin').command({ replSetInitiate: { _id: 'libraryarchive', members: [{ _id: 0, host: `127.0.0.1:${db}` }] } });
  await waitFor(async () => (await mongo.db('admin').command({ hello: 1 })).isWritablePrimary, 'disposable replica primary', dbProcess);
  await mongo.close(); mongo = undefined;
  const nitro = start(process.execPath, [join(source, '.output/server/index.mjs')]);
  await waitFor(async () => (await fetch(origin + manifestPath, { signal: AbortSignal.timeout(1000) })).ok, 'built Nitro', nitro);
  const manifest = (await api(manifestPath)).data;
  assert.equal(manifest.origin, origin);
  for (const [key, version] of [['api.things', '1.62.0'], ['api.things-search', '1.7.0'], ['api.things-bulk', '1.9.0'], ['api.things-actions', '1.1.0']]) assert.equal(manifest.features[key].version, version);
  const { cookie } = await register('archiveowner');
  const { cookie: other } = await register('archiveother');
  assert(cookie && other);
  const create = async body => (await api(paths.things, { body, cookie })).data.thing;
  const read = async (id, auth) => (await api(paths.things + '?id=' + id, { cookie: auth })).data.thing;
  const folder = await create({ thingtime: ['folder'], crystal: { name: 'Library fixture folder' } });
  const nested = await create({ thingtime: ['data'], folderId: folder.id, crystal: { name: 'Nested archive fixture', archived: true, note: 'Keep this' } });
  const publicThing = await create({ thingtime: ['data'], acl: ['tt:all'], crystal: { name: 'Public archive fixture', note: 'Still public' } });
  const untouched = await create({ thingtime: ['data'], crystal: { name: 'Active comparison fixture' } });
  const bulk = (op, ids, opts = {}) => api(paths.bulk, { body: { op, ids }, cookie, ...opts });
  const baseline = await read(publicThing.id, cookie);
  await bulk('archive', [publicThing.id], { requestOrigin: 'https://different.example', status: 403 });
  const foreign = await bulk('archive', [publicThing.id], { cookie: other });
  assert.equal(foreign.data.results[0].ok, false);
  const pat = (await api('/api/v1/tokens', { cookie, body: { name: 'Disposable archive refusal', scopes: ['things.read'], visibility: 'public' }, status: 201 })).data.token;
  assert(pat);
  await bulk('archive', [publicThing.id], { cookie: undefined, token: pat, status: 401 });
  for (const id of [publicThing.id, folder.id, nested.id]) assert.equal((await bulk('archive', [id])).data.succeeded, 1);
  assert.equal((await bulk('archive', [publicThing.id])).data.succeeded, 1, 'idempotent archive');
  const ownerRead = await read(publicThing.id, cookie);
  assert.deepEqual(ownerRead, { ...baseline, libraryArchived: true });
  const otherRead = await read(publicThing.id, other);
  assert(!Object.hasOwn(otherRead, 'libraryArchived'));
  assert.equal(otherRead.crystal.note, baseline.crystal.note);
  const archiveList = (await api(paths.things + '?libraryArchive=archived', { cookie })).data.things;
  assert.deepEqual(new Set(archiveList.map(row => row.id)), new Set([publicThing.id, folder.id, nested.id]));
  const activePage = (await api(paths.things + '?libraryArchive=active&folder=root&limit=1', { cookie })).data;
  assert.deepEqual(activePage.things.map(row => row.id), [untouched.id]);
  const search = async (libraryArchive, auth) => (await api(paths.search, { body: { libraryArchive, conditions: [{ field: 'name', op: 'eq', value: 'Public archive fixture' }] }, cookie: auth })).data.things;
  assert.equal((await search('active', cookie)).length, 0);
  assert.equal((await search('archived', cookie))[0].id, publicThing.id);
  assert.equal((await search(undefined, other))[0].id, publicThing.id);
  assert.equal((await search('archived', other)).length, 0);
  assert.equal((await bulk('restore', [folder.id, nested.id, publicThing.id])).data.succeeded, 3);
  assert.deepEqual(await read(publicThing.id, cookie), baseline);
  assert.equal((await read(nested.id, cookie)).folderId, folder.id);
  assert.equal((await read(nested.id, cookie)).crystal.archived, true);
  console.log('Built API: owner scope, token and origin refusal, pagination, search, reversible placement and unchanged public data passed.');

  const app = await create({ thingtime: ['folder', 'builder-thing'], crystal: { name: 'Synthetic archive app', builderApp: true, description: 'Independent app-card archive fixture' } });
  const appChild = await create({ thingtime: ['data', 'builder-thing'], folderId: app.id, crystal: { name: 'Synthetic app child', note: 'Keep this child in its app' } });
  const appBaseline = await read(app.id, cookie), appChildBaseline = await read(appChild.id, cookie);

  const published = (await api(paths.things, { cookie, body: { type: 'text', text: 'Synthetic globally archived post', visibility: 'public' } })).data.post;
  const foreignPost = (await api(paths.things, { cookie: other, body: { type: 'text', text: 'Synthetic other-owner post', visibility: 'public' } })).data.post;
  const comment = (await api('/api/v1/things/comment', { cookie, body: { id: published.id, text: 'Synthetic archived comment' } })).data.comment;
  const chat = (await api('/api/v1/chats', { cookie, body: { chatType: 'group', name: 'Synthetic archive chat', memberIds: [] } })).data.chat;
  const message = (await api('/api/v1/chats/messages', { cookie, body: { chatId: chat.id, text: 'Synthetic private archive message' } })).data.message;
  const describe = async (id, options = {}) => (await api('/api/v1/things/actions?id=' + id, { cookie, ...options })).data;
  const runAction = async (id, action, options = {}) => (await api('/api/v1/things/actions', { cookie, body: { id, action }, ...options })).data;
  for (const id of [published.id, comment.id, message.id]) {
    const available = await describe(id);
    assert.deepEqual(available.availableActions, ['archive']);
    assert(!Object.hasOwn(available, 'crystal'), 'Action discovery never returns protected content');
    await describe(id, { cookie: other, status: 404 });
    await runAction(id, 'archive', { cookie: other, status: 404 });
    assert.equal((await runAction(id, 'archive')).libraryArchived, true);
    const archived = (await api(paths.things + '?libraryArchive=archived', { cookie })).data.things;
    assert(archived.some(row => row.id === id), 'Every archivable root is discoverable for restore');
    assert.deepEqual((await describe(id)).availableActions, ['restore']);
    assert.equal((await runAction(id, 'restore')).libraryArchived, false);
  }
  assert.equal((await read(published.id, other)).crystal.text, 'Synthetic globally archived post');
  const ownMessages = (await api('/api/v1/chats/messages?chatId=' + chat.id, { cookie })).data.messages;
  assert(ownMessages.some(row => row.id === message.id && row.text === 'Synthetic private archive message'));
  console.log('Global action API: post/comment/chat-message availability, foreign refusal and archive/restore discovery passed.');

  if (process.env.THINGTIME_ARCHIVE_SCOPE === 'api') process.exitCode = 0;
  else {
  const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${web},strictPort:true}});await server.listen();`], source, { NODE_ENV: 'development' });
  await waitFor(async () => (await fetch(webOrigin + manifestPath, { signal: AbortSignal.timeout(1000) })).ok, 'isolated Vite', vite);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  for (const size of (process.env.THINGTIME_ARCHIVE_SCOPE === 'menus' ? [{ width: 375, height: 812 }] : [{ width: 1440, height: 1000 }, { width: 375, height: 812 }])) {
    const context = await browser.newContext({ viewport: size, isMobile: size.width < 500, hasTouch: size.width < 500 });
    await context.addCookies(cookie.split('; ').map(pair => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: webOrigin, httpOnly: true, sameSite: 'Lax' };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(120000);
    const row = () => page.locator(`[data-thing-id="${nested.id}"]`).last();
    const action = label => page.getByRole('menuitem').filter({ has: page.getByText(label, { exact: true }) }).last();
    const activate = async (label, input) => {
      if (input === 'right') await row().click({ button: 'right' });
      else if (size.width < 500) await page.getByRole('button', { name: 'Nested archive fixture actions' }).tap();
      else await page.getByRole('button', { name: 'Nested archive fixture actions' }).press('Enter');
      const command = action(label);
      await command.waitFor();
      await command.scrollIntoViewIfNeeded();
      const bounds = await command.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= size.width + 1, 'visible menu width');
      if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-${label.toLowerCase()}.png`) });
      if (size.width < 500) await command.tap();
      else if (input === 'keyboard') { await command.focus(); await page.keyboard.press('Enter'); }
      else await command.click();
    };
    if (process.env.THINGTIME_ARCHIVE_SCOPE === 'embed') {
      const privileged = [];
      context.on('request', request => { if (request.url().includes('/api/v1/things/actions')) privileged.push(request.url()); });
      await page.goto(webOrigin + '/embed/demo.html', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Full editor ↗', exact: true }).waitFor();
      const errors = [];
      context.on('weberror', event => errors.push(event.error().message));
      const opened = context.waitForEvent('page');
      await page.getByRole('button', { name: 'Full editor ↗', exact: true }).click();
      const popup = await opened;
      await popup.getByText('Saving creates a new thing on your Thingtime account.', { exact: true }).waitFor().catch(async error => {
        if (evidence) {
          await popup.screenshot({ path: join(evidence, `${size.width}-embed-popup-failure.png`) });
          await writeFile(join(evidence, `${size.width}-embed-popup-failure.json`), JSON.stringify({ path: new URL(popup.url()).pathname, errors, body: await popup.locator('body').innerText() }, null, 2));
        }
        throw error;
      });
      await popup.locator('[title="Options"]').first().click();
      await popup.getByRole('menu').waitFor();
      assert.equal(await popup.getByRole('menuitem').filter({ has: popup.getByText('Archive containing Thing', { exact: true }) }).count(), 0);
      assert.equal(privileged.length, 0, 'Unsaved embed JSON never dispatches privileged Thing actions');
      if (evidence) await popup.screenshot({ path: join(evidence, `${size.width}-embed-local-menu.png`) });
      await popup.keyboard.press('Escape');
      await popup.close();
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log(`Chrome ${size.width}px: real single-file embed popup/local menu; no privileged requests.`);
      await context.close();
      continue;
    }
    if (process.env.THINGTIME_ARCHIVE_SCOPE === 'lazy') {
      const chunk = '**/PersistedThingMenuController.tsx*';
      let requests = 0;
      page.on('request', request => { if (request.url().includes('/PersistedThingMenuController.tsx')) requests++; });
      await page.goto(webOrigin + '/post/' + published.id, { waitUntil: 'domcontentloaded' });
      const trigger = page.getByRole('button', { name: 'Post options', exact: true }).first();
      await trigger.waitFor({ timeout: 180000 });
      const open = async () => size.width < 500 ? trigger.tap() : trigger.press('Enter');
      assert.equal(requests, 0, 'Closed menus do not download the privileged controller');
      if (size.width > 500) {
        const fail = route => route.fulfill({ status: 503, contentType: 'text/javascript', body: 'Synthetic unavailable controller' });
        await page.route(chunk, fail);
        await open();
        await action('Retry Thing actions').waitFor();
        assert.equal(await action('Archive').count(), 0, 'Failed chunk exposes no unverified Archive');
        await page.unroute(chunk, fail);
      }
      let release, notify, finish, routeFailure;
      const gate = new Promise(resolve => { release = resolve; });
      const requested = new Promise(resolve => { notify = resolve; });
      const completed = new Promise(resolve => { finish = resolve; });
      const defer = async route => { try { notify(); const response = await route.fetch(); await gate; await route.fulfill({ response }); } catch (error) { routeFailure = error; } finally { finish(); } };
      await page.route(chunk, defer);
      if (size.width > 500) await action('Retry Thing actions').press('Enter'); else await open();
      await Promise.race([requested, delay(30000).then(() => { throw Error('Lazy controller was not requested'); })]);
      await page.getByText('Checking Thing actions', { exact: true }).waitFor();
      assert.equal(await action('Archive').count(), 0, 'No unverified Archive during first load');
      if (size.width < 500) { await page.keyboard.press('Escape'); await open(); }
      const pendingFocus = action('Copy link');
      await pendingFocus.focus();
      const focusedNode = await pendingFocus.elementHandle();
      release();
      await completed;
      assert.equal(routeFailure, undefined);
      await page.unroute(chunk, defer);
      await action('Archive').waitFor();
      assert.equal(await page.getByRole('menu').count(), 1, 'First-open load retains one current menu');
      assert(await focusedNode.evaluate(element => element === document.activeElement), 'Pending base-action focus survives controller resolution');
      await action('Archive').focus();
      assert(await action('Archive').evaluate(element => element === document.activeElement), 'First-open actions accept keyboard focus');
      if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-lazy-first-open.png`) });
      await action('Archive').press('Enter');
      await waitFor(async () => (await describe(published.id)).libraryArchived, 'lazy archive receipt');
      await open();
      await action('Restore').waitFor();
      await action('Restore').press('Enter');
      await waitFor(async () => !(await describe(published.id)).libraryArchived, 'lazy restore receipt');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log(`Chrome ${size.width}px: deferred first-open, failure/retry, close/reopen, focus and real Archive/Restore passed.`);
      await context.close();
      continue;
    }
    const appCard = () => page.locator(`[data-thing-id="${app.id}"]`).last();
    const openAppMenu = async rightClick => {
      if (rightClick) await appCard().click({ button: 'right' });
      else {
        const trigger = appCard().getByRole('button', { name: 'Synthetic archive app actions' });
        if (size.width < 500) await trigger.tap();
        else await trigger.press('Enter');
      }
    };
    const appCommand = async (label, rightClick = false) => {
      await openAppMenu(rightClick);
      const command = action(label);
      await command.waitFor().catch(async error => {
        if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-app-missing-${label.toLowerCase()}.png`) });
        throw error;
      });
      await command.scrollIntoViewIfNeeded();
      const bounds = await command.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= size.width + 1, 'app menu stays within viewport');
      if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-app-${label.toLowerCase()}.png`) });
      if (size.width < 500) await command.tap();
      else await command.press('Enter');
    };
    await page.goto(webOrigin + '/builder?view=grid', { waitUntil: 'domcontentloaded' });
    await appCard().waitFor({ timeout: 180000 });
    await appCard().getByRole('link', { name: 'Browse', exact: true }).waitFor();
    await appCard().getByRole('button', { name: 'Edit app', exact: true }).waitFor();
    if (process.env.THINGTIME_ARCHIVE_SCOPE === 'menus') {
      await openAppMenu(false);
      await action('Archive').waitFor();
      for (const label of ['Delete', 'Archive', 'Edit app…']) {
        const item = action(label);
        await item.scrollIntoViewIfNeeded();
        const box = await item.boundingBox();
        assert(box && box.y >= 0 && box.y + box.height <= size.height + 1, label + ' reachable after menu scroll');
      }
      if (evidence) await page.screenshot({ path: join(evidence, '375-app-menu-scrolled.png') });
      await page.keyboard.press('Escape');
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      console.log('Chrome 375px: app menu top/bottom, Delete, Archive and Edit app reachable; no page overflow.');
      await context.close();
      continue;
    }
    await appCommand('Archive');
    await appCard().waitFor({ state: 'hidden' });
    assert.deepEqual(await read(app.id, cookie), { ...appBaseline, libraryArchived: true });
    assert.deepEqual(await read(appChild.id, cookie), appChildBaseline);
    await page.reload();
    await page.getByRole('button', { name: 'Archived', exact: true }).waitFor();
    assert.equal(await appCard().count(), 0);
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await appCard().waitFor();
    await page.reload();
    await appCard().waitFor();
    assert.equal(new URL(page.url()).pathname, '/builder');
    await page.locator('#thingtime-things-search').fill('Synthetic archive app');
    await appCard().waitFor();
    await appCommand('Restore', size.width > 500);
    await appCard().waitFor({ state: 'hidden' });
    assert.deepEqual(await read(app.id, cookie), appBaseline);
    await page.getByRole('button', { name: 'Active Things', exact: true }).click();
    await appCard().waitFor();
    await page.goto(webOrigin + `/builder?folder=${app.id}&kind=all&view=list`);
    await page.locator(`[data-thing-id="${appChild.id}"]`).last().waitFor();
    await page.getByRole('button', { name: 'Synthetic app child actions' }).press('Enter');
    await action('Archive').waitFor();
    await page.keyboard.press('Escape');
    assert.deepEqual(await read(appChild.id, cookie), appChildBaseline);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Builder app contents width at bottom');
    console.log(`Chrome ${size.width}px: Builder app card Archive, reload, archived search, Restore and preserved app child passed.`);
    await page.goto(webOrigin + '/post/' + published.id, { waitUntil: 'domcontentloaded' });
    const postTrigger = page.getByRole('button', { name: 'Post options', exact: true }).first();
    await postTrigger.waitFor({ timeout: 180000 });
    const openPostMenu = async () => {
      if (size.width < 500) await postTrigger.tap(); else await postTrigger.press('Enter');
    };
    const commentTrigger = page.getByRole('button', { name: 'Comment actions', exact: true }).first();
    await commentTrigger.waitFor();
    if (size.width < 500) await commentTrigger.tap(); else await commentTrigger.press('Enter');
    await action('Archive').waitFor();
    await action('Archive').press('Enter');
    await waitFor(async () => (await describe(comment.id)).libraryArchived, 'comment archive receipt');
    if (size.width < 500) await commentTrigger.tap(); else await commentTrigger.press('Enter');
    await action('Restore').waitFor();
    await action('Restore').press('Enter');
    await waitFor(async () => !(await describe(comment.id)).libraryArchived, 'comment restore receipt');

    await openPostMenu();
    await action('Archive').waitFor();
    if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-post-archive.png`) });
    await action('Archive').press('Enter');
    await waitFor(async () => (await describe(published.id)).libraryArchived, 'post archive receipt');
    assert.equal((await read(published.id, other)).crystal.text, 'Synthetic globally archived post');
    await openPostMenu();
    await action('Restore').waitFor();
    await action('Restore').press('Enter');
    await waitFor(async () => !(await describe(published.id)).libraryArchived, 'post restore receipt');
    if (size.width > 500) {
      let releaseResponse, observeCommitted;
      const responseGate = new Promise(resolve => { releaseResponse = resolve; });
      const committed = new Promise(resolve => { observeCommitted = resolve; });
      const delayedWrite = async route => {
        const request = route.request();
        const body = request.method() === 'POST' ? request.postDataJSON() : null;
        if (body?.id !== published.id || body.action !== 'archive') return route.continue();
        const response = await route.fetch();
        observeCommitted();
        await responseGate;
        await route.fulfill({ response });
      };
      await page.route('**/api/v1/things/actions', delayedWrite);
      await openPostMenu();
      await action('Archive').waitFor();
      await action('Archive').press('Enter');
      await committed;
      await page.keyboard.press('Escape');
      await openPostMenu();
      releaseResponse();
      await waitFor(async () => action('Restore').isEnabled(), 'same-Thing reopened menu is ready');
      assert.equal(await page.getByRole('menu').count(), 1, 'Old completion never closes a reopened menu');
      await page.unroute('**/api/v1/things/actions', delayedWrite);
      await action('Restore').press('Enter');
      await waitFor(async () => !(await describe(published.id)).libraryArchived, 'race fixture restored');

      const failedDescribe = route => route.fulfill({ status: 503, contentType: 'application/json', body: '{"ok":false,"error":"Synthetic unavailable action lookup"}' });
      await page.route('**/api/v1/things/actions?id=*', failedDescribe);
      await openPostMenu();
      await action('Retry action availability').waitFor();
      assert.equal(await action('Archive').count(), 0, 'Failed lookup never exposes stale Archive');
      assert.equal(await action('Restore').count(), 0, 'Failed lookup never exposes stale Restore');
      await page.unroute('**/api/v1/things/actions?id=*', failedDescribe);
      await action('Retry action availability').press('Enter');
      await action('Archive').waitFor();
      await page.keyboard.press('Escape');
    }
    await page.goto(webOrigin + '/post/' + foreignPost.id, { waitUntil: 'domcontentloaded' });
    await postTrigger.waitFor();
    const denied = page.waitForResponse(response => response.url().includes('/api/v1/things/actions?id=' + foreignPost.id) && response.status() === 404);
    await openPostMenu();
    await denied;
    assert.equal(await action('Archive').count(), 0, 'Other-owner menu has no Archive');
    assert.equal(await action('Retry action availability').count(), 0, 'Permission refusal is not a retry failure');
    await page.keyboard.press('Escape');
    await page.goto(webOrigin + '/messages?chat=' + chat.id, { waitUntil: 'domcontentloaded' });
    await page.getByText('Synthetic private archive message', { exact: true }).waitFor({ timeout: 180000 });
    const messageTrigger = page.getByRole('button', { name: 'Message actions', exact: true }).last();
    if (size.width < 500) await messageTrigger.tap(); else await messageTrigger.press('Enter');
    await action('Archive').waitFor();
    if (evidence) await page.screenshot({ path: join(evidence, `${size.width}-message-archive.png`) });
    await action('Archive').press('Enter');
    await waitFor(async () => (await describe(message.id)).libraryArchived, 'message archive receipt');
    await page.goto(webOrigin + '/things?libraryArchive=1&view=list', { waitUntil: 'domcontentloaded' });
    const archivedMessage = page.locator(`[data-thing-id="${message.id}"]`).last();
    await archivedMessage.waitFor();
    assert.equal(await archivedMessage.locator('a[href]').count(), 0, 'Protected metadata has no generic content anchor');
    await archivedMessage.getByRole('button', { name: /actions$/ }).press('Enter');
    await action('Restore').waitFor();
    for (const label of ['Open', 'Inspect', 'Preview', 'Edit', 'Download…']) assert.equal(await action(label).count(), 0, 'Metadata card does not offer ' + label);
    await action('Restore').press('Enter');
    await archivedMessage.waitFor({ state: 'hidden' });
    assert.equal((await describe(message.id)).libraryArchived, false);
    console.log(`Chrome ${size.width}px: global post/message menus and restore discovery passed.`);
    if (process.env.THINGTIME_ARCHIVE_SCOPE === 'apps') {
      await context.close();
      continue;
    }
    await page.goto(webOrigin + '/things?view=list&folder=' + folder.id);
    await row().waitFor({ timeout: 180000 });
    await page.getByRole('button', { name: 'Archived', exact: true }).waitFor();
    await activate('Archive', size.width > 500 ? 'right' : 'touch');
    await row().waitFor({ state: 'hidden' });
    assert.equal((await read(nested.id, cookie)).libraryArchived, true);
    await page.getByRole('button', { name: 'Archived', exact: true }).click();
    await page.getByRole('heading', { name: 'Archived Things' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'New', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Paste', exact: true }).count(), 0);
    await row().waitFor();
    await page.reload();
    await row().waitFor();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'page width at end of scroll');
    await page.evaluate(() => window.scrollTo(0, 0));
    await activate('Restore', 'keyboard');
    await row().waitFor({ state: 'hidden' });
    assert.equal((await read(nested.id, cookie)).libraryArchived, undefined);
    await page.goto(webOrigin + '/things?view=list&folder=' + folder.id);
    await row().waitFor();
    await context.close();
    console.log(`Chrome ${size.width}px: Archive, reload Archived, Restore and original-folder readback passed.`);
  }
  }
} finally {
  await browser?.close().catch(() => {});
  await mongo?.close().catch(() => {});
  for (const { child } of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue;
    const exit = once(child, 'exit');
    try { process.kill(-child.pid, 'SIGTERM'); } catch { continue; }
    await Promise.race([exit, delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }
  await rm(temp, { recursive: true, force: true });
}
