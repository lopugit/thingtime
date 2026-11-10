import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
let docs: any[] = [];
let fail = false;
let query: any;
let user: any = null;
const col = {
  insertOne: async (doc: any) => { if (fail) throw new Error('secret connection failure'); await new Promise(r => setTimeout(r, 5)); docs.push(doc); },
  find: (filter: any) => { query = filter; return { sort: () => ({ limit: () => ({ toArray: async () => docs }) }) }; }
};
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, { namedExports: { getHomeThingsCollection: async () => col } });
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
const { recordErrorLog, withErrorLogRequest, buildErrorLogThing, listErrorLogs } = await import('./errorLogs');
const { loader } = await import('../../../routes/api/v1/admin/error-logs/_error-logs');

test('request context flushes handled captures, deduplicates the same error and does not persist request secrets', async (t) => {
  t.mock.method(console, 'error', () => {}); docs = [];
  const error = new Error('Rate limit reached');
  await withErrorLogRequest('/api/v1/auth/invites', 'POST', async () => {
    void recordErrorLog(error, { source: 'moderation', status: 429 });
    void recordErrorLog(error, { source: 'invite-avatar' });
  });
  assert.equal(docs.length, 1); assert.equal(docs[0].crystal.route, '/api/v1/auth/invites');
  assert.match(docs[0].crystal.requestId, /^[a-f0-9-]{36}$/);
  const rows = await listErrorLogs({}); assert.equal(rows.items[0].requestId, docs[0].crystal.requestId);
});
test('durable store failure never changes the original response or error', async (t) => {
  t.mock.method(console, 'error', () => {}); t.mock.method(console, 'warn', () => {}); fail = true;
  try {
    const result = await withErrorLogRequest('/api/v1/things', 'POST', async () => {
      assert.equal(await recordErrorLog(new Error('source failure'), { source: 'test' }), null);
      return 'original response';
    });
    assert.equal(result, 'original response');
  } finally { fail = false; }
});
test('endpoint rechecks current admin, including revocation, and every result is private/no-store', async () => {
  docs = [buildErrorLogThing(new Error('fixture failure'), { source: 'test' })];
  for (const [actor, status] of [[null, 401], [{ isAdmin: false }, 403], [{ isAdmin: true }, 200], [{ isAdmin: false }, 403]] as const) {
    user = actor;
    const response = await loader({ request: new Request('https://thingtime.test/api/v1/admin/error-logs') });
    assert.equal(response.status, status); assert.match(response.headers.get('cache-control')!, /private, no-store/);
    const body = await response.json(); assert.equal('items' in body, status === 200);
  }
});
test('search treats regex as literal, filters expired records and advances a stable cursor', async () => {
  docs = Array.from({ length: 31 }, () => buildErrorLogThing(new Error('fixture failure'), { source: 'test' }));
  const page = await listErrorLogs({ q: '.*(secret)' });
  assert.equal(page.items.length, 30); assert.ok(page.nextCursor);
  assert.equal(query.$and[0].$or[0].shareId.$regex, '\\.\\*\\(secret\\)');
  assert.ok(query.expiresAt.$gt instanceof Date); assert.equal(query.thingtime, 'error-log');
  await listErrorLogs({ before: page.nextCursor! }); assert.equal(query.$or.length, 2);
  await assert.rejects(listErrorLogs({ before: 'broken' }), /Invalid error log cursor/);
});
test('per-request capture flood is bounded to five persisted records', async (t) => {
  t.mock.method(console, 'error', () => {}); docs = [];
  await withErrorLogRequest('/api/v1/things', 'POST', async () => {
    for (let n = 0; n < 20; n++) void recordErrorLog(new Error('outage'), { source: 'test' });
  });
  assert.equal(docs.length, 5);
});
