import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { H3 } from 'nitro/h3';

// Everything below is a disposable synthetic fixture. The OS-denied test runner
// prohibits any provider, gateway or database connection outside mocked fetch.
const gateway = 'https://gateway.test', frontend = 'https://branch.test', secondFrontend = 'https://other-branch.test';
const dataEnvironment = 'relay-data';
process.env.JWT_SECRET = randomBytes(32).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.THINGTIME_DATA_ENV = `custom:${dataEnvironment}`;
process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = gateway;
process.env.THINGTIME_MONGODB_CONNECTION_MODE = 'proxy';
process.env.THINGTIME_GATEWAY_ENVIRONMENT = 'preview'; // Deliberately not the data-environment ID.
process.env.THINGTIME_GATEWAY_ORIGIN = gateway;
process.env.THINGTIME_GATEWAY_SECRET = randomBytes(48).toString('base64url');
process.env.THINGTIME_GATEWAY_DEPLOYMENT_ID = 'owner';
process.env.THINGTIME_GATEWAY_SOURCE_ORIGINS = `${frontend},${secondFrontend}`;
const spent = new Set<string>(), sessions = new Set<string>();
const sessionDocs = new Map<string, any>();
let vaultReads: string[] = [];
let vaultOrigins: string[] = [frontend, secondFrontend];
const clientFor = (origin: string) => origin === frontend ? 'synthetic-client-a' : 'synthetic-client-b';
mock.module(new URL('../admin/integrations.ts', import.meta.url).href, { namedExports: {
  readAdminAutomationSecret: async (label: string) => {
    vaultReads.push(label);
    assert.equal(label, 'connections-google-oauth');
    return JSON.stringify({ environments: { [dataEnvironment]: { origins: Object.fromEntries(vaultOrigins.map(origin => [origin, {
      clientId: clientFor(origin), clientSecret: `synthetic-secret-${clientFor(origin)}`,
      redirectUri: `${origin}/api/v1/connections/oauth/callback`
    }])) } } });
  }
} });
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: {
  getCurrentUser: async (request: Request) => {
    const token = await getAuthToken(request), claims = token ? await verifyJwt(token) : null;
    return claims && sessions.has(claims.jti) ? { id: claims.sub, username: claims.sub, accountKind: 'user' } : null;
  }
} });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
  enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({})
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
    getThingsCollection: async () => collection,
    getSessionsCollection: async () => ({
      findOne: async ({ jti }: any) => sessions.has(jti) ? sessionDocs.get(jti) ?? null : null,
      updateOne: async (query: any, update: any) => {
        const session = sessions.has(query.jti) ? sessionDocs.get(query.jti) : null;
        if (!session || session.userId !== query.userId || session.revokedAt) return { matchedCount: 0 };
        Object.assign(session, update.$set); return { matchedCount: 1 };
      }
    }),
    withIndexReadinessRequest: (work: () => unknown) => work(),
    getAuthOtpsCollection: async () => ({ insertOne: async (doc: any) => {
      if (spent.has(doc.challenge)) throw Object.assign(new Error('duplicate'), { code: 11000 });
      spent.add(doc.challenge);
    } })
  }
});

