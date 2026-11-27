import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { beforeEach, mock, test } from 'node:test';
let docs: any[] = [], writtenBatches: number[] = [];
let sessions: any[] = [], failWrites = false, revokedApp = false;
const matches = (doc: any, query: any): boolean => Object.entries(query).every(([key, expected]: any) => {
  if (key === '$or') return expected.some((part: any) => matches(doc, part));
  const value = key.split('.').reduce((at, part) => at?.[part], doc);
  if (expected && typeof expected === 'object' && '$in' in expected) return expected.$in.includes(value);
  if (expected && typeof expected === 'object' && '$gt' in expected) return value > expected.$gt;
  if (value instanceof Date && expected instanceof Date) return value.getTime() === expected.getTime();
  return Array.isArray(value) ? value.includes(expected) : value === expected;
});
const collection: any = {
  find(query: any) {
    let order: any = null, maximum = Infinity;
    const rows = () => {
      const result = docs.filter(doc => matches(doc, query));
      if (order) result.sort((a,b) => { for (const [key,direction] of Object.entries(order) as [string,number][]) { if (a[key] < b[key]) return -direction; if (a[key] > b[key]) return direction; } return 0; });
      return result.slice(0, maximum);
    };
    const cursor = { project: () => cursor, batchSize: () => cursor,
      sort: (value: any) => { order = value; return cursor; }, limit: (value: number) => { maximum = value; return cursor; },
      toArray: async () => rows(), async *[Symbol.asyncIterator]() { yield* rows(); } };
    return cursor;
  },
  findOne: async (query: any) => docs.find(doc => matches(doc, query)) || null,
  insertMany: async (rows: any[], options: any) => {
    assert.equal(options.session, transaction);
    if (failWrites) throw new Error('synthetic storage refusal');
    writtenBatches.push(rows.length);
    for (const row of rows) { assert.ok(!docs.some(doc => doc.shareId === row.shareId)); docs.push(row); }
  }
};
const transaction = {};
const sessionCollection = {
  insertOne: async (doc: any) => { sessions.push(doc); },
  findOne: async (query: any) => sessions.find(doc => matches(doc, query)) || null,
  find(query: any) { const cursor = { sort: () => cursor, limit: () => cursor, toArray: async () => sessions.filter(doc => matches(doc,query)) }; return cursor; },
  updateMany: async () => {},
  findOneAndUpdate: async (query: any, patch: any) => { const doc = sessions.find(row => matches(row,query)); if (!doc) return null; const previous = structuredClone(doc); doc.revokedAt = patch.$set.revokedAt; return previous; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: {
  getThingsCollection: async () => collection, getHomeThingsCollection: async () => collection,
  getSessionsCollection: async () => sessionCollection,
  withHomeMongoTransaction: async (work: any) => { const priorDocs = [...docs], priorSessions = [...sessions]; try { return await work(transaction); } catch(error) { docs = priorDocs; sessions = priorSessions; throw error; } }
} });
mock.module(new URL('../auth/jwt.ts', import.meta.url).href, { namedExports: {
  signJwt: async (claims: any) => `synthetic-token:${claims.jti}`,
  verifyJwt: async (token: string) => token.startsWith('synthetic-token:') ? {jti:token.slice('synthetic-token:'.length),sub:'synthetic-owner'} : null
} });
mock.module(new URL('../auth/users.ts', import.meta.url).href, { namedExports: { findUserById: async () => ({_id:'synthetic-owner'}), toPublicUserWithStorage: async () => ({id:'synthetic-owner'}) } });
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { serviceAccountAuthenticationAllowed: () => true } });
mock.module(new URL('../auth/characterSession.ts', import.meta.url).href, { namedExports: { characterAccountLive: async () => true } });
mock.module(new URL('./apps.ts', import.meta.url).href, { namedExports: { findAppByClientId: async () => ({}), appAllowsTokenAudience: () => true, appAllowsDesktopRedirect: () => true, appIsRevoked: () => revokedApp } });
mock.module(new URL('./sandbox.ts', import.meta.url).href, { namedExports: { sandboxPublicUser: () => ({id:'synthetic-owner'}) } });
const { sanitizeSharedThings, storeSessionSharedThings, getSessionSharedThings, SESSION_RESOURCE_GRANT_KIND } = await import('./sharedThings.ts');
const owner = 'synthetic-owner', expiry = new Date(Date.now() + 100000);
const resources = (count: number) => Array.from({ length: count }, (_, i) => ({ shareId: `resource-${String(i).padStart(4,'0')}`, ownerId: owner, thingtime: ['data'], crystal: { index: i }, createdAt: new Date(i), updatedAt: new Date(i) }));
beforeEach(() => { docs = resources(251); writtenBatches = []; sessions = []; failWrites = false; revokedApp = false; });

