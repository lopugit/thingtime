// HTTP-only fixture/acceptance on the explicitly disposable local replica set.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then((response) => response.json());
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
	return { status: response.status, body: await response.json() };
}
const username = `visual-branch-${randomUUID().slice(0, 8)}`,
	password = `Timeline-${randomUUID()}-9a!`;
const registration = await fetch(base + '/api/v1/auth/register', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username, password, email: `${username}@example.invalid` })
});
const account = await registration.json();
assert.equal(account.ok, true);
const ownerId = account.user.id;
cookie = registration.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
const scope = `ownerId=${ownerId}&dataPlane=home`;
const component = await call('/api/v1/things', {
	thingtime: ['component'],
	crystal: {
		name: 'Branch card',
		componentKey: 'branch-card',
		version: 1,
		args: [{ name: 'label', type: 'string', default: 'Original card' }],
		render: {
			tag: 'section',
			children: [
				{ tag: 'h2', children: '{label}' },
				{ tag: 'button', props: { 'data-tt-action': 'branch-inert-probe' }, children: 'Action probe' }
			]
		}
	},
	visibility: 'private'
});
assert.equal(component.body.ok, true, component.body.error);
const page = await call('/api/v1/things', {
	thingtime: ['webpage'],
	crystal: {
		name: 'Visual branch acceptance',
		blocks: [
			{ type: 'text', id: 'heading', text: 'Published heading', style: 'heading' },
			{ type: 'component', id: 'card', component: component.body.thing.id, args: { label: 'Published card' } }
		]
	},
	visibility: 'private'
});
assert.equal(page.body.ok, true, page.body.error);
const thingId = page.body.thing.id;
const root = (await call(`/api/v1/timeline?${scope}&thingId=${thingId}`)).body.entries[0].event;
const branchId = `branch-${randomUUID()}`;
const named = await call(`/api/v1/timeline?${scope}`, {
	command: 'create-branch',
	operationId: randomUUID(),
	branchId,
	thingId,
	eventId: root.id,
	expectedRevision: 0,
	name: 'Visual experiment'
});
assert.equal(named.body.ok, true, named.body.error);
const previewPath = `/api/v1/webpages/resolve?${scope}`;
const preview = await call(previewPath, { blocks: root.after.value.crystal.blocks });
assert.equal(preview.status, 200);
assert.equal(preview.body.refs[component.body.thing.id], component.body.thing.id);
assert.equal(preview.body.components[0].crystal.name, 'Branch card');
assert.equal((await call(previewPath + '&page=foreign', { blocks: [] })).status, 400);
assert.equal((await call(previewPath.replace('dataPlane=home', 'dataPlane=custom-other'), { blocks: [] })).status, 409);
assert.deepEqual((await call(`/api/v1/things?id=${thingId}`)).body.thing.crystal, page.body.thing.crystal);
// A guessed component from another signed-in account cannot inherit this draft's audience.
const firstCookie = cookie;
const secondName = `branch-reader-${randomUUID().slice(0, 8)}`;
const second = await fetch(base + '/api/v1/auth/register', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username: secondName, password, email: `${secondName}@example.invalid` })
});
const secondAccount = await second.json();
assert.equal(secondAccount.ok, true);
cookie = second.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; ');
const denied = await call(`/api/v1/webpages/resolve?ownerId=${secondAccount.user.id}&dataPlane=home`, { blocks: root.after.value.crystal.blocks });
assert.equal(denied.status, 200);
assert.equal(denied.body.refs[component.body.thing.id], null);
assert.deepEqual(denied.body.components, []);
cookie = firstCookie;
if (process.env.TIMELINE_TEST_FIXTURE_PATH)
	await writeFile(
		process.env.TIMELINE_TEST_FIXTURE_PATH,
		JSON.stringify(
			{
				base,
				username,
				password,
				cookie,
				ownerId,
				thingId,
				branchId,
				componentId: component.body.thing.id,
				originalCrystal: page.body.thing.crystal,
				originalEvent: root,
				builderPath: `/builder?page=${thingId}&branchId=${branchId}&historyOwner=${ownerId}&dataPlane=home&mode=edit`
			},
			null,
			2
		),
		{ mode: 0o600 }
	);
console.log('PASS: visual branch fixture, batched private component preview, source guards, no borrowed audience and unchanged published page');
