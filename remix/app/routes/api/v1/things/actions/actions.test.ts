import assert from 'node:assert/strict';
import test from 'node:test';
import { createThingActionHandler } from './_actions';
import { parseThingActionRequest } from '~/schemas/thingActions';
import { runWithMongoEndpoint } from '~/api/utils/mongodb/endpoint';

const request = (body: unknown = { id: 'watch-upload-qa', action: 'send-to-lopu' }, headers: Record<string, string> = {}) => new Request('https://thingtime.test/api/v1/things/actions', {
  method: 'POST', headers: { origin: 'https://thingtime.test', 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
function fixture(actor: any = { kind: 'user', user: { id: 'owner', accountKind: 'user' } }, limit: any = { allowed: true }) {
  const calls: unknown[] = [];
  const action = createThingActionHandler({ actor: async (...args) => { assert.equal(args.length, 1); return actor; },
    limit: (async (_request, bucket, owner) => { assert.equal(bucket, 'lopu.recordings'); assert.equal(owner, 'owner'); return limit; }) as any,
    dispatch: async (owner, input) => { calls.push({ owner, input }); return { ok: true, message: 'Queued' }; }
  });
  return { action, calls };
}
test('Thing actions accept only explicit bounded registered verbs and IDs', () => {
  for (const input of [null, [], {}, { id: '../bad', action: 'send-to-lopu' }, { id: 'a', action: ['archive'] }, { id: 'a', action: { toString: () => 'archive' } }, { id: 'a', action: 'delete' }, { id: 'a', action: 'send-to-lopu', ownerId: 'victim' }])
    assert.throws(() => parseThingActionRequest(input));
});
test('Thing action dispatch derives ownership from actor and never client fields', async () => {
  const f = fixture(); const response = await f.action({ request: request() });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(f.calls, [{ owner: 'owner', input: { id: 'watch-upload-qa', action: 'send-to-lopu' } }]);
  assert.equal((await response.json()).ownerId, 'owner');
});
test('anonymous, PAT, app, temporary and service actors cannot invoke recording tools', async () => {
  for (const actor of [{ kind: 'anonymous' }, { kind: 'pat' }, { kind: 'app' }, { kind: 'user', user: { temporary: true } }, { kind: 'user', user: { accountKind: 'service' } }]) {
    const f = fixture(actor); assert.equal((await f.action({ request: request() })).status, 401); assert.equal(f.calls.length, 0);
  }
});
test('cross-origin, non-JSON, oversized and malformed action inputs never dispatch', async () => {
  for (const [req, status] of [[request({}, { origin: 'https://evil.test' }), 403], [request({}, { 'Sec-Fetch-Site': 'cross-site' }), 403],
    [request({}, { 'content-type': 'text/plain' }), 415], [request({ id: 'x'.repeat(3000) }), 413], [request({}), 400]] as const) {
    const f = fixture(); const response = await f.action({ request: req });
    assert.equal(response.status, status); assert.equal(response.headers.get('Cache-Control'), 'private, no-store'); assert.equal(f.calls.length, 0);
  }
});
test('allowance outages and source rejections fail closed', async () => {
  const f = fixture(undefined, { unavailable: true });
  assert.equal((await f.action({ request: request() })).status, 503); assert.equal(f.calls.length, 0);
});
test('custom data sources cannot collide with a home recording identity', async () => {
  const f = fixture();
  const response = await runWithMongoEndpoint({ url: 'mongodb://127.0.0.1/other' } as any, () => f.action({ request: request() }));
  assert.equal(response.status, 409); assert.equal(f.calls.length, 0);
});

test('Archive availability and writes share the full-session origin/home boundary and private DTO', async () => {
  const calls: unknown[] = [];
  const handler = createThingActionHandler({ actor: async () => ({ kind: 'user', user: { id: 'owner', accountKind: 'user' } }) as any,
    limit: async () => { throw Error('Archive must not consume the recording allowance'); },
    libraryLimit: async (_request, bucket) => { assert.ok(['things.read', 'things.write'].includes(bucket)); return { allowed: true } as any; },
    available: async (owner, id) => { calls.push(['read', owner, id]); return { ok: true, id, ownerId: owner, libraryArchived: false, availableActions: ['archive'] }; },
    dispatch: async (owner, input: any) => { calls.push(['write', owner, input]); return { ok: true, id: input.id, ownerId: owner, libraryArchived: input.action === 'archive' }; }
  } as any);
  const response = await handler({ request: new Request('https://thingtime.test/api/v1/things/actions?id=post-id', { headers: { Origin: 'https://thingtime.test' } }) });
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await response.json(), { ok: true, id: 'post-id', ownerId: 'owner', libraryArchived: false, availableActions: ['archive'] });
  for (const action of ['archive', 'restore']) assert.equal((await handler({ request: request({ id: 'post-id', action }) })).status, 200);
  assert.equal(calls.length, 3);
  for (const headers of [{ Origin: 'https://foreign.test' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }]) {
    assert.equal((await handler({ request: new Request('https://thingtime.test/api/v1/things/actions?id=post-id', { headers }) })).status, 403);
  }
  assert.equal(calls.length, 3);
});

test('unavailable exact subjects disclose no owner or archive metadata', async () => {
  const handler = createThingActionHandler({ actor: async () => ({ kind: 'user', user: { id: 'owner', accountKind: 'user' } }) as any,
    limit: async () => ({ allowed: true }) as any, libraryLimit: async () => ({ allowed: true }) as any,
    available: async () => ({ ok: false, status: 404, error: 'Thing is not available in your library' }),
    dispatch: async () => ({ ok: false, status: 404, error: 'Thing is not available in your library' }) } as any);
  for (const req of [new Request('https://thingtime.test/api/v1/things/actions?id=foreign'), request({ id: 'foreign', action: 'archive' })]) {
    const response = await handler({ request: req }); assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { ok: false, error: 'Thing is not available in your library' });
  }
});

test('non-string semantic verbs fail as invalid input before dispatch', async () => {
  for (const action of [['archive'], { action: 'archive' }]) {
    const f = fixture();
    const response = await f.action({ request: request({ id: 'post-id', action }) });
    assert.equal(response.status, 400); assert.equal(f.calls.length, 0);
  }
});
