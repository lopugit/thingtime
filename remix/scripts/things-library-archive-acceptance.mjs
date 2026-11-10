#!/usr/bin/env node
// Disposable real API + isolated Chrome acceptance. Prerequisite: node-server
// Nitro build; PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE may select tooling.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
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
  for (const [key, version] of [['api.things', '1.58.0'], ['api.things-search', '1.5.0'], ['api.things-bulk', '1.8.0']]) assert.equal(manifest.features[key].version, version);
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

  const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${web},strictPort:true}});await server.listen();`], source, { NODE_ENV: 'development' });
  await waitFor(async () => (await fetch(webOrigin + manifestPath, { signal: AbortSignal.timeout(1000) })).ok, 'isolated Vite', vite);
  const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
  for (const size of [{ width: 1440, height: 1000 }, { width: 375, height: 812 }]) {
    const context = await browser.newContext({ viewport: size, isMobile: size.width < 500, hasTouch: size.width < 500 });
    await context.addCookies(cookie.split('; ').map(pair => {
      const index = pair.indexOf('=');
      return { name: pair.slice(0, index), value: pair.slice(index + 1), url: webOrigin, httpOnly: true, sameSite: 'Lax' };
    }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
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
