import assert from 'node:assert/strict';
import { mock, test, beforeEach } from 'node:test';
import { randomBytes } from 'node:crypto';
process.env.JWT_SECRET = randomBytes(32).toString('base64url');
process.env.THINGTIME_USER_VAULT_KEY = randomBytes(32).toString('base64url');
process.env.GOOGLE_CLIENT_ID = 'test-client';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = 'https://thingtime.test';
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
  const result = await beginOAuth(user, { provider: 'google' }, 'https://untrusted.test');
  assert.ok(result.ok);
  return new URL(result.authorizeUrl);
};
beforeEach(() => {
  spent.clear();
  writes = 0;
  exchanges = 0;
  process.env.CONNECTIONS_OAUTH_REDIRECT_BASE = 'https://thingtime.test';
});
test('Google opens account selection, offline access and PKCE with an env-pinned callback', async () => {
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
  assert.equal(oauthRedirectUri('https://attacker.test'), null);
  assert.equal(oauthRedirectUri('http://localhost:9999'), 'http://localhost:9999/api/v1/connections/oauth/callback');
});
