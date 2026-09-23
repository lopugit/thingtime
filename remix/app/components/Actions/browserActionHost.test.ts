import assert from 'node:assert/strict';
import test from 'node:test';
import { createBrowserActionHost, readActionResponse, finishBrowserAction } from './browserActionHost';
import { enforceExpectedActor, EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { createApiCapabilitiesManifest } from '~/docs/apiDocs';
import { capabilitySatisfies } from '~/api/utils/capabilities/capabilityContract';

const step = { path: '/api/v1/things', method: 'GET', feature: 'api.things', minimumVersion: '1.28.0', maxResultBytes: 65536, query: { q: 'a & b', limit: 20, flag: false } };
const signal = () => AbortSignal.timeout(5000);
test('browser host negotiates origin capabilities and pins encoded requests to the prepared actor', async () => {
 const features: string[] = [];
 const host = createBrowserActionHost(() => 'actor', (async (url, init) => {
  assert.equal(String(url), '/api/v1/things?q=a+%26+b&limit=20&flag=false');
  assert.equal(init?.credentials, 'same-origin');
  assert.equal(init?.redirect, 'error');
  assert.equal(new Headers(init?.headers).get(EXPECTED_ACTOR_HEADER), 'actor');
  return Response.json({ ok: true, items: ['0012'] });
 }) as typeof fetch, async (feature, version) => { features.push(`${feature}@${version}`); });
 assert.deepEqual(await host.request(step, 'actor', signal()), { ok: true, items: ['0012'] });
 assert.deepEqual(features, ['api.actions-run@1.7.0', 'api.things@1.28.0']);
});
test('unknown capability, switched actor, remote URL and non-scalar query stop before transport', async () => {
 let count = 0;
 const transport = (async () => { count++; return Response.json({}); }) as typeof fetch;
 const host = createBrowserActionHost(() => 'actor', transport, async () => {});
 await assert.rejects(host.request(step, 'other', signal()), /account changed/);
 await assert.rejects(host.request({ ...step, path: 'https://example.com' }, 'actor', signal()), /destination/);
 await assert.rejects(host.request({ ...step, query: { q: {} } }, 'actor', signal()), /Query values/);
 const unsupported = createBrowserActionHost(() => 'actor', transport, async () => { throw new Error('Unsupported capability'); });
 await assert.rejects(unsupported.request(step, 'actor', signal()), /capability/);
 assert.equal(count, 0);
});
test('response streaming stops at the byte limit before parsing', async () => {
 let cancelled = false;
 const response = new Response(new ReadableStream({
  start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(257))); },
  cancel() { cancelled = true; }
 }));
 await assert.rejects(readActionResponse(response, 256, signal()), /byte budget/);
 assert.equal(cancelled, true);
});
test('server actor fence rejects another account or expired session, and is opt-in for ordinary callers', async () => {
 for (const actor of [{ id: 'other' }, null]) {
  const result = await enforceExpectedActor(new Request('https://example.test/api/v1/things', { headers: { [EXPECTED_ACTOR_HEADER]: 'actor' } }), async () => actor);
  assert.equal(result?.status, 409);
 }
 assert.equal(await enforceExpectedActor(new Request('https://example.test/api/v1/things'), async () => { assert.fail('Unfenced requests retain normal auth'); }), null);
 assert.equal(await enforceExpectedActor(new Request('https://example.test/api/v1/things', { headers: { [EXPECTED_ACTOR_HEADER]: 'actor' } }), async () => ({ id: 'actor' })), null);
});
test('browser results report only executed/skipped steps and never invent a persisted run id', async () => {
 const response = await finishBrowserAction({ ok: true, status: 'prepared', execution: 'browser', actionId: 'a', viewer: { id: 'actor' }, inputs: {}, program: {
  name: 'Return early', runtime: 'browser', steps: [{ op: 'compute', when: false, value: 1 }, { op: 'return', when: true, value: 0 }, { op: 'compute', value: 3 }]
 } }, createBrowserActionHost(() => 'actor'));
 assert.equal(response.result, 0); assert.equal(response.opsUsed, 2); assert.equal(response.runId, undefined);
 assert.deepEqual(response.trace.map((entry) => entry.status), ['skipped', 'ok']);
});
test('manifest declares the new authoring and execution contracts', () => {
 const features = createApiCapabilitiesManifest().features;
 for (const [feature, required] of Object.entries({ 'api.actions-run': '1.8.0', 'api.things': '1.29.0', 'api.things-update': '1.6.0' })) {
  assert.ok(capabilitySatisfies(features[feature], required), feature);
 }
 assert.equal(capabilitySatisfies('1.6.0', '1.7.0'), false);
 assert.equal(capabilitySatisfies('2.0.0', '1.7.0'), false);
});


test('pagination refuses an origin without its runtime contract before making the first request', async () => {
 let requests = 0;
 const host = createBrowserActionHost(() => 'actor', (async () => { requests++; return Response.json({}); }) as typeof fetch,
  async (feature, version) => {
   if (feature === 'api.actions-run' && !capabilitySatisfies('1.7.0', version)) throw new Error('Pagination is unavailable');
  });
 await assert.rejects(host.request({ ...step, runtimeVersion: '1.8.0' }, 'actor', signal()), /Pagination is unavailable/);
 assert.equal(requests, 0);
});
