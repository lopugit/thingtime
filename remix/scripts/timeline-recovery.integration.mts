// Writes require the dedicated disposable loopback replica; never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { planPublishedComponentCopies } from '../app/api/utils/timeline/publishedComponents';
import { parseTimelineEntry } from '../app/timeline/contract';
import { parsePublishedVersionPreview, type VersionRequest, type PublishedVersionPreview } from '../app/timeline/publishedVersion';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set a disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(base + '/api/v1/mongodb/status').then((r) => r.json());
assert.equal(status.host, '127.0.0.1:20337');
assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false);
let cookie = '';
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, {
		method,
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: response.status, body: await response.json(), headers: response.headers };
}
const username = `recovery-${randomUUID().slice(0, 8)}`,
	password = `Timeline-${randomUUID()}-9a!`;
const registered = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
assert.equal(registered.body.ok, true, registered.body.error);
cookie = registered.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
const account = { username, password, cookie, ownerId: registered.body.user.id };
const scope = `ownerId=${account.ownerId}&dataPlane=home`;
const timeline = (body: unknown) => call(`/api/v1/timeline?${scope}`, body);
async function history(thingId: string) {
	const result = await call(`/api/v1/timeline?${scope}&thingId=${thingId}`);
	assert.equal(result.status, 200, result.body.error);
	return result.body.entries.map(parseTimelineEntry);
}
async function create(kind: string, crystal: any, extra: any = {}) {
	const result = await call('/api/v1/things', { thingtime: [kind], crystal, visibility: 'private', ...extra });
	assert.equal(result.body.ok, true, result.body.error);
	return result.body.thing;
}
async function remove(id: string) {
	const result = await call(`/api/v1/things?id=${id}`, undefined, 'DELETE');
	assert.equal(result.body.ok, true, result.body.error);
}
async function update(id: string, crystal: any) {
	const result = await call('/api/v1/things', { id, crystal }, 'PATCH');
	assert.equal(result.body.ok, true, result.body.error);
}
const read = async (id: string) => (await call(`/api/v1/things?id=${id}`)).body.thing;
const query = (eventId: string): VersionRequest => ({
	command: 'preview-version',
	mode: 'restore',
	recover: true,
	eventId,
	choices: {},
	componentMode: 'recorded',
	componentChoices: {}
});
async function compare(thingId: string, request: VersionRequest) {
	const result = await timeline(request);
	assert.equal(result.status, 200, result.body.error);
	assert.equal(result.headers.get('cache-control'), 'private, no-store');
	return parsePublishedVersionPreview(result.body.preview, request.eventId, thingId, request);
}
const command = (preview: PublishedVersionPreview, request: VersionRequest): VersionRequest => ({
	...request,
	command: 'apply-version',
	operationId: randomUUID(),
	expectedHeadId: preview.expectedHeadId,
	expectedComponents: preview.components!.fingerprint,
	...(preview.recovery ? { expectedRecovery: preview.recoveryFingerprint } : {})
});
const folder = await create('folder', { name: 'Recovery folder' });
const data = await create('data', { title: 'Original public value' }, { visibility: 'public', folderId: folder.id });
const original = (await history(data.id))[0];
await update(data.id, { title: 'Later value' });
await remove(data.id);
const deleted = (await history(data.id))[0];
assert.equal(deleted.event.operation, 'delete');
assert.equal(deleted.event.after, null);
const request = query(original.event.id);
const preview = await compare(data.id, request);
assert.equal(preview.current, null);
assert.equal(preview.recovery, true);
assert.equal(preview.expectedHeadId, deleted.event.id);
assert.deepEqual((preview.result.value as any).acl, ['tt:user']);
assert.equal((preview.result.value as any).folderId, folder.id);
assert.equal((await timeline({ ...request, recover: undefined })).status, 404, 'Old clients cannot recover without explicit support');
const apply = command(preview, request);
const restored = await timeline(apply);
assert.equal(restored.status, 200, restored.body.error);
const receipt = parseTimelineEntry(restored.body.entry);
assert.equal(receipt.event.operation, 'create');
assert.equal(receipt.event.before, null);
assert.deepEqual(receipt.event.parentIds, [deleted.event.id, original.event.id]);
assert.deepEqual((await timeline(apply)).body, restored.body, 'Lost replies reuse the exact receipt');
assert.equal((await timeline({ ...apply, recover: undefined, expectedRecovery: undefined })).status, 409);
const recovered = await read(data.id);
assert.equal(recovered.id, data.id);
assert.deepEqual(recovered.acl, ['tt:user']);
assert.equal(recovered.crystal.title, 'Original public value');
assert.equal(recovered.folderId, folder.id);
assert.equal((await history(data.id)).length, 4);
// ABA: a second recovery/delete cycle must invalidate an older preview.
await remove(data.id);
const stalePreview = await compare(data.id, request),
	stale = command(stalePreview, request);