const { signJwt, verifyJwt } = await import('../auth/jwt.ts');
const { getAuthToken } = await import('../auth/authCookie.ts');
const { withVaultRequest } = await import('../auth/vaultRequest.ts');
const { toBin } = await import('../auth/users.ts');
const { connectionProviderById } = await import('./providers.ts');
const { listConnections, resolveConnectionCredential } = await import('./connections.ts');
const { unpackConnectionTokens } = await import('./tokenVault.ts');
const { getDeploymentDataEnvironment } = await import('../deployment/dataEnvironment.ts');
const { thingtimeCapabilityManifest } = await import('../capabilities/thingtimeCapabilities.ts');
const { createGatewayAuthority, getGatewaySettings } = await import('../deployment/environmentGateway.ts');
const { proxyEnvironmentRequest } = await import('../../../../server/utils/environmentGateway.ts');
const { default: middleware } = await import('../../../../server/middleware/environment-gateway.ts');
const beginRoute = await import('../../../routes/api/v1/connections/oauth/begin/_begin.tsx');
const callbackRoute = await import('../../../routes/api/v1/connections/oauth/callback/_callback.tsx');
const requestRoute = await import('../../../routes/api/v1/connections/request/_request.tsx');
const provider = connectionProviderById('google')!;
let exchanges = 0, refreshes = 0;
let holdRefresh: (() => Promise<void>) | undefined;
provider.oauth!.exchangeCode = async input => {
  exchanges++;
  const origin = new URL(input.redirectUri).origin;
  assert.ok(vaultOrigins.includes(origin)); assert.notEqual(origin, gateway);
  assert.equal(input.clientId, clientFor(origin));
  assert.equal(input.clientSecret, `synthetic-secret-${clientFor(origin)}`);
  assert.equal(input.redirectUri, `${origin}/api/v1/connections/oauth/callback`);
  return { ok: true, tokens: { accessToken: `synthetic-access-${input.code}`, refreshToken: `synthetic-refresh-${input.code}`,
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(), scopes: ['openid'] } };
};
provider.oauth!.resolveAccountFromTokens = async tokens => ({ ok: true, account: {
  providerAccountId: 'synthetic-google-account', displayName: 'Synthetic account', handle: 'fixture@example.test',
  profileUrl: null, avatarUrl: null, config: {}
} });
provider.oauth!.refreshTokens = async (tokens, creds) => {
  refreshes++;
  assert.equal(creds.clientId, clientFor(tokens.oauthOrigin!));
  assert.equal(creds.clientSecret, `synthetic-secret-${creds.clientId}`);
  assert.equal(tokens.oauthEnvironment, getDeploymentDataEnvironment()!.id);
  await holdRefresh?.();
  return { accessToken: `synthetic-rotated-${tokens.refreshToken}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString() };
};
const app = new H3().use(middleware).all('/api/**', event => withVaultRequest(event.req, async () => {
  assert.ok([frontend, secondFrontend].includes(new URL(event.req.url).origin));
  assert.equal(event.req.headers.get('x-forwarded-host'), new URL(event.req.url).host);
  const path = new URL(event.req.url).pathname;
  if (path.endsWith('/oauth/begin')) return beginRoute.action({ request: event.req });
  if (path.endsWith('/oauth/callback')) return callbackRoute.loader({ request: event.req });
  if (path.endsWith('/request')) return requestRoute.action({ request: event.req });
  return new Response(null, { status: 404 });
}));
const manifest = () => thingtimeCapabilityManifest(gateway);
const installTransport = (t: any) => t.mock.method(globalThis, 'fetch', async (url: URL | string, init: RequestInit) => {
  const target = new URL(String(url)); assert.equal(target.origin, gateway);
  if (target.pathname === '/.well-known/thingtime-capabilities.json') return Response.json(manifest());
  return app.fetch(new Request(url, init));
});
const identity = async (owner: string, session = `session-${owner}`) => {
  sessions.add(session);
  sessionDocs.set(session, { jti: session, userId: owner, purpose: 'browser', revokedAt: null, expiresAt: new Date(Date.now() + 3_600_000) });
  const token = await signJwt({ sub: owner, jti: session });
  return { owner, session, token };
};
const send = async (actor: Awaited<ReturnType<typeof identity>>, path: string, body?: unknown, origin = frontend) => {
  const settings = { ...getGatewaySettings()!, deploymentId: 'follower' };
  const authority = await createGatewayAuthority({ settings: () => settings, fetch: async () => Response.json(manifest()) }).current();
  return proxyEnvironmentRequest(new Request(origin + path, { method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${actor.token}`, origin, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) }), authority!);
};
const start = async (actor: Awaited<ReturnType<typeof identity>>, origin = frontend) => {
  const response = await send(actor, '/api/v1/connections/oauth/begin', { provider: 'google', expectedOwnerId: actor.owner }, origin);
  assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.ok, true);
  const authorize = new URL(result.authorizeUrl);
  assert.equal(authorize.searchParams.get('redirect_uri'), `${origin}/api/v1/connections/oauth/callback`);
  assert.equal(authorize.searchParams.get('client_id'), clientFor(origin));
  return authorize.searchParams.get('state')!;
};
const finish = (actor: Awaited<ReturnType<typeof identity>>, state: string, origin = frontend) =>
  send(actor, `/api/v1/connections/oauth/callback?state=${encodeURIComponent(state)}&code=synthetic-code`, undefined, origin);
const link = async (actor: Awaited<ReturnType<typeof identity>>, origin = frontend) => {
  const state = await start(actor, origin), response = await finish(actor, state, origin);
  assert.equal(response.status, 302); assert.equal(response.headers.get('location'), '/connections?connected=google');
  const result = await listConnections({ id: actor.owner, username: actor.owner });
  assert.equal(result.connections.length, 1);
  return result.connections[0];
};
beforeEach(() => {
  docs = ['owner-a', 'owner-b'].map(shareId => ({ shareId, thingtime: ['user'], secureVersion: 0,
    secure: toBin(JSON.stringify({ passwordHash: 'synthetic-hash', meta: {} })) }));
  spent.clear(); sessions.clear(); sessionDocs.clear(); exchanges = 0; refreshes = 0; holdRefresh = undefined;
  vaultReads = []; vaultOrigins = [frontend, secondFrontend];
  delete process.env.CONNECTIONS_OAUTH_REDIRECT_BASE;
  process.env.THINGTIME_DATA_ENV = `custom:${dataEnvironment}`;
});

