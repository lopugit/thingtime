#!/usr/bin/env node
// Real API/browser acceptance against a task-owned disposable replica and two runtimes.
// No user env files, credentials, profiles, PM2 entries or production data are loaded.
// Mongo driver use is limited to replica initialization; all product data uses APIs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
if (process.argv.includes('--browser-worker')) { await browserAcceptance(); process.exit(); }
const cwd = fileURLToPath(new URL('..', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'tt-mongodb-connections-'));
const ports = { api: 19431, db: 19432, web: 19433, hmr: 19434, second: 19435 };
const origin = `http://127.0.0.1:${ports.api}`;
const secondOrigin = `http://127.0.0.1:${ports.second}`;
const out = process.env.MONGODB_CONNECTIONS_EVIDENCE_DIR;
assert(out, 'MONGODB_CONNECTIONS_EVIDENCE_DIR is required');
const children = [];
const stopped = new Set();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const password = randomBytes(24).toString('hex');
const env = { PATH: process.env.PATH, HOME: dir, TMPDIR: dir, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
 MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=mongodb_connections`, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
 THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(dir, 'attachments'), TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
function start(executable, args, extra = {}) {
 const child = spawn(executable, args, { cwd, detached: true, env: { ...env, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
 let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data); children.push(child);
 return { child, log: () => log };
}
async function stop(running) {
 const child = running.child;
 if (stopped.has(child)) return;
 stopped.add(child);
 const kill = signal => { try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
 const exit = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
 kill('SIGTERM'); const timeout = setTimeout(() => kill('SIGKILL'), 3000); await exit; clearTimeout(timeout); kill('SIGKILL');
}
async function ready(running, selectedOrigin = origin) {
 for (let attempt = 0; attempt < 120; attempt++) {
  if (running.child.exitCode !== null) throw new Error('Task-owned server exited: ' + running.log());
  try { if ((await fetch(selectedOrigin + '/.well-known/thingtime-capabilities.json', { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
  await delay(250);
 }
 throw new Error('Task-owned server did not become ready');
}
async function api(path, { body, cookie, status = 200, headers = {}, selectedOrigin = origin } = {}) {
 const response = await fetch(selectedOrigin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: selectedOrigin, ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
 const data = await response.json(); if (status !== null) assert.equal(response.status, status, path + ': ' + JSON.stringify(data));
 return { data, status: response.status, response, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
let client; let database; let server; let second;
try {
 await mkdir(out, { recursive: true });
 for (const port of Object.values(ports)) { const listener = createServer(); await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => listener.close(resolve)); }
 await mkdir(join(dir, 'db'));
 database = start(process.env.THINGTIME_TEST_MONGOD || 'mongod', ['--dbpath', join(dir, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'mongodb_connections', '--nounixsocket']);
 client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 1000 });
 for (let attempt = 0; ; attempt++) { try { await client.connect(); break; } catch (error) { if (attempt > 20) throw error; await delay(300); } }
 await client.db('admin').command({ replSetInitiate: { _id: 'mongodb_connections', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
 for (let attempt = 0; ; attempt++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break; if (attempt > 100) throw Error('Disposable replica did not become primary'); await delay(200); }
 await client.close(); client = null;
 server = start(process.execPath, ['.output/server/index.mjs']); await ready(server);
 const admin = await api('/api/v1/auth/register', { body: { username: 'connections-admin', email: 'connections-admin@example.invalid', password, displayName: 'Connections Admin' } });
 const other = await api('/api/v1/auth/register', { body: { username: 'connections-other', email: 'connections-other@example.invalid', password, displayName: 'Connections Other' } });
 await stop(server);
 const deployment = { THINGTIME_MONGODB_CONNECTION_MODE: 'dedicated', ADMIN_USERNAMES: 'connections-admin', VERCEL_DEPLOYMENT_ID: 'dpl_acceptance_primary', VERCEL_GIT_COMMIT_REF: 'acceptance-connections-primary', VERCEL_GIT_COMMIT_SHA: '1234567890abcdef1234567890abcdef12345678', VERCEL_URL: 'connections-primary.example.invalid', VERCEL_REGION: 'syd1' };
 server = start(process.execPath, ['.output/server/index.mjs'], deployment); await ready(server);
 second = start(process.execPath, ['.output/server/index.mjs'], { ...deployment, PORT: String(ports.second), VERCEL_DEPLOYMENT_ID: 'dpl_acceptance_secondary', VERCEL_GIT_COMMIT_REF: 'acceptance-connections-secondary', VERCEL_URL: 'connections-secondary.example.invalid' }); await ready(second, secondOrigin);
 await api('/api/v1/auth/me', { cookie: admin.cookie });
 await api('/api/v1/auth/me', { cookie: admin.cookie, selectedOrigin: secondOrigin });
 for (const selectedOrigin of [origin, secondOrigin]) {
  await api('/api/v1/things?limit=1', { cookie: admin.cookie, selectedOrigin });
  await api('/api/v1/admin/mongodb/connections?limit=100', { cookie: admin.cookie, selectedOrigin });
 }
 const manifest = await api('/.well-known/thingtime-capabilities.json');
 assert.equal(manifest.data.origin, origin); assert.equal(manifest.data.features['api.admin-mongodb-connections'].version, '1.1.0');
 const anonymous = await api('/api/v1/admin/mongodb/connections', { status: null }); assert([401, 403].includes(anonymous.status), 'Anonymous access denied');
 await api('/api/v1/admin/mongodb/connections', { cookie: other.cookie, status: 403 });
 const mismatch = await api('/api/v1/admin/mongodb/connections', { cookie: admin.cookie, headers: { 'X-Thingtime-Expected-Actor': 'wrong-actor' }, status: null }); assert(mismatch.status >= 400, 'HTTP actor fence');
 const wrongOrigin = await api('/api/v1/admin/mongodb/connections', { cookie: admin.cookie, headers: { 'X-Thingtime-Expected-Api-Origin': secondOrigin }, status: null }); assert(wrongOrigin.status >= 400, 'HTTP origin fence');
 // One bounded observation window allows the other worker's throttled telemetry to flush.
 let snapshot;
 for (let attempt = 0; attempt < 12; attempt++) {
  const result = await api('/api/v1/admin/mongodb/connections?limit=100', { cookie: admin.cookie });
  assert.match(result.response.headers.get('cache-control') || '', /no-store/); snapshot = result.data.inventory;
  const branches = new Set(snapshot.sources.map(source => source.deployment.branch));
  const attributed = ['dpl_acceptance_primary', 'dpl_acceptance_secondary'].every(id => {
   const features = new Set(snapshot.sources.filter(source => source.deployment.deploymentId === id).flatMap(source => (source.featureUsage || []).filter(usage => usage.accesses > 0 && Number.isFinite(new Date(usage.lastUsedAt).getTime())).map(usage => usage.feature)));
   return ['auth', 'admin', 'things'].every(feature => features.has(feature));
  });
  if (branches.has('acceptance-connections-primary') && branches.has('acceptance-connections-secondary') && attributed) break;
  if (attempt === 11) throw Error('Both task-owned runtimes and auth/admin/things shared-client accesses were not observed within the bounded window');
  await delay(1500);
 }
 assert.equal(snapshot.coverage.complete, false); assert(snapshot.sources.every(source => source.createdBy === 'Thingtime API runtime'));
 assert(snapshot.sources.some(source => source.pools.some(pool => pool.open > 0)), 'Actual CMAP pool sockets observed');
 const firstPage = await api('/api/v1/admin/mongodb/connections?limit=1', { cookie: admin.cookie });
 assert.equal(firstPage.data.inventory.sources.length, 1); assert(firstPage.data.inventory.nextCursor, 'Pagination cursor');
 const nextPage = await api('/api/v1/admin/mongodb/connections?limit=1&cursor=' + encodeURIComponent(firstPage.data.inventory.nextCursor), { cookie: admin.cookie });
 assert.notEqual(firstPage.data.inventory.sources[0].id, nextPage.data.inventory.sources[0].id);
 await writeFile(join(out, 'api-readback.json'), JSON.stringify({ checks: ['manifest version and origin', 'anonymous/non-admin refusal', 'actor/origin fences', 'no-store', 'two real runtimes', 'CMAP sockets', 'auth/admin/things shared-client attribution on both runtimes', 'cursor pagination'], snapshot }, null, 2));
 const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite';const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development' });
 const web = `http://127.0.0.1:${ports.web}`; await ready(vite, web);
 const fixture = join(dir, 'browser-fixture.json'); await writeFile(fixture, JSON.stringify({ origin: web, cookie: admin.cookie, otherCookie: other.cookie, snapshot }), { mode: 0o600 });
 const ui = start(process.execPath, ['scripts/mongodb-connections-acceptance.mjs', '--browser-worker', fixture], { PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE, MONGODB_CONNECTIONS_EVIDENCE_DIR: out });
 const timeout = setTimeout(() => { try { process.kill(-ui.child.pid, 'SIGTERM'); } catch {} }, 600000); const result = await once(ui.child, 'exit'); clearTimeout(timeout); assert.equal(result[0], 0, ui.log()); console.log(ui.log());
} catch (error) {
 console.error(error.message); process.exitCode = 1;
 // These logs belong exclusively to the synthetic environment and contain no fixture cookies/passwords.
 for (const [name, running] of [['database', database], ['primary', server], ['secondary', second]]) if (running) await writeFile(join(out, name + '.log'), running.log(), { mode: 0o600 });
} finally { await client?.close(); for (const child of children.reverse()) await stop({ child }); await rm(dir, { recursive: true, force: true }); }

