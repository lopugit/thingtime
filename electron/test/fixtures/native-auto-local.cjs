'use strict';

// Disposable acceptance controls only. Never import this module in the app.
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const { supportsVersion } = require('../../lib/endpoint-compatibility.cjs');

const REQUIRED = Object.freeze({ 'api.auth-register': '^1.3.2', 'api.login': '^1.3.1',
 'api.auth-me': '^1.2.0', 'api.root-data': '^1.1.0', 'api.things': '^1.64.0' });
function loopbackOrigin(value) {
 const url = new URL(value);
 assert.equal(url.origin, value, 'Require an exact task origin');
 assert.equal(url.protocol, 'http:'); assert.equal(url.hostname, '127.0.0.1');
 assert.ok(url.port && !url.username && !url.password, 'Require a task loopback port');
 return value;
}
function configuration(config) {
 assert.match(config.name, /^native-bundle-qa-auto-[a-z0-9-]+$/);
 assert.ok(path.isAbsolute(config.root)); assert.equal(path.basename(config.root), config.name);
 assert.equal(config.profile, path.join(config.root, 'profile'));
 assert.equal(config.source, path.join(config.root, 'source/electron'));
 for (const port of [config.apiPort, config.databasePort]) assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
 assert.notEqual(config.apiPort, config.databasePort);
 assert.ok(config.mode === 'remote' || config.mode === 'managed-local');
 const origin = loopbackOrigin(config.origin), local = config.mode === 'managed-local';
 assert.notEqual(new URL(origin).port, String(config.apiPort), 'Release endpoint must be independent of account API');
 return Object.freeze({ enabled: local, databaseMode: 'managed', apiPort: config.apiPort, databasePort: config.databasePort,
  bundledMongodPath: path.join(config.source, 'dist/database/mongodb/bin/mongod') });
}
function assertRuntime(info, { local, origin, releaseOrigin }) {
 assert.equal(info.origin, origin); assert.equal(new URL(info.apiOrigin).origin, local ? origin : releaseOrigin);
 assert.equal(info.localRuntime?.enabled, local); assert.equal(info.localRuntime?.active, local);
 if (local) {
  assert.equal(info.localRuntime.databaseMode, 'managed'); assert.equal(info.localRuntime.bundledMongoSelected, true);
  assert.equal(info.localRuntime.encryptionAvailable, true, 'Require real Electron safeStorage');
  assert.equal(info.localRuntime.error, null); assert.equal(info.localRuntime.restartRequired, false);
 }
}
function assertScope(root, origin, ownerId) {
 assert.equal(root.user?.id, ownerId, 'Canonical root identity changed');
 assert.ok(typeof root.dataPlane === 'string' && root.dataPlane.length > 0, 'Canonical data plane unavailable');
 return Object.freeze({ kind: 'account', origin, ownerId, dataPlane: root.dataPlane });
}
function negotiate(manifest, origin) {
 assert.equal(manifest.origin, origin, 'Account API manifest origin mismatch');
 for (const [id, range] of Object.entries(REQUIRED)) assert.ok(supportsVersion(manifest.features?.[id]?.version, range), `Missing compatible ${id}`);
}

// Mirror the existing safety scan for observation only. Return selector-specific
// metadata, never a control's value, text, label, ID or account information.
function readIdleBlockers(doc = document) {
 const elements = new Set(doc.querySelectorAll('[contenteditable="true"], .monaco-editor, .codex-editor, [role="dialog"], [aria-busy="true"]'));
 for (const element of doc.querySelectorAll('input, textarea'))
  if (!['button', 'submit', 'reset', 'hidden', 'checkbox', 'radio'].includes(element.type) && Boolean(element.value)) elements.add(element);
 for (const element of doc.querySelectorAll('audio, video')) if (!element.paused && !element.ended) elements.add(element);
 return [...elements].map(element => ({ tag: element.tagName, role: element.getAttribute('role'),
  ariaBusy: element.getAttribute('aria-busy'), contenteditable: element.getAttribute('contenteditable') }));
}
function installActivityObserver() {
 const records = [], attributes = new Set(['class', 'style', 'role', 'aria-busy', 'aria-hidden', 'hidden', 'contenteditable', 'value']);
 const record = value => { records.push({ at: Date.now(), ...value }); if (records.length > 512) records.shift(); };
 const tag = target => target instanceof Element ? target.tagName : 'OTHER';
 for (const kind of ['pointerdown', 'keydown', 'beforeinput', 'input', 'change', 'focus', 'pagehide'])
  window.addEventListener(kind, event => record({ kind: event.type, trusted: event.isTrusted === true, tag: tag(event.target) }), { capture: true, passive: true });
 new MutationObserver(changes => { for (const change of changes) record({ kind: 'mutation', type: change.type,
  attribute: change.type === 'attributes' ? attributes.has(change.attributeName) ? change.attributeName : 'other' : null, tag: tag(change.target) });
 }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true });
 window.__nativeAutoActivity = records;
}

