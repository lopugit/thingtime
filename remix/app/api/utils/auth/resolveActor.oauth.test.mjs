import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let context = null;
let resolved = { ok: true, actor: { user: null, pat: null } };
let requested;
mock.module('./getCurrentUser.ts', { namedExports: { getCurrentUser: async () => null } });
mock.module('./patTokens.ts', { namedExports: { resolveThingsActor: async (_request, scope) => { requested = scope; return resolved; } } });
mock.module('../apps/appTokens.ts', { namedExports: { resolveAppToken: async () => context } });
mock.module('../apps/namespace.ts', { namedExports: { appScopeOf: (ctx) => ({ clientId: ctx.clientId }) } });
const { resolveActor, actorPat } = await import('./resolveActor.ts');
const user = { id: 'synthetic-owner' };
const request = (origin) => new Request('https://thingtime.test/api/v1/things', { headers: origin ? { Origin: origin } : {} });

test('selected Things never select the account actor; namespace grants remain isolated', async () => {
  context = { user, scopes: ['things'], clientId: 'test-app', origin: 'https://client.test' };
  let result = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(result instanceof Response); assert.equal(result.status, 403);
  context.scopes.push('app-data');
  result = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(!(result instanceof Response)); assert.equal(result.kind, 'app');
  assert.equal(actorPat(result), null);
});

test('account grants thread their scoped actor through reads and preserve missing-scope errors', async () => {
  context = { user, scopes: ['account.things.read'], clientId: 'test-app', origin: 'https://client.test' };
  const pat = { scopes: ['things.read'], visibility: 'all', onlyCreatedThings: false };
  resolved = { ok: true, actor: { user, pat } };
  const result = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(!(result instanceof Response)); assert.equal(result.kind, 'pat'); assert.equal(actorPat(result), pat);
  assert.equal(requested, 'things.read');
  resolved = { ok: false, status: 403, error: 'Missing update permission' };
  const denied = await resolveActor(request(), { thingsScope: ['things.create', 'things.update'] });
  assert.ok(denied instanceof Response); assert.equal(denied.status, 403);
  assert.deepEqual(requested, ['things.create', 'things.update']);
});

test('account grants cannot bypass origin or sandbox restrictions', async () => {
  context = { user, scopes: ['account.things'], clientId: 'test-app', origin: 'https://client.test' };
  const denied = await resolveActor(request('https://another.test'), { thingsScope: 'things.read' });
  assert.ok(denied instanceof Response); assert.equal(denied.status, 403);
  context.sandbox = true;
  const sandbox = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(sandbox instanceof Response); assert.equal(sandbox.status, 403);
});