async function browserAcceptance() {
 const fixture = JSON.parse(await readFile(process.argv.at(-1), 'utf8')); const out = process.env.MONGODB_CONNECTIONS_EVIDENCE_DIR;
 await rm(join(out, 'browser-failure.json'), { force: true }); await rm(join(out, 'failure.png'), { force: true });
 const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
 const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
 const cookies = value => value.split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }; });
 await context.addCookies(cookies(fixture.cookie)); const page = await context.newPage(); const errors = []; const checks = []; page.on('pageerror', error => errors.push(error.message));
 const host = page.locator('[data-settings-document="mongodb-connections"]');
 const flatten = blocks => blocks.flatMap(block => [block, ...flatten(block.children || [])]);
 async function measure(name) {
  await page.evaluate(async () => { const height = document.documentElement.scrollHeight; for (let y = 0; y < height; y += 600) { scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 20)); } scrollTo(0, document.documentElement.scrollHeight); });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' document overflow');
  await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(out, name + '.png'), fullPage: true });
 }
 try {
  for (const width of [1440, 390]) {
   await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
   await page.goto(fixture.origin + '/admin/mongodb-connections', { waitUntil: 'domcontentloaded' });
   await host.getByRole('heading', { name: 'MongoDB connections', exact: true }).waitFor({ timeout: 90000 });
   await host.getByText('What MongoDB reports', { exact: true }).waitFor();
   await host.locator('[data-block-id="mongo-deployment-card"]').first().waitFor();
   const inventory = await page.evaluate(async () => (await (await fetch('/api/v1/admin/mongodb/connections?limit=100')).json()).inventory);
   const cards = host.locator('[data-block-id="mongo-deployment-card"]'); assert.equal(await cards.count(), new Set(inventory.sources.map(source => source.deployment.deploymentId || source.id)).size, 'Actual API deployment count rendered');
   await host.getByRole('searchbox', { name: 'Search loaded connection sources' }).fill('acceptance-connections-secondary');
   await host.getByText(/1 matching deployments/).waitFor(); assert.equal(await cards.count(), 1);
   const selectedSources = inventory.sources.filter(source => source.deployment.deploymentId === 'dpl_acceptance_secondary' && source.status === 'ready' && source.freshness !== 'stale');
   const observed = selectedSources.reduce((sum, source) => sum + source.totals.open, 0);
   assert.equal(await cards.first().locator('[data-block-id="mongo-open-value"]').innerText(), String(observed), 'Deployment count agrees with real API observations');
   const summary = cards.first().getByText('Why these connections?', { exact: true }); await summary.focus(); await page.keyboard.press('Enter');
   await cards.first().getByText('Runtime and pool details', { exact: true }).first().click();
   await cards.first().getByText(/Recorded accesses accumulate since each runtime started/).waitFor();
   for (const label of ['Accounts and sign-in', 'Administration', 'Things and data']) await cards.first().locator('[data-block-id="mongo-feature-name"]').filter({ hasText: label }).waitFor();
   const usageRows = await cards.first().locator('[data-block-id="mongo-feature-accesses"]').allTextContents();
   assert(usageRows.length >= 3 && usageRows.every(value => /[1-9][0-9]* recorded shared-client access(?:es)? · last used/.test(value) && !value.includes('Unknown time')), 'Rendered positive attributed counts and last-use times');
   await cards.first().locator('[data-block-id="mongo-pool-card"]').first().waitFor();
   await cards.first().getByText('Created by', { exact: true }).waitFor(); await cards.first().getByText('Thingtime API runtime', { exact: true }).waitFor();
   await measure('connections-' + width + '-expanded');
   await host.getByRole('searchbox', { name: 'Search loaded connection sources' }).fill('no-match-synthetic-connection');
   await host.getByText(/No loaded sources match/).waitFor(); await measure('connections-' + width + '-empty');
   await host.getByRole('searchbox', { name: 'Search loaded connection sources' }).fill('');
   await host.getByRole('combobox', { name: 'Filter snapshot freshness' }).selectOption('current');
   await host.getByRole('combobox', { name: 'Filter snapshot freshness' }).selectOption('all');
   const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/mongodb/connections');
   await host.getByRole('button', { name: 'Refresh observations', exact: true }).click(); assert((await refreshed).ok());
   await host.getByRole('button', { name: 'Refresh observations', exact: true }).waitFor();
   if (width === 390) {
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.locator('.lopuLauncher').isVisible(), false, 'Duplicate floating launcher cannot cover mobile inventory controls');
    const navLopu = page.locator('.nav-lopu-button'); await navLopu.focus(); await page.keyboard.press('Enter');
    await page.getByRole('complementary', { name: 'Lopu assistant', exact: true }).waitFor();
    await page.getByRole('complementary', { name: 'Lopu assistant', exact: true }).getByRole('button', { name: 'Close (Esc)', exact: true }).click();
    await page.getByRole('complementary', { name: 'Lopu assistant', exact: true }).waitFor({ state: 'hidden' });
    const refresh = host.getByRole('button', { name: 'Refresh observations', exact: true });
    await refresh.scrollIntoViewIfNeeded();
    const hits = await refresh.evaluate(node => { const r = node.getBoundingClientRect(); return [0.1, 0.5, 0.9].flatMap(x => [0.15, 0.5, 0.85].map(y => { const hit = document.elementFromPoint(r.left + r.width * x, r.top + r.height * y); return hit === node || node.contains(hit); })); });
    assert(hits.every(Boolean), 'Every representative Refresh hit point is clear');
    checks.push('Mobile launcher suppressed; keyboard navigation still opens/closes Lopu; Refresh hit targets clear');
   }
   await measure('connections-' + width + '-cards'); checks.push(width + ': actual API cards, search, empty, freshness, keyboard details, refresh, full scroll');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await host.getByRole('button', { name: 'Edit layout', exact: true }).click(); await host.getByRole('button', { name: 'Open Builder inspector', exact: true }).click();
  const drawer = page.getByTestId('builder-drawer');
  for (const [id, label, value] of [['mongo-intro', 'Block text', 'Connection sources reviewed independently'], ['mongo-source-counts', 'Block text', '{item.counts} · reviewed'], ['mongo-search', 'Element placeholder', 'Find a runtime']]) {
   await drawer.getByRole('combobox', { name: 'Select block', exact: true }).selectOption(id);
   await drawer.getByRole('textbox', { name: label, exact: true }).fill(value); await drawer.getByRole('textbox', { name: label, exact: true }).blur();
  }
  await page.getByRole('button', { name: 'Close builder', exact: true }).click();
  const save = page.waitForResponse(response => { try { return new URL(response.url()).pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(response.request().method()) && response.request().postDataJSON()?.crystal?.pageKey === 'settings-mongodb-connections'; } catch { return false; } });
  await host.getByRole('button', { name: 'Save layout', exact: true }).click(); const result = await (await save).json(); assert(result.ok);
  const readback = await page.evaluate(async id => (await (await fetch('/api/v1/things?id=' + encodeURIComponent(id))).json()).thing, result.thing.id);
  const saved = flatten(readback.crystal.blocks); assert.equal(saved.find(block => block.id === 'mongo-source-counts').text, '{item.counts} · reviewed'); assert.equal(saved.find(block => block.id === 'mongo-search').props.placeholder, 'Find a runtime');
  assert.deepEqual(readback.acl, ['tt:user']);
  await page.reload(); await host.getByText('Connection sources reviewed independently', { exact: true }).waitFor({ timeout: 90000 }); await host.getByText('Why these connections?', { exact: true }).first().click(); await host.getByText(/observed pool sockets.*reviewed/).first().waitFor();
  assert.equal(await host.getByRole('searchbox', { name: 'Search loaded connection sources' }).getAttribute('placeholder'), 'Find a runtime'); checks.push('Builder edits nested text, control, repeated-card field; private exact readback and reload');
  await page.goto(fixture.origin + '/settings/admin', { waitUntil: 'domcontentloaded' }); await page.getByText('Global controls — AI conflict resolution, rate limits, and admin access.', { exact: true }).click(); await host.getByRole('heading', { name: 'MongoDB connections', exact: true }).waitFor({ timeout: 90000 }); await host.getByText('Connection sources reviewed independently', { exact: true }).waitFor(); checks.push('Settings Admin reuses same saved editable layout');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.lopuLauncher').waitFor({ state: 'hidden' });
  const adminDisclosure = page.getByText('Global controls — AI conflict resolution, rate limits, and admin access.', { exact: true });
  await adminDisclosure.click(); await page.locator('.lopuLauncher').waitFor({ state: 'visible' });
  await adminDisclosure.click(); await page.locator('.lopuLauncher').waitFor({ state: 'hidden' });
  await measure('connections-390-settings'); checks.push('Mobile Settings disclosure restores launcher when workspace is collapsed');
  await context.clearCookies(); await context.addCookies(cookies(fixture.otherCookie)); await page.reload(); assert.equal((await page.request.get(fixture.origin + '/api/v1/admin/mongodb/connections')).status(), 403); assert.equal(await page.locator('[data-block-id="mongo-source-card"]').count(), 0); checks.push('Non-admin identity cannot retain prior inventory');
  assert.deepEqual(errors, []); await writeFile(join(out, 'browser-result.json'), JSON.stringify({ ok: true, checks, errors, source: 'real API, two isolated runtimes, disposable replica', origin: fixture.origin }, null, 2)); console.log(JSON.stringify({ ok: true, checks: checks.length, out }));
 } catch (error) { await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }); await writeFile(join(out, 'browser-failure.json'), JSON.stringify({ message: error.message, url: page.url(), errors, body: (await page.locator('body').innerText()).slice(0, 5000) }, null, 2)); throw error; }
 finally { await context.close(); await browser.close(); }
}
