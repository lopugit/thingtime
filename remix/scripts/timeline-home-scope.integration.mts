// Opt-in acceptance on a guarded disposable replica, using only HTTP writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { eventFixture } from '../app/timeline/testFixtures.ts';

const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then(response => response.json());
assert.equal(status.host, '127.0.0.1:20337'); assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false); assert.equal(status.connected, true);
const customUrl = `mongodb://127.0.0.1:20337/timeline_scope_${randomUUID().replaceAll('-', '')}?replicaSet=timeline-rs`;
let cookie = '';
async function call(path: string, body?: unknown, custom = false, authenticated = true, headerUrl = customUrl) {
	const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: {
		Origin: base!, 'Content-Type': 'application/json', ...(authenticated ? { Cookie: cookie } : {}), ...(custom ? { 'x-tt-mongo-url': headerUrl } : {})
	}, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { response, data: await response.json() };
}
const username = `timeline-scope-${randomUUID().slice(0, 8)}`, password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.data.ok, true, registered.data.error);
cookie = registered.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
const ownerId = registered.data.user.id;
const created = await call('/api/v1/things', { thingtime: ['data'], crystal: { name: 'Home scoped Thing', value: 'initial' }, visibility: 'private' });
assert.equal(created.data.ok, true, created.data.error);
const thingId = created.data.thing.id;
const theme = await call('/api/v1/themes', { name: 'Home history theme', theme: { colors: { accent: '#9173bb' } }, visibility: 'private' }, true);
assert.equal(theme.data.ok, true, theme.data.error);
const customDiscovery = await call(`/api/v1/timeline?ownerId=${ownerId}`, undefined, true);
assert.equal(customDiscovery.data.ok, true, customDiscovery.data.error);
const customPlane = customDiscovery.data.dataPlane; assert.match(customPlane, /^custom-/);
const homeDiscovery = await call(`/api/v1/timeline?ownerId=${ownerId}&storage=home`, undefined, true);
assert.equal(homeDiscovery.data.dataPlane, 'home');
assert.equal((await call(`/api/v1/timeline?ownerId=${ownerId}`, undefined, true, true, 'mongodb://127.0.0.1:20337/thingtime?replicaSet=timeline-rs')).data.dataPlane, 'home');
const homeQuery = `ownerId=${ownerId}&dataPlane=home&storage=home`;
const customQuery = `ownerId=${ownerId}&dataPlane=${customPlane}`;
const page = async (query: string, id = thingId) => {
	const result = await call(`/api/v1/timeline?${query}&thingId=${id}`, undefined, true);
	assert.equal(result.data.ok, true, result.data.error); return result.data.entries;
};
const baseVersion = (await page(homeQuery))[0].event;
const sameId = randomUUID();
const draft = (label: string) => eventFixture(sameId, { ownerId, actorId: ownerId, thingId, label, occurredAt: new Date().toISOString() });
for (const [query, label] of [[homeQuery, 'Home-only draft'], [customQuery, 'Custom-only draft']]) {
	const saved = await call(`/api/v1/timeline?${query}`, draft(label), true);
	assert.equal(saved.data.ok, true, saved.data.error); assert.equal(saved.data.entry.event.label, label);
}
const homeRows = await page(homeQuery), customRows = await page(customQuery);
assert.equal(homeRows.length, 2); assert.equal(customRows.length, 1);
assert.equal(customRows[0].event.label, 'Custom-only draft');
assert.equal(homeRows.find((row: any) => row.event.id === sameId).event.label, 'Home-only draft');
assert.equal((await page(homeQuery, theme.data.theme.id))[0].event.label, 'Created theme');
assert.equal((await page(customQuery, theme.data.theme.id)).length, 0);
for (const [query, label] of [[homeQuery, 'Home-only draft'], [customQuery, 'Custom-only draft']]) {
	const entry = await call(`/api/v1/timeline?${query}&eventId=${sameId}`, undefined, true);
	assert.equal(entry.data.entry.event.label, label);
}
const branchId = `branch-${randomUUID()}`;
const branch = await call(`/api/v1/timeline?${homeQuery}`, { command: 'create-branch', operationId: randomUUID(), branchId, thingId, eventId: baseVersion.id, expectedRevision: 0, name: 'Home experiment' }, true);
assert.equal(branch.data.ok, true, branch.data.error);
assert.equal((await call(`/api/v1/timeline?${homeQuery}&thingId=${thingId}&branches=1`, undefined, true)).data.branches.length, 1);
assert.equal((await call(`/api/v1/timeline?${customQuery}&thingId=${thingId}&branches=1`, undefined, true)).data.branches.length, 0);
const preview = await call(`/api/v1/timeline?${homeQuery}`, { command: 'preview-version', mode: 'restore', eventId: baseVersion.id }, true);
assert.equal(preview.data.ok, true, preview.data.error);
const apply = await call(`/api/v1/timeline?${homeQuery}`, { command: 'apply-version', mode: 'restore', eventId: baseVersion.id, expectedHeadId: preview.data.preview.expectedHeadId, operationId: randomUUID(), choices: {} }, true);
assert.equal(apply.data.ok, true, apply.data.error);
assert.equal((await call(`/api/v1/things?id=${thingId}`)).data.thing.timelineHeadId, apply.data.entry.event.id);
assert.equal((await page(customQuery)).length, 1, 'Home restore cannot change selected-database history');
for (const query of [`ownerId=${ownerId}&dataPlane=home`, `${customQuery}&storage=home`, homeQuery.replace(ownerId, 'another-account')]) {
	assert.equal((await call(`/api/v1/timeline?${query}&thingId=${thingId}`, undefined, true)).response.status, 409);
}
assert.equal((await call(`/api/v1/timeline?${homeQuery}&thingId=${thingId}`, undefined, true, false)).response.status, 401);
for (const suffix of ['&storage=selected', '&storage=elsewhere']) assert.equal((await call(`/api/v1/timeline?${homeQuery}${suffix}`, undefined, true)).response.status, 400);
await Promise.all(Array.from({ length: 12 }, async (_, i) => {
	const query = i % 2 ? homeQuery : customQuery;
	const result = await call(`/api/v1/timeline?${query}&eventId=${sameId}`, undefined, true);
	assert.equal(result.data.entry.event.label, i % 2 ? 'Home-only draft' : 'Custom-only draft');
}));
assert.equal((await call('/api/v1/mongodb/status', undefined, true)).data.custom, true);
// The public root identity and the dispatcher use the exact Timeline key.
const customRoot = await call('/api/root-data', undefined, true);
assert.equal(customRoot.data.dataPlane, customPlane);
assert.equal((await call('/api/root-data')).data.dataPlane, 'home');
async function fenced(path: string, plane: string, custom: boolean, method = 'GET', body?: unknown) {
	const response = await fetch(base + path, { method, headers: { Origin: base!, Cookie: cookie, 'Content-Type': 'application/json',
		'X-Thingtime-Expected-Data-Plane': plane, ...(custom ? { 'x-tt-mongo-url': customUrl } : {}) },
		...(body === undefined ? {} : { body: JSON.stringify(body) }) });
	return { response, data: await response.json() };
}
const sameThing = await fenced('/api/v1/things', customPlane, true, 'PUT', { id: thingId, thingtime: ['data'], crystal: { name: 'Custom scoped Thing', value: 'custom-original' }, visibility: 'private' });
assert.equal(sameThing.data.ok, true, sameThing.data.error);
assert.equal((await fenced(`/api/v1/things?id=${thingId}`, 'home', false)).data.thing.crystal.name, 'Home scoped Thing');
assert.equal((await fenced(`/api/v1/things?id=${thingId}`, customPlane, true)).data.thing.crystal.name, 'Custom scoped Thing');
const customBefore = await page(customQuery), homeBefore = await page(homeQuery);
for (const method of ['GET', 'PATCH', 'DELETE']) {
	const refused = await fenced(method === 'GET' ? `/api/v1/things?id=${thingId}` : '/api/v1/things', 'home', true, method,
		method === 'GET' ? undefined : { id: thingId, crystal: { name: 'Wrong database', value: 'must-not-write' } });
	assert.equal(refused.response.status, 409); assert.equal(refused.data.code, 'DATA_PLANE_CHANGED');
}
assert.equal((await fenced(`/api/v1/things?id=${thingId}`, 'invalid-location', true)).response.status, 400);
assert.deepEqual(await page(customQuery), customBefore); assert.deepEqual(await page(homeQuery), homeBefore);
assert.equal((await fenced(`/api/v1/things?id=${thingId}`, customPlane, true)).data.thing.crystal.value, 'custom-original');
// Explicit home history still fences the browser selection before routing home.
assert.equal((await fenced(`/api/v1/timeline?${homeQuery}&thingId=${thingId}`, customPlane, true)).data.ok, true);
assert.equal((await fenced(`/api/v1/timeline?${homeQuery}&thingId=${thingId}`, 'home', true)).response.status, 409);
const customEdit = await fenced('/api/v1/things', customPlane, true, 'PATCH', { id: thingId, crystal: { name: 'Custom scoped Thing', value: 'custom-updated' } });
assert.equal(customEdit.data.ok, true, customEdit.data.error);
assert.equal((await fenced(`/api/v1/things?id=${thingId}`, customPlane, true)).data.thing.crystal.value, 'custom-updated');
assert.deepEqual(await page(homeQuery), homeBefore);
assert.equal((await page(customQuery)).length, customBefore.length + 1);
await writeFile('/tmp/thingtime-timeline-home-scope-fixture.json', JSON.stringify({ base, username, password, cookie, ownerId, thingId, themeId: theme.data.theme.id, folderId: homeDiscovery.data.folderId, customUrl, customPlane }), { mode: 0o600 });
console.log(JSON.stringify({ ok: true, checks: ['explicit-home-discovery', 'same-home-uri-normalization', 'same-event-id-distinct-databases', 'theme-home-history', 'home-branch-and-restore', 'account-plane-refusals', 'concurrent-context-isolation', 'root-data-plane', 'same-id-live-things', 'stale-read-write-fence', 'selected-plane-before-home-routing'] }));
