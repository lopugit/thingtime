import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
import { randomBytes } from 'node:crypto';
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
    if (expected && typeof expected === 'object' && '$in' in expected) return Array.isArray(value) ? value.some(entry => expected.$in.includes(entry)) : expected.$in.includes(value);
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
const { upsertAccountAndLink, listConnections, resolveConnectionCredential, externalAccountShareId, externalLinkShareId, unlinkConnection } =
  await import('./connections.ts');
const { connectionProviderById } = await import('./providers.ts');
const { fromBin, toBin } = await import('../auth/users.ts');
const { unpackConnectionTokens } = await import('./tokenVault.ts');
const provider = connectionProviderById('google')!;
const { oauthCredsFor } = await import('./providers.ts');
const config = (await oauthCredsFor(provider, 'https://thingtime.test'))!;
const user = { id: 'owner-a', username: 'a' },
  other = { id: 'owner-b', username: 'b' };
const account = (id = 'google-one') => ({
  providerAccountId: id,
  displayName: 'Test account',
  handle: `${id}@example.test`,
  avatarUrl: null,
  profileUrl: null,
  config: {}
});
const tokens = {
  clientId: config.clientId, oauthBinding: config.binding, oauthOrigin: config.origin, oauthEnvironment: config.environment,
  accessToken: 'private-access-value',
  refreshToken: 'private-refresh-value',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: ['openid', 'profile']
};
beforeEach(() => {
  configuredClientId = 'test-client'; missingVault = false; interfere = undefined;
  docs = ['owner-a', 'owner-b'].map((shareId) => ({
    shareId,
    thingtime: ['user'],
    secureVersion: 0,
    secure: toBin(JSON.stringify({ passwordHash: 'fixture-hash', meta: {} }))
  }));
});
test('two Google accounts coexist; the same identity in another Thingtime account has independent encrypted credentials', async () => {
  const first = await upsertAccountAndLink(user, provider, account(), tokens);
  const second = await upsertAccountAndLink(user, provider, account('google-two'), { ...tokens, accessToken: 'second-token' });
  const foreign = await upsertAccountAndLink(other, provider, account(), { ...tokens, accessToken: 'foreign-token' });
  assert.ok(first.ok && second.ok && foreign.ok);
  assert.notEqual(first.connection.account.id, second.connection.account.id);
  assert.notEqual(first.connection.account.id, foreign.connection.account.id);
  const accounts = docs.filter((doc) => doc.thingtime.includes('external-account'));
  for (const doc of accounts) {
    assert.ok(!fromBin(doc.secure)?.includes('token'));
    assert.ok(!fromBin(doc.secure)?.includes('private-access-value'));
    assert.ok((await unpackConnectionTokens(doc))?.accessToken);
    assert.equal(await unpackConnectionTokens({ ...doc, ownerId: 'wrong-owner' }), null);
    assert.equal(await unpackConnectionTokens({ ...doc, shareId: 'wrong-id' }), null);
  }
  const publicResult = JSON.stringify(await listConnections(user));
  assert.ok(!publicResult.includes('private-access-value') && !publicResult.includes('private-refresh-value'));
  assert.equal((await listConnections(user)).connections.length, 2);
  assert.equal((await resolveConnectionCredential(other, first.connection.id)).ok, false);
});
test('scope metadata retains every granted scope without truncating valid provider grants', async () => {
  const scopes = Array.from({ length: 125 }, (_, index) => `scope-${index}`);
  const linked = await upsertAccountAndLink(user, provider, account(), { ...tokens, scopes });
  assert.ok(linked.ok);
  assert.deepEqual(linked.connection.scopes, scopes);
  assert.deepEqual((await listConnections(user)).connections[0].scopes, scopes);
});
test('reconnect is idempotent and preserves a refresh token omitted by the provider', async () => {
  const first = await upsertAccountAndLink(user, provider, account(), tokens);
  const again = await upsertAccountAndLink(user, provider, account(), { ...tokens, refreshToken: null, accessToken: 'renewed' });
  assert.ok(first.ok && again.ok && again.alreadyLinked);
  assert.equal(first.connection.id, again.connection.id);
  assert.equal((await listConnections(user)).connections.length, 1);
  const saved = await resolveConnectionCredential(user, first.connection.id);
  assert.ok(saved.ok);
  assert.equal(saved.tokens.accessToken, 'renewed');
  assert.equal(saved.tokens.refreshToken, tokens.refreshToken);
});
test('legacy shared credentials require reconnect; relinking preserves the existing connection ID and other owners', async () => {
  const accountId = externalAccountShareId(provider.id, account().providerAccountId);
  const oldId = externalLinkShareId(user.id, accountId);
  docs.push({ shareId: accountId, ownerId: 'system', thingtime: ['external-account'], crystal: { provider: 'google' }, secure: { old: true } });
  docs.push({
    shareId: oldId,
    ownerId: user.id,
    parentId: accountId,
    thingtime: ['external-account-link'],
    crystal: { accountId, provider: 'google' }
  });
  assert.equal((await resolveConnectionCredential(user, oldId)).ok, false);
  const linked = await upsertAccountAndLink(user, provider, account(), tokens);
  assert.ok(linked.ok);
  assert.equal(linked.connection.id, oldId);
  assert.notEqual(linked.connection.account.id, accountId);
  assert.ok(docs.some((doc) => doc.shareId === accountId && doc.ownerId === 'system'));
});
test('disconnect removes saved credentials and denies subsequent requests', async () => {
  const linked = await upsertAccountAndLink(user, provider, account(), tokens);
  assert.ok(linked.ok);
  assert.equal((await unlinkConnection(other, { id: linked.connection.id })).ok, false);
  assert.ok((await unlinkConnection(user, { id: linked.connection.id })).ok);
  assert.equal(
    docs.some((doc) => doc.thingtime.includes('external-account') && doc.secure),
    false
  );
  assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
});
test('a refresh lease prevents concurrent exchanges of a rotating token and reconnect wins', async () => {
  process.env.GOOGLE_CLIENT_ID = 'test';
  process.env.GOOGLE_CLIENT_SECRET = 'test';
  let release!: () => void,
    calls = 0;
  const original = provider.oauth!.refreshTokens;
  provider.oauth!.refreshTokens = async () => {
    calls++;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ...tokens, accessToken: 'rotated', refreshToken: 'rotated-refresh' };
  };
  try {
    const linked = await upsertAccountAndLink(user, provider, account(), { ...tokens, expiresAt: new Date(0).toISOString() });
    assert.ok(linked.ok);
    const first = resolveConnectionCredential(user, linked.connection.id);
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
    assert.equal(calls, 1);
    await upsertAccountAndLink(user, provider, account(), { ...tokens, accessToken: 'reconnected' });
    release();
    const result = await first;
    assert.ok(result.ok);
    assert.equal(result.tokens.accessToken, 'reconnected');
    assert.equal(
      docs.some((doc) => doc.credentialRefreshLease),
      false
    );
  } finally {
    provider.oauth!.refreshTokens = original;
  }
});