const winner = command(stalePreview, request);
assert.equal((await timeline(winner)).status, 200);
await remove(data.id);
assert.equal((await timeline(stale)).status, 409);
// Competing recoveries create exactly one new version.
const fresh = await compare(data.id, request);
const competing = await Promise.all([timeline(command(fresh, request)), timeline(command(fresh, request))]);
assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
assert.equal((await history(data.id)).length, 8);
// A disappeared folder falls back to Things root; one lost after preview refuses.
await remove(data.id);
await remove(folder.id);
const rootPreview = await compare(data.id, request);
assert.equal((rootPreview.result.value as any).folderId, null);
assert.equal((await timeline(command(rootPreview, request))).status, 200);
assert.equal((await read(data.id)).folderId, null);
const secondFolder = await create('folder', { name: 'Ephemeral folder' });
const nested = await create('data', { title: 'Nested' }, { folderId: secondFolder.id });
await remove(nested.id);
const nestedQuery = query((await history(nested.id))[0].event.id),
	nestedPreview = await compare(nested.id, nestedQuery);
await remove(secondFolder.id);
// A changed recovery placement requires a fresh preview.
const nestedResult = await timeline(command(nestedPreview, nestedQuery));
assert.equal(nestedResult.status, 409, nestedResult.body.error);
assert.equal((await history(nested.id)).length, 2);
// A deleted page retains its original captured definitions even if shared sources changed.
const definition = (name: string) => ({
	name,
	componentKey: `recovery-card-${account.ownerId}`,
	version: 1,
	render: { tag: 'section', children: name }
});
const component = await create('component', definition('Recorded blue card'));
const pageCrystal = { name: 'Deleted page recovery', blocks: [{ type: 'component', id: 'card', component: component.id }] };
const page = await create('webpage', pageCrystal),
	sibling = await create('webpage', { ...pageCrystal, name: 'Sibling page' });
const pageOriginal = (await history(page.id))[0];
await update(component.id, definition('Current coral card'));
await remove(page.id);
const pageDeleted = (await history(page.id))[0];
assert.deepEqual(pageDeleted.event.dependencies, pageOriginal.event.dependencies);
const pageQuery = query(pageDeleted.event.id),
	pagePreview = await compare(page.id, pageQuery);
assert.equal(pagePreview.components!.copyCount, 1);
assert.deepEqual(pagePreview.components!.current, {});
assert.equal(pagePreview.components!.result[component.id].value!.crystal.render.children, 'Recorded blue card');
const pageApply = command(pagePreview, pageQuery);
await update(component.id, definition('Later amber card'));
assert.equal((await timeline(pageApply)).status, 409, 'Component changes invalidate recovery previews');
const pageFresh = await compare(page.id, pageQuery),
	pageRestored = await timeline(command(pageFresh, pageQuery));
