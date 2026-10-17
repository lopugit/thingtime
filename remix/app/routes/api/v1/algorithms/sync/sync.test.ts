import assert from 'node:assert/strict';
import test from 'node:test';
import { createAlgorithmSyncResponse } from './_sync';
import { withInternalRequestActor } from '~/api/utils/auth/internalRequestActor';
const origin = 'https://algorithm-sync.example';
const account = { user: { id: 'owner', temporary: false, accountKind: 'full' }, claims: { jti: 'fixture-session' } };
const command = {
	action: 'save',
	id: '123e4567-e89b-42d3-a456-426614174000',
	writeId: 'fixture-write',
	expectedVersion: null,
	content: { name: 'Reading', emoji: '🧠', weights: { types: {}, tags: {}, authors: {} }, eventCount: 0, lastTrainedAt: null },
	description: ''
};
const body = { operation: 'write', expectedOwnerId: 'owner', command };
const receipt = {
	action: 'save',
	id: command.id,
	writeId: command.writeId,
	expectedVersion: null,
	resultVersion: 'algorithm-state-v1:' + 'a'.repeat(64)
};
const request = (payload: unknown = body, headers = {}) =>
	new Request(origin + '/api/v1/algorithms/sync', {
		method: 'POST',
		headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Thingtime-Expected-Data-Plane': 'home', ...headers },
		body: JSON.stringify(payload)
	});
