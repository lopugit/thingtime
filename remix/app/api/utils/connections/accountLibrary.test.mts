import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
import { randomBytes } from 'node:crypto';
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
let docs: any[] = [];
const valueAt = (doc: any, key: string) => key.split('.').reduce((obj, key) => obj?.[key], doc);
const matches = (doc: any, query: any): boolean =>
  Object.entries(query).every(([key, expected]: any) => {
    const value = valueAt(doc, key);
    if (key === '$or') return expected.some((part: any) => matches(doc, part));
    if (expected && typeof expected === 'object' && '$exists' in expected) return (value !== undefined) === expected.$exists;
    if (expected === null) return value == null;
    if (expected && typeof expected === 'object' && '$lte' in expected) return value <= expected.$lte;
    if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(value);
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
const { runConnectionRequest } = await import('./requests.ts');
const provider = connectionProviderById('google')!;
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
  accessToken: 'private-access-value',
  refreshToken: 'private-refresh-value',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scopes: ['openid', 'profile']
};
beforeEach(() => {
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
test('reuse rejects arbitrary operations, wrong services and credentials belonging to another user', async () => {
  const linked = await upsertAccountAndLink(user, provider, account(), tokens);
  assert.ok(linked.ok);
  for (const [actor, operation] of [
    [user, 'https://attacker.test'],
    [user, '__proto__'],
    [user, 'drive.list-files'],
    [other, 'account.profile']
  ] as const) {
    const result = await runConnectionRequest(actor, { connectionId: linked.connection.id, operation });
    assert.equal(result.ok, false);
  }
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
