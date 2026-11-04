// Real Request handlers, accounts, sessions, vault encryption and transactions.
// Only the external Google exchange/profile adapter is synthetic.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { tmpdir } from 'node:os';
const report = console.log.bind(console);
console.log = () => {}; console.warn = () => {}; console.error = () => {};
try {
  const directory = await realpath(process.env.CONNECTIONS_TEST_DIRECTORY || '');
  assert.equal(dirname(directory), await realpath(tmpdir()));
  assert.ok(basename(directory).startsWith('thingtime-connections-oauth-'));
  assert.equal((await stat(directory)).mode & 0o077, 0);
  assert.match(process.env.MONGODB_CONNECTION_STRING || '', /^mongodb:\/\/127\.0\.0\.1:\d+\/thingtime\?replicaSet=connections-oauth$/);
  const base = 'http://127.0.0.1:28147';
  process.env.APP_URL = base;
  process.env.JWT_SECRET = randomBytes(32).toString('base64url');
  process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
  process.env.THINGTIME_ADMIN_VAULT_KEY = randomBytes(32).toString('base64url');
  process.env.THINGTIME_DATA_ENV = 'custom:oauth-integration';
  process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = base;
  const register = await import('../app/routes/api/v1/auth/register/_register');
  const accounts = await import('../app/routes/api/v1/connections/_connections');
  const begin = await import('../app/routes/api/v1/connections/oauth/begin/_begin');
  const callback = await import('../app/routes/api/v1/connections/oauth/callback/_callback');
  const feed = await import('../app/routes/api/v1/connections/feed/_feed');
  const unlink = await import('../app/routes/api/v1/connections/unlink/_unlink');
  const integrations = await import('../app/routes/api/v1/admin/integrations/_integrations');
  const { connectionProviderById } = await import('../app/api/utils/connections/providers');
  const { resolveConnectionCredential } = await import('../app/api/utils/connections/connections');
  const { withVaultRequest, vaultRequest } = await import('../app/api/utils/auth/vaultRequest');
  const request = (path: string, cookie = '', body?: unknown, origin = base) => new Request(origin + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  async function call(handler: any, path: string, cookie = '', body?: unknown, origin = base) {
    const response: Response = await handler({ request: request(path, cookie, body, origin) });
    const data = response.headers.get('content-type')?.includes('json') ? await response.json() : null;
    return { response, data };
  }
  async function identity() {
    const username = 'oauth-' + randomUUID().slice(0, 8);
    const result = await call(register.action, '/api/v1/auth/register', '', { username, email: username + '@example.test', password: randomBytes(32).toString('base64url') + '!Aa1' });
    assert.equal(result.response.status, 200, 'Registration status');
    return { id: result.data.user.id, username, cookie: result.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ') };
  }
  const owner = await identity(), other = await identity();
  process.env.ADMIN_USERNAMES = owner.username;
  const configured = await call(integrations.action, '/api/v1/admin/integrations', owner.cookie, { action: 'create-secret', label: 'connections-google-oauth', value: JSON.stringify({ environments: { 'oauth-integration': { origins: { [base]: { clientId: 'synthetic-client', clientSecret: 'synthetic-client-secret', redirectUri: base + '/api/v1/connections/oauth/callback' } } } } }) });
  assert.equal(configured.response.status, 200, 'Platform vault configuration status');
  const provider = connectionProviderById('google')!;
  let externalId = 'google-one', exchanges = 0;
  provider.oauth!.exchangeCode = async () => {
    assert.ok(vaultRequest(), 'Real callback route must install the request vault context');
    exchanges++;
    return { ok: true, tokens: { accessToken: 'synthetic-access-' + externalId, refreshToken: 'synthetic-refresh-' + externalId, expiresAt: new Date(Date.now() + 3600000).toISOString(), scopes: ['openid', 'email'] } };
  };
  provider.oauth!.resolveAccountFromTokens = async () => ({ ok: true, account: { providerAccountId: externalId, displayName: externalId, handle: externalId + '@example.test', avatarUrl: null, profileUrl: null, config: {} } });
  async function connect(user: typeof owner) {
    const started = await call(begin.action, '/api/v1/connections/oauth/begin', user.cookie, { provider: 'google' });
    assert.equal(started.response.status, 200, 'OAuth begin status');
    const state = new URL(started.data.authorizeUrl).searchParams.get('state')!;
    const path = '/api/v1/connections/oauth/callback?' + new URLSearchParams({ state, code: 'synthetic-code' });
    const completed = await call(callback.loader, path, user.cookie);
    assert.equal(completed.response.status, 302, 'OAuth callback redirect');
    assert.ok(completed.response.headers.get('location')?.includes('connected=google'), 'OAuth callback completion');
    const count = exchanges;
    const replay = await call(callback.loader, path, user.cookie);
    assert.ok(replay.response.headers.get('location')?.includes('oauthError=state'), 'Callback replay refused');
    assert.equal(exchanges, count, 'Replay never exchanges again');
  }
  await connect(owner); externalId = 'google-two'; await connect(owner);
  externalId = 'google-one'; await connect(other);
  const first = (await call(accounts.loader, '/api/v1/connections', owner.cookie)).data.connections;
  const second = (await call(accounts.loader, '/api/v1/connections', other.cookie)).data.connections;
  assert.equal(first.length, 2); assert.equal(second.length, 1);
  assert.ok(first.every((connection: any) => connection.credentialStatus === 'connected'));
  assert.ok(first.every((connection: any) => connection.account.id !== second[0].account.id), 'Owner-specific external identities');
  assert.equal(JSON.stringify(first).includes('synthetic-access'), false, 'No token projection');
  const original = first.find((connection: any) => connection.account.handle === 'google-one@example.test');
  const unbound = await withVaultRequest(request('/api/v1/connections', owner.cookie, undefined, 'http://127.0.0.1:28148'), () => resolveConnectionCredential(owner, original.id));
  assert.equal(unbound.ok, false, 'Cross-origin credential reuse refused');
  // Traverse the real feed handler on the wrong origin and demand its context
  // survives all the way into configuration resolution before a provider pull.
  let pulls = 0;
  const originalGoogle = provider.accountOnly; provider.accountOnly = false;
  const savedFetch = provider.fetchFeed;
  provider.fetchFeed = async () => { pulls++; return { ok: true, items: [] }; };
  const wrongFeed = await call(feed.loader, '/api/v1/connections/feed?sync=force&connection=' + original.id, owner.cookie, undefined, 'http://127.0.0.1:28148');
  assert.equal(wrongFeed.response.status, 200, 'Wrong-origin feed still returns cached data');
  assert.ok(wrongFeed.data.synced.some((item: any) => item.error?.includes('reconnect')), 'Wrong-origin feed reports its unavailable grant');
  assert.equal(pulls, 0, 'Wrong-origin real feed route must never call provider');
  provider.accountOnly = originalGoogle; provider.fetchFeed = savedFetch;
  const denied = await call(unlink.action, '/api/v1/connections/unlink', other.cookie, { id: original.id });
  assert.equal(denied.response.status, 404);
  assert.equal((await call(unlink.action, '/api/v1/connections/unlink', owner.cookie, { id: original.id })).response.status, 200);
  assert.equal((await call(accounts.loader, '/api/v1/connections', owner.cookie)).data.connections.length, 1);
  assert.equal((await call(accounts.loader, '/api/v1/connections', other.cookie)).data.connections.length, 1);
  report(JSON.stringify({ connectionsOAuthProof: true, api: 'unmodified Request handlers', storage: 'disposable replica transactions', provider: 'synthetic exchange/profile only', owners: 2, ownerAccounts: [2, 1], replayRejected: true, wrongOriginFeedRejected: true, ownerOnlyDisconnect: true }));
  process.exit(0);
} catch (error: any) {
  // Assertions use status/booleans, never fixture secrets or cookies.
  report('CONNECTIONS_TEST_FAILURE ' + String(error?.message || 'unknown').slice(0, 500));
  process.exit(1);
}
