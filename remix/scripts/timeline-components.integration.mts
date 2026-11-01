// Real HTTP mutations against an explicitly disposable replica set only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(r => r.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs'); assert.equal(status.custom, false);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
 const response = await fetch(base + path, { method, headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
 return { status: response.status, body: await response.json(), headers: response.headers };
}
async function register() {
 const username = `timeline-components-${randomUUID().slice(0, 8)}`, password = `Timeline-${randomUUID()}-9a!`;
 const result = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
 assert.equal(result.body.ok, true, result.body.error);
 cookie = result.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
 return { username, password, ownerId: result.body.user.id, cookie };
}
const crystal = (name: string, text: string) => ({ name, componentKey: name, version: 1, args: [], render: { tag: 'section', children: [{ tag: 'h2', children: text }, { tag: 'button', props: { 'data-tt-action': 'history-inert-probe' }, children: 'Action probe' }] } });
const publisher = await register();
const shared = await call('/api/v1/things', { thingtime: ['component'], crystal: crystal('shared-card', 'Shared original definition'), visibility: 'public' });
assert.equal(shared.body.ok, true, shared.body.error);
const privateComponent = await call('/api/v1/things', { thingtime: ['component'], crystal: crystal('secret-card', 'DO NOT CAPTURE'), visibility: 'private' });
assert.equal(privateComponent.body.ok, true);
const owner = await register();
const local = await call('/api/v1/things', { thingtime: ['component'], crystal: crystal('saved-card', 'Original recorded definition'), visibility: 'private' });
assert.equal(local.body.ok, true, local.body.error);
const blocks = [
 { type: 'text', id: 'heading', style: 'heading', text: 'Historical page acceptance' },
 { type: 'component', id: 'own', component: 'saved-card' },
 { type: 'component', id: 'shared', component: shared.body.thing.id },
 { type: 'component', id: 'private', component: privateComponent.body.thing.id }
];
const created = await call('/api/v1/things', { thingtime: ['webpage'], crystal: { name: 'Component history acceptance', blocks }, visibility: 'private' });
assert.equal(created.body.ok, true, created.body.error);
const thingId = created.body.thing.id;
const scope = `ownerId=${owner.ownerId}&dataPlane=home`;
const pageHistory = async () => (await call(`/api/v1/timeline?${scope}&thingId=${thingId}`)).body.entries;
const oldEvent = (await pageHistory())[0].event;
assert.equal(oldEvent.dependencies.length, 3);
const readBindings = (id: string) => call(`/api/v1/timeline?${scope}&eventId=${id}&components=1`);
const original = await readBindings(oldEvent.id);
assert.equal(original.status, 200); assert.equal(original.headers.get('cache-control'), 'private, no-store');
assert.equal(original.body.entries.length, 3);
const binding = (result: any, ref: string) => result.entries.find((entry: any) => entry.event.after.value.ref === ref);
assert.equal(binding(original.body, 'saved-card').event.after.value.component.crystal.render.children[0].children, 'Original recorded definition');
assert.equal(binding(original.body, privateComponent.body.thing.id).event.after.value.component, null);
for (const entry of original.body.entries) {
 assert.equal(entry.event.ownerId, owner.ownerId); assert.equal(entry.event.source, 'api'); assert.equal(entry.event.mode, 'revision');
 assert.deepEqual(Object.keys(entry.event.after.value).sort(), ['component', 'ref']);
 if (entry.event.after.value.component) assert.deepEqual(Object.keys(entry.event.after.value.component).sort(), ['crystal', 'id']);
}
// Unchanged references are reused across ordinary API-only page edits.
const changedPage = await call('/api/v1/things', { id: thingId, crystal: { ...created.body.thing.crystal, name: 'Page edited through API' } }, 'PATCH');
assert.equal(changedPage.body.ok, true, changedPage.body.error);
const second = (await pageHistory())[0].event;
assert.deepEqual(second.dependencies, oldEvent.dependencies);
// Component edits and later ACL revocation cannot rewrite the retained version.
const update = await call('/api/v1/things', { id: local.body.thing.id, crystal: crystal('saved-card', 'Current changed definition') }, 'PATCH');
assert.equal(update.body.ok, true, update.body.error);
cookie = publisher.cookie;
const revoke = await call('/api/v1/things', { id: shared.body.thing.id, crystal: crystal('shared-card', 'Changed shared definition'), acl: ['tt:user'] }, 'PATCH');
assert.equal(revoke.body.ok, true, revoke.body.error);
assert.equal((await call(`/api/v1/timeline?ownerId=${publisher.ownerId}&dataPlane=home&eventId=${oldEvent.id}&components=1`)).status, 404);
cookie = owner.cookie;
assert.deepEqual((await readBindings(oldEvent.id)).body, original.body);
const latestPage = await call('/api/v1/things', { id: thingId, crystal: { ...created.body.thing.crystal, name: 'Current component capture' } }, 'PATCH');
assert.equal(latestPage.body.ok, true, latestPage.body.error);
const newest = (await pageHistory())[0].event;
const latestBindings = await readBindings(newest.id);
assert.equal(binding(latestBindings.body, 'saved-card').event.after.value.component.crystal.render.children[0].children, 'Current changed definition');
assert.equal(binding(latestBindings.body, shared.body.thing.id).event.after.value.component, null);
assert.equal(binding(latestBindings.body, privateComponent.body.thing.id).event.id, binding(original.body, privateComponent.body.thing.id).event.id);
const branchId = `branch-${randomUUID()}`;
assert.equal((await call(`/api/v1/timeline?${scope}`, { command: 'create-branch', operationId: randomUUID(), branchId, thingId, eventId: oldEvent.id, expectedRevision: 0, name: 'Recorded definitions' })).body.ok, true);
for (const suffix of ['&components=1', '&eventId=other', '&thingId=other', '&before=1']) assert.equal((await call(`/api/v1/timeline?${scope}&eventId=${oldEvent.id}&components=1${suffix}`)).status, 400);
assert.equal((await call(`/api/v1/timeline?${scope.replace('dataPlane=home', 'dataPlane=custom-other')}&eventId=${oldEvent.id}&components=1`)).status, 409);
cookie = ''; assert.equal((await readBindings(oldEvent.id)).status, 401); cookie = owner.cookie;
if (process.env.TIMELINE_TEST_FIXTURE_PATH) await writeFile(process.env.TIMELINE_TEST_FIXTURE_PATH, JSON.stringify({ ...owner, base, thingId, branchId, componentId: local.body.thing.id, oldEvent, newEvent: newest, originalBindings: original.body, originalCrystal: created.body.thing.crystal, builderPath: `/builder?page=${thingId}&branchId=${branchId}&historyOwner=${owner.ownerId}&dataPlane=home&mode=edit` }, null, 2), { mode: 0o600 });
console.log('PASS: transactional API capture, author-local refs, private foreign refusal, immutable definitions after edit/revocation, unchanged-binding reuse, branch fixture, source/account/input fences');
