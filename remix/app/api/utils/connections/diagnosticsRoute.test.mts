import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let user: any = { id: 'owner' }, calls = 0, allowed = true;
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../auth/vaultRequest.ts', import.meta.url).href, { namedExports: { withVaultRequest: (_request: unknown, fn: () => unknown) => fn() } });
mock.module(new URL('./connections.ts', import.meta.url).href, { namedExports: { diagnoseConnection: async (_user: unknown, id: string, origin: string) => {
  calls++; assert.equal(id, 'exact-connection'); assert.equal(origin, 'https://thingtime.test');
  return { ok: true, grantedScopes: null, checks: [] };
} } });
mock.module(new URL('./oauth.ts', import.meta.url).href, { namedExports: { requestOrigin: (request: Request) => new URL(request.url).origin } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
  enforceRateLimit: async () => ({ allowed }), rateLimitedResponseInit: () => ({ status: 429 })
} });
const { loader } = await import('../../../routes/api/v1/connections/diagnostics/_diagnostics.tsx');
const read = (owner = 'owner') => loader({ request: new Request(`https://thingtime.test/api/v1/connections/diagnostics?connectionId=exact-connection&expectedOwnerId=${owner}`) });
test('diagnostics route requires the authenticated exact owner, fails closed and never caches', async () => {
  user = null; assert.equal((await read()).status, 401);
  user = { id: 'owner', accountKind: 'service' }; assert.equal((await read()).status, 401);
  user = { id: 'owner' }; assert.equal((await read('other')).status, 409);
  allowed = false; assert.equal((await read()).status, 429);
  assert.equal(calls, 0);
  allowed = true;
  const response = await read();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { ok: true, grantedScopes: null, checks: [] });
  assert.equal(calls, 1);
});
