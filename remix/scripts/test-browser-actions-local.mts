// Opt-in full HTTP regression against the task's disposable loopback replica.
// No direct database access and no production account credentials.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createBrowserActionHost, finishBrowserAction } from '../app/components/Actions/browserActionHost';
import { capabilitySatisfies } from '../app/api/utils/capabilities/capabilityContract';
assert.equal(process.env.TT_BROWSER_ACTION_TEST_LOCAL, '1');
const origin = 'http://127.0.0.1:17120';
const health = await (await fetch(`${origin}/api/v1/health/mongodb`)).json();
assert.equal(health.connected, true);
assert.ok(JSON.stringify(health).includes('127.0.0.1:17123'), 'Use the dedicated local replica only');
const manifest = await (await fetch(`${origin}/.well-known/thingtime-capabilities.json`)).json();
assert.equal(manifest.origin, origin);
const check = async (feature: string, minimum: string) => assert.ok(capabilitySatisfies(manifest.features[feature]?.version, minimum), feature);
const client = () => {
 let cookie = '';
 const request = async (path: string, body?: unknown, extra: Record<string, string> = {}, method = body === undefined ? 'GET' : 'POST') => {
  const response = await fetch(new URL(path, origin), { method, headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const set = response.headers.getSetCookie();
  if (set.length) cookie = set.map((entry) => entry.split(';')[0]).join('; ');
  return { status: response.status, data: await response.json() };
 };
 return { request, transport: (async (url, init) => fetch(new URL(String(url), origin), { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), Origin: origin, Cookie: cookie } })) as typeof fetch };
};
const owner = client(), stranger = client();
const suffix = randomUUID().slice(0, 8);
const register = async (who: ReturnType<typeof client>, name: string) => {
 const response = await who.request('/api/v1/auth/register', { username: `flows-${name}-${suffix}`, password: 'Local-fixture-password-2026!', email: `flows-${name}-${suffix}@example.invalid` });
 assert.equal(response.data.ok, true, JSON.stringify({ status: response.status, error: response.data.error }));
 return response.data.user;
};
const user = await register(owner, 'owner'); await register(stranger, 'stranger');
const create = async (crystal: any, thingtime = ['action']) => {
 const response = await owner.request('/api/v1/things', { thingtime, crystal });
 assert.equal(response.data.ok, true, JSON.stringify(response.data)); return response.data.thing;
};
const request = { op: 'http.request', method: 'POST', path: '/api/v1/things', feature: 'api.things', minimumVersion: '1.28.0', body: { thingtime: ['data'], acl: ['tt:user'], crystal: { title: '$input.title', serial: '0012' } } };
const program = { name: 'Create record in browser', actionKey: `browser-create-${suffix}`, runtime: 'browser', inputs: [{ name: 'title', type: 'string', required: true }], capabilities: [{ capability: 'http.request', endpoints: ['POST /api/v1/things'] }], steps: [request, { op: 'return', value: '$step.1.thing' }] };
const action = await create(program);
const run = (input: any) => owner.request('/api/v1/actions/run', { action: action.id, inputs: { title: 'Browser flow record' }, source: 'component', ...input });
assert.equal((await run({})).status, 409, 'Old clients must not claim success');
assert.equal((await stranger.request('/api/v1/actions/run', { action: action.id, execution: 'browser', source: 'component', inputs: { title: 'Forbidden' } })).status, 404);
const prepared = await run({ execution: 'browser' });
assert.equal(prepared.status, 200); assert.equal(prepared.data.status, 'prepared');
assert.equal(prepared.data.viewer.id, user.id);
const before = await owner.request(`/api/v1/actions/runs?action=${action.id}`);
assert.equal(before.data.runs.length, 0, 'Preparing does not forge execution history');
const host = createBrowserActionHost(() => user.id, owner.transport, check);
const result = await finishBrowserAction(prepared.data, host);
assert.equal(result.status, 'ok', result.error); assert.equal(result.result.crystal.serial, '0012');
assert.equal(result.opsUsed, 2); assert.equal(result.runId, undefined);
const saved = (await owner.request(`/api/v1/things?id=${result.result.id}`)).data.thing;
assert.equal(saved.crystal.title, 'Browser flow record');
assert.equal((await stranger.request(`/api/v1/things?id=${saved.id}`)).status, 404);
const denied = await owner.request('/api/v1/things', { thingtime: ['data'], crystal: { title: 'Must never save' } }, { 'X-Thingtime-Expected-Actor': 'different-account' });
assert.equal(denied.status, 409);
const listings = await owner.request('/api/v1/things?thingtime=data&limit=100');
assert.equal(listings.data.things.some((thing: any) => thing.crystal.title === 'Must never save'), false);
const revision = await owner.request('/api/v1/things', { id: action.id, crystal: { ...program, description: 'Edited through the same contract as Builder' }, replaceCrystal: true, expectedUpdatedAt: action.updatedAt }, {}, 'PATCH');
assert.equal(revision.data.ok, true, JSON.stringify(revision.data));
const stale = await owner.request('/api/v1/things', { id: action.id, crystal: program, replaceCrystal: true, expectedUpdatedAt: action.updatedAt }, {}, 'PATCH');
assert.equal(stale.status, 409, 'Stale editor must preserve the newer definition');
const final = (await owner.request(`/api/v1/things?id=${action.id}`)).data.thing;
assert.equal(final.crystal.description, 'Edited through the same contract as Builder');
console.log('PASS: HTTP Action authoring, owner-only preparation, old-client refusal, actual browser transport, record persistence, actor fence, private ACL and stale-definition conflict.');