test('a service can retain more than fifty independently removable accounts', async () => {
  for (let index = 0; index < 55; index++) {
    const result = await upsertAccountAndLink(user, provider, account(`many-${index}`), tokens);
    assert.ok(result.ok);
  }
  const saved = await listConnections(user);
  assert.equal(saved.connections.length, 55);
  assert.ok((await unlinkConnection(user, { id: saved.connections[27].id })).ok);
  assert.equal((await listConnections(user)).connections.length, 54);
  assert.ok((await upsertAccountAndLink(user, provider, account('many-55'), tokens)).ok);
  assert.equal((await listConnections(user)).connections.length, 55);
});

test('concurrent first encrypted accounts converge on one persisted user key', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => upsertAccountAndLink(user, provider, account(`first-${index}`), tokens)));
  assert.ok(results.every((result) => result.ok));
  const accounts = docs.filter((doc) => doc.thingtime.includes('external-account'));
  assert.equal(new Set(accounts.map((doc) => JSON.parse(fromBin(doc.secure)).keyId)).size, 1);
  for (const doc of accounts) assert.equal((await unpackConnectionTokens(doc))?.accessToken, tokens.accessToken);
});

test('a corrupt user secure blob cannot be replaced with a fresh vault key', async () => {
  const owner = docs.find((doc) => doc.shareId === user.id);
  owner.secure = toBin('damaged secure payload');
  await assert.rejects(upsertAccountAndLink(user, provider, account(), tokens));
  assert.equal(fromBin(owner.secure), 'damaged secure payload');
  assert.equal(docs.filter((doc) => doc.thingtime.includes('external-account')).length, 0);
});

