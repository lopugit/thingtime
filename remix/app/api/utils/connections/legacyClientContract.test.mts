import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

// Frozen request/response contract used by the main-based bundled Connections
// client: it sends provider/fields or id, without expectedOwnerId or negotiation.
// Persistence/crypto isolation is covered by accountLibrary and vault suites;
// this exercises the real HTTP handlers and their authentication boundary.
let user: any = { id: 'fixture-owner', username: 'fixture' };
let calls: any[] = [];
const connection = { id: 'fixture-link', provider: 'fixture', account: { id: 'fixture-account', displayName: 'Fixture' } };
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
  enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({}),
} });
mock.module(new URL('./connections.ts', import.meta.url).href, { namedExports: {
  listConnections: async (actor: any) => { calls.push(['list', actor.id]); return { connections: [connection] }; },
  connectProvider: async (actor: any, args: any) => {
    calls.push(['connect', actor.id, args]);
    return args.provider === 'invalid' ? { ok: false, status: 400, error: 'Unknown provider' } : { ok: true, connection, alreadyLinked: false };
  },
  unlinkConnection: async (actor: any, args: any) => { calls.push(['unlink', actor.id, args]); return { ok: true, removed: true }; },
} });
mock.module(new URL('./oauth.ts', import.meta.url).href, { namedExports: {
  requestOrigin: (request: Request) => new URL(request.url).origin,
  oauthSessionBinding: async () => 'fixture-session-binding',
  beginOAuth: async (actor: any, args: any, origin: string) => {
    calls.push(['oauth', actor.id, actor.sessionBinding, args, origin]);
    return { ok: true, provider: args.provider, authorizeUrl: 'https://identity.example.test/authorize?state=synthetic' };
  },
} });
const links = await import('../../../routes/api/v1/connections/_connections.tsx');
const unlink = await import('../../../routes/api/v1/connections/unlink/_unlink.tsx');
const oauth = await import('../../../routes/api/v1/connections/oauth/begin/_begin.tsx');
const request = (path: string, body?: unknown) => new Request(`https://fixture.test/api/v1/connections${path}`, body === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => { user = { id: 'fixture-owner', username: 'fixture' }; calls = []; });
test('legacy list/connect/unlink and OAuth request shapes remain accepted with additive responses', async () => {
  const listed = await links.loader({ request: request('') });
  assert.equal(listed.status, 200);
  assert.match(listed.headers.get('cache-control')!, /private, no-store/);
  const list = await listed.json();
  assert.deepEqual(list.connections, [connection]);
  assert.equal(list.ownerId, user.id);
  const linked = await links.action({ request: request('', { provider: 'fixture', fields: { url: 'https://source.example.test' } }) });
  assert.deepEqual(await linked.json(), { ok: true, connection, alreadyLinked: false });
  const begun = await oauth.action({ request: request('/oauth/begin', { provider: 'fixture' }) });
  assert.equal((await begun.json()).authorizeUrl, 'https://identity.example.test/authorize?state=synthetic');
  const removed = await unlink.action({ request: request('/unlink', { id: connection.id }) });
  assert.deepEqual(await removed.json(), { ok: true, removed: true });
  assert.deepEqual(calls, [
    ['list', 'fixture-owner'], ['connect', 'fixture-owner', { provider: 'fixture', fields: { url: 'https://source.example.test' } }],
    ['oauth', 'fixture-owner', 'fixture-session-binding', { provider: 'fixture' }, 'https://fixture.test'],
    ['unlink', 'fixture-owner', { id: 'fixture-link' }],
  ]);
});
test('old clients are bound to the current authenticated owner; supplied identity cannot override it', async () => {
  user = { id: 'second-owner', username: 'second' };
  await links.action({ request: request('', { provider: 'fixture', fields: {}, ownerId: 'fixture-owner' }) });
  assert.equal(calls[0][1], 'second-owner');
  for (const handler of [links.action, oauth.action]) {
    const response = await handler({ request: request('', { provider: 'fixture', expectedOwnerId: 'fixture-owner' }) });
    assert.equal(response.status, 409);
  }
  assert.equal(calls.length, 1);
});
test('anonymous/service callers and malformed legacy requests fail without a credential write', async () => {
  for (const actor of [null, { id: 'service', accountKind: 'service' }]) {
    user = actor;
    for (const handler of [links.action, unlink.action, oauth.action]) assert.equal((await handler({ request: request('', { provider: 'fixture' }) })).status, 401);
    assert.equal((await links.loader({ request: request('') })).status, 401);
  }
  assert.deepEqual(calls, []);
  user = { id: 'fixture-owner' };
  const response = await links.action({ request: request('', { provider: 'invalid', fields: {} }) });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { ok: false, error: 'Unknown provider' });
});
