import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { Binary, ObjectId } from 'mongodb';
const actualCollections = await import('../mongodb/collections');
const rows: any[] = [];
let owner: any;
let failOwnerSave = false;
let transactionTail = Promise.resolve();
const valueAt = (value: any, path: string) => path.split('.').reduce((current, key) => current?.[key], value);
const matches = (doc: any, query: any) => Object.entries(query).every(([key, value]: [string, any]) => {
  const actual = valueAt(doc, key);
  if (value && typeof value === 'object' && '$exists' in value) return (actual !== undefined) === value.$exists;
  if (key === 'thingtime') return Array.isArray(doc.thingtime) && doc.thingtime.includes(value);
  if (actual instanceof ObjectId && value instanceof ObjectId) return actual.equals(value);
  if (actual instanceof Date && value instanceof Date) return actual.getTime() === value.getTime();
  return actual === value;
});
const set = (doc: any, path: string, value: any) => { const keys = path.split('.'); const last = keys.pop()!; const target = keys.reduce((parent, key) => parent[key] ||= {}, doc); target[last] = value; };
const things = {
  findOne: async (query: any) => owner && matches(owner, query) ? owner : rows.find(row => matches(row, query)) || null,
  find: (query: any) => ({ async *[Symbol.asyncIterator]() { yield* rows.filter(row => matches(row, query)); } }),
  updateOne: async (query: any, change: any, options: any) => {
    if (owner && matches(owner, query)) {
      if (failOwnerSave) return { matchedCount: 0 };
      for (const [key, value] of Object.entries(change.$set || {})) set(owner, key, value);
      return { matchedCount: 1 };
    }
    let row = rows.find(row => matches(row, query));
    if (!row && options?.upsert) {
      row = {}; for (const [key, value] of Object.entries(change.$setOnInsert || {})) set(row, key, value);
      rows.push(row);
    }
    if (!row) return { matchedCount: 0 };
    for (const [key, value] of Object.entries(change.$set || {})) set(row, key, value);
    return { matchedCount: 1 };
  },
  deleteOne: async (query: any) => { const index = rows.findIndex(row => matches(row, query)); if (index >= 0) rows.splice(index, 1); },
  deleteMany: async (query: any) => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], query)) rows.splice(i, 1); }
};
const clone = (input: any): any => input instanceof Binary ? new Binary(Buffer.from(input.buffer)) : input instanceof Date ? new Date(input) : Array.isArray(input) ? input.map(clone) : input && typeof input === 'object' ? Object.fromEntries(Object.entries(input).map(([key,value]) => [key,clone(value)])) : input;
const transaction = async (work: any) => {
  const previous = transactionTail; let release!: () => void;
  transactionTail = new Promise(resolve => { release = resolve; }); await previous;
  const savedOwner = clone(owner), savedRows = clone(rows);
  try { return await work({ syntheticSession: true }); }
  catch (error) { owner = savedOwner; rows.splice(0, rows.length, ...savedRows); throw error; }
  finally { release(); }
};
mock.module('../mongodb/collections', { namedExports: { ...actualCollections,
  getHomeThingsCollection: async () => things, getUsersCollection: async () => things, withHomeMongoTransaction: transaction
} });
const users = await import('./users');
const { ACCOUNT_CONFIG_MARKER } = await import('./accountConfiguration');
const key = randomBytes(32).toString('base64url');
const endpoint = (n: number) => ({ id: `endpoint-${n}`, name: `Synthetic ${n}`, url: `mongodb://synthetic-${n}:synthetic-value@invalid.test/db`, createdAt: '2026-11-12T00:00:00.000Z' });
const link = (n: number) => ({ id: `link-${n}`, name: `Synthetic ${n}`, baseUrl: `https://deployment-${n}.invalid`, token: `synthetic-token-${n}`, tokenExpiresAt: null,
  remoteUserId: `remote-${n}`, remoteUsername: `remote-${n}`, syncMode: 'off' as const,
  pathRules: Array.from({ length: 70 }, (_, i) => ({ path: `things/kind-${i}`, mode: 'push' as const })), createdAt: '', lastSyncAt: null, lastSyncSummary: null });
