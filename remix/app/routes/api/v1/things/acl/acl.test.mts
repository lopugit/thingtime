import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
const user = { id: 'owner', username: 'owner' };
mock.module('~/api/utils/auth/resolveActor', { namedExports: {
  resolveActor: async () => ({ kind: 'user', user }), actorUser: (actor: any) => actor.user,
  actorPat: (actor: any) => actor.pat ?? null
} });
mock.module('~/api/utils/rateLimit/enforce', { namedExports: {
  enforceRateLimit: async () => ({ allowed: true }), rateLimitedResponseInit: () => ({ status: 429 })
} });
mock.module('~/api/utils/things/things', { namedExports: {
  viewerOf: (user: any, pat: any) => ({ id: user.id, username: user.username, pat }),
  grantThingAclEntries: async () => ({}), removeThingAclEntries: async () => ({}), listThingAclEntries: async () => ({})
} });
const { createThingAclHandler } = await import('./_acl');
const request = (method = 'GET', body?: any, headers: Record<string, string> = {}) => new Request('https://thingtime.test/api/v1/things/acl' + (method === 'GET' ? '?id=private&limit=100' : ''),
  { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const make = (actor: any = { kind: 'user', user }) => {
  const calls: any[] = [];
  const mutation = async (...args: any[]) => { calls.push(args); return { ok: true, doc: { acl: ['tt:user', 'tt:custom'], aclRevision: 'generation', aclEntryCount: 100, crystal: { private: 'never serialize' } } }; };
  const handler = createThingAclHandler({ resolveActor: async (_request: any, scope: any) => { calls.push(scope); return actor; },
    enforceRateLimit: async () => ({ allowed: true }), grantThingAclEntries: mutation, removeThingAclEntries: mutation,
    listThingAclEntries: async (...args: any[]) => { calls.push(args); return { ok: true, entries: ['tt:user'], revision: 'generation', nextCursor: null }; }
  } as any);
  return { handler, calls };
};
test('ACL route preserves scoped credential fences and returns private owner pages', async () => {
  const pat = { visibility: 'private', onlyCreatedThings: true };
  const { handler, calls } = make({ kind: 'pat', user, pat });
  const response = await handler({ request: request() }); assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control')!, /private, no-store/);
  assert.deepEqual(calls[0], { thingsScope: 'things.read' }); assert.equal(calls[1][0].pat, pat);
  assert.deepEqual(calls[1].slice(1), ['private', { cursor: undefined, limit: 100 }]);
});
test('ACL mutation forwards revision and projects no raw private document', async () => {
  const { handler, calls } = make();
  const response = await handler({ request: request('POST', { id: 'private', operation: 'add', entries: ['tt:user/reader'], expectedAclRevision: null }) });
  assert.equal(response.status, 200); assert.deepEqual(calls[0], { thingsScope: 'things.update' });
  assert.deepEqual(calls[1].slice(1), ['private', ['tt:user/reader'], { expectedAclRevision: null }]);
  const body = await response.json(); assert.equal(body.aclEntryCount, 100); assert.equal(body.crystal, undefined); assert.equal(body.doc, undefined);
});
test('token-family management uses the same scoped owner gateway without borrowing audience revisions', async () => {
  const { handler, calls } = make();
  const response = await handler({ request: request('POST', { id: 'private', family: 'token', operation: 'add', entries: ['tt:token/sandbox-token'], expectedAclRevision: null }) });
  assert.equal(response.status, 200);
  assert.deepEqual(calls[1].slice(1), ['private', ['tt:token/sandbox-token'], { expectedAclRevision: null, family: 'token' }]);
  assert.equal((await response.json()).family, 'token');
  const read = await handler({ request: new Request('https://thingtime.test/api/v1/things/acl?id=private&family=token&limit=100') });
  assert.equal(read.status, 200);
  assert.equal(calls[3][2].family, 'token');
  for (const family of ['app', 'session', 'execute']) {
    assert.equal((await handler({ request: request('POST', { id: 'private', family, operation: 'add', entries: ['tt:token/x'] }) })).status, 400);
  }
});
test('app aliases, cross-origin mutations and unsupported methods never dispatch', async () => {
  for (const actor of [{ kind: 'app' }, { kind: 'pat', user, cors: {} }]) {
    const { handler, calls } = make(actor); assert.equal((await handler({ request: request() })).status, 403); assert.equal(calls.length, 1);
  }
  for (const req of [request('POST', { id: 'private', operation: 'remove', entries: [] }, { Origin: 'https://foreign.test' }), request('DELETE')]) {
    const { handler, calls } = make(); assert([403, 405].includes((await handler({ request: req })).status)); assert.equal(calls.length, 0);
  }
});
