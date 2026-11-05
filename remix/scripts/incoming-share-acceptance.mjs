#!/usr/bin/env node
// Real API and isolated browser/replica acceptance. Native byte delivery is a
// runtime fixture, never a shipped route. No production env/account is reused.
// Prerequisite: NITRO_PRESET=node-server pnpm --dir remix run build:server.
// SHARE_COMPOSER_EVIDENCE_DIR=/tmp/... PLAYWRIGHT_MODULE=/absolute/index.mjs
// CHROMIUM_EXECUTABLE=/absolute/chrome node remix/scripts/incoming-share-acceptance.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { Resvg } from '@resvg/resvg-js';
if (process.argv.includes('--browser-worker')) { await browserAcceptance(); process.exit(); }
const source = fileURLToPath(new URL('..', import.meta.url));
const evidence = process.env.SHARE_COMPOSER_EVIDENCE_DIR;
assert(evidence, 'Set SHARE_COMPOSER_EVIDENCE_DIR outside the repository.');
await mkdir(evidence, { recursive: true });
const temporary = await mkdtemp(join(tmpdir(), 'tt-incoming-share-'));
const ports = { api: 18430, db: 18431, web: 18432, hmr: 18433 };
const origin = `http://127.0.0.1:${ports.api}`, webOrigin = `http://127.0.0.1:${ports.web}`;
const children = [], delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtime = { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary, NODE_ENV: 'production', HOST: '127.0.0.1', PORT: String(ports.api),
 MONGODB_CONNECTION_STRING: `mongodb://127.0.0.1:${ports.db}/thingtime?replicaSet=incoming_share`, JWT_SECRET: randomBytes(48).toString('hex'), THINGTIME_DATA_ENV: 'development',
 THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR: join(temporary, 'attachments'), TT_WEB_PORT: String(ports.web), TT_API_PORT: String(ports.api), TT_HMR_PORT: String(ports.hmr) };
