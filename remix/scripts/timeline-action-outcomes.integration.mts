// Real APIs only, on the disposable loopback replica. Never production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { parseTimelineEntry } from '../app/timeline/contract';
import { readActionOutcome } from '../app/timeline/actionOutcome';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(base + '/api/v1/mongodb/status').then((r) => r.json());
assert.equal(status.host, '127.0.0.1:20337');
assert.equal(status.replicaSet, 'timeline-rs');
assert.equal(status.custom, false);
async function call(cookie: string, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, {
		method,
		headers: { Cookie: cookie, Origin: base!, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: response.status, data: await response.json(), headers: response.headers };
}
const cookies = (headers: Headers) =>
	headers
		.getSetCookie()
		.map((value) => value.split(';')[0])
		.join('; ');
async function register() {
	const username = `outcome-${randomUUID().slice(0, 8)}`,
		password = `Timeline-${randomUUID()}-9a!`;
	const response = await call('', '/api/v1/auth/register', { username, password, email: `${username}@example.invalid` });
	assert.equal(response.data.ok, true, response.data.error);
	return { username, password, ownerId: response.data.user.id, cookie: cookies(response.headers) };
}
const owner = await register();
const other = await register();
const query = (account = owner) => `ownerId=${account.ownerId}&dataPlane=home`;
async function history(id: string, account = owner) {
	const result = await call(account.cookie, `/api/v1/timeline?${query(account)}&thingId=${id}`);
	assert.equal(result.status, 200, result.data.error);
	assert.equal(result.headers.get('cache-control'), 'private, no-store');
	return result.data.entries.map(parseTimelineEntry);
}
async function create(kind: string, crystal: any, visibility = 'private') {
	const result = await call(owner.cookie, '/api/v1/things', { thingtime: [kind], crystal, visibility });
	assert.equal(result.data.ok, true, result.data.error);
	return result.data.thing;
}
const secret = `private-input-${randomUUID()}`;
const action = await create(
	'action',
	{
		name: 'Timeline execution receipt',
		actionKey: `outcomes-${randomUUID()}`,
		inputs: [{ name: 'value', type: 'string', required: true }],
		capabilities: [],
		steps: [{ op: 'return', value: '$input.value' }]
	},
	'public'
);
const before = await call(owner.cookie, `/api/v1/things?id=${action.id}`);
const run = await call(owner.cookie, '/api/v1/actions/run', { action: action.id, inputs: { value: secret } });
assert.equal(run.data.status, 'ok', run.data.error);
assert.equal(run.data.result, secret);
assert.equal(run.data.history.status, 'recorded');
const events = await history(action.id);
assert.equal(events.length, 3);
const [end, start] = events;
assert.equal(end.event.id, run.data.history.outcomeEventId);
assert.equal(start.event.id, run.data.history.startedEventId);
assert.equal(readActionOutcome(start.event)?.status, 'started');
assert.equal(readActionOutcome(end.event)?.status, 'ok');
assert.equal(readActionOutcome(end.event)?.runId, run.data.runId);
assert.deepEqual(end.event.parentIds, [start.event.id]);
assert.equal(end.event.operationId, start.event.operationId);
assert.equal(JSON.stringify([end, start]).includes(secret), false);
assert.deepEqual(
	(await call(owner.cookie, `/api/v1/things?id=${action.id}`)).data.thing,
	before.data.thing,
	'Activity does not advance the saved content head'
);
assert.equal((await call(owner.cookie, `/api/v1/timeline?${query()}&eventId=${end.event.id}`)).data.entry.event.id, end.event.id);
assert.equal((await history(action.id, other)).length, 0);
assert.equal((await call(other.cookie, `/api/v1/timeline?${query(other)}&eventId=${end.event.id}`)).status, 404);
assert.equal(
	(await call(owner.cookie, `/api/v1/timeline?${query()}`, { command: 'preview-version', mode: 'restore', eventId: end.event.id })).status,
	422
);
assert.equal((await call(owner.cookie, `/api/v1/timeline?${query()}`, end.event)).status, 400, 'Uploaded server effect cannot forge provenance');
assert.equal((await call(owner.cookie, '/api/v1/actions/run', { action: action.id, inputs: {} })).status, 400);
assert.deepEqual(await history(action.id), events, 'Rejected inputs do not admit execution');
const visitor = await call(other.cookie, '/api/v1/actions/run', { action: action.id, inputs: { value: 'visitor' } });
assert.equal(visitor.data.status, 'ok');
assert.equal((await history(action.id, other)).length, 2, 'Deliberate public Action run belongs to invoker');
assert.deepEqual(await history(action.id), events, 'Foreign invoker cannot write author history');
for (const cookie of ['', other.cookie]) {
	const shared = await call(cookie, '/api/v1/actions/run', { action: action.id, sharedRoot: action.id, inputs: { value: 'shared' } });
	assert.equal(shared.data.status, 'ok', shared.data.error);
	assert.equal(shared.data.history, undefined);
}
assert.deepEqual(await history(action.id), events);
assert.equal((await history(action.id, other)).length, 2, 'Shared runs do not journal visitor history');
const browser = await create('action', {
	name: 'Only prepared',
	actionKey: `prepare-${randomUUID()}`,
	runtime: 'browser',
	capabilities: [],
	steps: [{ op: 'return', value: 'prepared' }]
});
const browserHistory = await history(browser.id);
const prepared = await call(owner.cookie, '/api/v1/actions/run', { action: browser.id, execution: 'browser', executionVersion: '1.11.0' });
assert.equal(prepared.data.status, 'prepared', prepared.data.error);
assert.deepEqual(await history(browser.id), browserHistory, 'Preparation never claims execution');
const data = await create('data', { name: 'Partial Action', value: 'before' });
const partial = await create('action', {
	name: 'Change then fail',
	actionKey: `partial-${randomUUID()}`,
	capabilities: [{ capability: 'things.update' }],
	steps: [
		{ op: 'things.update', id: data.id, values: { value: 'committed' } },
		{ op: 'fail', message: secret }
	]
});
const failed = await call(owner.cookie, '/api/v1/actions/run', { action: partial.id });
assert.equal(failed.data.status, 'error');
assert.equal(failed.data.history.status, 'recorded');
assert.ok(failed.data.error.includes(secret));
const partialEvents = await history(partial.id);
assert.equal(readActionOutcome(partialEvents[0].event)?.status, 'error');
assert.equal(JSON.stringify(partialEvents.slice(0, 2)).includes(secret), false);
const changed = (await history(data.id))[0];
assert.equal(changed.event.after?.value.crystal.value, 'committed');
assert.equal(changed.event.operationId, partialEvents[0].event.operationId);
assert.equal(changed.event.source, 'action');
assert.equal((await call(owner.cookie, '/api/v1/things', { id: action.id }, 'DELETE')).data.ok, true);
assert.equal(
	(await call(owner.cookie, `/api/v1/actions/runs?action=${action.id}`)).data.runs.length,
	0,
	'Debug cache follows its existing deletion lifecycle'
);
assert.equal((await history(action.id)).filter((item) => readActionOutcome(item.event)).length, 2, 'Canonical outcomes survive Action deletion');
assert.equal((await history(action.id, other)).length, 2);
console.log(
	'PASS canonical receipts, private invoker ownership, immutable content head, partial failure, omitted secrets, shared/browser boundaries, and retained deleted Action outcomes'
);

// Optional full-quota acceptance. The admin is a synthetic account explicitly
// allowlisted only in the disposable server process; entitlement changes use API.
if (process.env.TIMELINE_TEST_ADMIN_FIXTURE) {
	const fixture = JSON.parse(await readFile(process.env.TIMELINE_TEST_ADMIN_FIXTURE, 'utf8'));
	assert.equal(fixture.base, base);
	assert.match(fixture.username, /^timeline-quota-admin-[a-f0-9]{8}$/);
	const login = await call('', '/api/v1/login', { username: fixture.username, password: fixture.password });
	assert.equal(login.data.user.id, fixture.ownerId);
	assert.equal(login.data.user.isAdmin, true);
	const admin = cookies(login.headers);
	const quotaAction = await create('action', {
		name: 'Quota execution',
		actionKey: `quota-${randomUUID()}`,
		capabilities: [],
		steps: [{ op: 'return', value: 'ran exactly once' }]
	});
	const usage = async () => (await call(owner.cookie, '/api/v1/auth/me')).data.user.storage;
	const allowance = async (bytes: number) => {
		const response = await call(admin, '/api/v1/admin/subscriptions', {
			subjectType: 'user',
			subjectId: owner.ownerId,
			tier: 'free',
			overrides: { userStorageBytes: bytes },
			note: 'Disposable Action Timeline quota acceptance'
		});
		assert.equal(response.data.ok, true, response.data.error);
	};
	const baseline = (await usage()).usedBytes;
	await allowance(baseline);
	const historyBefore = await history(quotaAction.id);
	const refused = await call(owner.cookie, '/api/v1/actions/run', { action: quotaAction.id });
	assert.equal(refused.status, 507);
	assert.equal(refused.data.ok, false);
	assert.match(refused.data.error, /did not run/);
	assert.deepEqual(await history(quotaAction.id), historyBefore);
	assert.equal((await usage()).usedBytes, baseline);
	const admissionBytes = Buffer.byteLength(
		JSON.stringify({
			before: start.event.before,
			after: { ...start.event.after, value: { ...(start.event.after!.value as any), actionName: quotaAction.crystal.name } }
		})
	);
	await allowance(baseline + admissionBytes);
	const incomplete = await call(owner.cookie, '/api/v1/actions/run', { action: quotaAction.id });
	assert.equal(incomplete.data.status, 'ok');
	assert.equal(incomplete.data.result, 'ran exactly once');
	assert.equal(incomplete.data.history.status, 'incomplete');
	assert.equal(incomplete.data.history.outcomeEventId, null);
	const accepted = await history(quotaAction.id);
	assert.equal(accepted.length, 2);
	assert.equal(readActionOutcome(accepted[0].event)?.status, 'started');
	assert.equal((await usage()).usedBytes, baseline + admissionBytes, 'Exactly one admitted event charged despite bounded completion retries');
	await allowance(baseline + 1_000_000);
	console.log('PASS admission quota refuses before execution; exhausted completion quota preserves actual result with explicit incomplete receipt');
}
await writeFile(
	'/tmp/thingtime-outcomes-fixture.json',
	JSON.stringify({ base, ...owner, actionId: partial.id, dataId: data.id, failureEventId: partialEvents[0].event.id }),
	{ mode: 0o600 }
);
