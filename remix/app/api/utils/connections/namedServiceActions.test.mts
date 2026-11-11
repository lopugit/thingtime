import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import dns from 'node:dns/promises';
import { syncBuiltinESMExports } from 'node:module';
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.THINGTIME_DATA_ENV = 'custom:oauth-test';
process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = 'https://thingtime.test';
let configuredClientId = 'test-client', missingVault = false;
mock.module(new URL('../admin/integrations.ts', import.meta.url).href, { namedExports: {
  readAdminAutomationSecret: async () => missingVault ? null : JSON.stringify({ environments: { 'oauth-test': { origins: {
    'https://thingtime.test': { clientId: configuredClientId, clientSecret: 'test-secret', redirectUri: 'https://thingtime.test/api/v1/connections/oauth/callback' }
  } } } })
} });
let docs: any[] = [];
let interfere: ((query: any, patch: any) => Promise<void>) | undefined;
const valueAt = (doc: any, key: string) => key.split('.').reduce((obj, key) => obj?.[key], doc);
const matches = (doc: any, query: any): boolean =>
  Object.entries(query).every(([key, expected]: any) => {
    const value = valueAt(doc, key);
    if (key === '$or') return expected.some((part: any) => matches(doc, part));
    if (expected && typeof expected === 'object' && '$exists' in expected) return (value !== undefined) === expected.$exists;
    if (expected === null) return value == null;
    if (expected && typeof expected === 'object' && '$lte' in expected) return value <= expected.$lte;
    if (expected && typeof expected === 'object' && '$in' in expected) return Array.isArray(value) ? value.some(item => expected.$in.includes(item)) : expected.$in.includes(value);
    return Array.isArray(value) ? value.includes(expected) : value === expected;
  });
const set = (doc: any, key: string, value: any) => {
  const parts = key.split('.');
  let at = doc;
  for (const part of parts.slice(0, -1)) at = at[part] ||= {};
  at[parts.at(-1)!] = value;
};
const collection = {
  findOne: async (q: any) => {
    const doc = docs.find((doc) => matches(doc, q));
    return doc ? { ...doc, crystal: { ...doc.crystal } } : null;
  },
  countDocuments: async (q: any) => docs.filter((doc) => matches(doc, q)).length,
  find(q: any) {
    const cursor = {
      sort: () => cursor,
      toArray: async () => docs.filter((doc) => matches(doc, q)).map((doc) => ({ ...doc, crystal: { ...doc.crystal } }))
    };
    return cursor;
  },
  async updateOne(query: any, patch: any, options?: any) {
    await interfere?.(query, patch);
    let doc = docs.find((doc) => matches(doc, query));
    const inserted = !doc;
    if (!doc && !options?.upsert) return { matchedCount: 0, upsertedCount: 0 };
    if (!doc) {
      doc = {};
      for (const [k, v] of Object.entries(patch.$setOnInsert || {})) set(doc, k, v);
      docs.push(doc);
    }
    for (const [k, v] of Object.entries(patch.$set || {})) set(doc, k, v);
    for (const k of Object.keys(patch.$unset || {})) delete doc[k];
    return { modifiedCount: 1, matchedCount: inserted ? 0 : 1, upsertedCount: inserted ? 1 : 0 };
  },
  async deleteOne(q: any) {
    const at = docs.findIndex((doc) => matches(doc, q));
    if (at >= 0) docs.splice(at, 1);
    return { deletedCount: at >= 0 ? 1 : 0 };
  },
  async deleteMany(q: any) {
    docs = docs.filter((doc) => !matches(doc, q));
  }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    withHomeMongoTransaction: async (work: any) => work({}),
    getHomeThingsCollection: async () => collection,
    getThingsCollection: async () => collection
  }
});

const { saveNamedConnection } = await import('./namedConnections.ts');
const { useNamedConnection, unlinkConnection, listConnections } = await import('./connections.ts');
const { connectionProviderById, oauthCredsFor } = await import('./providers.ts');
const { toBin } = await import('../auth/users.ts');
const { googleServiceAccess } = await import('../../../connections/googleServiceActions.ts');
const owner = { id: 'owner-a', username: 'a' }, origin = 'https://thingtime.test';
const provider = connectionProviderById('google-drive')!;
const config = (await oauthCredsFor(provider, origin))!;
const tokens = { clientId: config.clientId, oauthBinding: config.binding, oauthOrigin: config.origin, oauthEnvironment: config.environment,
  accessToken: 'selected-access-fixture', refreshToken: 'selected-refresh-fixture', expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: [googleServiceAccess['drive.list-files'].scope], confirmedScopes: [googleServiceAccess['drive.list-files'].scope] };
