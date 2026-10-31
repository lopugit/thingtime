// Real account writer parity for the shared branch planner. Disposable local DB only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { parseTimelineBranchCommand } from '../app/timeline/branches.ts';
import { branchCheckoutRequest, parseBranchCheckout } from '../app/timeline/branchCheckout.ts';
import { parseBranchMergePreview, createBranchMergeProposal } from '../app/timeline/branchMerge.ts';
const base = process.env.TIMELINE_TEST_BASE;
if (!base || !['127.0.0.1', 'localhost'].includes(new URL(base).hostname)) throw new Error('Set the disposable loopback TIMELINE_TEST_BASE');
const status = await fetch(`${base}/api/v1/mongodb/status`).then((response) => response.json());
assert.equal(status.host, process.env.TIMELINE_TEST_MONGO_HOST || '127.0.0.1:20337');
assert.equal(status.replicaSet, process.env.TIMELINE_TEST_REPLICA_SET || 'timeline-rs');
assert.equal(status.custom, false);
assert.equal(status.connected, true);
let cookie = '';
const ownThings = new Set<string>();
async function call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
	const response = await fetch(base + path, {
		method,
		headers: { Cookie: cookie, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const data = await response.json();
	if (path === '/api/v1/things' && method === 'POST' && data.ok && data.thing?.id) ownThings.add(data.thing.id);
	return { response, data };
}
const username = `branch-parity-${randomUUID().slice(0, 8)}`;
const registration = await fetch(base + '/api/v1/auth/register', {
	method: 'POST',
	headers: { 'Content-Type': 'application/json' },
	body: JSON.stringify({ username, password: `Branch-${randomUUID()}-9a!`, email: `${username}@example.invalid` })
});
const account = await registration.json();
assert.equal(account.ok, true);
const ownerId = account.user.id;
const fixtureCookie = (cookie = registration.headers
	.getSetCookie()
	.map((value) => value.split(';')[0])
	.join('; '));
const path = `/api/v1/timeline?ownerId=${ownerId}&dataPlane=home`;
try {
	const created = await call('/api/v1/things', {
		thingtime: ['webpage'],
		crystal: { name: 'Branch parity fixture', blocks: [{ id: 'text', type: 'text', text: 'Original' }] },
		visibility: 'private'
	});
	assert.equal(created.data.ok, true, created.data.error);
	const thingId = created.data.thing.id;
	const events = async () => (await call(path + `&thingId=${thingId}`)).data.entries;
	const original = (await events())[0].event;
	const command = parseTimelineBranchCommand({
		command: 'create-branch',
		operationId: randomUUID(),
		branchId: `branch-${randomUUID()}`,
		thingId,
		eventId: original.id,
		expectedRevision: 0,
		name: 'Account parity'
	});
	const result = await call(path, command);
	assert.equal(result.data.ok, true, result.data.error);
	assert.deepEqual((await call(path, command)).data, result.data);
	assert.equal((await call(path, { ...command, name: 'Changed retry' })).response.status, 409);
	const request = branchCheckoutRequest(result.data);
	assert.equal(parseBranchCheckout((await call(path, request)).data.checkout, ownerId, request).entry.event.id, original.id);
	assert.equal((await call('/api/v1/things', { id: thingId, crystal: { name: 'Branch parity updated', blocks: [] } }, 'PATCH')).data.ok, true);
	const next = (await events())[0].event;
	const advance = parseTimelineBranchCommand({
		...command,
		command: 'advance-branch',
		operationId: randomUUID(),
		eventId: next.id,
		expectedRevision: 1,
		name: null
	});
	const advanced = await call(path, advance);
	assert.equal(advanced.data.ok, true, advanced.data.error);
	assert.equal(advanced.data.head.revision, 2);
	assert.deepEqual((await call(path, command)).data, result.data, 'original retry never rewinds the head');
	assert.equal((await call(path, request)).response.status, 409);
	assert.equal((await call(path, { ...advance, operationId: randomUUID() })).response.status, 409);
	assert.equal(
		(await call(path, { ...advance, operationId: randomUUID(), expectedRevision: 2, eventId: original.id })).response.status,
		409,
		'backward/divergent advance is refused'
	);
	const latestRequest = branchCheckoutRequest(advanced.data);
	const checkout = parseBranchCheckout((await call(path, latestRequest)).data.checkout, ownerId, latestRequest);
	assert.equal((checkout.snapshot.value as any).crystal.name, 'Branch parity updated');
	const heads = (await call(path + `&thingId=${thingId}&branches=1`)).data.branches;
	assert.equal(heads[0].head.eventId, next.id);
	// The same canonical comparison used offline still runs through owner-authenticated
	// server readers and the existing revision-fenced writer.
	const incoming = {
		...original,
		id: randomUUID(),
		operationId: randomUUID(),
		source: 'client',
		clientId: 'branch-parity',
		mode: 'draft',
		operation: 'update',
		branchId: command.branchId,
		parentIds: [original.id],
		before: original.after,
		after: { ...original.after, value: { ...original.after.value, crystal: { ...original.after.value.crystal, name: 'Incoming branch title' } } }
	};
	assert.equal((await call(path, incoming)).data.ok, true);
	const mergeRequest = {
		command: 'preview-branch-merge' as const,
		branchId: command.branchId,
		thingId,
		eventId: incoming.id,
		expectedHeadId: next.id,
		expectedRevision: 2,
		choices: {},
		componentChoices: {}
	};
	const compared = await call(path, mergeRequest);
	assert.equal(compared.response.status, 200, compared.data.error);
	assert.equal(compared.response.headers.get('cache-control'), 'private, no-store');
	assert.deepEqual(
		compared.data.preview.conflicts.map((conflict: any) => conflict.path),
		[['crystal', 'name']]
	);
	assert.equal((await call(path, { ...mergeRequest, choices: { '["crystal","missing"]': 'incoming' } })).response.status, 422);
	const chosenRequest = { ...mergeRequest, choices: { '["crystal","name"]': 'incoming' as const } };
	const mergePreview = parseBranchMergePreview((await call(path, chosenRequest)).data.preview, ownerId, chosenRequest);
	const proposal = createBranchMergeProposal(mergePreview, 'branch-parity');
	assert.equal((await call(path, proposal.event)).data.ok, true);
	const merged = await call(path, proposal.command);
	assert.equal(merged.data.ok, true, merged.data.error);
	assert.equal(merged.data.head.revision, 3);
	assert.deepEqual((await call(path, proposal.command)).data, merged.data, 'merge retries have one canonical receipt');
	assert.equal((await call(path, mergeRequest)).response.status, 409, 'old comparison cannot rewind the branch');
	const mergedRequest = branchCheckoutRequest(merged.data);
	const mergedCheckout = parseBranchCheckout((await call(path, mergedRequest)).data.checkout, ownerId, mergedRequest);
	assert.equal((mergedCheckout.snapshot.value as any).crystal.name, 'Incoming branch title');
	assert.equal(
		(await call(`/api/v1/things?id=${thingId}`)).data.thing.crystal.name,
		'Branch parity updated',
		'merge never changes the current Thing'
	);
	cookie = '';
	assert.equal((await call(path, mergeRequest)).response.status, 401);
	assert.equal((await call(path, latestRequest)).response.status, 401);
	assert.equal((await call(path, command)).response.status, 401);
	console.log('PASS: real account branch create/replay/CAS/ancestry/checkout/merge/conflicts and anonymous denial');
} finally {
	cookie = fixtureCookie;
	for (const id of ownThings) assert.equal((await call('/api/v1/things', { id }, 'DELETE')).data.ok, true, 'clean up only fixture-created Things');
}