test('relayed begin/callback preserves frontend callback and exact data-environment grant binding', async t => {
  installTransport(t);
  const actor = await identity('owner-a'), state = await start(actor);
  const callback = await finish(actor, state);
  assert.equal(callback.status, 302); assert.equal(callback.headers.get('location'), '/connections?connected=google');
  const account = docs.find(doc => doc.thingtime.includes('external-account'));
  const tokens = (await unpackConnectionTokens(account))!;
  assert.equal(tokens.oauthOrigin, frontend); assert.equal(tokens.oauthEnvironment, dataEnvironment);
  assert.equal(tokens.clientId, clientFor(frontend)); assert.ok(tokens.oauthBinding);
  assert.notEqual(tokens.oauthEnvironment, process.env.THINGTIME_GATEWAY_ENVIRONMENT);
  assert.equal((await finish(actor, state)).headers.get('location'), '/connections?oauthError=state');
  assert.equal(exchanges, 1); assert.equal(spent.size, 1); assert.ok(vaultReads.length > 0);
});

test('relayed callback rejects wrong account, session, frontend and revoked session before exchange', async t => {
  installTransport(t);
  const actor = await identity('owner-a'), other = await identity('owner-b'), secondSession = await identity('owner-a', 'second-session');
  const state = await start(actor);
  for (const candidate of [other, secondSession]) assert.equal((await finish(candidate, state)).headers.get('location'), '/connections?oauthError=session');
  assert.equal((await finish(actor, state, secondFrontend)).headers.get('location'), '/connections?oauthError=state');
  sessions.delete(actor.session);
  assert.equal((await finish(actor, state)).headers.get('location'), '/login');
  assert.equal(exchanges, 0); assert.equal(spent.size, 0);
});

test('gateway-only vault origins and a gateway environment name cannot authorize frontend OAuth', async t => {
  installTransport(t);
  const actor = await identity('owner-a');
  vaultOrigins = [gateway];
  assert.equal((await send(actor, '/api/v1/connections/oauth/begin', { provider: 'google' })).status, 503);
  vaultOrigins = [frontend]; process.env.THINGTIME_DATA_ENV = 'custom:preview';
  assert.equal((await send(actor, '/api/v1/connections/oauth/begin', { provider: 'google' })).status, 503);
  assert.equal(exchanges, 0); assert.equal(spent.size, 0);
});

test('relayed concurrent refresh uses one rotating grant and keeps owners and frontend grants independent', async t => {
  installTransport(t);
  const actor = await identity('owner-a'), other = await identity('owner-b');
  const first = await link(actor), second = await link(other, secondFrontend);
  const firstAccount = docs.find(doc => doc.shareId === first.account.id);
  const { packConnectionTokens } = await import('./tokenVault.ts');
  const prior = (await unpackConnectionTokens(firstAccount))!;
  firstAccount.secure = await packConnectionTokens(actor.owner, firstAccount.shareId, { ...prior, expiresAt: new Date(0).toISOString() });
  let release!: () => void, entered!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  holdRefresh = () => { entered(); return new Promise<void>(resolve => { release = resolve; }); };
  const body = { connectionId: first.id, operation: 'account.profile' };
  const pending = send(actor, '/api/v1/connections/request', body);
  await waiting;
  const duplicate = await send(actor, '/api/v1/connections/request', body);
  assert.equal(duplicate.status, 401); assert.equal(refreshes, 1);
  const foreign = await send(other, '/api/v1/connections/request', body, secondFrontend);
  assert.equal(foreign.status, 404);
  const independent = await send(other, '/api/v1/connections/request', { connectionId: second.id, operation: 'account.profile' }, secondFrontend);
  assert.equal(independent.status, 200);
  release(); const response = await pending; assert.equal(response.status, 200);
  const serialized = JSON.stringify(await response.json());
  assert.equal(serialized.includes('synthetic-access'), false); assert.equal(serialized.includes('synthetic-refresh'), false);
  const refreshed = await withVaultRequest(new Request(frontend), () => resolveConnectionCredential({ id: actor.owner, username: actor.owner }, first.id));
  assert.ok(refreshed.ok); assert.equal(refreshed.tokens.oauthOrigin, frontend); assert.equal(refreshed.tokens.oauthEnvironment, dataEnvironment);
  assert.equal(refreshed.tokens.refreshToken, prior.refreshToken); assert.equal(refreshes, 1);
});
