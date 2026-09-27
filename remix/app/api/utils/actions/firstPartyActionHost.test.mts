import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { internalRequestActor, withInternalRequestActor } from '../auth/internalRequestActor';
let requests = 0;
mock.module('../../../../server/utils/actionDataRoutes', { namedExports: { actionDataRoutes: {
  'v1/builder/workspaces': async () => ({ loader: async ({ request }: any) => {
    requests++;
    assert.equal(request.headers.has('Authorization'), false);
    assert.equal(request.headers.has('Cookie'), false);
    assert.equal((await internalRequestActor(request)!())?.id, 'owner');
    return Response.json({ ok: true, rootId: new URL(request.url).searchParams.get('rootId') });
  } })
} } });
mock.module('./execute', { namedExports: { runAction: async () => { throw new Error('not prepared'); } } });
const { createFirstPartyActionHost } = await import('./firstPartyActionHost');
const { dispatchActionRequest, isLopuActionPath } = await import('./internalActionRequest');
const user: any = { id: 'owner', username: 'owner', accountKind: 'user' };
const step = { path: '/api/v1/builder/workspaces', method: 'GET', query: { rootId: 'root' }, feature: 'api.builder-workspaces', minimumVersion: '1.0.1', maxResultBytes: 1024 };
test('first-party browser flows use the canonical route without copying credentials', async () => {
  const host = createFirstPartyActionHost('owner', { resolveActor: async () => user, isAuthorized: async () => true });
  assert.deepEqual(await host.request(step, 'owner', AbortSignal.timeout(1000)), { ok: true, rootId: 'root' });
});
test('revoked/wrong/scoped users, revoked access, invalid destination/version and cancellation fail closed', async () => {
  const before = requests;
  for (const actor of [null, { ...user, id: 'other' }, { ...user, accountKind: 'service' }, { ...user, temporary: true }]) {
    const host = createFirstPartyActionHost('owner', { resolveActor: async () => actor, isAuthorized: async () => true });
    await assert.rejects(host.request(step, 'owner', AbortSignal.timeout(1000)), /first-party/);
  }
  const host = createFirstPartyActionHost('owner', { resolveActor: async () => user, isAuthorized: async () => false });
  await assert.rejects(host.request(step, 'owner', AbortSignal.timeout(1000)), /Ask before running/);
  const allowed = createFirstPartyActionHost('owner', { resolveActor: async () => user, isAuthorized: async () => true });
  await assert.rejects(allowed.request({ ...step, path: 'https://example.com' }, 'owner', AbortSignal.timeout(1000)), /endpoint/);
  await assert.rejects(allowed.request({ ...step, minimumVersion: '9.0.0' }, 'owner', AbortSignal.timeout(1000)), /requires/);
  await assert.rejects(allowed.request(step, 'other', AbortSignal.timeout(1000)), /account changed/);
  await assert.rejects(allowed.request(step, 'owner', AbortSignal.abort()));
  assert.equal(requests, before);
});
test('Actions cannot grant themselves chat access or reach credential/control-plane APIs', async () => {
  for (const path of ['/api/v1/lopu/chats/update', '/api/v1/auth/login', '/api/v1/admin/users', '/api/v1/vault/reveal', '/api/v1/things/reveal', '/api/v1/actions/run']) {
    assert.equal(isLopuActionPath(path), false);
    await assert.rejects(dispatchActionRequest(new Request(`https://thingtime.internal${path}`), async () => user), /not available/);
  }
  const external = new Request('https://thingtime.internal/api/v1/things', { headers: { 'X-Thingtime-Actor': 'owner' } });
  assert.equal(internalRequestActor(external), undefined);
});


test('internal authority is scoped to the exact Request and removed after success or failure', async () => {
  const request = new Request('https://thingtime.internal/api/v1/things');
  for (const throws of [false, true]) {
    try {
      await withInternalRequestActor(request, async () => user, async () => {
        assert.equal((await internalRequestActor(request)!())?.id, 'owner');
        assert.equal(internalRequestActor(request.clone()), undefined);
        if (throws) throw new Error('failed route');
      });
    } catch (error) { assert.match(String(error), /failed route/); }
    assert.equal(internalRequestActor(request), undefined);
  }
});
