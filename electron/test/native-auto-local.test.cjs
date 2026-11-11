'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { configuration, assertRuntime, assertScope, negotiate, REQUIRED, readIdleBlockers, installActivityObserver, holdMutation, browserRequest, createLocalAccountFixture } = require('./fixtures/native-auto-local.cjs');

async function server(t, handler) {
 const app = http.createServer(handler); await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
 t.after(() => { app.closeAllConnections(); return new Promise(resolve => app.close(resolve)); });
 return `http://127.0.0.1:${app.address().port}`;
}
test('local CLI refuses before any preparation or app launch without fresh-build acknowledgement', async t => {
 const home = await fs.mkdtemp(path.join(os.tmpdir(), 'native-local-guard-'));
 t.after(() => fs.rm(home, { recursive: true, force: true }));
 const result = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/verify-web-bundle-auto-activation.mjs'),
  '--local-api', '--workspace=native-bundle-qa-auto-guard', `--output=${path.join(home, 'evidence')}`],
 { env: { HOME: home, PATH: process.env.PATH, THINGTIME_NATIVE_BUNDLE_QA: '1' }, encoding: 'utf8', timeout: 10000 });
 assert.equal(result.status, 1); assert.match(result.stderr, /THINGTIME_NATIVE_LOCAL_BUILD_READY=1/);
 assert.deepEqual(await fs.readdir(home), [], 'Guard must precede writable profiles, temporary logs and launch');
});
test('QA configuration isolates managed account origin and bundled binary from release endpoint', () => {
 const root = path.resolve('/tmp/native-bundle-qa-auto-local-test');
 const value = { name: path.basename(root), root, source: path.join(root, 'source/electron'), profile: path.join(root, 'profile'), apiPort: 34561, databasePort: 34562, mode: 'managed-local', origin: 'http://127.0.0.1:34564' };
 assert.equal(configuration(value).enabled, true); assert.equal(configuration({ ...value, mode: 'remote' }).enabled, false);
 assert.equal(configuration(value).bundledMongodPath, path.join(value.source, 'dist/database/mongodb/bin/mongod'));
 assert.equal(Object.isFrozen(configuration(value)), true);
 for (const change of [{ name: 'stable' }, { profile: '/tmp/personal' }, { source: '/tmp/personal' }, { mode: 'unknown' },
  { origin: 'https://thingtime.com' }, { origin: `http://127.0.0.1:${value.apiPort}` }, { databasePort: value.apiPort }]) assert.throws(() => configuration({ ...value, ...change }));
});
test('local proof refuses wrong selected account origin, weak encryption and unmanaged runtime', () => {
 const expected = { local: true, origin: 'http://127.0.0.1:32101', releaseOrigin: 'http://127.0.0.1:32102' };
 const info = { origin: expected.origin, apiOrigin: expected.origin, localRuntime: { active: true, enabled: true, databaseMode: 'managed', bundledMongoSelected: true, encryptionAvailable: true, error: null, restartRequired: false } };
 assertRuntime(info, expected);
 for (const change of [{ encryptionAvailable: false }, { bundledMongoSelected: false }, { error: 'unavailable' }, { restartRequired: true }, { active: false }, { databaseMode: 'external' }])
  assert.throws(() => assertRuntime({ ...info, localRuntime: { ...info.localRuntime, ...change } }, expected));
 assert.throws(() => assertRuntime({ ...info, apiOrigin: expected.releaseOrigin }, expected));
 assert.throws(() => assertRuntime({ ...info, origin: expected.releaseOrigin }, expected));
});
test('negotiate all real auth/private CRUD contracts and derive scope only from canonical root identity', () => {
 const origin = 'http://127.0.0.1:32101';
 const manifest = { origin, features: Object.fromEntries(Object.entries(REQUIRED).map(([key, value]) => [key, { version: value.slice(1) }])) };
 negotiate(manifest, origin);
 for (const key of Object.keys(REQUIRED)) assert.throws(() => negotiate({ ...manifest, features: { ...manifest.features, [key]: { version: '0.0.0' } } }, origin));
 assert.throws(() => negotiate({ ...manifest, origin: 'https://thingtime.com' }, origin));
 const scope = assertScope({ user: { id: 'owner' }, dataPlane: 'custom-task' }, origin, 'owner');
 assert.deepEqual(scope, { kind: 'account', ownerId: 'owner', dataPlane: 'custom-task', origin }); assert.equal(Object.isFrozen(scope), true);
 assert.throws(() => assertScope({ user: { id: 'other' }, dataPlane: 'home' }, origin, 'owner'));
 assert.throws(() => assertScope({ user: { id: 'owner' } }, origin, 'owner'));
});
test('idle scan distinguishes busy/dialog/editable selectors without disclosing text, values, labels or IDs', () => {
 const element = (tagName, attrs = {}, extra = {}) => ({ tagName, getAttribute: key => attrs[key] ?? null,
  textContent: 'private text', id: 'private-id', value: 'private input', ...extra });
 const busy = element('SECTION', { 'aria-busy': 'true' }), dialog = element('SECTION', { role: 'dialog' }),
  editor = element('DIV', { contenteditable: 'true' }), input = element('INPUT', {}, { type: 'text' }), hidden = element('INPUT', {}, { type: 'hidden' }),
  media = element('VIDEO', {}, { paused: false, ended: false });
 const doc = { querySelectorAll(selector) { return selector === 'input, textarea' ? [input, hidden] : selector === 'audio, video' ? [media] : [busy, dialog, editor]; } };
 const result = readIdleBlockers(doc);
 assert.deepEqual(result, [
  { tag: 'SECTION', role: null, ariaBusy: 'true', contenteditable: null },
  { tag: 'SECTION', role: 'dialog', ariaBusy: null, contenteditable: null },
  { tag: 'DIV', role: null, ariaBusy: null, contenteditable: 'true' },
  { tag: 'INPUT', role: null, ariaBusy: null, contenteditable: null },
  { tag: 'VIDEO', role: null, ariaBusy: null, contenteditable: null }
 ]);
 assert.doesNotMatch(JSON.stringify(result), /private/);
 assert.deepEqual(readIdleBlockers({ querySelectorAll: () => [] }), []);
});
test('bounded passive activity observation records only event/mutation kinds and never writes to the DOM', () => {
 const handlers = new Map(); let mutated, observed;
 class Element { constructor(tagName) { this.tagName = tagName; this.value = 'private-value'; this.textContent = 'private-text'; } }
 const window = { addEventListener: (kind, fn, options) => { assert.deepEqual(JSON.parse(JSON.stringify(options)), { capture: true, passive: true }); handlers.set(kind, fn); } };
 const document = { documentElement: Object.freeze({}) };
 class MutationObserver { constructor(fn) { mutated = fn; } observe(target, options) { assert.equal(target, document.documentElement); observed = options; } }
 vm.runInNewContext(`(${installActivityObserver})()`, { window, document, MutationObserver, Element, Date });
 assert.equal(observed.attributes, true); assert.equal(handlers.size, 7);
 handlers.get('input')({ type: 'input', isTrusted: true, target: new Element('INPUT'), data: 'private-key' });
 mutated([{ type: 'attributes', attributeName: 'data-private-owner', target: new Element('SECTION') },
  { type: 'characterData', target: new Element('SPAN') }]);
 const rows = JSON.parse(JSON.stringify(window.__nativeAutoActivity));
 assert.deepEqual(rows.map(({ at, ...row }) => row), [{ kind: 'input', trusted: true, tag: 'INPUT' },
  { kind: 'mutation', type: 'attributes', attribute: 'other', tag: 'SECTION' }, { kind: 'mutation', type: 'characterData', attribute: null, tag: 'SPAN' }]);
 assert.doesNotMatch(JSON.stringify(rows), /private/);
 for (let i = 0; i < 700; i++) handlers.get('focus')({ type: 'focus', isTrusted: false, target: new Element('BUTTON') });
 assert.equal(window.__nativeAutoActivity.length, 512); assert.equal(Object.isFrozen(document.documentElement), true);
});
test('active work uses a real incomplete HTTP mutation then exactly one complete commit', async t => {
 let admittedResolve, ended = 0;
 const admitted = new Promise(resolve => { admittedResolve = resolve; });
 const origin = await server(t, async (req, res) => {
  assert.equal(req.method, 'POST'); assert.equal(req.url, '/api/v1/things'); assert.equal(req.headers.origin, origin); assert.equal(req.headers.cookie, 'task=opaque');
  const chunks = []; req.on('data', chunk => { chunks.push(chunk); admittedResolve(); });
  req.on('end', () => { ended++; const body = JSON.parse(Buffer.concat(chunks).toString()); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok: true, thing: body })); });
 });
 const body = { thingtime: ['data'], visibility: 'private', crystal: { text: 'owned test work' } };
 const held = holdMutation(origin, 'task=opaque', body); t.after(() => held.abort());
 await admitted; held.assertPending(); assert.equal(ended, 0, 'No mutation is committed by the incomplete body');
 assert.deepEqual((await held.complete()).body.thing, body); assert.equal(ended, 1);
 assert.throws(() => held.complete()); assert.throws(() => held.assertPending());
});
test('early server refusal and cancellation cannot become a false active-work proof', async t => {
 const origin = await server(t, (_req, res) => { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"ok":false}'); });
 const held = holdMutation(origin, 'task=opaque', { crystal: {} });
 assert.equal((await held.result).status, 503); assert.throws(() => held.assertPending()); held.abort();
 const waitingOrigin = await server(t, req => req.resume());
 const cancelled = holdMutation(waitingOrigin, 'task=opaque', { crystal: {} }); cancelled.abort();
 await assert.rejects(cancelled.result, /Task work request failed/); assert.throws(() => cancelled.assertPending());
});
test('browser exchange is same-origin and auth responses never expose session payloads', async () => {
 const origin = 'http://127.0.0.1:32101'; let called = false;
 const page = { url: () => 'https://thingtime.com/', evaluate() { called = true; } };
 await assert.rejects(browserRequest(page, origin, '/api/v1/login', 'POST', {})); assert.equal(called, false);
 const current = { url: () => origin + '/', evaluate: async (fn, args) => JSON.parse(JSON.stringify(await vm.runInNewContext(`(${fn})`, {
  location: { origin }, AbortSignal, fetch: async (_route, init) => { assert.equal(init.credentials, 'same-origin'); assert.equal(init.redirect, 'error');
   return Response.json({ ok: true, user: { id: 'owner' }, token: 'never-return', cookie: 'never-return' }); }
 })(args))) };
 const response = await browserRequest(current, origin, '/api/v1/login', 'POST', {});
 assert.deepEqual(response, { status: 200, ok: true, requiresOtp: false, userId: 'owner' });
});

// Synthetic HTTP/account host, not native/Mongo acceptance. This exercises the
// complete fixture controls with real sockets and an isolated browser cookie jar.
test('account fixture keeps login, private edits, ACLs, revision and cold-session verification independent', async t => {
 const accounts = new Map(), things = new Map(); let loginCalls = 0, revision = 0, loseSession = false;
 const origin = await server(t, async (req, res) => {
  const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const url = new URL(req.url, origin);
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  let account = [...accounts.values()].find(value => req.headers.cookie === `session=${value.id}`);
  if (url.pathname === '/.well-known/thingtime-capabilities.json') return send(200, { origin, features: Object.fromEntries(Object.entries(REQUIRED).map(([key, value]) => [key, { version: value.slice(1) }])) });
  if (url.pathname === '/api/v1/auth/register') {
   const account = { ...body, id: 'user-' + accounts.size }; accounts.set(body.username, account); res.setHeader('Set-Cookie', `session=${account.id}; HttpOnly; Path=/`);
   return send(200, { ok: true, user: { id: account.id } });
  }
  if (url.pathname === '/api/v1/login') {
   loginCalls++; account = accounts.get(body.username); assert.equal(body.password, account.password);
   res.setHeader('Set-Cookie', `session=${account.id}; HttpOnly; Path=/`); return send(200, { ok: true, user: { id: account.id } });
  }
  if (loseSession && req.headers['x-synthetic-browser']) account = null;
  if (url.pathname === '/api/v1/auth/me') return send(200, { user: account ? { id: account.id } : null });
  if (url.pathname === '/api/root-data') return send(200, { user: account ? { id: account.id } : null, dataPlane: 'home' });
  if (!account) return send(401, { ok: false });
  if (req.method === 'POST') {
   const thing = { ...body, id: 'thing-' + things.size, updatedAt: 'revision-' + revision++, owner: account.id }; things.set(thing.id, thing); return send(200, { ok: true, thing });
  }
  const thing = things.get(body.id || url.searchParams.get('id'));
  if (!thing || thing.owner !== account.id) return send(404, { ok: false });
  if (req.method === 'PATCH') {
   if (body.expectedUpdatedAt !== thing.updatedAt) return send(409, { ok: false });
   Object.assign(thing, { crystal: body.crystal, updatedAt: 'revision-' + revision++ });
  }
  return send(200, { ok: true, thing });
 });
 let browserCookie = '';
 const page = { url: () => origin + '/', goto: async () => {}, evaluate: async (fn, args) => JSON.parse(JSON.stringify(await vm.runInNewContext(`(${fn})`, {
  location: { origin }, AbortSignal, fetch: async (route, init) => {
   const response = await fetch(origin + route, { ...init, headers: { ...init.headers, 'X-Synthetic-Browser': '1', ...(browserCookie ? { Cookie: browserCookie } : {}) } });
   const set = response.headers.getSetCookie(); if (set.length) browserCookie = set.map(value => value.split(';')[0]).join('; ');
   return response;
  }
 })(args))) };
 const fixture = await createLocalAccountFixture(origin); t.after(() => fixture.dispose());
 assert.equal(JSON.stringify(fixture), '{}', 'Opaque fixture object never serializes credentials');
 assert.equal((await fixture.loginBrowser(page)).kind, 'account'); assert.equal(loginCalls, 1);
 const work = fixture.startWork(); work.assertPending(); await fixture.finishWork();
 const proof = await fixture.verifyAfterRestart(page); assert.equal(proof.durableEditRetained, true); assert.equal(proof.staleRevisionRefused, true);
 assert.equal(loginCalls, 1, 'Restart readback cannot silently sign in again');
 loseSession = true; await assert.rejects(fixture.verifyAfterRestart(page), /Chromium session was not recovered/);
 assert.equal(loginCalls, 1);
});
