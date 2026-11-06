import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any,
	actor: any,
	allowed = true;
const calls: any[] = [];
const call = async (name: string, ...args: any[]) => {
	calls.push([name, ...args]);
	return { ok: true };
};
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('../auth/publicOrigin.ts', import.meta.url).href, {
	namedExports: { resolvePublicOrigin: () => new URL('https://thingtime.test') }
});
mock.module(new URL('./deviceAuth.ts', import.meta.url).href, { namedExports: { resolveDeviceActor: async () => actor } });
mock.module(new URL('./deviceAlerts.ts', import.meta.url).href, {
	namedExports: {
		createDeviceAlert: (...args: any[]) => call('create', ...args),
		readDeviceAlert: (...args: any[]) => call('read', ...args),
		registerDeviceAlertPush: (...args: any[]) => call('push', ...args),
		getDeviceAlertMedia: (...args: any[]) => call('media', ...args),
		recordDevicePreparedSound: (...args: any[]) => call('sound', ...args)
	}
});
mock.module(new URL('./deviceObservations.ts', import.meta.url).href, { namedExports: { DeviceObservationFailure: class Failure extends Error {} } });
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async (_r: any, _k: any, _s: any, opts: any) => {
			assert.equal(opts.failClosed, true);
			return { allowed };
		},
		rateLimitedResponseInit: () => ({ status: 429 })
	}
});
const alerts = await import('../../../routes/api/v1/devices/alerts/_alerts');
const push = await import('../../../routes/api/v1/devices/node/push/_push');
const media = await import('../../../routes/api/v1/devices/node/media/_media');
const sounds = await import('../../../routes/api/v1/devices/node/alert-sounds/_alert-sounds');
const req = (body?: any, headers: Record<string, string> = {}) =>
	new Request('https://thingtime.test/api/v1/devices/alerts?deviceId=device&requestId=request', {
		method: body ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.test', 'X-Thingtime-Expected-Actor': 'owner', ...headers },
		...(body ? { body: JSON.stringify(body) } : {})
	});
const privateHeaders = (r: Response) => {
	assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(r.headers.get('Pragma'), 'no-cache');
};
beforeEach(() => {
	user = { id: 'owner', accountKind: 'user' };
	actor = { userId: 'owner', deviceId: 'device', sessionId: 'session' };
	allowed = true;
	calls.length = 0;
});
test('owner request recovery is read-only and fixes owner independently of query data', async () => {
	const r = await alerts.loader({ request: req() });
	assert.equal(r.status, 200);
	privateHeaders(r);
	assert.deepEqual(calls, [['read', 'owner', 'device', 'request']]);
});
test('owner dispatch refuses account switching, cross-origin, anonymous and limited requests', async () => {
	for (const headers of [{ 'X-Thingtime-Expected-Actor': 'foreign' }, { Origin: 'https://evil.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
		const r = await alerts.action({ request: req({ deviceId: 'device' }, headers) });
		assert.ok([403, 409].includes(r.status));
		privateHeaders(r);
	}
	user = null;
	assert.equal((await alerts.action({ request: req({}) })).status, 401);
	user = { id: 'owner', accountKind: 'user' };
	allowed = false;
	assert.equal((await alerts.action({ request: req({}) })).status, 429);
	assert.equal(calls.length, 0);
});
test('each node action requires its current credential and delegates only derived device identity', async () => {
	for (const [route, name] of [
		[push, 'push'],
		[media, 'media'],
		[sounds, 'sound']
	] as const) {
		let r = await route.action({ request: req({ commandId: 'command', leaseId: 'lease' }) });
		assert.equal(r.status, 200);
		privateHeaders(r);
		assert.deepEqual(calls.at(-1), [name, actor, { commandId: 'command', leaseId: 'lease' }]);
		actor = null;
		r = await route.action({ request: req({}) });
		assert.equal(r.status, 401);
		privateHeaders(r);
		actor = { userId: 'owner', deviceId: 'device', sessionId: 'session' };
	}
});
