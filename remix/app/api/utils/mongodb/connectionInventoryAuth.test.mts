import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let purpose: string | undefined = 'browser';
mock.module('../auth/jwt', { namedExports: { verifyJwt: async () => ({ sub: 'owner', jti: 'live' }) } });
mock.module('../auth/authCookie', { namedExports: { getAuthToken: async () => 'synthetic-session-handle' } });
mock.module('../auth/sessions', { namedExports: { getLiveSession: async () => ({ jti: 'live', userId: 'owner', purpose, meta: {} }) } });
mock.module('../auth/users', { namedExports: {
  findUserById: async () => ({ _id: 'owner', accountKind: 'user', meta: { admin: true } }),
  toPublicUser: () => ({ id: 'owner', accountKind: 'user', isAdmin: true })
} });
mock.module('../subscriptions/subscriptions', { namedExports: { getSubscription: async () => null } });
const { requireAdmin } = await import('../auth/requireAdmin');

test('canonical inventory administrator gate refuses scoped tokens even for an administrator owner', async () => {
  const request = new Request('https://inventory.example/api/v1/admin/mongodb/connections');
  for (const denied of ['pat', 'app', 'app-sandbox', 'device-node', 'watch-pairing', 'future-scoped-purpose']) {
    purpose = denied;
    const gate = await requireAdmin(request);
    assert.ok('error' in gate, denied);
    if ('error' in gate) assert.equal(gate.error.status, 401, denied);
  }
  purpose = 'browser';
  assert.ok('user' in await requireAdmin(request));
});
