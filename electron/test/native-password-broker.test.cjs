'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { NativePasswordBroker, GRANT_MS } = require('../lib/native-passwords/broker.cjs');
const { PasswordBridgeError } = require('../lib/native-passwords/contract.cjs');

function fixture(t, extra = {}) {
  let time = 1000, state = { version: 1, connection: null, pending: {} };
  const session = {}, context = { endpoint: 'https://vault.example', origin: 'http://127.0.0.1:28630', session };
  const records = new Map(), writes = [], delivered = [];
  const store = { available: () => true, requireAvailable() {}, read: async () => structuredClone(state), write: async value => { state = structuredClone(value); } };
  const vault = async (scope, body, check = () => {}) => {
    check(); if (scope.ownerId !== 'owner') throw new PasswordBridgeError('SESSION_CHANGED', 'The account changed.');
    if (body.operation === 'catalog') return { catalog: [...records].map(([id, entry]) => ({ id, title: entry.title, username: '', fillEligible: true, domains: ['site.example'], origins: entry.fields.filter(field => field.type === 'url').map(field => new URL(field.value).origin) })), nextCursor: null };
    if (body.operation === 'save') { writes.push(structuredClone(body)); records.set(body.id, structuredClone(body.entry)); return { record: { id: body.id } }; }
    if (!records.has(body.id)) throw new PasswordBridgeError('NOT_FOUND', 'Not found.');
    if (body.operation === 'fill') {
      const entry = records.get(body.id), context = body.passkeySession?.context;
      if (!context || context.entryId !== body.id || entry.passwordType === 'passkey' || !entry.fields.some(field => field.type === 'url' && field.value === context.origin)) throw new PasswordBridgeError('WRONG_CREDENTIAL', 'Wrong exact website.');
      return { username: entry.fields.find(field => field.id === 'username').value, password: entry.fields.find(field => field.id === 'password').value };
    }
    return { id: body.id, entry: structuredClone(records.get(body.id)) };
  };
  const browser = { open: async () => {}, bind: async () => ({ deliver: async value => delivered.push(value), close: async () => {} }), close: async () => {} };
  const broker = new NativePasswordBroker({ userData: '/synthetic-profile', platform: 'linux', store, vault, context: () => context, approve: async () => true,
    verify: async ({ target, entryId, assertCurrent }) => { assertCurrent(); return { requestId: randomUUID(), binding: randomBytes(32).toString('base64url'), ...(target.kind === 'website' ? { context: { purpose: 'fill', rp: new URL(target.origin).hostname, entryId, origin: target.origin } } : {}) }; },
    browserFactory: () => browser, now: () => time, ...extra });
  t.after(() => broker.close());
  const authorize = async (target = { kind: 'website', origin: 'https://site.example' }) => {
    await broker.connection('connect', 'owner');
    return (await broker.request({ method: 'authorize', origin: context.endpoint, ownerId: 'owner', taskId: 'synthetic-task', target })).grant;
  };
  return { broker, records, writes, delivered, browser, context, store, vault, authorize, state: () => state, expire: () => { time += GRANT_MS; } };
}
test('generation commits once with immutable retry/readback and returns no credential', async t => {
  const f = fixture(t), grant = await f.authorize(), requestId = randomUUID();
  const request = { method: 'generate', grant, requestId, title: '  Synthetic login  ', username: 'test-user' };
  const result = await f.broker.request(request);
  assert.equal(result.saved, true); assert.equal(result.entryId, requestId);
  const value = f.records.get(requestId).fields.find(field => field.id === 'password').value;
  assert.equal(value.length, 32); assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(f.records.get(requestId).title, 'Synthetic login'); assert.deepEqual(f.state().pending, {});
  assert.equal((await f.broker.request(request)).reused, true); assert.equal(f.writes.length, 1);
  await assert.rejects(f.broker.request({ ...request, username: 'changed' }), { code: 'RETRY_CHANGED' });
});
test('ambiguous saves retain only an encrypted-store journal and retry exact generated value', async t => {
  const f = fixture(t), original = f.broker.vault; let rejectOnce = true;
  f.broker.vault = async (...args) => { const result = await original(...args); if (args[1].operation === 'save' && rejectOnce) { rejectOnce = false; throw new PasswordBridgeError('VAULT_UNAVAILABLE', 'Retry same ID.'); } return result; };
  const grant = await f.authorize(), request = { method: 'generate', grant, requestId: randomUUID(), title: 'Retry', username: 'fixture' };
  await assert.rejects(f.broker.request(request), { code: 'VAULT_UNAVAILABLE' });
  const journal = f.state().pending[request.requestId]; assert.ok(journal);
  await f.broker.request(request);
  assert.deepEqual(f.writes[0], f.writes[1]); assert.deepEqual(f.state().pending, {});
});
test('direct browser delivery checks exact origin/type and returns status without submitting', async t => {
  const f = fixture(t), grant = await f.authorize(), requestId = randomUUID();
  await f.broker.request({ method: 'generate', grant, requestId, title: 'Fill', username: 'fixture' });
  await f.broker.request({ method: 'open-browser', grant });
  const result = await f.broker.request({ method: 'fill', grant, entryId: requestId, selectors: { password: '#password' } });
  assert.deepEqual(result, { delivered: true, submitted: false, entryId: requestId }); assert.equal(f.delivered.length, 1);
  f.records.get(requestId).fields.find(field => field.id === 'website').value = 'https://site.example:444';
  await assert.rejects(f.broker.request({ method: 'fill', grant, entryId: requestId, selectors: { password: '#password' } }), { code: 'WRONG_CREDENTIAL' });
  assert.equal(f.delivered.length, 1);
  assert.deepEqual((await f.broker.request({ method: 'catalog', grant })).entries, [], 'Hostname-only hints never disclose a different port’s account');
  f.records.get(requestId).fields.find(field => field.id === 'website').value = 'https://site.example'; f.records.get(requestId).passwordType = 'passkey';
  await assert.rejects(f.broker.request({ method: 'fill', grant, entryId: requestId, selectors: { password: '#password' } }), { code: 'WRONG_CREDENTIAL' });
});
test('owner/origin, consent refusal, expiry and invalidation fail closed', async t => {
  const f = fixture(t), grant = await f.authorize();
  await assert.rejects(f.broker.request({ method: 'authorize', origin: 'https://other.example', ownerId: 'owner', taskId: 'task', target: { kind: 'website', origin: 'https://site.example' } }), { code: 'NOT_CONNECTED' });
  f.broker.approve = async () => false;
  await assert.rejects(f.broker.request({ method: 'authorize', origin: f.context.endpoint, ownerId: 'owner', taskId: 'task', target: { kind: 'website', origin: 'https://site.example' } }), { code: 'CONSENT_REFUSED' });
  f.expire(); await assert.rejects(f.broker.request({ method: 'catalog', grant }), { code: 'GRANT_EXPIRED' });
  f.broker.approve = async () => true; const next = await f.authorize(); await f.broker.invalidate();
  await assert.rejects(f.broker.request({ method: 'catalog', grant: next }), { code: 'GRANT_EXPIRED' });
});
test('account revocation during credential read cannot deliver a password', async t => {
  const f = fixture(t), grant = await f.authorize(), id = randomUUID();
  await f.broker.request({ method: 'generate', grant, requestId: id, title: 'Race', username: 'fixture' });
  await f.broker.request({ method: 'open-browser', grant });
  const original = f.broker.vault;
  f.broker.vault = async (...args) => { const result = await original(...args); if (args[1].operation === 'fill') await f.broker.invalidate(); return result; };
  await assert.rejects(f.broker.request({ method: 'fill', grant, entryId: id, selectors: { password: '#password' } }), { code: 'GRANT_EXPIRED' });
  assert.deepEqual(f.delivered, []);
});
test('task consent cannot substitute for per-request credential verification', async t => {
  const f = fixture(t, { verify: async () => { throw new PasswordBridgeError('APPROVAL_CANCELLED', 'Verification cancelled.'); } }), grant = await f.authorize(), id = randomUUID();
  await f.broker.request({ method: 'generate', grant, requestId: id, title: 'Approval', username: 'fixture' });
  await f.broker.request({ method: 'open-browser', grant });
  await assert.rejects(f.broker.request({ method: 'fill', grant, entryId: id, selectors: { password: '#password' } }), { code: 'APPROVAL_CANCELLED' });
  assert.deepEqual(f.delivered, []);
});
test('keyring already unlocked does not read a credential; arbitrary consumers are rejected', async t => {
  let delivered = false;
  const f = fixture(t, { inspectKeyring: async () => ({ locked: false, owner: ':1.7' }), keyring: async () => { delivered = true; } });
  const grant = await f.authorize({ kind: 'local-app', id: 'org.gnome.keyring' });
  assert.deepEqual(await f.broker.request({ method: 'unlock-keyring', grant, entryId: randomUUID() }), { unlocked: true, alreadyUnlocked: true, credentialUsed: false, consumer: 'org.gnome.keyring' });
  assert.equal(delivered, false);
  await assert.rejects(f.authorize({ kind: 'local-app', id: '/usr/bin/sh' }), { code: 'UNSUPPORTED_TARGET' });
});
test('native manifest is explicit about unsupported system autofill and passkeys', async t => {
  const f = fixture(t, { platform: 'win32' }); const manifest = await f.broker.request({ method: 'manifest' });
  assert.equal(manifest.features['native.passwords'].version, '1.0.0');
  assert.equal(manifest.capabilities.systemAutofill, false); assert.equal(manifest.capabilities.passkeys, false); assert.deepEqual(manifest.capabilities.localConsumers, []);
  for (const method of ['read', 'export', 'execute', 'evaluate']) await assert.rejects(f.broker.request({ method, token: randomBytes(32).toString('hex') }), { code: 'UNSUPPORTED_OPERATION' });
});
