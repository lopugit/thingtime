import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let actor: any, limit: any, found: boolean;
const reads: string[][] = [];
mock.module(new URL('./deviceAuth.ts', import.meta.url).href, { namedExports: { resolveDeviceActor: async () => actor } });
mock.module(new URL('./devices.ts', import.meta.url).href, {
	namedExports: {
		readDeviceIdentity: async (ownerId: string, deviceId: string) => {
			reads.push([ownerId, deviceId]);
			return found ? { ok: true, ownerId, deviceId } : { ok: false, status: 404, error: 'Device not found' };
		}
	}
});
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async () => limit,
		rateLimitedResponseInit: () => ({ status: 429, headers: { 'Retry-After': '60' } })
	}
});
const { loader } = await import('../../../routes/api/v1/devices/node/identity/_identity');
const request = (method = 'GET') => new Request('https://thingtime.test/api/v1/devices/node/identity?ownerId=foreign&deviceId=other', { method });
beforeEach(() => {
	actor = { userId: 'owner', deviceId: 'device', sessionId: 'private-session', capabilities: ['private'] };
	limit = { allowed: true };
	found = true;
	reads.length = 0;
});
const privateResponse = (r: Response) => {
	assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(r.headers.get('Pragma'), 'no-cache');
	assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
};
test('identity is fixed by the credential and projects no session data', async () => {
	const r = await loader({ request: request() });
	privateResponse(r);
	assert.deepEqual(await r.json(), { ok: true, ownerId: 'owner', deviceId: 'device' });
	assert.deepEqual(reads, [['owner', 'device']]);
});
test('invalid credentials, methods, missing devices and rate limits fail privately', async () => {
	actor = null;
	let r = await loader({ request: request() });
	assert.equal(r.status, 401);
	privateResponse(r);
	r = await loader({ request: request('POST') });
	assert.equal(r.status, 405);
	privateResponse(r);
	assert.equal(reads.length, 0);
	actor = { userId: 'owner', deviceId: 'device' };
	found = false;
	r = await loader({ request: request() });
	assert.equal(r.status, 404);
	privateResponse(r);
	limit = { allowed: false };
	r = await loader({ request: request() });
	assert.equal(r.status, 429);
	privateResponse(r);
	assert.equal(r.headers.get('Retry-After'), '60');
	assert.equal(reads.length, 1);
});
