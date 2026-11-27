#!/usr/bin/env node
// Built HTTP handler + real disposable replica set. Application fixtures use
// supported APIs only; Mongo is used solely to initiate/observe the replica.
// No inherited account, vault, application configuration or test profile.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-builder-entrypoint-'));
const children = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const availablePort = async () => {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
};
const ports = { db: await availablePort(), api: await availablePort() };
const origin = `http://127.0.0.1:${ports.api}`;
const env = { PATH: process.env.PATH || '/usr/bin:/bin', HOME: dir, TMPDIR: dir,
  NODE_ENV: 'development', HOST: '127.0.0.1', PORT: String(ports.api),
  MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=builderentrypoint`,
  JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development' };
function start(command, args) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: 'ignore' }); children.push(child); return child;
}
async function waitFor(read, label) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (await read()) return; await delay(200); }
  throw Error(`Timed out: ${label}`);
}
async function api(path, { cookie, token, body, method = body === undefined ? 'GET' : 'POST', status = 200 } = {}) {
  const start = performance.now();
  const response = await fetch(origin + path, { method, headers: { Origin: origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = null; }
  assert.equal(response.status, status, `${method} ${path.split('?')[0]} unexpected status${typeof data?.error === 'string' ? `: ${data.error}` : ''}`);
  return { data, ms: Math.round((performance.now() - start) * 100) / 100, bytes: Buffer.byteLength(text),
    cache: response.headers.get('cache-control'), cookie: (response.headers.getSetCookie?.() || []).map(value => value.split(';')[0]).join('; ') };
}
const register = () => api('/api/v1/auth/register', { body: { username: 'largepage' + randomBytes(6).toString('hex'),
  email: `largepage${randomUUID()}@example.invalid`, password: randomBytes(32).toString('hex') } });
let client, browser, tab;
try {
  await mkdir(join(dir, 'db'));
  start(process.env.MONGOD_PATH || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'builderentrypoint', '--nounixsocket']);
  client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
  await waitFor(async () => { try { await client.connect(); return true; } catch { return false; } }, 'disposable Mongo startup');
  await client.db('admin').command({ replSetInitiate: { _id: 'builderentrypoint', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
  await waitFor(async () => (await client.db('admin').command({ hello: 1 })).isWritablePrimary, 'replica primary');
  await client.close(); client = null;
  const server = start(process.execPath, ['.output/server/index.mjs']);
  await waitFor(async () => { assert.equal(server.exitCode, null, 'Disposable Nitro exited');
    try { return (await fetch(origin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(800) })).ok; } catch { return false; }
  }, 'built Nitro HTTP server');
  const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
  assert.equal(manifest.origin, origin);
  for (const [feature, required] of Object.entries({ 'api.things': '1.46.0', 'api.things-search': '1.3.0' })) {
    const actual = manifest.features[feature]?.version?.split('.').map(Number);
    const minimum = required.split('.').map(Number);
    assert(actual && actual[0] === minimum[0] && (actual[1] > minimum[1] || actual[1] === minimum[1] && actual[2] >= minimum[2]), `Missing ${feature}`);
  }
  const owner = await register(), other = await register(); assert(owner.cookie && other.cookie);
  const create = async (thingtime, crystal, folderId = null, cookie = owner.cookie) => (await api('/api/v1/things', { cookie, body: { thingtime, crystal, folderId, visibility: 'private' } })).data.thing;
  const appA = await create(['folder', 'builder-thing'], { name: 'Alpha acceptance app', builderApp: true, metadata: {} });
  const appB = await create(['folder', 'builder-thing'], { name: 'Beta acceptance app', builderApp: true, metadata: {} });
  const pageA = await create(['webpage'], { name: 'Shared Alpha page', version: 1, blocks: [{ id: 'alpha-text', type: 'text', text: 'Alpha live source truth' }] }, appA.id);
  const pageB = await create(['webpage'], { name: 'Shared Beta page', version: 1, blocks: [{ id: 'beta-text', type: 'text', text: 'Beta live source truth' }] }, appB.id);
  const componentA = await create(['component'], { name: 'Shared Alpha component', componentKey: 'alpha-component', version: 1, args: [], render: { tag: 'p', children: 'Alpha component' } }, appA.id);
  const nestedFolder = await create(['folder'], { name: 'Nested Alpha folder' }, appA.id);
  const nestedPage = await create(['webpage'], { name: 'Nested Alpha page', version: 1, blocks: [] }, nestedFolder.id);
  const foreignPage = await create(['webpage'], { name: 'Other account page', version: 1, blocks: [] }, null, other.cookie);
  assert(appA?.id && appB?.id && pageA?.id && pageB?.id && componentA?.id && foreignPage?.id);
  async function point(id, metadata) {
    const current = (await api(`/api/v1/things?id=${id}`, { cookie: owner.cookie })).data.thing;
    return (await api('/api/v1/things/update', { cookie: owner.cookie, body: { id, expectedUpdatedAt: current.updatedAt, crystal: { ...current.crystal, metadata } } })).data;
  }
  assert.equal((await point(appA.id, { entryPointThingId: pageA.id })).ok, true);
  const scoped = (await api('/api/v1/things/search', { cookie: owner.cookie, body: { q: 'Shared', author: owner.data.user?.username, conditions: [{ field: 'folderId', op: 'eq', value: appA.id }], limit: 50 } })).data;
  assert(scoped.things.some(row => row.id === pageA.id)); assert(!scoped.things.some(row => row.id === pageB.id));
  await api(`/api/v1/things?id=${foreignPage.id}`, { cookie: owner.cookie, status: 404 });
  const { chromium } = await import(process.env.TT_SHARED_PLAYWRIGHT_PATH || 'playwright');
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.TT_SHARED_CHROME_PATH });
  const context = await browser.newContext();
  // Vercel owns this hosted-only endpoint; standalone Nitro has no analytics service.
  // All application API and content requests still use the real disposable server.
  await context.route('**/_vercel/insights/script.js', route => route.fulfill({ contentType: 'application/javascript', body: '/* hosted analytics absent in standalone acceptance */' }));
  await context.addCookies(owner.cookie.split('; ').map(pair => { const at = pair.indexOf('='); return { name: pair.slice(0, at), value: pair.slice(at + 1), url: origin }; }));
  tab = await context.newPage();
  const errors = [];
  tab.on('pageerror', error => errors.push({ message: error.message, stack: error.stack }));
  const htmlScripts = new Set();
  tab.on('response', response => { if (response.request().resourceType() === 'script' && response.headers()['content-type']?.includes('text/html')) htmlScripts.add(new URL(response.url()).pathname); });
  const searchRequests = [];
  tab.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/things/search') searchRequests.push(JSON.parse(request.postData() || '{}')); });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 390, height: 844 }]) {
    await tab.setViewportSize(viewport);
    for (const view of ['grid', 'list', 'columns']) {
      await tab.goto(origin + `/builder?kind=apps&view=${view}`);
      const row = tab.locator(`[data-thing-id="${appA.id}"]`);
      await row.getByTestId('thing-title-link').waitFor();
      await row.getByTestId('thing-title-link').click();
      await tab.waitForURL(`**/p/${pageA.id}`);
      await tab.getByText('Alpha live source truth', { exact: true }).waitFor();
    }
    await tab.goto(origin + '/builder?kind=apps&view=grid');
    const appCard = tab.locator(`[data-thing-id="${appA.id}"]`);
    await appCard.getByTestId('thing-title-link').waitFor();
    assert(await appCard.getByRole('link', { name: 'Browse', exact: true }).count());
    assert(await appCard.getByRole('button', { name: 'Edit app', exact: true }).count());
    await appCard.getByTestId('thing-title-link').click();
    await tab.waitForURL(`**/p/${pageA.id}`);
    await tab.getByText('Alpha live source truth', { exact: true }).waitFor();
    await tab.goto(origin + `/builder?folder=${appA.id}&kind=all&sort=newest&group=none`);
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Shared Alpha page' }).waitFor();
    const initialSearch = tab.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things/search');
    await tab.locator('#thingtime-things-search').fill('Shared');
    await initialSearch;
    assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
    assert.equal(await tab.getByText('Shared Beta page', { exact: true }).count(), 0);
    await tab.getByRole('button', { name: /pages$/i }).click();
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Shared Alpha page' }).waitFor();
    assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
    assert.equal(new URL(tab.url()).searchParams.get('q'), 'Shared');
    assert.equal(await tab.getByText('Shared Beta page', { exact: true }).count(), 0);
    for (const name of ['List', 'Columns', 'Grid', 'Previews', 'Names']) {
      await tab.getByRole('button', { name, exact: true }).click();
      assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
      assert.equal(new URL(tab.url()).searchParams.get('q'), 'Shared');
    }
    for (const name of [/components$/i, /data$/i, /actions$/i, /schemas$/i, /All app items$/]) {
      await tab.getByRole('button', { name }).click();
      assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
      assert.equal(new URL(tab.url()).searchParams.get('q'), 'Shared');
      assert.equal(await tab.getByText('Shared Beta page', { exact: true }).count(), 0);
    }
    await tab.getByRole('button', { name: /pages$/i }).click();
    await tab.getByRole('button', { name: 'Newest first', exact: true }).click();
    await tab.getByRole('menuitem', { name: /Name A–Z/ }).click();
    await tab.getByRole('button', { name: 'Group', exact: true }).click();
    await tab.getByRole('menuitem', { name: /By kind/ }).click();
    assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
    assert.equal(new URL(tab.url()).searchParams.get('q'), 'Shared');
    await tab.reload();
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Shared Alpha page' }).waitFor();
    await tab.goBack(); await tab.goForward();
    assert.equal(new URL(tab.url()).searchParams.get('folder'), appA.id);
    await tab.getByRole('button', { name: 'Edit app', exact: true }).click();
    await tab.getByRole('dialog').waitFor();
    assert.equal(await tab.getByRole('textbox', { name: 'Entry point Thing ID' }).inputValue(), pageA.id);
    if (process.env.TT_BUILDER_EVIDENCE_DIR) await tab.screenshot({ path: join(process.env.TT_BUILDER_EVIDENCE_DIR, `builder-settings-${viewport.width}.png`), fullPage: true });
    await tab.getByRole('textbox', { name: 'Entry point Thing ID' }).fill(foreignPage.id);
    await tab.getByRole('button', { name: 'Save app', exact: true }).click();
    await tab.getByRole('alert').filter({ hasText: /missing or unavailable/ }).waitFor();
    await tab.locator('#builder-app-entry-page').selectOption(pageB.id);
    await tab.getByRole('button', { name: 'Save app', exact: true }).click();
    await tab.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await api(`/api/v1/things?id=${appA.id}`, { cookie: owner.cookie })).data.thing.crystal.metadata.entryPointThingId, pageB.id);
    assert.equal((await api(`/api/v1/things?id=${pageB.id}`, { cookie: owner.cookie })).data.thing.folderId, appB.id);
    await tab.getByRole('button', { name: 'Edit app', exact: true }).click();
    await tab.getByRole('textbox', { name: 'Entry point Thing ID' }).fill('');
    await tab.getByRole('button', { name: 'Save app', exact: true }).click();
    await tab.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.equal((await api(`/api/v1/things?id=${appA.id}`, { cookie: owner.cookie })).data.thing.crystal.metadata.entryPointThingId, undefined);
    assert.equal((await point(appA.id, { entryPointThingId: pageA.id })).ok, true);
    await tab.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    assert(await tab.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.TT_BUILDER_EVIDENCE_DIR) await tab.screenshot({ path: join(process.env.TT_BUILDER_EVIDENCE_DIR, `builder-${viewport.width}.png`), fullPage: true });
    await tab.goto(origin + `/builder?folder=${appA.id}&kind=all&view=grid`);
    await tab.locator(`[data-thing-id="${nestedFolder.id}"]`).getByTestId('thing-title-link').click();
    await tab.waitForURL(url => url.searchParams.get('folder') === nestedFolder.id);
    const nestedSearch = tab.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things/search');
    await tab.locator('#thingtime-things-search').fill('Nested'); await nestedSearch;
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Nested Alpha page' }).waitFor();
    assert.equal(await tab.getByText('Shared Alpha page', { exact: true }).count(), 0);
    await tab.reload();
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Nested Alpha page' }).waitFor();
    await tab.goBack();
    await tab.waitForURL(url => url.searchParams.get('folder') === appA.id);
    await tab.goForward();
    await tab.waitForURL(url => url.searchParams.get('folder') === nestedFolder.id);
    await tab.getByRole('button', { name: 'All apps', exact: true }).click();
    await tab.getByTestId('thing-title-link').filter({ hasText: 'Beta acceptance app' }).waitFor();
    assert.equal(new URL(tab.url()).searchParams.has('folder'), false);
  }
  assert(searchRequests.length > 0 && searchRequests.filter(body => body.q === 'Shared').every(body => body.conditions?.some(condition => condition.field === 'folderId' && condition.value === appA.id)));
  for (const metadata of [{ entryPageId: pageA.id, entryUrl: 'https://ignored.invalid' }, { entryPointThingId: foreignPage.id }, { entryPointThingId: appA.id }, {}]) {
    assert.equal((await point(appA.id, metadata)).ok, true);
    await tab.goto(origin + `/builder?app=${appA.id}`);
    if (metadata.entryPageId) await tab.waitForURL(`**/p/${pageA.id}`);
    else if (!metadata.entryPointThingId) await tab.waitForURL(`**folder=${appA.id}**`);
    else { await tab.getByRole('alert').waitFor(); assert(await tab.getByRole('link', { name: 'Browse app', exact: true }).count()); }
  }
  assert.equal((await api(`/api/v1/things?id=${pageA.id}`, { cookie: owner.cookie })).data.thing.folderId, appA.id);
  assert.equal((await api(`/api/v1/things?id=${appA.id}`, { cookie: owner.cookie })).data.thing.visibility, 'private');
  if (errors.length || htmlScripts.size) console.error('Browser diagnostics:', JSON.stringify({ errors, htmlScripts: [...htmlScripts] }));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, realApi: true, disposableReplica: true, independentApps: 2, viewports: [1440, 390], entrypointAcl: true, legacyPointer: true, scopedSearch: true, audienceUnchanged: true }));
} catch (error) {
  if (tab && process.env.TT_BUILDER_EVIDENCE_DIR) {
    await tab.screenshot({ path: join(process.env.TT_BUILDER_EVIDENCE_DIR, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Synthetic browser state:', await tab.locator('body').innerText().catch(() => 'unavailable'));
  }
  throw error;
} finally {
  await browser?.close();
  await client?.close().catch(() => {});
  await Promise.all(children.map(async child => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    try { process.kill(-child.pid, 'SIGTERM'); } catch { return; }
    await Promise.race([once(child, 'exit'), delay(3000)]);
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
  }));
  await rm(dir, { recursive: true, force: true });
}