const originalFetch = globalThis.fetch, originalLookup = dns.lookup;
let requests: { url: string; token: string | null }[] = [], duringFetch: (() => void) | undefined;
beforeEach(() => {
  docs = [{ shareId: owner.id, thingtime: ['user'], secureVersion: 0, secure: toBin(JSON.stringify({ passwordHash: 'fixture', meta: {} })) }];
  requests = []; duringFetch = undefined; interfere = undefined;
  dns.lookup = (async () => [{ address: '1.1.1.1', family: 4 }]) as unknown as typeof dns.lookup;
  syncBuiltinESMExports();
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    requests.push({ url: String(url), token: new Headers(init.headers).get('Authorization') }); duringFetch?.();
    return Response.json({ files: [{ id: 'fixture-document', size: 15, private_echo: tokens.accessToken }], nextPageToken: 'next/page+opaque' });
  }) as typeof fetch;
});
test.after(() => { globalThis.fetch = originalFetch; dns.lookup = originalLookup; syncBuiltinESMExports(); });
async function saved(name = 'Selected', overrides = {}) {
  return saveNamedConnection(owner, provider, { providerAccountId: 'google-subject', displayName: 'Fixture', handle: 'fixture@example.test', avatarUrl: null, profileUrl: null, config: {} },
    { ...tokens, ...overrides }, { requestId: randomUUID(), name, allowedOperations: ['drive.list-files'], requestedScopes: tokens.scopes }, tokens.scopes, origin, config.environment);
}
test('same-subject grants stay independent; use only the selected token and opaque page', async () => {
  const a = await saved(), b = await saved('Sibling', { accessToken: 'sibling-access-fixture' }); assert.ok(a.ok && b.ok);
  assert.notEqual(a.connection.id, b.connection.id);
  const result = await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files', pageToken: 'page/one+opaque' }, origin);
  assert.ok(result.ok); assert.equal(requests.length, 1); assert.equal(requests[0].token, `Bearer ${tokens.accessToken}`);
  assert.equal(new URL(requests[0].url).searchParams.get('pageToken'), 'page/one+opaque'); assert.equal(result.result.nextPageToken, 'next/page+opaque');
  assert.ok(!JSON.stringify(result).includes(tokens.accessToken));
  await unlinkConnection(owner, { id: a.connection.id, origin });
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, false);
  assert.equal((await useNamedConnection(owner, { id: b.connection.id, operation: 'drive.list-files' }, origin)).ok, true);
  assert.equal(requests.at(-1)?.token, 'Bearer sibling-access-fixture');
});
test('wrong owner, origin, operation and unconfirmed scopes fail before fetch', async () => {
  const a = await saved(); assert.ok(a.ok);
  assert.equal((await useNamedConnection({ id: 'foreign', username: 'f' }, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, false);
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, 'https://other.test')).ok, false);
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'gmail.list-messages' }, origin)).ok, false);
  const row = docs.find(doc => doc.shareId === a.connection.id)!;
  row.crystal.allowedOperations = ['account.identity'];
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, false);
  row.crystal.allowedOperations = ['drive.list-files']; row.crystal.grantedScopes = [];
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, false); assert.equal(requests.length, 0);
});
test('reconnect during an upstream request discards its completed result', async () => {
  const a = await saved(); assert.ok(a.ok);
  duringFetch = () => { docs.find(doc => doc.shareId === a.connection.id)!.crystal.grantRevision = 'newer-grant'; };
  const result = await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin);
  assert.equal(result.ok, false); assert.equal(requests.length, 1);
});


test('fixed service reads preserve upstream JSON larger than feed budgets', async () => {
  const a = await saved(); assert.ok(a.ok);
  const value = 'long-user-data'.repeat(260000);
  globalThis.fetch = (async () => Response.json({ files: [{ id: 'one', description: value }], nextPageToken: 'opaque'.repeat(3000) })) as typeof fetch;
  const result = await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin);
  assert.ok(result.ok); assert.deepEqual(result.result, { files: [{ id: 'one', description: value }], nextPageToken: 'opaque'.repeat(3000) });
});
test('malformed successes and denied requests fail without returning upstream secrets', async () => {
  const a = await saved(); assert.ok(a.ok);
  globalThis.fetch = (async () => new Response('not-json')) as typeof fetch;
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, false);
  globalThis.fetch = (async () => new Response(tokens.accessToken, { status: 403 })) as typeof fetch;
  const denied = await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin);
  assert.equal(denied.ok, false); assert.ok(!JSON.stringify(denied).includes(tokens.accessToken));
});
test('cancelled reads do not start a provider request', async () => {
  const a = await saved(); assert.ok(a.ok);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin, controller.signal), { name: 'AbortError' });
  assert.equal(requests.length, 0);
});


test('refresh losing confirmed permission cannot run the selected service action', async () => {
  const a = await saved('Expiring', { expiresAt: new Date(Date.now() - 1000).toISOString() }); assert.ok(a.ok);
  const original = provider.oauth!.refreshTokens;
  let refreshed = 0;
  provider.oauth!.refreshTokens = async () => { refreshed++; return { accessToken: 'refreshed-access-fixture', confirmedScopes: [], expiresAt: new Date(Date.now() + 3600000).toISOString() }; };
  try {
    const result = await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin);
    assert.equal(result.ok, false); assert.equal(refreshed, 1); assert.equal(requests.length, 0);
  } finally { provider.oauth!.refreshTokens = original; }
});


test('older named clients never receive new exhaustive operation IDs', async () => {
  const a = await saved(); assert.ok(a.ok);
  const oldClient = await listConnections(owner, origin);
  assert.deepEqual(oldClient.connections.find(row => row.id === a.connection.id)?.named?.allowedOperations, []);
  const newClient = await listConnections(owner, origin, true);
  assert.deepEqual(newClient.connections.find(row => row.id === a.connection.id)?.named?.allowedOperations, ['drive.list-files']);
  assert.equal((await useNamedConnection(owner, { id: a.connection.id, operation: 'drive.list-files' }, origin)).ok, true, 'Projection never changes saved permissions');
});