const reset = (legacy = false, meta: any = {}) => {
  rows.splice(0); failOwnerSave = false; process.env.THINGTIME_USER_VAULT_KEY = key;
  owner = legacy ? { _id: new ObjectId('111111111111111111111111'), meta, updatedAt: new Date() } : { shareId: 'owner', thingtime: ['user'], secureVersion: 0, secure: users.packSecure({ meta } as any) };
};
test('legacy arrays migrate transactionally to individually encrypted endpoint/link/rule records without former count caps', async () => {
  const endpoints = Array.from({ length: 25 }, (_, n) => endpoint(n)); const links = Array.from({ length: 12 }, (_, n) => link(n));
  reset(false, { mongoEndpoints: endpoints, deploymentLinks: links, unrelated: 'preserved' });
  const read = await users.getUserMongoEndpoints('owner');
  assert.equal(read.length, 25); assert.equal((await users.getUserDeploymentLinks('owner')).length, 12);
  assert.equal((await users.getUserDeploymentLinks('owner'))[0].pathRules.length, 70);
  assert.equal(rows.length, 25 + 12 + 12 * 70);
  const meta = users.unpackSecure(owner.secure).meta!;
  assert.equal(meta[ACCOUNT_CONFIG_MARKER], true); assert.equal(meta.mongoEndpoints, undefined); assert.equal(meta.deploymentLinks, undefined); assert.equal(meta.unrelated, 'preserved');
  assert(rows.every(row => row.secure instanceof Binary && !row.crystal.token && !row.crystal.url && !row.crystal.pathRules));
  assert(rows.every(row => !Buffer.from(row.secure.buffer).includes(Buffer.from('synthetic-token-'))));
  assert(rows.every(row => !Buffer.from(row.secure.buffer).includes(Buffer.from('mongodb://'))));
  assert.equal((await users.addUserMongoEndpoint('owner', endpoint(100))).ok, true);
  assert.equal((await users.addUserDeploymentLink('owner', link(100))).ok, true);
});
test('empty authoritative marker prevents deleted legacy endpoints and rules resurrecting', async () => {
  reset(false, { mongoEndpoints: [endpoint(0)], deploymentLinks: [link(0)] });
  await users.getUserMongoEndpoints('owner');
  assert.equal(await users.removeUserMongoEndpoint('owner', 'endpoint-0'), true);
  assert.equal(!!(await users.removeUserDeploymentLink('owner', 'link-0')), true); assert.equal(rows.length, 0);
  const secure = users.unpackSecure(owner.secure); secure.meta!.mongoEndpoints = [endpoint(0)]; secure.meta!.deploymentLinks = [link(0)]; owner.secure = users.packSecure(secure);
  assert.equal((await users.getUserMongoEndpoints('owner')).length, 0); assert.equal((await users.getUserDeploymentLinks('owner')).length, 0);
});
test('concurrent identical endpoint adds serialize and preserve the duplicate constraint', async () => {
  reset();
  const results = await Promise.all(Array.from({ length: 5 }, () => users.addUserMongoEndpoint('owner', endpoint(0))));
  assert.equal(results.filter(result => result.ok).length, 1); assert.equal((await users.getUserMongoEndpoints('owner')).length, 1);
});
test('missing cipher preserves legacy read/use and refuses new plaintext writes; failed owner CAS rolls back migration', async () => {
  reset(false, { mongoEndpoints: [endpoint(0)] }); const original = Buffer.from(owner.secure.buffer);
  delete process.env.THINGTIME_USER_VAULT_KEY; const adminKey = process.env.THINGTIME_ADMIN_VAULT_KEY; delete process.env.THINGTIME_ADMIN_VAULT_KEY;
  try {
    assert.equal((await users.getUserMongoEndpoints('owner')).length, 1);
    await assert.rejects(users.addUserMongoEndpoint('owner', endpoint(1)), /Secure Vault is unavailable/);
    assert.equal(rows.length, 0); assert(Buffer.from(owner.secure.buffer).equals(original));
  } finally { process.env.THINGTIME_USER_VAULT_KEY = key; if (adminKey !== undefined) process.env.THINGTIME_ADMIN_VAULT_KEY = adminKey; }
  failOwnerSave = true; assert.equal((await users.getUserMongoEndpoints('owner')).length, 1);
  assert.equal((await users.getUserMongoEndpoint('owner', 'endpoint-0'))?.id, 'endpoint-0');
  assert.equal(rows.length, 0); assert(Buffer.from(owner.secure.buffer).equals(original));
});


