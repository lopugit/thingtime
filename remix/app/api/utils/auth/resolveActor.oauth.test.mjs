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

test('a token holding both grants routes per operation, not on the mere presence of an account scope', async () => {
  context = { user, scopes: ['account.things.read', 'app-data'], clientId: 'test-app', origin: 'https://client.test' };
  const pat = { scopes: ['things.read'], visibility: 'all', onlyCreatedThings: false };
  resolved = { ok: true, actor: { user, pat } };

  // The account grant covers this operation, so it wins over the namespace.
  const read = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(!(read instanceof Response)); assert.equal(read.kind, 'pat'); assert.equal(actorPat(read), pat);
  assert.equal(requested, 'things.read');

  // It does not cover this one — the app must still reach its own namespace
  // rather than being stranded on the account surface it can't use.
  requested = null;
  const create = await resolveActor(request(), { thingsScope: 'things.create' });
  assert.ok(!(create instanceof Response)); assert.equal(create.kind, 'app'); assert.equal(actorPat(create), null);
  assert.equal(requested, null);
});

test('an account-only token keeps the account-flavoured error for operations it lacks', async () => {
  context = { user, scopes: ['account.things.read'], clientId: 'test-app', origin: 'https://client.test' };
  resolved = { ok: false, status: 403, error: 'Approve the required account Things permissions for this app' };
  requested = null;

  // No namespace capability to fall back to, so this must still consult the
  // account path instead of answering "not granted the app-data scope".
  const denied = await resolveActor(request(), { thingsScope: 'things.create' });
  assert.ok(denied instanceof Response); assert.equal(denied.status, 403);
  assert.equal(requested, 'things.create');
  assert.match((await denied.json()).error, /account Things permissions/);
});

test('account grants cannot bypass origin or sandbox restrictions', async () => {
  context = { user, scopes: ['account.things'], clientId: 'test-app', origin: 'https://client.test' };
  const denied = await resolveActor(request('https://another.test'), { thingsScope: 'things.read' });
  assert.ok(denied instanceof Response); assert.equal(denied.status, 403);
  context.sandbox = true;
  const sandbox = await resolveActor(request(), { thingsScope: 'things.read' });
  assert.ok(sandbox instanceof Response); assert.equal(sandbox.status, 403);
});
