import assert from 'node:assert/strict';
import { test } from 'node:test';
import { connectionProviderById } from './providers';

test('Google refresh preserves confirmed scope only when the scope field is absent', async t => {
  let providerScope: Record<string, unknown> = {};
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    assert.equal(String(input), 'https://oauth2.googleapis.com/token');
    return Response.json({ access_token: 'synthetic', expires_in: 3600, ...providerScope });
  });
  const refresh = connectionProviderById('google')!.oauth!.refreshTokens!;
  const previous = { accessToken: 'prior', refreshToken: 'synthetic-refresh', confirmedScopes: ['openid', 'profile'] };
  const creds = { clientId: 'synthetic-client', clientSecret: 'synthetic-secret' };
  assert.deepEqual((await refresh(previous, creds))?.confirmedScopes, ['openid', 'profile']);
  for (const scope of [null, ['profile'], 123]) {
    providerScope = { scope };
    assert.deepEqual((await refresh(previous, creds))?.confirmedScopes, []);
  }
  providerScope = { scope: 'openid' };
  assert.deepEqual((await refresh(previous, creds))?.confirmedScopes, ['openid']);
});