test('legacy users collection adapter migrates once and preserves unrelated private metadata', async () => {
  reset(true, { mongoEndpoints: [endpoint(0)], deploymentLinks: [link(0)], unrelated: 'preserved' });
  const id = '111111111111111111111111';
  assert.equal((await users.getUserMongoEndpoints(id)).length, 1);
  assert.equal(owner.meta[ACCOUNT_CONFIG_MARKER], true); assert.equal(owner.meta.unrelated, 'preserved');
  assert.equal(owner.meta.mongoEndpoints, undefined); assert.equal(owner.meta.deploymentLinks, undefined);
  assert.equal((await users.getUserDeploymentLinks(id))[0].pathRules.length, 70);
  assert.equal(await users.removeUserMongoEndpoint(id, 'endpoint-0'), true);
  assert.equal((await users.getUserMongoEndpoints(id)).length, 0);
});

test('exact selection never decrypts unrelated endpoint/link/rule credentials', async () => {
  reset(false, { mongoEndpoints: [endpoint(0), endpoint(1)], deploymentLinks: [link(0), link(1)] });
  await users.getUserMongoEndpoints('owner');
  const { accountConfigurationId } = await import('./accountConfiguration');
  const corrupt = (family: any, id: string) => {
    rows.find(row => row.shareId === accountConfigurationId('owner', family, id)).secure = new Binary(Buffer.from('{}'));
  };
  corrupt('mongo-endpoint', 'endpoint-1'); corrupt('deployment-link', 'link-1');
  corrupt('deployment-path-rule', JSON.stringify(['link-1', 0]));
  assert.equal((await users.getUserMongoEndpoint('owner', 'endpoint-0'))?.id, 'endpoint-0');
  assert.equal((await users.getUserDeploymentLink('owner', 'link-0'))?.pathRules.length, 70);
  await assert.rejects(users.getUserMongoEndpoint('owner', 'endpoint-1'), /cannot be unlocked/);
  await assert.rejects(users.getUserDeploymentLink('owner', 'link-1'), /cannot be unlocked/);
});

test('path-rule replacement is relational, complete and deletion-safe', async () => {
  reset(false, { deploymentLinks: [link(0)] }); await users.getUserDeploymentLinks('owner');
  const rules = Array.from({ length: 125 }, (_, n) => ({ path: `things/replacement-${n}`, mode: 'pull' as const }));
  const updated = await users.updateUserDeploymentLink('owner', 'link-0', { pathRules: rules });
  assert.equal(updated?.pathRules.length, 125);
  assert.equal((await users.getUserDeploymentLink('owner', 'link-0'))?.pathRules.length, 125);
  assert.equal(rows.filter(row => row.crystal.family === 'deployment-path-rule').length, 125);
  await users.updateUserDeploymentLink('owner', 'link-0', { pathRules: [] });
  assert.equal((await users.getUserDeploymentLink('owner', 'link-0'))?.pathRules.length, 0);
  assert.equal(rows.filter(row => row.crystal.family === 'deployment-path-rule').length, 0);
});


test('corrupt private account envelopes refuse migration without replacing source bytes', async () => {
  reset(); owner.secure = new Binary(Buffer.from('{invalid'));
  await assert.rejects(users.getUserMongoEndpoints('owner'), /could not be unlocked/);
  assert.equal(rows.length, 0);
  reset(false, []);
  await assert.rejects(users.getUserMongoEndpoints('owner'), /metadata is invalid/);
  assert.equal(rows.length, 0);
});


test('unknown migration markers never revive obsolete embedded configuration', async () => {
  for (const marker of [false, 2, 'future', null]) {
    reset(false, { [ACCOUNT_CONFIG_MARKER]: marker, mongoEndpoints: [endpoint(0)], deploymentLinks: [link(0)] });
    await assert.rejects(users.getUserMongoEndpoints('owner'), /unsupported migration marker/);
    await assert.rejects(users.getUserDeploymentLink('owner', 'link-0'), /unsupported migration marker/);
    assert.equal(rows.length, 0);
  }
});