function fixture(overrides: any = {}) {
	let writes = 0,
		reads = 0;
	const run = createAlgorithmSyncResponse({
		getAuthToken: async () => 'session',
		resolveTokenUser: async () => account as any,
		mongoDataPlane: () => 'home',
		enforceRateLimit: async () => ({ allowed: true } as any),
		algorithmSyncSnapshot: async () => {
			reads++;
			return [];
		},
		synchronizeAlgorithmWrite: async (owner, plane, raw, admit) => {
			assert.equal(owner, 'owner');
			assert.equal(plane, 'home');
			assert.deepEqual(raw, command);
			await admit();
			writes++;
			return receipt as any;
		},
		...overrides
	});
	return { run, writes: () => writes, reads: () => reads };
}
test('dedicated algorithm sync pins confirmed owner and selected plane while declaring home storage', async () => {
	const f = fixture();
	const response = await f.run({ request: request() });
	assert.equal(response.status, 200);
	assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
	assert.deepEqual(await response.json(), { ok: true, ownerId: 'owner', dataPlane: 'home', storagePlane: 'home', acknowledgment: receipt });
	assert.equal(f.writes(), 1);
	const snapshot = await f.run({ request: request({ operation: 'snapshot', expectedOwnerId: 'owner' }) });
	assert.equal(snapshot.status, 200);
	assert.deepEqual((await snapshot.json()).algorithms, []);
	assert.equal(f.reads(), 1);
});
test('anonymous, temporary, service, changed-account, changed-plane and cross-origin callers never reach algorithm storage', async () => {
	for (const [req, overrides, status] of [
		[request(body, { Origin: '' }), {}, 403],
		[request(body, { Origin: 'https://other.example' }), {}, 403],
		[request(body, { 'Sec-Fetch-Site': 'cross-site' }), {}, 403],
		[request(body, { 'Content-Type': 'text/plain' }), {}, 415],
		[request(body, { 'X-Thingtime-Expected-Data-Plane': '' }), {}, 400],
		[request(), { getAuthToken: async () => null }, 401],
		[request(), { resolveTokenUser: async () => ({ ...account, user: { ...account.user, temporary: true } }) }, 401],
		[request(), { resolveTokenUser: async () => ({ ...account, user: { ...account.user, accountKind: 'service' } }) }, 401],
		[request({ ...body, expectedOwnerId: 'different' }), {}, 409],
		[request(), { mongoDataPlane: () => 'custom-' + 'b'.repeat(64) }, 409],
		[request({ ...body, ownerId: 'forged' }), {}, 400],
		[request({ operation: 'snapshot', expectedOwnerId: 'owner', command }), {}, 400],
		[request({ ...body, command: { data: 'x'.repeat(3 * 1024 * 1024) } }), {}, 413]
	] as any[]) {
		const f = fixture(overrides);
		assert.equal((await f.run({ request: req })).status, status);
		assert.equal(f.writes() + f.reads(), 0);
	}
});
test('internal Action identity and failed rate admission do not authorize algorithm synchronization', async () => {
	const f = fixture(),
		req = request();
	const response = await withInternalRequestActor(
		req,
		async () => account.user as any,
		() => f.run({ request: req })
	);
	assert.equal(response.status, 403);
	assert.equal(f.writes(), 0);
	const capped = fixture({
		enforceRateLimit: async () => ({ allowed: false, limit: 60, remaining: 0, resetAt: new Date(Date.now() + 60000).toISOString() })
	});
	const denied = await capped.run({ request: request() });
	assert.equal(denied.status, 429);
	assert.equal(denied.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(capped.writes() + capped.reads(), 0);
	const failed = fixture({
		enforceRateLimit: async () => {
			throw Error('private storage outage');
		}
	});
	const limited = await failed.run({ request: request() });
	assert.equal(limited.status, 503);
	assert.equal(failed.writes(), 0);
	assert.ok(!(await limited.text()).includes('private storage outage'));
});
test('algorithm sync repeats session admission before mutation and response disclosure', async () => {
	for (const expiration of [2, 3]) {
		let resolved = 0;
		const f = fixture({ resolveTokenUser: async () => (++resolved >= expiration ? null : account) });
		const response = await f.run({ request: request() });
		assert.equal(response.status, 401);
		assert.equal(f.writes(), expiration === 2 ? 0 : 1);
		assert.ok(!(await response.text()).includes('resultVersion'));
	}
	let resolved = 0;
	const f = fixture({ resolveTokenUser: async () => (++resolved >= 2 ? null : account) });
	const response = await f.run({ request: request({ operation: 'snapshot', expectedOwnerId: 'owner' }) });
	assert.equal(response.status, 401);
	assert.equal(f.reads(), 1);
	assert.ok(!(await response.text()).includes('algorithms'));
});

test('selection operations use the same admission and hide pointers after account revocation', async () => {
	const selection = { algorithmId: 'hot', version: 'algorithm-selection-v1:' + 'a'.repeat(64) };
	const command = { algorithmId: 'hot', expectedVersion: selection.version, writeId: 'choose-hot' };
	let writes = 0;
	const f = fixture({
		readUserAlgorithmSelection: async () => selection,
		synchronizeAlgorithmSelection: async (owner: string, raw: unknown, admit: () => Promise<void>) => {
			assert.equal(owner, 'owner');
			assert.deepEqual(raw, command);
			await admit();
			writes++;
			return { ...command, result: selection };
		}
	});
	assert.deepEqual((await (await f.run({ request: request({ operation: 'selection', expectedOwnerId: 'owner' }) })).json()).selection, selection);
	assert.deepEqual((await (await f.run({ request: request({ operation: 'select', expectedOwnerId: 'owner', command }) })).json()).acknowledgment, {
		...command,
		result: selection
	});
	assert.equal(writes, 1);
	assert.equal((await f.run({ request: request({ operation: 'selection', expectedOwnerId: 'owner', command }) })).status, 400);
	assert.equal((await f.run({ request: request({ operation: 'select', expectedOwnerId: 'owner' }) })).status, 400);
	let reads = 0;
	const expired = fixture({ resolveTokenUser: async () => (++reads > 1 ? null : account), readUserAlgorithmSelection: async () => selection });
	const denied = await expired.run({ request: request({ operation: 'selection', expectedOwnerId: 'owner' }) });
	assert.equal(denied.status, 401);
	assert.ok(!(await denied.text()).includes('algorithmId'));
});
