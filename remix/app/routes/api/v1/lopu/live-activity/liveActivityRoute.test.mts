import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
mock.module('../../../../../api/utils/auth/authCookie.ts', { namedExports: { getAuthToken: async () => 'session-token' } });
mock.module('../../../../../api/utils/auth/getCurrentUser.ts', { namedExports: { resolveTokenUser: async () => null } });
mock.module('../../../../../api/utils/lopu/backgroundTaskScope.ts', { namedExports: { backgroundTaskScopeFor: async () => 'scope' } });
mock.module('../../../../../api/utils/lopu/liveActivity.ts', { namedExports: { registerLopuLiveActivity: async () => ({ ok: true }), unregisterLopuLiveActivity: async () => {} } });
mock.module('../../../../../api/utils/rateLimit/enforce.ts', { namedExports: { enforceRateLimit: async () => ({allowed: true}), rateLimitedResponseInit: () => ({status: 429}) } });
const { createLopuLiveActivityAction } = await import('./_live-activity.tsx');
const request = (body: any = {ownerId: 'owner', activityId: 'activity', contextKey: 'origin-and-source-digest'}, origin = 'https://thingtime.test', method = 'POST') => new Request('https://thingtime.test/api/v1/lopu/live-activity', {method, headers: {'Content-Type': 'application/json', Origin: origin}, body: JSON.stringify(body)});

const harness = () => {
  const calls: any[] = [];
  const deps: any = {
    getAuthToken: async () => 'cookie', resolveTokenUser: async () => ({user: {id: 'owner', accountKind: 'user'}, claims: {jti: 'session'}}),
    resolvePublicOrigin: () => ({origin: 'https://thingtime.test'}), backgroundTaskScopeFor: async () => 'origin-and-source-digest',
    enforceRateLimit: async (_request: any, _key: any, _owner: any, options: any) => { assert.equal(options.failClosed, true); return {allowed: true}; },
    registerLopuLiveActivity: async (...args: any[]) => { calls.push(args); return {ok: true}; },
    unregisterLopuLiveActivity: async (...args: any[]) => { calls.push(args); }
  };
  return {calls, deps, action: createLopuLiveActivityAction(deps)};
};

test('registration binds authenticated session and derived source scope without echoing token', async () => {
  const h = harness();
  const response = await h.action({request: request({ownerId: 'owner', activityId: 'activity', contextKey: 'origin-and-source-digest', token: 'private-token'})});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(h.calls[0].slice(0, 3), ['owner', 'session', 'origin-and-source-digest']);
  assert.deepEqual(await response.json(), {ok: true});
});

test('wrong owner, cross origin, anonymous and scoped actors cannot register', async () => {
  const h = harness();
  assert.equal((await h.action({request: request({ownerId: 'previous-owner', activityId: 'activity'})})).status, 409);
  assert.equal((await h.action({request: request(undefined, 'https://other.test')})).status, 403);
  h.deps.resolveTokenUser = async () => null;
  assert.equal((await h.action({request: request()})).status, 401);
  h.deps.resolveTokenUser = async () => ({user: {id: 'owner', accountKind: 'service'}, claims: {jti: 'session'}});
  assert.equal((await h.action({request: request()})).status, 401);
  assert.equal(h.calls.length, 0);
});

test('unregister is scoped to current owner, source and exact activity', async () => {
  const h = harness();
  assert.equal((await h.action({request: request(undefined, undefined, 'DELETE')})).status, 200);
  assert.deepEqual(h.calls, [['owner', 'origin-and-source-digest', 'activity']]);
});

test('a stale selected-data-source snapshot cannot be rebound by changed cookies', async () => {
  const h = harness();
  assert.equal((await h.action({request: request({ownerId: 'owner', activityId: 'activity', contextKey: 'old-source'})})).status, 409);
  assert.equal(h.calls.length, 0);
});

test('limiter refusal cannot mutate a registration', async () => {
  const h = harness(); h.deps.enforceRateLimit = async () => ({allowed: false});
  assert.equal((await h.action({request: request()})).status, 429);
  assert.equal(h.calls.length, 0);
});
