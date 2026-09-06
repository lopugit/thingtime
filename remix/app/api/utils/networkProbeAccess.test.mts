import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

let account: any, app: any, subscription: any, outcome: any;
let quotaCalls: any[], guestCalls: any[];
mock.module(new URL('./auth/authCookie.ts', import.meta.url).href, {
	namedExports: {
		getAuthToken: async (request: Request) => request.headers.get('authorization')?.slice(7) || null
	}
});
mock.module(new URL('./auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => account } });
mock.module(new URL('./apps/appTokens.ts', import.meta.url).href, { namedExports: { resolveAppToken: async () => app } });
mock.module(new URL('./subscriptions/subscriptions.ts', import.meta.url).href, {
	namedExports: {
		getSubscription: async (type: string, id: string) => {
			assert.equal(type, 'user');
			assert.equal(id, (app?.user ?? account).id);
			return subscription;
		}
	}
});
mock.module(new URL('./rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async (...args: any[]) => {
			guestCalls.push(args);
			return outcome;
		},
		enforceQuotaRateLimit: async (...args: any[]) => {
			quotaCalls.push(args);
			return outcome;
		},
		rateLimitedResponseInit: () => ({ status: 429, headers: { 'Retry-After': '60' } })
	}
});
const { networkProbeAccess } = await import('./networkProbeAccess.ts');
const { loader: download } = await import('../../routes/api/v1/network-probe/download/_download.tsx');
const { action: upload } = await import('../../routes/api/v1/network-probe/upload/_upload.tsx');
const { loader: ping } = await import('../../routes/api/v1/network-probe/ping/_ping.tsx');
const request = (headers: Record<string, string> = { authorization: 'Bearer valid' }) =>
	new Request('https://thingtime.test/api/v1/network-probe/download?bytes=57344', { headers });
beforeEach(() => {
	account = { id: 'account-1' };
	app = null;
	subscription = { tier: 'free', effective: {} };
	quotaCalls = [];
	guestCalls = [];
	outcome = { allowed: true, limit: 20, remaining: 19, resetAt: new Date().toISOString() };
});
test('Free and Plus apply account budgets for five downloads and eleven upload chunks', async () => {
	for (const [tier, count] of [
		['free', 4],
		['plus', 20]
	] as const) {
		subscription.tier = tier;
		await networkProbeAccess(request(), 'download');
		await networkProbeAccess(request(), 'upload');
		assert.deepEqual(quotaCalls.slice(-2), [
			['network-probe.download', 'account-1', count * 5],
			['network-probe.upload', 'account-1', count * 11]
		]);
	}
	assert.equal(guestCalls.length, 0);
});
test('Pro and PAYG never consume account or IP buckets, even if limiter would deny', async () => {
	outcome.allowed = false;
	for (const tier of ['pro', 'payg']) {
		subscription.tier = tier;
		assert.equal(await networkProbeAccess(request(), 'download'), null);
		assert.equal(await networkProbeAccess(request(), 'upload'), null);
	}
	assert.deepEqual(quotaCalls, []);
	assert.deepEqual(guestCalls, []);
});
test('authenticated latency preflight cannot impose a hidden guest cooldown', async () => {
	outcome.allowed = false;
	const response = await ping({ request: request() });
	assert.equal(response.status, 200);
	assert.equal((await response.arrayBuffer()).byteLength, 256);
	assert.equal(quotaCalls.length, 0);
	assert.equal(guestCalls.length, 0);
	assert.equal((await ping({ request: request({}) })).status, 429);
	assert.equal(guestCalls[0][1], 'networkProbe.ping');
	account = null;
	assert.equal((await ping({ request: request() })).status, 401);
});
test('custom quota and explicit admin overrides win over defaults', async () => {
	subscription = { tier: 'custom', effective: { speedTestsPerHour: 7 } };
	await networkProbeAccess(request(), 'download');
	assert.equal(quotaCalls[0][2], 35);
	subscription.effective.speedTestsPerHour = null;
	assert.equal(await networkProbeAccess(request(), 'upload'), null);
	subscription.effective.speedTestsPerHour = 0;
	assert.equal((await networkProbeAccess(request(), 'upload'))?.status, 403);
});
test('IP and token changes share account usage; different accounts have different keys', async () => {
	await networkProbeAccess(request({ authorization: 'Bearer first', 'x-forwarded-for': '192.0.2.1' }), 'download');
	await networkProbeAccess(request({ authorization: 'Bearer second', 'x-forwarded-for': '192.0.2.2' }), 'download');
	assert.deepEqual(quotaCalls[0], quotaCalls[1]);
	account.id = 'account-2';
	await networkProbeAccess(request(), 'download');
	assert.equal(quotaCalls[2][1], 'account-2');
});
test('OAuth uses its granted user, ignoring client-supplied tier and user headers', async () => {
	account = null;
	app = { user: { id: 'oauth-owner' }, scopes: ['profile.username'], origin: 'https://client.test' };
	await networkProbeAccess(request({ authorization: 'Bearer oauth', origin: app.origin, 'x-tier': 'pro', 'x-user-id': 'other' }), 'upload');
	assert.equal(quotaCalls[0][1], 'oauth-owner');
	assert.equal(quotaCalls[0][2], 44);
});
test('revoked or invalid credentials fail closed without guest fallback', async () => {
	account = null;
	assert.equal((await networkProbeAccess(request(), 'download'))?.status, 401);
	assert.equal(guestCalls.length, 0);
	assert.equal(quotaCalls.length, 0);
});
test('sandbox and wrong-origin app grants are rejected', async () => {
	for (const patch of [{ sandbox: true }, { origin: 'https://wrong.test' }]) {
		app = { user: { id: 'oauth-owner' }, scopes: ['profile.username'], origin: 'https://client.test', ...patch };
		assert.equal((await networkProbeAccess(request({ authorization: 'Bearer oauth', origin: 'https://client.test' }), 'download'))?.status, 403);
	}
	assert.equal(quotaCalls.length, 0);
});
test('guests retain the independent fail-closed public allowance', async () => {
	await networkProbeAccess(request({}), 'upload');
	assert.equal(guestCalls[0][1], 'networkProbe.upload.v2');
	assert.equal(guestCalls[0][2], null);
	assert.deepEqual(guestCalls[0][3], { failClosed: true });
});
test('denials return Retry-After; accounting outages return 503, not a cooldown', async () => {
	outcome.allowed = false;
	const denied = await networkProbeAccess(request(), 'download');
	assert.equal(denied?.status, 429);
	assert.equal(denied?.headers.get('retry-after'), '60');
	outcome.unavailable = true;
	assert.equal((await networkProbeAccess(request(), 'upload'))?.status, 503);
	assert.equal((await networkProbeAccess(request({}), 'download'))?.status, 503);
});
test('real packet handlers enforce before transferring and keep size safeguards for Pro', async () => {
	outcome.allowed = false;
	assert.equal((await download({ request: request() })).status, 429);
	const uploadRequest = new Request('https://thingtime.test/api/v1/network-probe/upload?bytes=57344', {
		method: 'POST',
		headers: { authorization: 'Bearer valid' },
		body: new Uint8Array(57344)
	});
	assert.equal((await upload({ request: uploadRequest })).status, 429);
	subscription.tier = 'pro';
	assert.equal((await download({ request: request() })).status, 200);
	const invalid = new Request('https://thingtime.test/api/v1/network-probe/download?bytes=999999999', { headers: { authorization: 'Bearer valid' } });
	assert.equal((await download({ request: invalid })).status, 400);
});
