import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let context = null;
const revoked = [];
mock.module('../apps/appTokens.ts', { namedExports: { resolveAppToken: async () => context } });
mock.module('./sessions.ts', { namedExports: { revokeSession: async (jti) => { revoked.push(jti); } } });
mock.module('../apps/desktopOAuth.ts', { namedExports: { exchangeDesktopAuthorizationCode: async () => { throw new Error('Revocation must not exchange a code'); } } });
mock.module('../rateLimit/enforce.ts', { namedExports: { enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 }) } });
const { action } = await import('../../../routes/api/v1/oauth/token/_token.tsx');
const request = () => new Request('https://thingtime.test/api/v1/oauth/token', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' },
  body: JSON.stringify({ grantType: 'revoke', jti: 'someone-elses-session' })
});
test('revocation requires a live app credential and only revokes that credential', async () => {
  context = null;
  const denied = await action({ request: request() });
  assert.equal(denied.status, 401); assert.deepEqual(revoked, []);
  context = { jti: 'own-session' };
  const result = await action({ request: request() });
  assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(revoked, ['own-session']);
});
