import test from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordHandler } from './_passwords';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const owner = { id: 'owner', temporary: false } as any;
const defaults = {
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