assert.equal(pageRestored.status, 200, pageRestored.body.error);
const recoveredPage = await read(page.id),
	ref = recoveredPage.crystal.blocks[0].component;
assert.notEqual(ref, component.id);
assert.deepEqual((await read(ref)).acl, ['tt:user']);
assert.equal((await read(ref)).crystal.render.children, 'Recorded blue card');
assert.deepEqual((await read(sibling.id)).crystal, sibling.crystal);
assert.equal((await read(component.id)).crystal.render.children, 'Later amber card');
assert.equal((await history(page.id)).length, 3);
assert.equal((await history(ref)).length, 1);
const branches = await call(`/api/v1/timeline?${scope}&thingId=${page.id}&branches=1`);
assert.equal(branches.status, 200);
assert.deepEqual(branches.body.branches, [], 'Published pointers are not editable variations');
assert.equal((await timeline({ ...pageQuery, mode: 'merge' })).status, 400);
assert.equal((await call(`/api/v1/timeline?ownerId=other&dataPlane=home`, pageQuery)).status, 409);
cookie = '';
assert.equal((await timeline(pageQuery)).status, 401);
cookie = account.cookie;
// Failure of the second deterministic copy rolls back the first, recovery and all receipts.
const secondComponent = await create('component', { ...definition('Second recorded card'), componentKey: `second-${account.ownerId}` });
const multi = await create('webpage', {
	name: 'Atomic recovery',
	blocks: [...pageCrystal.blocks, { type: 'component', id: 'second', component: secondComponent.id }]
});
await remove(multi.id);
const multiQuery = query((await history(multi.id))[0].event.id),
	multiPreview = await compare(multi.id, multiQuery),
	multiApply = command(multiPreview, multiQuery);
const plan = planPublishedComponentCopies(multiApply.operationId!, multiPreview.result.value, multiPreview.components!.result);
assert.equal(plan.copies.length, 2);
await create('component', plan.copies[1].crystal, { shareId: plan.copies[1].shareId });
const baselineBytes = (await call('/api/v1/auth/me')).body.user.storage.usedBytes;
assert.equal((await timeline(multiApply)).status, 409);
assert.equal((await call('/api/v1/auth/me')).body.user.storage.usedBytes, baselineBytes);
assert.equal((await call(`/api/v1/things?id=${multi.id}`)).status, 404);
assert.equal((await call(`/api/v1/things?id=${plan.copies[0].shareId}`)).status, 404);
assert.equal((await history(multi.id)).length, 2);
assert.equal((await history(plan.copies[0].shareId)).length, 0);
// A private foreign occupant cannot be overwritten through the original owner's history.
const collision = await create('data', { title: 'Original identity' });
await remove(collision.id);
const collisionQuery = query((await history(collision.id))[0].event.id);
const outsiderName = `collision-${randomUUID().slice(0, 8)}`;
const outsider = await call('/api/v1/auth/register', { username: outsiderName, password, email: `${outsiderName}@example.invalid` });
assert.equal(outsider.body.ok, true, outsider.body.error);
cookie = outsider.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
await create('data', { title: 'Private foreign occupant' }, { shareId: collision.id });
cookie = account.cookie;
const collisionResult = await timeline(collisionQuery);
assert.equal(collisionResult.status, 409);
assert.equal(JSON.stringify(collisionResult.body).includes('Private foreign occupant'), false);
// Leave a deleted page for rendered recovery validation, with no production writes.
await remove(page.id);
await writeFile(
	'/tmp/thingtime-recovery-fixture.json',
	JSON.stringify({ ...account, page, component, sibling, url: `/history?thing=${page.id}`, deletion: (await history(page.id))[0].event.id }),
	{ mode: 0o600 }
);
console.log(
	'Deleted Thing recovery passed: private original identity, immutable history, exact retry, stale/ABA and concurrent recoveries, folder placement, retained component captures, isolated copies, source/auth gates and hidden Published pointers.'
);
