import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
import { randomBytes } from 'node:crypto';
process.env.JWT_SECRET = randomBytes(32).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.THINGTIME_DATA_ENV = 'custom:oauth-test';
process.env.THINGTIME_DATA_AUTHORITY_ORIGIN = 'https://thingtime.test';
let clientId = 'test-client', clientSecret = 'test-secret', invalidVault = false;
mock.module(new URL('../admin/integrations.ts', import.meta.url).href, { namedExports: {
  readAdminAutomationSecret: async () => invalidVault ? 'invalid-secret-value' : JSON.stringify({ environments: { 'oauth-test': { origins: {
    'https://thingtime.test': { clientId, clientSecret, redirectUri: 'https://thingtime.test/api/v1/connections/oauth/callback' }
  } } } })
} });
const spent = new Set<string>();
let writes = 0,
  exchanges = 0;
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
  namedExports: {
    getAuthOtpsCollection: async () => ({
      insertOne: async (doc: any) => {
        if (spent.has(doc.challenge)) throw Object.assign(new Error('duplicate'), { code: 11000 });
        spent.add(doc.challenge);
      }
    })
  }
});
mock.module(new URL('./connections.ts', import.meta.url).href, {
  namedExports: {
    upsertAccountAndLink: async () => {
      writes++;
      return { ok: true, connection: { id: 'test' } };
    }
  }
});
const { beginOAuth, completeOAuth } = await import('./oauth.ts');
const { connectionProviderById } = await import('./providers.ts');
const { oauthRedirectUri } = await import('./oauthConfig.ts');
const { verifyJwt } = await import('../auth/jwt.ts');
const provider = connectionProviderById('google')!;
provider.oauth!.exchangeCode = async () => {
  exchanges++;
  return { ok: true, tokens: { accessToken: 'private', scopes: ['openid'] } };
};
provider.oauth!.resolveAccountFromTokens = async () => ({
  ok: true,
  account: { providerAccountId: 'google-one', displayName: 'Example', handle: 'test@example.test', profileUrl: null, avatarUrl: null, config: {} }
});
const user = { id: 'one', username: 'one', sessionBinding: 'session-one' };
const begin = async () => {
  const result = await beginOAuth(user, { provider: 'google' }, 'https://thingtime.test');
  assert.ok(result.ok);
  return new URL(result.authorizeUrl);
};
beforeEach(() => {
  spent.clear();
  writes = 0;
  exchanges = 0;
  delete process.env.CONNECTIONS_OAUTH_REDIRECT_BASE;
  clientId = 'test-client'; clientSecret = 'test-secret'; invalidVault = false;
});
test('Google opens account selection, offline access and PKCE with a vault-pinned callback', async () => {
  const url = await begin();
  assert.equal(url.searchParams.get('redirect_uri'), 'https://thingtime.test/api/v1/connections/oauth/callback');
  assert.equal(url.searchParams.get('prompt'), 'select_account consent');
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(await verifyJwt(url.searchParams.get('state')!), null);
  assert.ok(!url.href.includes('test-secret'));
});
test('Facebook account linking requests only identity while posts remain a separate grant', () => {
  const identity = connectionProviderById('facebook-account')!;
  const posts = connectionProviderById('facebook')!;
  const input = { clientId: 'test-client', redirectUri: 'https://thingtime.test/api/v1/connections/oauth/callback', state: 'state' };
  assert.equal(new URL(identity.oauth!.buildAuthorizeUrl(input)).searchParams.get('scope'), 'public_profile');
  assert.ok(new URL(posts.oauth!.buildAuthorizeUrl(input)).searchParams.get('scope')!.includes('user_posts'));
  assert.equal(identity.accountOnly, true);
});
test('successful callback writes once; replay never exchanges a second code', async () => {
  const state = (await begin()).searchParams.get('state');
  const result = await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test');
  assert.ok(result.ok);
  assert.equal((await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test')).ok, false);
  assert.equal(writes, 1);
  assert.equal(exchanges, 1);
});
test('other account, other session, invalid signature and changed redirect do not exchange credentials', async () => {
  const state = (await begin()).searchParams.get('state');
  for (const actor of [
    { ...user, id: 'two' },
    { ...user, sessionBinding: 'session-two' },
    { ...user, sessionBinding: undefined }
  ]) {
    assert.equal((await completeOAuth(actor, { state, code: 'code' }, 'https://thingtime.test')).ok, false);
  }
  assert.equal((await completeOAuth(user, { state: state + 'x', code: 'code' }, 'https://thingtime.test')).ok, false);
  process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = 'https://another.test';
  assert.equal((await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test')).ok, false);
  assert.equal(exchanges, 0);
  assert.equal(writes, 0);
});
test('decline consumes the state without echoing provider-controlled text', async () => {
  const state = (await begin()).searchParams.get('state');
  const result = await completeOAuth(user, { state, error: 'secret-shaped-message', errorDescription: 'secret' }, 'https://thingtime.test');
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(exchanges, 0);
  assert.equal((await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test')).ok, false);
});
test('callback config refuses credentials, paths and remote request-origin fallbacks', () => {
  for (const base of ['https://user:pass@thingtime.test', 'https://thingtime.test/path', 'https://thingtime.test?x=y', 'http://thingtime.test']) {
    process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = base;
    assert.equal(oauthRedirectUri('http://localhost:9999'), null);
  }
  delete process.env.CONNECTIONS_OAUTH_REDIRECT_BASE;
  assert.equal(oauthRedirectUri('https://attacker.test'), 'https://attacker.test/api/v1/connections/oauth/callback');
  assert.equal(oauthRedirectUri('http://localhost:9999'), 'http://localhost:9999/api/v1/connections/oauth/callback');
});

test('catalog and begin agree on the exact origin and vault readiness without leaking configuration', async () => {
  const { publicProviders } = await import('./providers.ts');
  for (const origin of ['https://thingtime.test', 'https://preview.test', 'http://localhost:9999']) {
    const catalog = await publicProviders(origin);
    const result = await beginOAuth(user, { provider: 'google' }, origin);
    assert.equal(catalog.find(p => p.id === 'google')!.configured, origin === 'https://thingtime.test');
    assert.equal(result.ok, origin === 'https://thingtime.test');
    assert.ok(!JSON.stringify(catalog).includes('test-secret'));
  }
  invalidVault = true;
  const result = await beginOAuth(user, { provider: 'google' }, 'https://thingtime.test');
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes('invalid-secret-value'));
});
test('client rotation invalidates pending state before any provider exchange', async () => {
  const state = (await begin()).searchParams.get('state');
  clientId = 'replacement-client';
  assert.equal((await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test')).ok, false);
  assert.equal(exchanges, 0);
});
test('secret rotation keeps the same public client binding and uses the current vault value', async () => {
  const state = (await begin()).searchParams.get('state');
  clientSecret = 'replacement-secret';
  assert.ok((await completeOAuth(user, { state, code: 'code' }, 'https://thingtime.test')).ok);
});

test('Mastodon readiness prerequisite agrees between catalog and begin', async () => {
  const { publicProviders } = await import('./providers.ts');
  const old = process.env.MASTODON_INSTANCE;
  try {
    delete process.env.MASTODON_INSTANCE;
    assert.equal((await publicProviders('https://thingtime.test')).find(p => p.id === 'mastodon-account')!.configured, false);
    assert.equal((await beginOAuth(user, { provider: 'mastodon-account' }, 'https://thingtime.test')).ok, false);
    process.env.MASTODON_INSTANCE = 'mastodon.test';
    assert.equal((await publicProviders('https://thingtime.test')).find(p => p.id === 'mastodon-account')!.configured, true);
    assert.ok((await beginOAuth(user, { provider: 'mastodon-account' }, 'https://thingtime.test')).ok);
  } finally { if (old === undefined) delete process.env.MASTODON_INSTANCE; else process.env.MASTODON_INSTANCE = old; }
});
test('Twitch actual code-exchange adapter sends the bound client ID to identity lookup', async (t) => {
  const requests: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: any, init: any) => {
    requests.push(String(url));
    if (url === 'https://id.twitch.tv/oauth2/token') {
      assert.equal(new URLSearchParams(init.body).get('client_id'), 'test-client');
      assert.equal(new URLSearchParams(init.body).get('client_secret'), 'test-secret');
      return Response.json({ access_token: 'synthetic-twitch', token_type: 'Bearer', expires_in: 3600 });
    }
    assert.equal(url, 'https://api.twitch.tv/helix/users');
    assert.equal(new Headers(init.headers).get('Client-Id'), 'test-client');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-twitch');
    return Response.json({ data: [{ id: 'twitch-test', login: 'fixture', display_name: 'Fixture' }] });
  });
  const result = await beginOAuth(user, { provider: 'twitch' }, 'https://thingtime.test');
  assert.ok(result.ok);
  const state = new URL(result.authorizeUrl).searchParams.get('state');
  assert.ok((await completeOAuth(user, { state, code: 'synthetic-code' }, 'https://thingtime.test')).ok);
  assert.deepEqual(requests, ['https://id.twitch.tv/oauth2/token', 'https://api.twitch.tv/helix/users']);
});
