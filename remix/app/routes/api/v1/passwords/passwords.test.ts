import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordHandler } from './_passwords';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const owner = { id: 'owner', temporary: false } as any;
const defaults = {
  confirmCurrentPassword: async () => 'confirmed' as const,
  getCurrentUser: async () => owner,
  getAuthToken: async () => 'fixture-session',
  ownerVaultConfigured: () => true,
  enforceRateLimit: async () => ({ allowed: true }) as any,
  listPasswords: async () => ({ entries: [], nextCursor: null }),
  readPassword: async () => ({ id: 'fixture', entry: { title: 'Fixture', fields: [] } }) as any,
  exportPasswordPage: async () => ({ entries: [], nextCursor: null }),
  passwordCatalog: async () => ({ catalog: [], nextCursor: null }),
  savePassword: async () => ({ id: 'fixture', revision: 1 }) as any,
  deletePassword: async () => {}
};
const passkeyRequest = { operation: 'verify-passkey', expectedOwnerId: 'owner', requestId: 'b87e17e1-b67b-492b-9cc8-70f521282864', password: 'synthetic-test-password' };
test('browser passkey verification uses fresh password confirmation and returns no reusable credential', async () => {
  let confirmed = 0;
  const response = await createPasswordHandler({ ...defaults, confirmCurrentPassword: async (id, password) => {
    assert.equal(id, 'owner'); assert.equal(password, passkeyRequest.password); confirmed++; return 'confirmed';
  } })({ request: request({}, passkeyRequest) });
  assert.equal(response.status, 200); assert.equal(confirmed, 1);
  const result = await response.json();
  assert.match(result.sessionBinding, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(result.sessionBinding.includes('fixture-session'), false);
  assert.deepEqual({ ...result, sessionBinding: undefined }, { ok: true, ownerId: 'owner', requestId: passkeyRequest.requestId, verified: true, sessionBinding: undefined });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});
test('passkey binding rejects same-owner session replacement, changed origin/request and live revocation', async () => {
  let token = 'fixture-session-A';
  let live = true;
  let touched = 0;
  const handler = createPasswordHandler({ ...defaults, getAuthToken: async () => token,
    getCurrentUser: async () => live ? owner : null,
    passwordCatalog: async () => { touched++; return { catalog: [], nextCursor: null }; },
    savePassword: async () => { touched++; return { id: 'fixture', revision: 1, title: 'Fixture passkey', passwordType: 'passkey' as const, updatedAt: '2026-10-27T00:00:00.000Z' }; } });
  const proof = await (await handler({ request: request({}, passkeyRequest) })).json();
  const otherProof = await (await handler({ request: request({}, { ...passkeyRequest, requestId: 'a87e17e1-b67b-492b-9cc8-70f521282864' }) })).json();
  assert.notEqual(otherProof.sessionBinding, proof.sessionBinding, 'Bindings cannot track a session across website ceremonies.');
  const passkeySession = { requestId: passkeyRequest.requestId, binding: proof.sessionBinding };
  assert.equal((await handler({ request: request({}, { operation: 'catalog', expectedOwnerId: 'owner', passkeySession }) })).status, 200);
  assert.equal(touched, 1);
  token = 'fixture-session-B';
  for (const operation of ['catalog', 'read', 'save', 'delete', 'verify-passkey']) {
    const response = await handler({ request: request({}, { ...passkeyRequest, operation, passkeySession }) });
    assert.equal(response.status, 401, operation);
  }
  assert.equal(touched, 1, 'A replacement same-owner session cannot reach dependent operations.');
  token = 'fixture-session-A';
  const alteredRequest = { ...passkeySession, requestId: 'a87e17e1-b67b-492b-9cc8-70f521282864' };
  assert.equal((await handler({ request: request({}, { operation: 'catalog', expectedOwnerId: 'owner', passkeySession: alteredRequest }) })).status, 401);
  assert.equal((await handler({ request: request({ Origin: 'https://other.example', 'x-forwarded-host': 'other.example' }, { operation: 'catalog', expectedOwnerId: 'owner', passkeySession }) })).status, 401);
  live = false;
  assert.equal((await handler({ request: request({}, { operation: 'catalog', expectedOwnerId: 'owner', passkeySession }) })).status, 401);
});

test('bound operations recheck live revocation after a secret read and after a save', async () => {
  const proof = await (await createPasswordHandler(defaults)({ request: request({}, passkeyRequest) })).json();
  const passkeySession = { requestId: passkeyRequest.requestId, binding: proof.sessionBinding };
  for (const operation of ['read', 'save']) {
    let live = true;
    const handler = createPasswordHandler({ ...defaults, getCurrentUser: async () => live ? owner : null,
      readPassword: async () => { live = false; return { id: 'fixture', entry: { title: 'No release', fields: [] } } as any; },
      savePassword: async () => { live = false; return { id: 'fixture', revision: 1, title: 'Fixture passkey', passwordType: 'passkey' as const, updatedAt: '2026-10-27T00:00:00.000Z' }; } });
    const response = await handler({ request: request({}, { operation, expectedOwnerId: 'owner', passkeySession }) });
    assert.equal(response.status, 401);
    assert.equal((await response.text()).includes('No release'), false);
  }
});
test('browser passkey verification rejects wrong passwords, revoked sessions, rate limits and cross-origin callers', async () => {
  for (const confirmation of ['mismatch', 'unavailable'] as const) {
    const response = await createPasswordHandler({ ...defaults, confirmCurrentPassword: async () => confirmation })({ request: request({}, passkeyRequest) });
    assert.equal(response.status, 403); assert.equal((await response.text()).includes(passkeyRequest.password), false);
  }
  let calls = 0;
  const revoked = createPasswordHandler({ ...defaults, getAuthToken: async () => ++calls === 1 ? 'fixture-session' : 'changed-session' });
  assert.equal((await revoked({ request: request({}, passkeyRequest) })).status, 401);
  const limited = createPasswordHandler({ ...defaults, enforceRateLimit: async (_request, policy) => ({ allowed: policy !== 'auth.passkeyManage', retryAfterSeconds: 60 }) as any, confirmCurrentPassword: async () => { throw Error('must not verify'); } });
  assert.equal((await limited({ request: request({}, passkeyRequest) })).status, 429);
  assert.equal((await createPasswordHandler(defaults)({ request: request({ Origin: 'https://evil.test' }, passkeyRequest) })).status, 403);
});
const request = (headers = {}, body: any = { expectedOwnerId: 'owner', operation: 'read', id: 'fixture' }) => new Request('http://127.0.0.1:17822/api/v1/passwords', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.example', 'x-forwarded-host': 'thingtime.example', 'x-forwarded-proto': 'https', ...headers }, body: JSON.stringify(body) });
test('password endpoint binds the public proxy origin and keeps responses private', async () => {
  const handler = createPasswordHandler(defaults), response = await handler({ request: request() });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(response.headers.get('vary'), 'Cookie, Authorization');
  assert.equal((await handler({ request: request({ Origin: 'https://evil.test' }) })).status, 403);
  assert.equal((await handler({ request: request({ 'Sec-Fetch-Site': 'cross-site' }) })).status, 403);
  assert.equal((await handler({ request: request({ 'Content-Type': 'text/plain' }) })).status, 415);
});
test('password endpoint rejects absent credentials, temporary users and account switches', async () => {
  for (const overrides of [{ getAuthToken: async () => null }, { getCurrentUser: async () => null }, { getCurrentUser: async () => ({ ...owner, temporary: true }) }, { getCurrentUser: async () => ({ ...owner, accountKind: 'service' }) }]) {
    assert.equal((await createPasswordHandler({ ...defaults, ...overrides })({ request: request() })).status, 401);
  }
  assert.equal((await createPasswordHandler(defaults)({ request: request({}, { expectedOwnerId: 'other', operation: 'read' }) })).status, 409);
});
test('internal Action actors cannot borrow vault access even when a bearer header is present', async () => {
  for (const operation of ['list', 'read', 'catalog', 'export', 'save', 'delete']) {
    const incoming = operation === 'list' ? new Request('https://thingtime.example/api/v1/passwords', { headers: { Authorization: 'Bearer fixture-session' } }) : request({ Authorization: 'Bearer fixture-session' }, { operation, expectedOwnerId: 'owner', id: 'fixture' });
    const response = await withInternalRequestActor(incoming, async () => owner, () => createPasswordHandler(defaults)({ request: incoming }));
    assert.equal(response.status, 401, operation);
  }
});
test('revocation before decrypted response blocks both selected reads and native catalog', async () => {
  for (const operation of ['read', 'catalog', 'export']) {
    let count = 0;
    const response = await createPasswordHandler({ ...defaults, getCurrentUser: async () => ++count === 1 ? owner : null })({ request: request({}, { operation, expectedOwnerId: 'owner', id: 'fixture' }) });
    assert.equal(response.status, 401); assert.equal((await response.json()).entry, undefined);
  }
});
test('unexpected crypto failures are redacted and unavailable encryption fails closed', async () => {
  const response = await createPasswordHandler({ ...defaults, readPassword: async () => { throw new Error('fixture-secret-that-must-not-leak'); } })({ request: request() });
  assert.equal(response.status, 503); assert.equal((await response.text()).includes('fixture-secret'), false);
  assert.equal((await createPasswordHandler({ ...defaults, ownerVaultConfigured: () => false })({ request: request() })).status, 503);
});

test('title search and cursor reach the owner-scoped list without revealing values', async () => {
  const handler = createPasswordHandler({ ...defaults, listPasswords: async (id, cursor, query) => {
    assert.equal(id, 'owner'); assert.equal(cursor, 'opaque-cursor'); assert.equal(query, 'Facebook [.*]');
    return { entries: [], nextCursor: null };
  } });
  const response = await handler({ request: new Request('https://thingtime.example/api/v1/passwords?q=Facebook%20%5B.*%5D&cursor=opaque-cursor') });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual((await response.json()).entries, []);
});

test('native setup owner verification uses the existing authenticated metadata GET contract', async () => {
  const response = await createPasswordHandler(defaults)({ request: new Request('https://thingtime.example/api/v1/passwords') });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, ownerId: 'owner', configured: true, entries: [], nextCursor: null });
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
});

test('revocation during icon metadata load withholds the entire private list', async () => {
  let checks = 0;
  const handler = createPasswordHandler({ ...defaults, getCurrentUser: async () => ++checks === 1 ? owner : null,
    listPasswords: async () => ({ entries: [{ id: 'fixture', title: 'Private', icon: { kind: 'url', url: 'https://private.example.test/icon' } }], nextCursor: null }) as any });
  const response = await handler({ request: new Request('https://thingtime.example/api/v1/passwords') });
  assert.equal(response.status, 401);
  assert.equal((await response.text()).includes('private.example'), false);
});
