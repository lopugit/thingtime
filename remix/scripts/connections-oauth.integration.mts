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
  const genericThings = await import('../app/routes/api/v1/things/_things');
  const namedRoute = await import('../app/routes/api/v1/connections/named/_named');
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
  let externalId = 'google-one', exchanges = 0, granted = ['openid', 'email'], expirationDelay = 3600000;
  provider.oauth!.exchangeCode = async ({ code }) => {
    assert.ok(vaultRequest(), 'Real callback route must install the request vault context');
    exchanges++;
    return { ok: true, tokens: { accessToken: 'synthetic-access-' + code, refreshToken: 'synthetic-refresh-' + code, expiresAt: new Date(Date.now() + expirationDelay).toISOString(), scopes: granted, confirmedScopes: granted } };
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
  const namedList = async (identity = owner) => (await call(accounts.loader, '/api/v1/connections?includeNamed=1', identity.cookie)).data.connections
    .filter((connection: any) => connection.named);
  const use = (id: string, operation: string, identity = owner) => call(namedRoute.action, '/api/v1/connections/named', identity.cookie,
    { id, operation, expectedOwnerId: identity.id });
  const startNamed = async (name: string, allowedOperations: string[], reconnectId?: string, requestId = randomUUID(), actor = owner) => {
    const started = await call(begin.action, '/api/v1/connections/oauth/begin', actor.cookie,
      { provider: 'google', named: { requestId, name, allowedOperations, ...(reconnectId ? { reconnectId } : {}) } });
    assert.equal(started.response.status, 200, 'Named OAuth begin');
    const authorize = new URL(started.data.authorizeUrl);
    const claims = JSON.parse(Buffer.from(authorize.searchParams.get('state')!.split('.')[1], 'base64url').toString('utf8'));
    assert.equal(JSON.stringify(claims).includes(name), false, 'Private label stays out of external OAuth state');
    assert.equal(authorize.searchParams.get('include_granted_scopes'), null);
    return authorize;
  };
  const finishNamed = (authorize: URL, code: string, actor = owner) => call(callback.loader,
    '/api/v1/connections/oauth/callback?' + new URLSearchParams({ state: authorize.searchParams.get('state')!, code }), actor.cookie);
  const success = async (name: string, ops: string[], code: string, id?: string, actor = owner) => {
    const started = await startNamed(name, ops, id, randomUUID(), actor);
    assert.match((await finishNamed(started, code, actor)).response.headers.get('location') || '', /connected=google/);
    return started;
  };
  const scopeOwner = await identity();
  const driveMetadata = 'https://www.googleapis.com/auth/drive.metadata.readonly';
  const namedDrive = await call(begin.action, '/api/v1/connections/oauth/begin', scopeOwner.cookie,
    { provider: 'google-drive', named: { requestId: randomUUID(), name: 'Drive metadata', allowedOperations: ['account.identity'], requestedScopes: [driveMetadata] } });
  assert.equal(namedDrive.response.status, 200);
  assert.equal(new URL(namedDrive.data.authorizeUrl).searchParams.get('scope'), 'openid ' + driveMetadata);
  const wrongDriveScope = await call(begin.action, '/api/v1/connections/oauth/begin', scopeOwner.cookie,
    { provider: 'google-drive', named: { requestId: randomUUID(), name: 'Cross service', allowedOperations: ['account.identity'],
      requestedScopes: ['https://www.googleapis.com/auth/gmail.readonly'] } });
  assert.equal(wrongDriveScope.response.status, 400);
  externalId = 'google-one';
  granted = ['openid', 'profile'];
  const started = await success('Profile use', ['google.profile'], 'profile-one');
  assert.equal(started.searchParams.get('scope'), 'openid profile');
  const profile = (await namedList())[0];
  granted = ['openid', 'email'];
  await success('Email use', ['google.email'], 'email-one');
  const email = (await namedList()).find((item: any) => item.named.name === 'Email use');
  assert.ok(email && email.id !== profile.id && email.account.id === profile.account.id);
  assert.deepEqual(email.account, { id: profile.account.id, handle: '', displayName: '', avatarUrl: null, profileUrl: null },
    'Named list must not inherit metadata from another provider grant');
  const repeatedRequest = randomUUID();
  const firstDraft = await startNamed('Duplicate scope', ['google.email'], undefined, repeatedRequest);
  const retryDraft = await startNamed('Duplicate scope', ['google.email'], undefined, repeatedRequest);
  const concurrentlyCompleted = await Promise.all([finishNamed(firstDraft, 'dupe-one'), finishNamed(retryDraft, 'dupe-two')]);
  assert.equal(concurrentlyCompleted.filter(result => result.response.headers.get('location')?.includes('connected=google')).length, 1);
  assert.equal((await namedList()).length, 3, 'Same scope is allowed but a retry cannot create a duplicate');
  assert.equal((await call(accounts.loader, '/api/v1/connections', owner.cookie)).data.connections.length, 1, 'Legacy list is unchanged');
  assert.equal((await namedList(other)).length, 0);
  for (const protectedId of [email.id, email.account.id]) {
    assert.equal((await call(genericThings.loader, '/api/v1/things?id=' + protectedId, owner.cookie)).response.status, 404,
      'Neither named credentials nor private provider metadata have a generic read path');
  }
  assert.equal((await use(email.id, 'google.email', other)).response.status, 404);
  assert.equal((await use(profile.id, 'google.email')).response.status, 403);
  const realFetch = globalThis.fetch;
  let releaseOldUse!: () => void, enteredOldUse!: () => void;
  const oldUseStarted = new Promise<void>(resolve => { enteredOldUse = resolve; });
  const waitOldUse = new Promise<void>(resolve => { releaseOldUse = resolve; });
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://openidconnect.googleapis.com/v1/userinfo', 'Only the synthetic identity endpoint may be called');
    const header = new Headers(init?.headers).get('authorization');
    if (header === 'Bearer synthetic-access-retired') {
      enteredOldUse(); await waitOldUse;
      return Response.json({ sub: 'google-one', name: 'Stale profile must not be returned' });
    }
    assert.ok(header && ['Bearer synthetic-access-profile-one', 'Bearer synthetic-access-email-one', 'Bearer synthetic-access-profile-updated', 'Bearer synthetic-access-lease-refreshed'].includes(header),
      'Exactly selected credential reached the provider');
    return Response.json({ sub: 'google-one', name: 'Verified name', email: 'verified@example.test' });
  }) as typeof fetch;
  assert.deepEqual((await use(profile.id, 'google.profile')).data.result, { name: 'Verified name', picture: null });
  assert.deepEqual((await use(email.id, 'google.email')).data.result, { email: 'verified@example.test' });

  const reconnect = await startNamed('Profile updated', ['google.profile'], profile.id);
  externalId = 'google-two';
  granted = ['openid', 'profile'];
  assert.match((await finishNamed(reconnect, 'wrong-account')).response.headers.get('location') || '', /oauthError=/);
  assert.equal((await namedList()).find((item: any) => item.id === profile.id).named.name, 'Profile use');
  externalId = 'google-one';
  await success('Profile updated', ['google.profile'], 'profile-updated', profile.id);
  assert.equal((await namedList()).find((item: any) => item.id === profile.id).named.name, 'Profile updated');
  assert.deepEqual((await use(email.id, 'google.email')).data.result, { email: 'verified@example.test' });
  const partial = await startNamed('Partial must fail', ['google.profile', 'google.email']);
  assert.match((await finishNamed(partial, 'partial')).response.headers.get('location') || '', /oauthError=permissions/);
  assert.equal((await namedList()).length, 3);
  assert.equal((await call(unlink.action, '/api/v1/connections/unlink', owner.cookie, { id: profile.id })).response.status, 200);
  assert.equal((await use(profile.id, 'google.profile')).response.status, 404);
  assert.deepEqual((await use(email.id, 'google.email')).data.result, { email: 'verified@example.test' });
  const excluded = await call(feed.loader, '/api/v1/connections/feed?deferSync=1&connection=' + email.id, owner.cookie);
  assert.equal(excluded.response.status, 404, 'Named authorization does not grant a legacy feed');

  const refreshOwner = await identity();
  expirationDelay = 1;
  await success('Refresh race', ['google.profile'], 'lease-race', undefined, refreshOwner);
  const expiringProfile = (await namedList(refreshOwner)).find((item: any) => item.named.name === 'Refresh race');
  let releaseRefresh!: () => void, enteredRefresh!: () => void, refreshes = 0;
  const startedRefresh = new Promise<void>(resolve => { enteredRefresh = resolve; });
  const waitRefresh = new Promise<void>(resolve => { releaseRefresh = resolve; });
  provider.oauth!.refreshTokens = async () => {
    refreshes++;
    enteredRefresh();
    await waitRefresh;
    return { accessToken: 'synthetic-access-lease-refreshed', refreshToken: 'synthetic-rotated-lease',
      expiresAt: new Date(Date.now() + 3600000).toISOString(), confirmedScopes: ['openid', 'profile'] };
  };
  const winner = use(expiringProfile.id, 'google.profile', refreshOwner);
  await Promise.race([startedRefresh, winner.then(result => { throw new Error(`Refresh did not start (HTTP ${result.response.status})`); })]);
  assert.equal((await use(expiringProfile.id, 'google.profile', refreshOwner)).response.status, 401);
  releaseRefresh();
  assert.equal((await winner).response.status, 200);
  assert.equal(refreshes, 1, 'Only one caller uses the rotating refresh credential');
  await success('Refresh race', ['google.profile'], 'lease-shrink', expiringProfile.id, refreshOwner);
  provider.oauth!.refreshTokens = async () => ({ accessToken: 'synthetic-access-restricted',
    expiresAt: new Date(Date.now() + 3600000).toISOString(), confirmedScopes: ['openid'] });
  assert.equal((await use(expiringProfile.id, 'google.profile', refreshOwner)).response.status, 403);
  assert.deepEqual((await namedList(refreshOwner)).find((item: any) => item.id === expiringProfile.id).named.grantedScopes, ['openid']);

  expirationDelay = 20000;
  await success('Retired scope race', ['google.profile'], 'retired', undefined, refreshOwner);
  const retired = (await namedList(refreshOwner)).find((item: any) => item.named.name === 'Retired scope race');
  let releaseScopeChange!: () => void, enteredScopeChange!: () => void;
  const scopeChangeStarted = new Promise<void>(resolve => { enteredScopeChange = resolve; });
  const waitScopeChange = new Promise<void>(resolve => { releaseScopeChange = resolve; });
  provider.oauth!.refreshTokens = async () => {
    enteredScopeChange();
    await waitScopeChange;
    return { accessToken: 'synthetic-access-new-scope', expiresAt: new Date(Date.now() + 3600000).toISOString(), confirmedScopes: ['openid'] };
  };
  const scopeChange = use(retired.id, 'google.profile', refreshOwner);
  await Promise.race([scopeChangeStarted, scopeChange.then(result => { throw new Error(`Scope change did not start (HTTP ${result.response.status})`); })]);
  const oldUse = use(retired.id, 'google.profile', refreshOwner);
  await Promise.race([oldUseStarted, oldUse.then(result => { throw new Error(`Old provider read did not start (HTTP ${result.response.status})`); })]);
  releaseScopeChange();
  assert.equal((await scopeChange).response.status, 403);
  releaseOldUse();
  assert.equal((await oldUse).response.status, 403, 'Scope reduction blocks an older in-flight provider response');

  const manual = connectionProviderById('bluesky-account')!;
  manual.resolveAccount = async fields => ({ ok: true, account: { providerAccountId: fields.handle,
    displayName: 'Fixture manual account', handle: fields.handle, avatarUrl: null, profileUrl: null,
    config: {}, tokens: { accessToken: 'synthetic-manual-session', refreshToken: 'synthetic-manual-refresh', expiresAt: new Date(Date.now() + 3600000).toISOString() } } });
  const manualConnect = (name: string, handle: string, reconnectId?: string) => call(accounts.action, '/api/v1/connections', refreshOwner.cookie,
    { provider: 'bluesky-account', fields: { handle, appPassword: 'synthetic-fixture-value' },
      named: { requestId: randomUUID(), name, allowedOperations: ['account.identity'], ...(reconnectId ? { reconnectId } : {}) } });
  const manualA = await manualConnect('Manual A', 'example.bsky.social');
  const manualB = await manualConnect('Manual B', 'example.bsky.social');
  assert.equal(manualA.response.status, 200);
  assert.equal(manualB.response.status, 200);
  assert.notEqual(manualA.data.connection.id, manualB.data.connection.id);
  assert.equal(manualA.data.connection.account.id, manualB.data.connection.account.id);
  assert.equal((await manualConnect('Manual wrong target', 'different.bsky.social', manualA.data.connection.id)).response.status, 409);
  assert.equal((await use(manualB.data.connection.id, 'account.identity', refreshOwner)).response.status, 200);
  assert.equal(JSON.stringify(await namedList(refreshOwner)).includes('synthetic-manual'), false, 'Manual secrets never appear in metadata');
  const driveProvider = connectionProviderById('google-drive')!;
  driveProvider.oauth!.resolveAccountFromTokens = provider.oauth!.resolveAccountFromTokens;
  driveProvider.oauth!.exchangeCode = async () => ({ ok: true, tokens: { accessToken: 'synthetic-drive-access', confirmedScopes: ['openid', driveMetadata] } });
  const driveCompleted = await finishNamed(new URL(namedDrive.data.authorizeUrl), 'drive-fixture-code', scopeOwner);
  assert.match(driveCompleted.response.headers.get('location') || '', /connected=google-drive/);
  const savedDrive = (await namedList(scopeOwner))[0];
  assert.deepEqual(savedDrive.named.requestedScopes, ['openid', driveMetadata]);
  assert.deepEqual(savedDrive.named.grantedScopes, ['openid', driveMetadata]);
  assert.deepEqual(savedDrive.named.allowedOperations, ['account.identity']);
  assert.equal((await use(savedDrive.id, 'google.profile', scopeOwner)).response.status, 403);

  const facebookConfigured = await call(integrations.action, '/api/v1/admin/integrations', owner.cookie, { action: 'create-secret', label: 'connections-facebook-oauth',
    value: JSON.stringify({ environments: { 'oauth-integration': { origins: { [base]: { clientId: 'synthetic-facebook-client',
      clientSecret: 'synthetic-facebook-secret', redirectUri: base + '/api/v1/connections/oauth/callback' } } } } }) });
  assert.equal(facebookConfigured.response.status, 200);
  const facebook = connectionProviderById('facebook')!;
  facebook.oauth!.resolveAccountFromTokens = provider.oauth!.resolveAccountFromTokens;
  facebook.oauth!.exchangeCode = async () => ({ ok: true, tokens: { accessToken: 'synthetic-facebook-access', scopes: ['public_profile', 'email', 'user_posts'] } });
  let postsGranted = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), 'https://graph.facebook.com/v23.0/me/permissions?fields=permission,status');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-facebook-access');
    return Response.json({ data: [{ permission: 'public_profile', status: 'granted' },
      { permission: 'email', status: 'granted' }, { permission: 'user_posts', status: postsGranted ? 'granted' : 'declined' }] });
  }) as typeof fetch;
  const startFacebook = async () => {
    const started = await call(begin.action, '/api/v1/connections/oauth/begin', scopeOwner.cookie, { provider: 'facebook',
      named: { requestId: randomUUID(), name: 'Facebook posts credential', allowedOperations: ['account.identity'], requestedScopes: ['email', 'user_posts'] } });
    assert.equal(started.response.status, 200);
    const authorize = new URL(started.data.authorizeUrl);
    assert.equal(authorize.searchParams.get('scope'), 'public_profile,email,user_posts');
    return authorize;
  };
  assert.match((await finishNamed(await startFacebook(), 'fb-partial', scopeOwner)).response.headers.get('location') || '', /oauthError=permissions/);
  postsGranted = true;
  assert.match((await finishNamed(await startFacebook(), 'fb-granted', scopeOwner)).response.headers.get('location') || '', /connected=facebook/);
  const savedFacebook = (await namedList(scopeOwner)).find((item: any) => item.provider === 'facebook');
  assert.deepEqual(savedFacebook.named.grantedScopes, ['public_profile', 'email', 'user_posts']);
  globalThis.fetch = realFetch;
  report(JSON.stringify({ connectionsOAuthProof: true, api: 'unmodified Request handlers', storage: 'disposable replica transactions', provider: 'synthetic exchange/profile only', owners: 2, ownerAccounts: [2, 1], replayRejected: true, wrongOriginFeedRejected: true, ownerOnlyDisconnect: true, namedConnections: true, targetedReconnect: true, partialRefused: true, siblingRetained: true, refreshLease: true, scopeShrink: true, manualProfiles: true, namedFeedDenied: true, oldProviderResponseDenied: true, genericProjectionDenied: true, independentScopeSelection: true, facebookPermissionProof: true }));
  process.exit(0);
} catch (error: any) {
  // Assertions use status/booleans, never fixture secrets or cookies.
  const where = String(error?.stack || '').match(/connections-oauth\.integration\.mts:(\d+:\d+)/)?.[1] || 'unknown';
  const status = Number.isInteger(error?.actual) && Number.isInteger(error?.expected) ? ` (actual ${error.actual}, expected ${error.expected})` : '';
  report('CONNECTIONS_TEST_FAILURE ' + where + status + ' ' + String(error?.message || 'unknown').split('\n')[0].slice(0, 300));
  process.exit(1);
}
