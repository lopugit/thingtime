// Writes require the dedicated disposable loopback replica; never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { parseTimelineEntry } from '../app/timeline/contract';
import { parseRelatedTimelineScope } from '../app/timeline/relatedHistory';
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
async function register() {
	const username = `related-${randomUUID().slice(0, 8)}`,
		password = `Timeline-${randomUUID()}-9a!`;
	const result = await call('/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
	assert.equal(result.body.ok, true, result.body.error);
	cookie = result.headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
	return { username, password, cookie, ownerId: result.body.user.id };
}
async function create(kind: string, crystal: any, visibility = 'private') {
	const result = await call('/api/v1/things', { thingtime: [kind], crystal, visibility });
	assert.equal(result.body.ok, true, result.body.error);
	return result.body.thing;
}
async function update(id: string, crystal: any) {
	const result = await call('/api/v1/things', { id, crystal }, 'PATCH');
	assert.equal(result.body.ok, true, result.body.error);
}
const definition = (name: string, action?: string) => ({
	name,
	componentKey: `related-${randomUUID()}`,
	version: 1,
	...(action ? { source: { action } } : {}),
	render: { tag: 'section', children: name }
});
await register();
const foreignAction = await create('action', {
	name: 'Foreign private action',
	actionKey: 'foreign-related-action',
	capabilities: [],
	steps: [{ op: 'return', value: 'private author result' }]
});
const shared = await create('component', definition('Public shared card', foreignAction.id), 'public');
const foreignPage = await create('webpage', { name: 'Foreign page', blocks: [] }, 'public');
const account = await register();
const scope = `ownerId=${account.ownerId}&dataPlane=home`;
const old = await create('component', definition('Earlier card'));
const schema = await create('schema', { name: 'Related schema', fields: [{ name: 'title', type: 'string' }] });
const data = await create('data', { title: 'Related data', schemaId: schema.id });
const action = await create('action', {
	name: 'Read related data',
	actionKey: 'read-related',
	capabilities: [{ capability: 'things.read' }],
	steps: [
		{ op: 'things.get', id: data.id, as: 'result' },
		{ op: 'return', value: '{{result}}' }
	]
});
const component = await create('component', definition('Related card', action.id));
const crystal = {
	name: 'Page and related history',
	blocks: [
		{ type: 'component', id: 'own', component: component.id },
		{ type: 'component', id: 'shared', component: shared.id }
	]
};
const page = await create('webpage', crystal);
const unrelated = await create('data', { title: 'Unrelated data' });
const url = `/api/v1/timeline?${scope}&thingId=${page.id}&related=1`;
async function related(extra = '') {
	const result = await call(url + extra);
	assert.equal(result.status, 200, result.body.error);
	assert.equal(result.headers.get('cache-control'), 'private, no-store');
	parseRelatedTimelineScope(result.body.related, page.id);
	result.body.entries.forEach(parseTimelineEntry);
	return result.body;
}
let current = await related();
const owned = [page.id, component.id, action.id, data.id, schema.id].sort();
assert.deepEqual(current.related.thingIds, owned);
assert.equal(current.related.sharedCount, 2);
assert.equal(current.entries.length, 5);
assert.ok(current.entries.every((entry: any) => entry.event.ownerId === account.ownerId && owned.includes(entry.event.thingId)));
for (const id of owned) {
	const single = await call(`/api/v1/timeline?${scope}&thingId=${id}`);
	assert.deepEqual(
		current.entries.find((entry: any) => entry.event.thingId === id),
		single.body.entries[0],
		'Exact canonical records are reused'
	);
}
assert.ok(!JSON.stringify(current).includes(foreignAction.id));
assert.ok(!JSON.stringify(current).includes(unrelated.id));
const all: any[] = [];
let next: number | null = null;
do {
	const part = await related(`&limit=2${next === null ? '' : `&before=${next}&relatedRevision=${current.related.revision}`}`);
	all.push(...part.entries);
	next = part.nextBefore;
} while (next !== null);
assert.deepEqual(all, current.entries);
const latest = current.entries[0].receipt.position;
await update(component.id, { ...component.crystal, name: 'Card changed through API' });
const live = await related(`&after=${latest}&relatedRevision=${current.related.revision}`);
assert.deepEqual(
	live.entries.map((entry: any) => entry.event.thingId),
	[component.id]
);
assert.equal(live.related.revision, current.related.revision);
await update(page.id, { ...crystal, blocks: [...crystal.blocks, { type: 'component', id: 'old', component: old.id }] });
const added = await related(`&after=${live.entries[0].receipt.position}&relatedRevision=${current.related.revision}`);
assert.equal(added.reset, true);
assert.ok(added.entries.some((entry: any) => entry.event.thingId === old.id && entry.receipt.position < latest));
await update(page.id, { ...crystal, blocks: [{ type: 'component', id: 'old', component: old.id }] });
const removed = await related(`&before=${latest}&relatedRevision=${added.related.revision}`);
assert.equal(removed.reset, true);
assert.deepEqual(removed.related.thingIds, [old.id, page.id].sort());
assert.ok(removed.entries.every((entry: any) => [old.id, page.id].includes(entry.event.thingId)));
for (const id of [foreignPage.id, component.id]) assert.equal((await call(`/api/v1/timeline?${scope}&thingId=${id}&related=1`)).status, 404);
for (const extra of ['&after=1', '&relatedRevision=invalid', '&eventId=abc', '&related=1']) assert.equal((await call(url + extra)).status, 400);
assert.equal((await call(url.replace(account.ownerId, 'other'))).status, 409);
assert.equal((await call(url.replace('dataPlane=home', 'dataPlane=other'))).status, 409);
cookie = '';
assert.equal((await call(url)).status, 401);
cookie = account.cookie;
// Leave a useful, non-sensitive demo dataset in the isolated replica only.
await update(page.id, crystal);
current = await related();
await writeFile(
	'/tmp/thingtime-related-history-fixture.json',
	JSON.stringify({
		...account,
		page,
		component,
		action,
		data,
		schema,
		old,
		shared,
		url: `/history?thing=${page.id}&scope=related`,
		revision: current.related.revision
	}),
	{ mode: 0o600 }
);
console.log(
	'Related Timeline integration passed: canonical records, five-kind composition, private foreign history, paging, live API edits, membership reset, ownership/source/auth/query gates.'
);