// No cookie/token/profile reads. Chromium performs the ordinary login exchange
// and owns its Set-Cookie persistence. The returned projection excludes secrets.
async function browserRequest(page, origin, route, method = 'GET', body) {
 assert.equal(new URL(page.url()).origin, origin, 'Browser left the task account origin');
 return page.evaluate(async ({ origin, route, method, body }) => {
  if (location.origin !== origin) throw Error('Task browser origin changed');
  const response = await fetch(route, { method, credentials: 'same-origin', redirect: 'error',
   headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  // Only these routes are called by the fixture; never return auth payloads.
  if (route === '/api/v1/login') return { status: response.status, ok: value.ok, requiresOtp: value.requiresOtp === true, userId: value.user?.id };
  if (route === '/api/v1/auth/me') return { status: response.status, user: { id: value.user?.id } };
  if (route === '/api/root-data') return { status: response.status, user: { id: value.user?.id }, dataPlane: value.dataPlane };
  return { status: response.status, body: value };
 }, { origin, route, method, body });
}

// A complete canonical mutation held at its real HTTP body boundary. No fake
// busy flag or custom endpoint: middleware and response admission remain live.
function holdMutation(origin, cookie, body, { timeoutMs = 90000 } = {}) {
 loopbackOrigin(origin);
 const bytes = Buffer.from(JSON.stringify(body));
 let finished = false, completed = false, request;
 const result = new Promise((resolve, reject) => {
  request = http.request(origin + '/api/v1/things', { method: 'POST', headers: {
   Origin: origin, Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': bytes.length }, agent: false }, response => {
   const chunks = []; response.on('data', chunk => chunks.push(chunk));
   response.on('error', () => reject(Error('Task work response failed')));
   response.on('end', () => { finished = true; try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString()) }); }
    catch { reject(Error('Task work response was not JSON')); } });
  });
  request.on('error', () => { finished = true; reject(Error('Task work request failed')); });
  request.setTimeout(timeoutMs, () => request.destroy(Error('Task work deadline')));
  request.write(bytes.subarray(0, 1));
 });
 // Attach immediately: a server refusal can precede the bounded observation.
 void result.catch(() => {});
 return Object.freeze({ assertPending() { assert.equal(finished, false, 'Canonical work ended before refusal observation'); },
  complete() { assert.equal(completed, false); completed = true; request.end(bytes.subarray(1)); return result; },
  abort() { request.destroy(); }, result });
}