function start(command, args, extra = {}, cwd = temporary) {
 const child = spawn(command, args, { cwd, detached: true, env: { ...runtime, ...extra }, stdio: ['ignore', 'pipe', 'pipe'] });
 let log = ''; child.stdout.on('data', data => log += data); child.stderr.on('data', data => log += data);
 const result = { child, log: () => log }; children.push(result); return result;
}
async function stop(running) {
 if (!running) return;
 const kill = signal => { try { process.kill(-running.child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
 const exit = running.child.exitCode !== null || running.child.signalCode !== null ? Promise.resolve() : once(running.child, 'exit');
 kill('SIGTERM'); const forced = setTimeout(() => kill('SIGKILL'), 3000); await exit; clearTimeout(forced); kill('SIGKILL');
}
async function ready(running, target = origin) {
 for (let attempt = 0; attempt < 120; attempt++) {
  if (running.child.exitCode !== null) throw Error(running.log());
  try { if ((await fetch(`${target}/.well-known/thingtime-capabilities.json`, { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
  await delay(200);
 }
 throw Error('Server did not start: ' + running.log());
}
async function api(path, body, cookie) {
 const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
 const data = await response.json(); assert(response.ok, `${path}: ${response.status} ${JSON.stringify(data)}`);
 return { data, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
}
let client, server, database;
try {
 for (const port of Object.values(ports)) { const socket = createServer(); await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(port, '127.0.0.1', resolve); }); await new Promise(resolve => socket.close(resolve)); }
 await mkdir(join(temporary, 'db'));
 database = start(process.env.THINGTIME_TEST_MONGOD || '/opt/homebrew/bin/mongod', ['--dbpath', join(temporary, 'db'), '--port', String(ports.db), '--bind_ip', '127.0.0.1', '--replSet', 'incoming_share', '--nounixsocket']);
 client = new MongoClient(`mongodb://127.0.0.1:${ports.db}/?directConnection=true`, { serverSelectionTimeoutMS: 700 });
 for (let n = 0;; n++) { try { await client.connect(); break; } catch (error) { if (n > 30) throw error; await delay(250); } }
 // Replica infrastructure only; all product records go through HTTP APIs.
 await client.db('admin').command({ replSetInitiate: { _id: 'incoming_share', members: [{ _id: 0, host: `127.0.0.1:${ports.db}` }] } });
 for (let n = 0;; n++) { if ((await client.db('admin').command({ hello: 1 })).isWritablePrimary) break; assert(n < 100); await delay(200); }
 await client.close();
 server = start(process.execPath, [join(source, '.output/server/index.mjs')]); await ready(server);
 // Verify the actual selected data plane before the first product mutation.
 const health = (await api('/api/v1/health/mongodb')).data;
 assert.equal(health.dbName, 'thingtime'); assert.equal(health.replicaSet, 'incoming_share'); assert.equal(health.custom, false);
 const register = async username => api('/api/v1/auth/register', { username, email: `${username}@example.invalid`, displayName: username, password: randomBytes(24).toString('hex') });
 const owner = await register('incoming-share-owner'), recipient = await register('incoming-share-recipient');
 await stop(server); server = start(process.execPath, [join(source, '.output/server/index.mjs')], { ADMIN_USERNAMES: 'incoming-share-owner' }); await ready(server);
 const manifest = (await api('/.well-known/thingtime-capabilities.json')).data;
 assert.equal(manifest.origin, origin); assert.equal(manifest.features['api.chats-messages'].version, '1.4.0');
 const chat = (await api('/api/v1/chats', { chatType: 'dm', memberIds: [recipient.data.user.id] }, owner.cookie)).data.chat;
 assert(chat.id);
 const vite = start(process.execPath, ['--input-type=module', '-e', `import {createServer} from 'vite'; const server=await createServer({envFile:false,server:{host:'127.0.0.1',port:${ports.web},strictPort:true}});await server.listen();`], { NODE_ENV: 'development' }, source);
 await ready(vite, webOrigin);
 const fixtureFile = join(temporary, 'browser-fixture.json');
 await writeFile(fixtureFile, JSON.stringify({ origin: webOrigin, apiOrigin: origin, cookie: owner.cookie, ownerId: owner.data.user.id, recipientId: recipient.data.user.id, chatId: chat.id }), { mode: 0o600 });
 console.log(`Isolated incoming-share UI ready: ${webOrigin}; API ${origin}. Evidence ${evidence}`);
 const extra = Object.fromEntries(Object.entries({ PLAYWRIGHT_MODULE: process.env.PLAYWRIGHT_MODULE, CHROMIUM_EXECUTABLE: process.env.CHROMIUM_EXECUTABLE, SHARE_COMPOSER_EVIDENCE_DIR: evidence }).filter(([, value]) => value));
 if (process.argv.includes('--host-only')) { console.log('Host-only fixture ready; browser acceptance runs as a separate bounded worker.'); } else {
 const browser = start(process.execPath, [join(source, 'scripts/incoming-share-acceptance.mjs'), '--browser-worker', fixtureFile], extra, source);
 const timeout = setTimeout(() => { try { process.kill(-browser.child.pid, 'SIGTERM'); } catch {} }, 600000);
 const [code] = await once(browser.child, 'exit'); clearTimeout(timeout); console.log(browser.log()); assert.equal(code, 0, browser.log());
 }
} catch (error) {
 console.error(error.message); process.exitCode = 1;
} finally {
 if (process.env.SHARE_COMPOSER_HOLD_FILE && server && server.child.exitCode === null) {
  const marker = process.env.SHARE_COMPOSER_HOLD_FILE; await writeFile(marker, 'Task-owned native acceptance host; remove this marker when native verification finishes.');
  console.log(`Retaining isolated UI for native acceptance, release marker: ${marker}`);
  const holdMs = Number(process.env.SHARE_COMPOSER_HOLD_MS || 900000);
  assert(Number.isSafeInteger(holdMs) && holdMs > 0, 'SHARE_COMPOSER_HOLD_MS must be a finite positive duration.');
  const deadline = Date.now() + holdMs;
  while (Date.now() < deadline) { try { await readFile(marker); } catch { break; } await delay(1000); }
 }
 await client?.close();
 for (const running of children) if (running === server || running === database) await writeFile(join(evidence, running === server ? 'server.log' : 'database.log'), running.log(), { mode: 0o600 });
 for (const running of children.reverse()) await stop(running);
 await rm(temporary, { recursive: true, force: true });
}

async function browserAcceptance() {
 const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
 const fixture = JSON.parse(await readFile(process.argv.at(-1), 'utf8')), out = process.env.SHARE_COMPOSER_EVIDENCE_DIR;
 await mkdir(out, { recursive: true });
 const browser = await chromium.launch({ headless: true, chromiumSandbox: true, executablePath: process.env.CHROMIUM_EXECUTABLE });
 const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
 await context.addCookies(fixture.cookie.split('; ').map(pair => { const index = pair.indexOf('='); return { name: pair.slice(0, index), value: pair.slice(index + 1), url: fixture.origin, httpOnly: true, sameSite: 'Lax' }; }));
 const batches = ['post', 'message', 'save'].map(destination => ({ id: randomUUID(), destination, text: destination === 'message' ? 'Shared long message ' + 'x'.repeat(4100) : `Shared ${destination} text\n${'x'.repeat(destination === 'save' || destination === 'post' ? 20_000 : 0)}\nhttps://example.invalid/reference`, files: destination === 'message' ? Array.from({ length: 26 }, (_, index) => ({ id: `opaque-${index}`, name: `shared-${index}.unknown`, relativePath: '', type: 'application/octet-stream', bytes: Buffer.from(`opaque original message file ${index}`).toString('base64') })) : destination === 'save' ? [{ id: 'opaque-1', name: 'same.unknown', relativePath: 'folder/a/same.unknown', type: 'application/octet-stream', bytes: Buffer.from('exact first file').toString('base64') }, { id: 'opaque-2', name: 'same.unknown', relativePath: 'folder/b/same.unknown', type: 'application/octet-stream', bytes: Buffer.from('exact second file').toString('base64') }] : [{ id: 'opaque-1', name: 'shared.unknown', relativePath: '', type: 'application/octet-stream', bytes: Buffer.from('opaque original file bytes').toString('base64') }], directories: destination === 'save' ? ['folder/empty'] : [] }));
 for (const [index, colour] of ['#59ff9c', '#ffa3b1'].entries()) {
  const bytes = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="${colour}"/></svg>`).render().asPng();
  batches[0].files.push({ id: `photo-${index}`, name: `photo-${index}.png`, relativePath: '', type: 'image/png', bytes: bytes.toString('base64') });
 }
 batches.push({ id: randomUUID(), destination: 'directories', text: '', files: [], directories: ['Only folders/empty'] });
 for (const batch of batches.filter(item => item.destination !== 'directories')) batch.files.push({ id: 'empty-file', name: 'empty.unknown', relativePath: '', type: 'application/octet-stream', bytes: '' });
 if (process.env.SHARE_COMPOSER_SCOPE === 'post-keyboard') { batches[0].text = 'Keyboard action reachability\nUnicode: café 🌏'; batches[0].files = []; }
 if (process.env.SHARE_COMPOSER_SCOPE === 'contexts-keyboard') for (const batch of batches) { batch.text = 'Keyboard context draft'; batch.files = []; }
 await context.addInitScript(({ batches, ownerId }) => {
  window.thingtimeShare = { version: '1.0.0', request: async body => {
   const requestId = new URLSearchParams(location.search).get('requestId'), batch = batches.find(item => item.id === requestId);
   if (!batch) throw Error('Fixture request mismatch');
   const key = 'fixture-submission-' + batch.id;
   if (body.method === 'manifest') return { version: '1.0.0', origin: location.origin, requestId, maxChunkBytes: 262144 };
   if (body.accountId !== ownerId || body.requestId !== batch.id) throw Error('Fixture scope mismatch');
   let submission = JSON.parse(sessionStorage.getItem(key) || 'null');
   if (body.method === 'getIncomingShare') return { id: batch.id, accountId: ownerId, apiOrigin: location.origin, text: batch.text, directories: batch.directories, submission, attachments: batch.files.map(file => ({ ...file, size: atob(file.bytes).length })) };
   if (body.method === 'read') { const file = batch.files.find(item => item.id === body.fileId); if (!file) throw Error('Unknown file'); const value = atob(file.bytes).slice(body.offset, body.offset + body.length); return { base64: btoa(value), nextOffset: body.offset + value.length, eof: body.offset + value.length === atob(file.bytes).length }; }
   if (body.method === 'beginSubmission') {
    const intended = { destination: body.destination, operationId: body.operationId, ...(body.targetId ? { targetId: body.targetId } : {}), ...(body.recoveryPayload !== undefined ? { recoveryPayload: body.recoveryPayload } : {}) };
    if (submission && JSON.stringify({ ...submission, outcomeIds: undefined }) !== JSON.stringify(intended)) throw Error('Fixture immutable submission changed');
    submission ||= intended; sessionStorage.setItem(key, JSON.stringify(submission)); return { submission };
   }
   if (body.method === 'recordOutcome') { if (batch.destination === 'post' && !sessionStorage.getItem(key + ':receipt-failure')) { sessionStorage.setItem(key + ':receipt-failure', '1'); window.__incomingShareReceiptFailed = true; throw Error('Simulated lost native receipt response after API success'); } if (!submission || submission.destination !== body.destination || submission.operationId !== body.operationId || submission.targetId !== body.targetId) throw Error('Fixture receipt scope mismatch'); submission.outcomeIds = body.outcomeIds; sessionStorage.setItem(key, JSON.stringify(submission)); return { ok: true }; }
   if (body.method === 'complete') { if (!submission?.outcomeIds?.length) throw Error('Fixture requires a real outcome'); window.__incomingShareOutcome = submission; return { ok: true }; }
   throw Error('Unsupported fixture bridge method');
  } };
 }, { batches, ownerId: fixture.ownerId });
 const page = await context.newPage(), errors = [], checks = [], responses = [];
 page.on('response', response => { const path = new URL(response.url()).pathname; if (path.startsWith('/api/')) responses.push({ path, status: response.status() }); });
 page.on('pageerror', error => errors.push(error.message));
 const api = async path => { const response = await context.request.get(fixture.origin + path); assert(response.ok(), `${path}: ${response.status()}`); return response.json(); };
 const inspect = async name => {
  await page.evaluate(async () => { for (const surface of [document.scrollingElement, ...document.querySelectorAll('*')].filter(node => node && node.scrollHeight > node.clientHeight && (node === document.scrollingElement || /auto|scroll/.test(getComputedStyle(node).overflowY)))) { for (let y = 0; y < surface.scrollHeight; y += 500) { surface.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 10)); } surface.scrollTo(0, surface.scrollHeight); surface.scrollTo(0, 0); } });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name + ' horizontal overflow');
  const selected = page.getByTestId('context-action-toolbar').getByRole('button', { pressed: true }); assert.equal(await selected.count(), 1, name + ' one selected destination');
  const activeColour = await selected.evaluate(node => getComputedStyle(node).backgroundColor), inactiveColour = await page.getByTestId('context-action-toolbar').getByRole('button', { pressed: false }).first().evaluate(node => getComputedStyle(node).backgroundColor); assert.notEqual(activeColour, inactiveColour, name + ' visible selected destination');
  const toolbar = await page.getByTestId('context-action-toolbar').boundingBox(), viewport = page.viewportSize();
  assert(toolbar && toolbar.x === 0 && Math.abs(toolbar.width - viewport.width) <= 1 && Math.abs(toolbar.y + toolbar.height - viewport.height) <= 1, name + ' pinned full-width toolbar');
  await page.screenshot({ path: join(out, name + '.png'), fullPage: true });
 };
 try {
  for (const batch of batches.filter(item => !process.env.SHARE_COMPOSER_SCOPE || (process.env.SHARE_COMPOSER_SCOPE === 'save-keyboard' ? item.destination === 'save' : process.env.SHARE_COMPOSER_SCOPE === 'contexts-keyboard' ? ['message', 'save'].includes(item.destination) : process.env.SHARE_COMPOSER_SCOPE === 'save' ? ['save', 'directories'].includes(item.destination) : item.destination === (process.env.SHARE_COMPOSER_SCOPE === 'message-preview' ? 'message' : process.env.SHARE_COMPOSER_SCOPE === 'post-keyboard' ? 'post' : process.env.SHARE_COMPOSER_SCOPE)))) {
   console.log(`Opening ${batch.destination}`);
   let targetFolderId = null;
   await page.goto(`${fixture.origin}/share?requestId=${batch.id}`);
   await page.getByRole('heading', { name: 'New post', exact: true }).waitFor({ timeout: 90000 });
   await page.getByRole('button', { name: ['save', 'directories'].includes(batch.destination) ? 'Save as Thing / file' : batch.destination === 'message' ? 'Message' : /^(?:Post|Create post.*)$/, exact: true }).click();
   if (!['post-keyboard', 'contexts-keyboard', 'save-keyboard'].includes(process.env.SHARE_COMPOSER_SCOPE)) for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await inspect(`${batch.destination}-${width}`); }
   if (['contexts-keyboard', 'save-keyboard'].includes(process.env.SHARE_COMPOSER_SCOPE)) {
    await page.setViewportSize({ width: 390, height: 844 });
    if (batch.destination === 'message') await page.getByText('incoming-share-recipient', { exact: true }).last().click();
    const field = batch.destination === 'message' ? page.locator('textarea:visible').last() : page.getByPlaceholder(/Search all your things and computers/);
    await field.focus();
    await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 }); visualViewport.dispatchEvent(new Event('resize')); });
    await page.waitForTimeout(500);
    const action = batch.destination === 'message' ? page.getByTitle('Send', { exact: true }) : page.getByRole('button', { name: 'Save here', exact: true });
    const geometry = await action.evaluate(node => { const rect = node.getBoundingClientRect(), toolbar = document.querySelector('[data-testid="context-action-toolbar"]').getBoundingClientRect(), field = document.activeElement.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, toolbarTop: toolbar.top, fieldTop: field.top, fieldBottom: field.bottom, hittable: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }; });
    assert(geometry.top >= 0 && geometry.bottom <= geometry.toolbarTop + 1 && geometry.hittable, batch.destination + ' action reachable above keyboard toolbar: ' + JSON.stringify(geometry));
    assert(geometry.fieldTop >= 0 && geometry.fieldBottom <= geometry.toolbarTop, batch.destination + ' focused input visible: ' + JSON.stringify(geometry));
    await page.screenshot({ path: join(out, batch.destination + '-keyboard-viewport.png') });
    checks.push({ destination: batch.destination + '-keyboard', geometry, visualViewportFixture: true, publicationRepeated: false }); continue;
   }
   if (batch.destination === 'post') {
    await page.getByRole('button', { name: 'Post ✨', exact: true }).waitFor();
    if (process.env.SHARE_COMPOSER_SCOPE === 'post-keyboard') {
     await page.setViewportSize({ width: 390, height: 844 });
     await page.locator('[contenteditable="true"]').first().focus();
     await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 420 }); visualViewport.dispatchEvent(new Event('resize')); });
     await page.waitForTimeout(250);
     const geometry = await page.getByRole('button', { name: 'Post ✨', exact: true }).evaluate(node => {
      const rect = node.getBoundingClientRect(), toolbar = document.querySelector('[data-testid="context-action-toolbar"]').getBoundingClientRect();
      const field = document.activeElement.getBoundingClientRect(), controls = document.querySelector('[data-testid="composer-submit-row"]').getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, toolbarTop: toolbar.top, fieldTop: field.top, fieldBottom: field.bottom, controlsTop: controls.top, innerHeight, viewportHeight: visualViewport.height, viewportOffsetTop: visualViewport.offsetTop, visibleBottom: visualViewport.height + visualViewport.offsetTop, hittable: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) };
     });
     assert(geometry.top >= 0 && geometry.bottom <= geometry.toolbarTop + 1 && geometry.bottom <= geometry.visibleBottom && geometry.hittable, 'Focused Post stays hit-test reachable above keyboard and toolbar: ' + JSON.stringify(geometry));
     assert(geometry.fieldTop >= 0 && geometry.fieldBottom <= geometry.controlsTop, 'Focused editor remains visible above the docked actions: ' + JSON.stringify(geometry));
     await page.screenshot({ path: join(out, 'post-keyboard-viewport.png') });
     checks.push({ destination: 'post-keyboard', geometry, visualViewportFixture: true, publicationRepeated: false });
     await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 365 }); Object.defineProperty(visualViewport, 'offsetTop', { configurable: true, value: 269 }); visualViewport.dispatchEvent(new Event('scroll')); });
     await page.waitForTimeout(500);
     const panned = await page.getByRole('button', { name: 'Post ✨', exact: true }).evaluate(node => { const rect = node.getBoundingClientRect(), toolbar = document.querySelector('[data-testid="context-action-toolbar"]').getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom, toolbarTop: toolbar.top, toolbarBottom: toolbar.bottom, visibleTop: visualViewport.offsetTop, visibleBottom: visualViewport.offsetTop + visualViewport.height, hittable: node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) }; });
     assert(panned.top >= panned.visibleTop && panned.bottom <= panned.toolbarTop && panned.toolbarTop >= panned.visibleTop && Math.abs(panned.toolbarBottom - panned.visibleBottom) <= 1 && panned.hittable, 'Native panned viewport keeps Post and toolbar visible: ' + JSON.stringify(panned));
     await page.screenshot({ path: join(out, 'post-keyboard-panned.png') });
     checks.push({ destination: 'post-keyboard-panned', geometry: panned, visualViewportFixture: true, publicationRepeated: false });
     continue;
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: 'Rows 🥞', exact: true }).waitFor({ timeout: 90000 });
    await page.getByRole('button', { name: 'Rows 🥞', exact: true }).click();
    for (let row = 2; row < 27; row++) await page.getByRole('button', { name: 'Add row', exact: true }).click();
    await page.getByRole('button', { name: 'More images in row 27', exact: true }).waitFor();
    await inspect('post-27-row-layout');
    await page.getByRole('button', { name: 'Grid 🔳', exact: true }).click();
    for (let column = 3; column < 7; column++) await page.getByRole('button', { name: 'More columns', exact: true }).click();
    await page.getByText('7 columns', { exact: true }).waitFor();
    await inspect('post-7-column-layout');
    await page.getByRole('button', { name: 'Rows 🥞', exact: true }).click();
    await page.getByRole('button', { name: 'Customise toolbar', exact: true }).click();
    const customLabel = 'Create post ' + batch.id.slice(0, 4);
    const oldGlyph = await page.locator('[data-block-id="context-icon-post"]').innerText();
    const edits = [['context-label-post', customLabel], ['context-icon-post', oldGlyph === '+' ? '↗' : '+']];
    for (const [id, value] of edits) {
     await page.locator(`[data-block-id="${id}"]`).click();
     const drawer = page.locator('.ttBuilderDrawer').last();
     await drawer.getByLabel('Block text', { exact: true }).fill(value);
     await drawer.getByRole('button', { name: 'Close builder', exact: true }).click();
    }
    const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things' && ['POST', 'PATCH'].includes(response.request().method()));
    await page.getByTestId('context-action-toolbar').getByRole('button', { name: 'Save layout', exact: true }).click();
    const document = await (await saveResponse).json(); assert(document.ok && document.thing?.id);
    const stored = (await api(`/api/v1/things?id=${document.thing.id}`)).thing;
    for (const [, value] of edits) assert(JSON.stringify(stored.crystal.blocks).includes(value));
    assert.deepEqual(stored.acl, ['tt:user']);
    await page.getByRole('button', { name: 'Done editing layout', exact: true }).click();
    await page.reload();
    await page.getByRole('button', { name: customLabel, exact: true }).waitFor({ timeout: 90000 });
    await inspect('toolbar-nested-edits-reloaded');
    checks.push({ editableToolbarDocumentId: stored.id, nestedBlockIds: edits.map(item => item[0]), reloadVerified: true });
    await page.getByRole('button', { name: 'Post ✨', exact: true }).click({ timeout: 90000 });
    await page.waitForFunction(() => window.__incomingShareReceiptFailed, undefined, { timeout: 90000 });
    const beforeRecovery = responses.filter(row => row.path === '/api/v1/attachments/uploads').length;
    await page.reload();
    await page.waitForFunction(() => window.__incomingShareOutcome?.destination === 'post', undefined, { timeout: 90000 });
    assert.equal(responses.filter(row => row.path === '/api/v1/attachments/uploads').length, beforeRecovery, 'Recovery must not reupload original files');
    const saved = await api(`/api/v1/things?id=${batch.id}`);
    assert.equal(saved.post.text, batch.text); assert.equal(saved.post.attachments.length, batch.files.length); assert.equal(saved.post.mediaLayout.pattern.length, 27); checks.push({ destination: 'post', id: saved.post.id, attachmentIds: saved.post.attachments.map(file => file.id), lostReceiptRecoveryVerified: true });
   } else if (batch.destination === 'message') {
    await page.getByText('incoming-share-recipient', { exact: true }).last().click();
    const textarea = page.locator('textarea:visible').last(); await textarea.waitFor({ timeout: 30000 }); await textarea.focus();
    assert.equal(await textarea.inputValue(), batch.text); assert(await textarea.evaluate(node => node.selectionStart === node.value.length && node.selectionEnd === node.value.length));
    await page.waitForFunction(() => document.querySelector('button[title="Send"]')?.disabled === false, undefined, { timeout: 90000 });
    for (const width of [1440, 390]) { await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 }); await inspect(`message-expanded-attachments-${width}`); }
    if (process.env.SHARE_COMPOSER_SCOPE === 'message-preview') { checks.push({ destination: 'message-preview', attachmentCount: batch.files.length, readyExpandedScrollDesktopMobile: true, publicationRepeated: false }); continue; }
    await textarea.fill(batch.text + ' appended');
    await page.setViewportSize({ width: 390, height: 480 }); await textarea.focus();
    await textarea.evaluate(node => node.scrollIntoView({ block: 'nearest' }));
    const sendBounds = await page.getByTitle('Send', { exact: true }).boundingBox(), toolbarBounds = await page.getByTestId('context-action-toolbar').boundingBox();
    assert(sendBounds && toolbarBounds && sendBounds.y >= 0 && sendBounds.y + sendBounds.height <= toolbarBounds.y + 1, 'Send stays above the toolbar in a reduced keyboard viewport');
    await page.screenshot({ path: join(out, 'message-keyboard-viewport.png') });
    await page.getByTitle('Send', { exact: true }).click({ timeout: 90000 });
    await page.waitForFunction(() => window.__incomingShareOutcome?.destination === 'message', { timeout: 90000 });
    const saved = await api(`/api/v1/chats/messages?chatId=${fixture.chatId}`), message = saved.messages.find(item => item.text === batch.text + ' appended');
    assert(message); assert.equal(message.attachments.length, batch.files.length); checks.push({ destination: 'message', id: message.id, textLength: message.text.length });
   } else {
    const locations = [];
    for (const name of ['Acceptance parent ' + batch.id.slice(0, 4), 'Nested destination']) {
     await page.getByRole('button', { name: 'New', exact: true }).click();
     await page.getByRole('menuitem', { name: /New folder/ }).click();
     const dialog = page.getByRole('dialog', { name: /New folder/ });
     await dialog.getByPlaceholder('Folder name', { exact: true }).fill(name);
     const createdResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/things' && response.request().method() === 'POST');
     await dialog.getByRole('button', { name: 'Create', exact: true }).click();
     const created = await (await createdResponse).json(); assert(created.ok && created.thing?.id);
     const read = (await api(`/api/v1/things?id=${created.thing.id}`)).thing;
     assert.equal(read.crystal.name, name); assert.equal(read.folderId, targetFolderId);
     await dialog.waitFor({ state: 'hidden' });
     await page.locator(`[data-thing-id="${created.thing.id}"]`).getByText(name, { exact: true }).click();
     await page.getByText(`Save in ${name}`, { exact: true }).waitFor();
     targetFolderId = created.thing.id; locations.push(targetFolderId);
    }
    await inspect('save-created-nested-destination');
    checks.push({ createdFolderIds: locations, selectedSaveLocationId: targetFolderId });
    await page.getByRole('button', { name: 'Save here', exact: true }).click({ timeout: 90000 });
    await page.waitForFunction(() => window.__incomingShareOutcome?.destination === 'save', { timeout: 90000 });
    const ids = await page.evaluate(() => window.__incomingShareOutcome.outcomeIds);
    const rows = await Promise.all(ids.map(async id => (await api(`/api/v1/things?id=${id}`)).thing));
    assert(rows.some(row => row.thingtime.includes('folder') && row.crystal.name === 'empty'));
    assert.equal(rows.filter(row => row.thingtime.includes('file')).length, batch.files.length);
    for (const row of rows.filter(row => row.thingtime.includes('file'))) {
     const file = (await api(`/api/v1/files?id=${row.id}`)).file;
     const response = await context.request.get(fixture.origin + `/api/v1/attachments/content?id=${file.content.attachmentId}`); assert(response.ok());
     const parts = [file.name]; for (let parent = row.folderId; parent && parent !== targetFolderId;) { const folder = rows.find(item => item.id === parent); assert(folder); parts.unshift(folder.crystal.name); parent = folder.folderId; }
     const original = batch.files.find(item => (item.relativePath || item.name) === parts.join('/'));
     assert(original); assert.deepEqual(await response.body(), Buffer.from(original.bytes, 'base64'));
    }
    checks.push({ destination: 'save', ids });
   }
   await page.screenshot({ path: join(out, `${batch.destination}-success.png`), fullPage: true });
   await writeFile(join(out, 'partial-web-evidence.json'), JSON.stringify({ checks, errors }, null, 2));
  }
  await writeFile(join(out, 'partial-web-evidence.json'), JSON.stringify({ checks, errors }, null, 2));
  const switchBatch = batches[0];
  const beforeSwitch = responses.filter(row => row.path === '/api/v1/attachments/uploads').length;
  const switchResponse = await context.request.post(fixture.origin + '/api/v1/auth/register', { data: { username: 'incoming-share-switched-' + randomUUID().slice(0, 7), email: randomUUID() + '@example.invalid', displayName: 'Other isolated account', password: randomBytes(24).toString('hex') } });
  assert(switchResponse.ok());
  await page.goto(`${fixture.origin}/share?requestId=${switchBatch.id}`);
  await page.getByText('Fixture scope mismatch', { exact: true }).waitFor({ timeout: 90000 });
  assert(!(await page.locator('body').innerText()).includes(switchBatch.text));
  assert.equal(responses.filter(row => row.path === '/api/v1/attachments/uploads').length, beforeSwitch);
  checks.push({ accountSwitchClearsContentAndRefusesNativeAccess: true });
  assert.deepEqual(errors, []); await writeFile(join(out, 'web-evidence.json'), JSON.stringify({ fixture: 'native bridge only; real disposable product APIs', apiOrigin: fixture.apiOrigin, webOrigin: fixture.origin, checks, errors }, null, 2));
 } catch (error) { await writeFile(join(out, 'failure-geometry.json'), JSON.stringify(await page.evaluate(() => { const rows = []; for (let node = document.activeElement; node; node = node.parentElement) { const css = getComputedStyle(node); rows.push({ tag: node.tagName, id: node.id, overflow: css.overflowY, height: node.clientHeight, scrollHeight: node.scrollHeight, scrollTop: node.scrollTop }); } return { scrollY, innerHeight, clientHeight: document.documentElement.clientHeight, visualViewport: visualViewport && { height: visualViewport.height, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale }, ancestors: rows }; }), null, 2)); await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }); await writeFile(join(out, 'failure-state.txt'), await page.locator('body').innerText()); await writeFile(join(out, 'http-responses.json'), JSON.stringify(responses, null, 2)); await writeFile(join(out, 'partial-web-evidence.json'), JSON.stringify({ checks, errors }, null, 2)); throw error; }
 finally { await context.close(); await browser.close(); }
}
