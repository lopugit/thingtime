import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any,
	limit: any,
	rows: any[],
	records: any[],
	writes = 0;
const transaction = { fixture: true };
mock.module(new URL('../mongodb/collections.ts', import.meta.url).href, {
	namedExports: {
		getHomeThingsCollection: async () => ({
			findOne: async (query: any, options: any) => {
				assert.equal(options.session, transaction);
				return rows.find((row) => row.ownerId === query.ownerId && row.shareId === query.shareId && query.thingtime === 'device') ?? null;
			}
		}),
		getSessionsCollection: async () => ({
			updateMany: async (query: any, pipeline: any[], options: any) => {
				assert.equal(options.session, transaction);
				assert.equal(query.purpose, 'device');
				assert.equal(query.revokedAt, null);
				assert.equal(pipeline[1].$unset, 'secureVaultKey');
				assert.ok(pipeline[0].$set.revokedAt instanceof Date);
				writes++;
				for (const record of records)
					if (record.userId === query.userId && record.purpose === query.purpose && record.deviceId === query['meta.deviceId'] && !record.revokedAt)
						record.revokedAt = pipeline[0].$set.revokedAt;
			}
		}),
		withHomeMongoTransaction: async (work: any) => work(transaction)
	}
});
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async (_r: Request, key: string, scope: string, options: any) => {
			assert.equal(key, 'devices.permissions');
			assert.equal(scope, 'user:owner');
			assert.equal(options.failClosed, true);
			return limit;
		},
		rateLimitedResponseInit: () => ({ status: 429, headers: { 'Retry-After': '60' } })
	}
});
const { disconnectDevice } = await import('./disconnectDevice');
const { action } = await import('../../../routes/api/v1/devices/disconnect/_disconnect');
beforeEach(() => {
	user = { id: 'owner', accountKind: 'user' };
	limit = { allowed: true };
	writes = 0;
	rows = [
		{ ownerId: 'owner', shareId: 'device' },
		{ ownerId: 'other', shareId: 'foreign' }
	];
	records = [
		{ userId: 'owner', deviceId: 'device', purpose: 'device' },
		{ userId: 'owner', deviceId: 'device', purpose: 'device' },
		{ userId: 'other', deviceId: 'device', purpose: 'device' },
		{ userId: 'owner', deviceId: 'other-device', purpose: 'device' },
		{ userId: 'owner', deviceId: 'device', purpose: 'browser' }
	];
});
const privateResponse = (r: Response) => {
	assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(r.headers.get('Pragma'), 'no-cache');
};
const request = (body: unknown = { deviceId: 'device' }, method = 'POST') =>
	new Request('https://thingtime.test/api/v1/devices/disconnect', {
		method,
		headers: { 'Content-Type': 'application/json' },
		body: method === 'POST' ? JSON.stringify(body) : undefined
	});
test('disconnect revokes every matching credential and preserves other accounts, devices, browser sessions and history', async () => {
	const before = structuredClone(rows),
		response = await action({ request: request() });
	privateResponse(response);
	assert.deepEqual(await response.json(), { ok: true, deviceId: 'device', disconnected: true });
	assert.deepEqual(
		records.map((row) => !!row.revokedAt),
		[true, true, false, false, false]
	);
	assert.deepEqual(rows, before);
	const dates = records.map((row) => row.revokedAt);
	assert.equal((await disconnectDevice('owner', { deviceId: 'device' })).ok, true);
	assert.deepEqual(
		records.map((row) => row.revokedAt),
		dates
	);
	assert.deepEqual(rows, before);
});
test('unknown and foreign devices, extra owner IDs and malformed inputs never mutate sessions', async () => {
	for (const body of [null, [], {}, { deviceId: 'device', ownerId: 'other' }, { deviceId: ' device' }, { deviceId: 1 }]) {
		const result = await disconnectDevice('owner', body);
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 400);
	}
	for (const deviceId of ['missing', 'foreign']) {
		const result = await disconnectDevice('owner', { deviceId });
		assert.equal(result.ok, false);
		if (!result.ok) assert.equal(result.status, 404);
	}
	assert.equal(writes, 0);
});
test('route refuses missing/full-account mismatch, wrong method and rate-limit failures privately', async () => {
	for (const [actor, method, status] of [
		[null, 'POST', 401],
		[{ id: 'owner', accountKind: 'temporary' }, 'POST', 403],
		[user, 'GET', 405]
	] as const) {
		user = actor;
		const response = await action({ request: request(undefined, method) });
		assert.equal(response.status, status);
		privateResponse(response);
	}
	user = { id: 'owner', accountKind: 'user' };
	limit = { allowed: false };
	const response = await action({ request: request() });
	assert.equal(response.status, 429);
	privateResponse(response);
	assert.equal(response.headers.get('Retry-After'), '60');
	assert.equal(writes, 0);
});