test('consent validates more than100 ordinary owned Things and grants persist as bounded relational writes', async () => {
  const ids = docs.map(doc => doc.shareId);
  const result = await sanitizeSharedThings(owner, [...ids, ids[0]]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.sharedThings.length, 251);
  await storeSessionSharedThings(collection, owner, 'session', expiry, result.sharedThings, transaction);
  assert.deepEqual(writtenBatches, [100,100,51]);
  const grants = docs.filter(doc => doc.thingtime.includes(SESSION_RESOURCE_GRANT_KIND));
  assert.equal(grants.length,251);
  assert.ok(grants.every(doc => doc.targetId === 'session' && doc.expiresAt === expiry && doc.storageClass === 'control'));
  let cursor: string | null = null;
  const found = new Set<string>();
  do {
    const page = await getSessionSharedThings(owner, 'session', null, { cursor });
    for (const thing of page.things) found.add(thing.shareId);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(found.size,251);
});

test('relational grant membership remains session/owner/resource bound and ownership is rechecked', async () => {
  await storeSessionSharedThings(collection, owner, 'session', expiry, ['resource-0001'], transaction);
  assert.equal((await getSessionSharedThings(owner, 'session', null, { id: 'resource-0001' })).things.length,1);
  assert.equal((await getSessionSharedThings(owner, 'other-session', null, { id: 'resource-0001' })).things.length,0);
  assert.equal((await getSessionSharedThings('other-owner', 'session', null, { id: 'resource-0001' })).things.length,0);
  docs.find(doc => doc.shareId === 'resource-0001').ownerId = 'other-owner';
  assert.equal((await getSessionSharedThings(owner, 'session', null, { id: 'resource-0001' })).things.length,0);
  assert.equal((await getSessionSharedThings(owner, 'session', null, { id: 'resource-0002' })).things.length,0);
});

test('an authoritative empty relational grant set does not resurrect legacy selections', async () => {
  assert.equal((await getSessionSharedThings(owner, 'empty', null)).things.length,0);
  assert.equal((await getSessionSharedThings(owner, 'legacy', ['resource-0001'])).things.length,1);
  assert.equal((await sanitizeSharedThings(owner, ['not-owned'])).ok,false);
  docs.push({ shareId:'vault', ownerId:owner, thingtime:['password-manager-entry'], crystal:{} });
  assert.equal((await sanitizeSharedThings(owner, ['vault'])).ok,false);
});

test('desktop code grants copy in batches and mismatch fails closed', async () => {
  const ids = docs.map(doc => doc.shareId);
  await storeSessionSharedThings(collection, owner, 'code', expiry, ids, transaction);
  await storeSessionSharedThings(collection, owner, 'app', expiry, { sessionId:'code',count:251 }, transaction);
  assert.equal(docs.filter(doc => doc.targetId === 'app').length,251);
  assert.ok(writtenBatches.every(size => size <=100));
  await assert.rejects(storeSessionSharedThings(collection, owner, 'invalid', expiry, {sessionId:'missing',count:1},transaction), /changed during authorization/);
});

const { issueAppToken, resolveAppToken } = await import('./appTokens.ts');
test('app issuance atomically stores session and grants; live token/session/app revocation stays authoritative', async () => {
  const ids = docs.map(doc => doc.shareId);
  const grant = await issueAppToken(owner, 'client', 'https://client.test', ['things'], ids);
  assert.equal(grant.sharedThingCount, 251);
  assert.equal(sessions.length,1);
  assert.equal(sessions[0].meta.sharedThings,undefined);
  assert.equal(sessions[0].meta.sharedThingsVersion,1);
  const request = new Request('https://thingtime.test/api/v1/oauth/shared', {headers:{Authorization:`Bearer ${grant.token}`}});
  const context = await resolveAppToken(request);
  assert.equal(context?.sharedThingCount,251);
  assert.deepEqual(context?.sharedThings,[]);
  sessions[0].revokedAt = new Date();
  assert.equal(await resolveAppToken(request),null);
  sessions[0].revokedAt = null; sessions[0].expiresAt = new Date(0);
  assert.equal(await resolveAppToken(request),null);
  sessions[0].expiresAt = new Date(Date.now()+100000); revokedApp = true;
  assert.equal(await resolveAppToken(request),null);
  const beforeDocs = docs.length, beforeSessions = sessions.length;
  failWrites = true;
  await assert.rejects(issueAppToken(owner,'client','https://client.test',['things'],ids), /storage refusal/);
  assert.equal(sessions.length,beforeSessions);
  assert.equal(docs.length,beforeDocs);
});

const { issueDesktopAuthorizationCode, exchangeDesktopAuthorizationCode } = await import('./desktopOAuth.ts');
test('desktop code retains251 relational grants through PKCE exchange and is consumed once', async () => {
  const verifier = 'a'.repeat(43), redirectUri = 'http://127.0.0.1:8432/callback';
  const issued = await issueDesktopAuthorizationCode(owner,{clientId:'client',redirectUri,origin:'http://127.0.0.1:8432',codeChallenge:createHash('sha256').update(verifier).digest('base64url'),scopes:['things'],sharedThings:docs.map(doc=>doc.shareId)});
  assert.equal(sessions[0].meta.sharedThings,undefined);
  const request = {code:issued.code,clientId:'client',redirectUri,codeVerifier:verifier};
  const result = await exchangeDesktopAuthorizationCode(request);
  assert.equal(result.ok,true);
  if (result.ok) assert.equal(result.grant.sharedThingCount,251);
  assert.equal(sessions.filter(doc=>doc.purpose==='app').length,1);
  assert.equal((await exchangeDesktopAuthorizationCode(request)).ok,false);
});
