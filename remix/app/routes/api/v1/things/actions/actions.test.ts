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
  for (const input of [null, [], {}, { id: '../bad', action: 'send-to-lopu' }, { id: 'a', action: 'delete' }, { id: 'a', action: 'send-to-lopu', ownerId: 'victim' }])
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
