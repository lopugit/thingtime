import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let user: any; let limit: any; const created: string[] = [];
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('./deviceAuth.ts', import.meta.url).href, { namedExports: { createDevicePairingSession: async (ownerId: string) => {
	created.push(ownerId); return { pairingId: 'test-pair', pairingSecret: 'synthetic-pairing-secret', expiresAt: '2026-09-10T08:00:00Z' };
} } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, { namedExports: {
	enforceRateLimit: async () => limit,
	rateLimitedResponseInit: () => ({ status: 429, headers: { 'Retry-After': '60' } })
} });
const { action } = await import('../../../routes/api/v1/devices/pairing/_pairing');
const request = (method = 'POST') => new Request('https://thingtime.test/api/v1/devices/pairing', { method });
beforeEach(() => { user = { id: 'owner', accountKind: 'user' }; limit = { allowed: true }; created.length = 0; });
const assertPrivate = (value: Response) => {
	assert.equal(value.headers.get('Cache-Control'), 'private, no-store'); assert.equal(value.headers.get('Pragma'), 'no-cache');
	assert.equal(value.headers.get('X-Content-Type-Options'), 'nosniff');
};

test('challenge receipt carries the authenticated owner and cannot be cached', async () => {
	const response = await action({ request: request() }); assertPrivate(response);
	const body = await response.json(); assert.equal(body.ownerId, 'owner'); assert.deepEqual(created, ['owner']);
});
test('unauthenticated, temporary and wrong-method requests never create a challenge', async () => {
	for (const [actor, method, status] of [[null, 'POST', 401], [{ id: 'temp', accountKind: 'temporary' }, 'POST', 403], [user, 'GET', 405]] as const) {
		user = actor; const response = await action({ request: request(method) }); assert.equal(response.status, status); assertPrivate(response);
	}
	assert.deepEqual(created, []);
});
test('rate limits retain retry headers alongside private response headers', async () => {
	limit = { allowed: false }; const response = await action({ request: request() });
	assert.equal(response.status, 429); assert.equal(response.headers.get('Retry-After'), '60'); assertPrivate(response); assert.deepEqual(created, []);
});
