import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnedPlanResolver, ownsPlanAdmission } from './chatgptPlanAdmissionCore';
import { evaluateLopuAccess } from '../lopu/accessCore';

const request = new Request('http://127.0.0.1:28631/api/v1/lopu/chats');
const settings = { requireVerification: true, allowByoUnverified: false };
const owner = { id: 'owner' };
const providerId = 'chatgpt-plan-synthetic';
const provider = (signal = new AbortController().signal) => ({ id: providerId, authMode: 'chatgpt-plan' as const, authSignal: signal });

test('only issued, live owner-bound plan authority admits BYO; JSON hints and other billing cannot', async () => {
  const controller = new AbortController();
  const resolve = createOwnedPlanResolver({ sessionOwns: async () => true, resolve: async () => provider(controller.signal) });
  const { admission } = await resolve(request, owner.id, providerId);
  assert.equal(ownsPlanAdmission(admission, owner.id, providerId), true);
  for (const proof of [null, { ownerId: owner.id, providerId }, JSON.parse(JSON.stringify(admission))]) {
    assert.equal(evaluateLopuAccess(owner, { billing: 'byo', settings, ownedPlan: proof }).ok, false);
  }
  assert.equal(evaluateLopuAccess(owner, { billing: 'byo', settings, ownedPlan: admission }).ok, true);
  for (const billing of ['free', 'thingtime'] as const) assert.equal(evaluateLopuAccess(owner, { billing, settings, balanceMicros: 1, ownedPlan: admission }).ok, false);
  for (const user of [null, { id: 'other' }, { ...owner, temporary: true }]) assert.equal(evaluateLopuAccess(user, { billing: 'byo', settings, ownedPlan: admission }).ok, false);
  assert.equal(ownsPlanAdmission(admission, owner.id, 'other-plan'), false);
  controller.abort();
  assert.equal(ownsPlanAdmission(admission, owner.id, providerId), false);
  assert.equal(evaluateLopuAccess(owner, { billing: 'byo', settings, ownedPlan: admission }).ok, false);
});

test('scoped, mismatched and revoked sessions never resolve a credential; identity changes after refresh fail closed', async () => {
  let resolutions = 0;
  const denied = createOwnedPlanResolver({ sessionOwns: async () => false, resolve: async () => { resolutions++; return provider(); } });
  await assert.rejects(denied(request, owner.id, providerId));
  assert.equal(resolutions, 0);
  let live = true;
  const switched = createOwnedPlanResolver({ sessionOwns: async () => live, resolve: async () => { live = false; return provider(); } });
  await assert.rejects(switched(request, owner.id, providerId));
  for (const value of [{ ...provider(), id: 'foreign' }, { ...provider(), authMode: 'api-key' }, provider(AbortSignal.abort())]) {
    const resolve = createOwnedPlanResolver({ sessionOwns: async () => true, resolve: async () => value as ReturnType<typeof provider> });
    await assert.rejects(resolve(request, owner.id, providerId));
  }
  const unavailable = createOwnedPlanResolver({ sessionOwns: async () => true, resolve: async () => { throw new Error('runtime unavailable or disconnected'); } });
  await assert.rejects(unavailable(request, owner.id, providerId));
});