async function createLocalAccountFixture(origin) {
 loopbackOrigin(origin);
 const credentials = { username: `native-auto-${randomBytes(7).toString('hex')}`, password: randomBytes(32).toString('base64url') };
 let cookie = '', otherCookie = '', ownerId, otherId, thing, scope, held;
 const content = { name: 'Disposable native local restart', text: 'Private API content before edit', nested: { count: 1 } };
 const edited = { ...content, text: 'Durable private edit before automatic replacement', nested: { count: 2 } };
 async function request(route, method = 'GET', body, auth = cookie) {
  const response = await fetch(origin + route, { method, redirect: 'error', signal: AbortSignal.timeout(15000), headers: {
   Origin: origin, 'Content-Type': 'application/json', ...(auth ? { Cookie: auth } : {}) },
   ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  return { status: response.status, body: value, cookie: response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
 }
 negotiate((await request('/.well-known/thingtime-capabilities.json')).body, origin);
 const registered = await request('/api/v1/auth/register', 'POST', { ...credentials, email: 'native-auto@example.invalid' });
 assert.equal(registered.status, 200, 'Disposable canonical registration failed'); assert.equal(registered.body.ok, true);
 ownerId = registered.body.user?.id; cookie = registered.cookie; assert.ok(ownerId && cookie, 'Registration session unavailable');
 const other = await request('/api/v1/auth/register', 'POST', { username: credentials.username + '-other', password: randomBytes(32).toString('base64url'), email: 'native-auto-other@example.invalid' }, '');
 assert.equal(other.status, 200); assert.equal(other.body.ok, true); otherCookie = other.cookie; otherId = other.body.user?.id;
 assert.ok(otherCookie && otherId); assert.notEqual(otherId, ownerId);
 const created = await request('/api/v1/things', 'POST', { thingtime: ['data'], crystal: content, visibility: 'private' });
 assert.equal(created.status, 200); assert.equal(created.body.ok, true); thing = created.body.thing;
 assert.ok(thing?.id && thing.updatedAt); assert.equal(thing.visibility, 'private');
 const initialRevision = thing.updatedAt, readPath = '/api/v1/things?id=' + encodeURIComponent(thing.id);
 const changed = await request('/api/v1/things', 'PATCH', { id: thing.id, crystal: edited, expectedUpdatedAt: initialRevision });
 assert.equal(changed.status, 200); assert.equal(changed.body.ok, true);
 thing = (await request(readPath)).body.thing;
 assert.equal(thing?.visibility, 'private'); assert.deepEqual(thing.crystal, edited); assert.notEqual(thing.updatedAt, initialRevision);
 const revision = thing.updatedAt;
 async function assertPrivate() {
  assert.equal((await request('/api/v1/auth/me', 'GET', undefined, otherCookie)).body.user?.id, otherId);
  for (const auth of ['', otherCookie]) {
   const refused = await request(readPath, 'GET', undefined, auth);
   assert.ok([401, 403, 404].includes(refused.status)); assert.equal(refused.body.thing, undefined);
  }
  const refused = await request('/api/v1/things', 'PATCH', { id: thing.id, crystal: { text: 'refused' }, expectedUpdatedAt: revision }, otherCookie);
  assert.ok([403, 404].includes(refused.status));
 }
 await assertPrivate();
 return Object.freeze({
  async loginBrowser(page) {
   const login = await browserRequest(page, origin, '/api/v1/login', 'POST', credentials);
   assert.equal(login.status, 200, 'Ordinary browser login failed'); assert.equal(login.ok, true); assert.equal(login.requiresOtp, false); assert.equal(login.userId, ownerId);
   credentials.password = ''; // No credential needed after the ordinary exchange.
   await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
   scope = assertScope(await browserRequest(page, origin, '/api/root-data'), origin, ownerId);
   return scope;
  },
  async verifyAfterRestart(page) {
   assert.equal((await browserRequest(page, origin, '/api/v1/auth/me')).user.id, ownerId, 'Chromium session was not recovered');
   assert.deepEqual(assertScope(await browserRequest(page, origin, '/api/root-data'), origin, ownerId), scope);
   const retained = await browserRequest(page, origin, readPath);
   assert.equal(retained.status, 200); assert.equal(retained.body.thing?.id, thing.id); assert.equal(retained.body.thing?.visibility, 'private');
   assert.equal(retained.body.thing?.updatedAt, revision); assert.deepEqual(retained.body.thing?.crystal, edited);
   assert.equal((await request('/api/v1/auth/me')).body.user?.id, ownerId, 'Independent API session was not recovered');
   await assertPrivate();
   const stale = await request('/api/v1/things', 'PATCH', { id: thing.id, crystal: content, expectedUpdatedAt: initialRevision });
   assert.equal(stale.status, 409, 'Revision history must survive automatic restart');
   assert.deepEqual((await request(readPath)).body.thing?.crystal, edited);
   return { sameAccount: true, browserSessionRetained: true, independentSessionRetained: true, samePrivateThing: true,
    sameRevision: true, durableEditRetained: true, staleRevisionRefused: true, anonymousAndOtherAccountRefused: true };
  },
  startWork() { assert.equal(held, undefined); held = holdMutation(origin, cookie, { thingtime: ['data'], visibility: 'private', crystal: { name: 'Disposable admitted native work' } }); return held; },
  async finishWork() { const done = await held.complete(); assert.equal(done.status, 200); assert.equal(done.body.ok, true); assert.ok(done.body.thing?.id);
   const read = await request('/api/v1/things?id=' + encodeURIComponent(done.body.thing.id)); assert.deepEqual(read.body.thing?.crystal, done.body.thing.crystal); },
  dispose() { held?.abort(); cookie = ''; otherCookie = ''; credentials.password = ''; }
 });
}
module.exports = { configuration, assertRuntime, assertScope, negotiate, REQUIRED, readIdleBlockers, installActivityObserver, holdMutation, browserRequest, createLocalAccountFixture };
