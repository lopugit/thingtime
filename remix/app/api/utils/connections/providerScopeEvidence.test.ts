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

test('Facebook permission evidence rejects failed/malformed reads and includes only confirmed supported grants', async t => {
  const { readConnectionFacebookPermissions } = await import('./providers');
  let body: unknown = {}, status = 200;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/v23.0/me/permissions');
    assert.equal(url.searchParams.has('access_token'), false);
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer synthetic');
    return Response.json(body, { status });
  });
  for (const value of [{}, { data: null }, { data: [], paging: { next: 'https://graph.facebook.com/next' } }, { data: [{ permission: 'user_posts' }] }, { data: [{ permission: 'user_posts', status: 'unexpected' }] }]) {
    body = value;
    assert.equal(await readConnectionFacebookPermissions({ accessToken: 'synthetic' }), undefined);
  }
  body = { data: [{ permission: 'user_posts', status: 'declined' }, { permission: 'public_profile', status: 'granted' }, { permission: 'email', status: 'granted' }, { permission: 'untrusted-provider-text', status: 'granted' }] };
  assert.deepEqual(await readConnectionFacebookPermissions({ accessToken: 'synthetic' }), ['public_profile', 'email']);
  body = { data: [] };
  assert.deepEqual(await readConnectionFacebookPermissions({ accessToken: 'synthetic' }), []);
  status = 403;
  assert.equal(await readConnectionFacebookPermissions({ accessToken: 'synthetic' }), undefined);
});

test('Facebook diagnostics isolate core posts from optional fields without returning content or errors', async t => {
  const fields: string[] = [];
  let denyCore = false;
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(url.searchParams.has('access_token'), false);
    if (url.pathname.endsWith('/permissions')) return Response.json({ data: [{ permission: 'user_posts', status: 'granted' }] });
    assert.equal(url.searchParams.get('limit'), '1');
    const field = url.searchParams.get('fields')!;
    fields.push(field);
    if (denyCore || field.includes('likes')) return Response.json({ error: { code: 200, message: 'synthetic-private-provider-message' } }, { status: 400 });
    return Response.json({ data: [{ id: 'private-post', message: 'private-content' }] });
  });
  const diagnose = connectionProviderById('facebook')!.diagnose!;
  const result = await diagnose({ accessToken: 'synthetic' });
  assert.deepEqual(result, { grantedScopes: ['user_posts'], checks: [
    { name: 'posts', status: 'available' }, { name: 'shares', status: 'available' },
    { name: 'likes', status: 'permission-denied' }, { name: 'comments', status: 'available' }
  ] });
  assert.deepEqual(fields, ['id,message,created_time', 'id,shares', 'id,likes.summary(true)', 'id,comments.summary(true)']);
  assert.ok(!JSON.stringify(result).includes('private'));
  denyCore = true; fields.length = 0;
  assert.deepEqual((await diagnose({ accessToken: 'synthetic' })).checks.map(check => check.status), ['permission-denied', 'skipped', 'skipped', 'skipped']);
  assert.equal(fields.length, 1);
});