test('invalid persisted key registries fail closed without replacing credentials', async () => {
  const owner = docs.find((doc) => doc.shareId === user.id);
  for (const vaultKey of [null, [], false, 0]) {
    const payload = JSON.stringify({ passwordHash: 'fixture', vaultKey });
    owner.secure = toBin(payload);
    await assert.rejects(upsertAccountAndLink(user, provider, account(), tokens));
    assert.equal(fromBin(owner.secure), payload);
    assert.equal(docs.filter((doc) => doc.thingtime.includes('external-account')).length, 0);
  }
});

test('saved grants fail closed on client rotation, missing vault, wrong environment and unbound legacy tokens', async () => {
  const linked = await upsertAccountAndLink(user, provider, account(), tokens);
  assert.ok(linked.ok);
  configuredClientId = 'other-client';
  assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
  configuredClientId = 'test-client';
  process.env.THINGTIME_DATA_ENV = 'development';
  assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
  process.env.THINGTIME_DATA_ENV = 'custom:oauth-test';
  missingVault = true;
  assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
  missingVault = false;
  const legacy = { ...tokens, oauthBinding: undefined };
  await upsertAccountAndLink(user, provider, account(), legacy);
  assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
});
test('partial refresh retains origin, client, environment, refresh grant and scope metadata', async () => {
  const original = provider.oauth!.refreshTokens;
  provider.oauth!.refreshTokens = async () => ({ accessToken: 'partial-refreshed', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  try {
    const linked = await upsertAccountAndLink(user, provider, account(), { ...tokens, expiresAt: new Date(0).toISOString() });
    assert.ok(linked.ok);
    const result = await resolveConnectionCredential(user, linked.connection.id);
    assert.ok(result.ok);
    assert.equal(result.tokens.accessToken, 'partial-refreshed');
    for (const key of ['clientId', 'oauthBinding', 'oauthOrigin', 'oauthEnvironment', 'refreshToken', 'scopes'] as const)
      assert.deepEqual(result.tokens[key], tokens[key]);
  } finally { provider.oauth!.refreshTokens = original; }
});

const testRefreshLoser = (phase: 'lease' | 'write') => test(`refresh ${phase} loser refuses a concurrent reconnect with another binding`, async () => {
  const original = provider.oauth!.refreshTokens;
  let refreshes = 0;
  provider.oauth!.refreshTokens = async () => {
    refreshes++;
    if (phase === 'write') await upsertAccountAndLink(user, provider, account(), { ...tokens, oauthBinding: 'other-deployment', accessToken: 'foreign' });
    return { accessToken: 'refreshed', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  };
  try {
    const linked = await upsertAccountAndLink(user, provider, account(), { ...tokens, expiresAt: new Date(0).toISOString() });
    assert.ok(linked.ok);
    if (phase === 'lease') interfere = async (_query, patch) => {
      if (!patch.$set?.credentialRefreshLease) return;
      interfere = undefined;
      await upsertAccountAndLink(user, provider, account(), { ...tokens, oauthBinding: 'other-deployment', accessToken: 'foreign' });
    };
    assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
    assert.equal(refreshes, phase === 'lease' ? 0 : 1);
  } finally { provider.oauth!.refreshTokens = original; interfere = undefined; }
});
testRefreshLoser('lease');
testRefreshLoser('write');
test('a request on another origin cannot reuse a stored production grant', async () => {
  const { withVaultRequest } = await import('../auth/vaultRequest.ts');
  const linked = await upsertAccountAndLink(user, provider, account(), tokens);
  assert.ok(linked.ok);
  await withVaultRequest(new Request('https://preview.test'), async () => assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false));
});

test('failed refresh revalidates a concurrent reconnect before returning credentials', async () => {
  const original = provider.oauth!.refreshTokens;
  provider.oauth!.refreshTokens = async () => {
    await upsertAccountAndLink(user, provider, account(), { ...tokens, oauthBinding: 'another-client', accessToken: 'foreign' });
    return null;
  };
  try {
    const linked = await upsertAccountAndLink(user, provider, account(), { ...tokens, expiresAt: new Date(Date.now() + 1000).toISOString() });
    assert.ok(linked.ok);
    assert.equal((await resolveConnectionCredential(user, linked.connection.id)).ok, false);
  } finally { provider.oauth!.refreshTokens = original; }
});


test('Facebook diagnostics bind exact owner, origin and unchanged saved credential without writes', async t => {
  const { diagnoseConnection } = await import('./connections.ts');
  const facebook = connectionProviderById('facebook')!;
  const creds = (await oauthCredsFor(facebook, 'https://thingtime.test'))!;
  const saved = { ...tokens, clientId: creds.clientId, oauthBinding: creds.binding, oauthOrigin: creds.origin,
    oauthEnvironment: creds.environment, requestedScopes: ['public_profile', 'user_posts'], confirmedScopes: ['public_profile'] };
  const linked = await upsertAccountAndLink(user, facebook, account('facebook-one'), saved);
  assert.ok(linked.ok);
  if (!linked.ok) return;
  const id = linked.connection.id;
  assert.deepEqual(linked.connection.authorization, { requestedScopes: saved.requestedScopes, grantedScopes: saved.confirmedScopes });
  assert.deepEqual(linked.connection.scopes, ['public_profile']);
  let probes = 0;
  t.mock.method(facebook, 'diagnose', async () => { probes++; return { grantedScopes: ['public_profile'], checks: [] }; });
  const before = JSON.stringify(docs);
  assert.equal((await diagnoseConnection(other, id, 'https://thingtime.test')).ok, false);
  assert.equal((await diagnoseConnection(user, id, 'https://foreign.test')).ok, false);
  assert.equal(probes, 0);
  assert.equal((await diagnoseConnection(user, id, 'https://thingtime.test')).ok, true);
  assert.equal(probes, 1);
  assert.equal(JSON.stringify(docs), before);
  await upsertAccountAndLink(user, facebook, account('facebook-one'), { ...saved, expiresAt: new Date(0).toISOString() });
  assert.deepEqual(await diagnoseConnection(user, id, 'https://thingtime.test'), { ok: false, status: 401, error: 'This account authorization expired. Reconnect it.' });
  assert.equal(probes, 1);
  await upsertAccountAndLink(user, facebook, account('facebook-one'), saved);
  t.mock.method(facebook, 'diagnose', async () => {
    docs = docs.filter(doc => doc.shareId !== id);
    return { grantedScopes: ['user_posts'], checks: [] };
  });
  assert.deepEqual(await diagnoseConnection(user, id, 'https://thingtime.test'), { ok: false, status: 409, error: 'This connection changed or was removed.' });
});

test('legacy Facebook requested scope metadata is never projected as confirmed grants', async () => {
  const { toPublicConnection } = await import('./connections.ts');
  const projection = toPublicConnection({ ownerId: user.id, crystal: { provider: 'facebook' } },
    { ownerId: user.id, crystal: { scopes: ['public_profile', 'user_posts'] } }, connectionProviderById('facebook')!);
  assert.deepEqual(projection.scopes, []);
  assert.deepEqual(projection.authorization, { requestedScopes: null, grantedScopes: null });
});
