import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';
let user: any,
	actor: any,
	allowed = true;
const calls: any[] = [];
class Failure extends Error {
	constructor(readonly status: number, readonly code: string, message: string) {
		super(message);
	}
}
const invoke = async (kind: string, ...args: any[]) => {
	calls.push([kind, ...args]);
	return { ok: true, fixture: kind };
};
mock.module(new URL('../auth/getCurrentUser.ts', import.meta.url).href, { namedExports: { getCurrentUser: async () => user } });
mock.module(new URL('./deviceAuth.ts', import.meta.url).href, { namedExports: { resolveDeviceActor: async () => actor } });
mock.module(new URL('./deviceObservations.ts', import.meta.url).href, {
	namedExports: {
		DeviceObservationFailure: Failure,
		deviceObservations: {
			read: (...args: any[]) => invoke('read', ...args),
			settings: (...args: any[]) => invoke('settings', ...args),
			nodeSettings: (...args: any[]) => invoke('nodeSettings', ...args),
			record: (...args: any[]) => invoke('record', ...args),
			sweep: () => invoke('sweep')
		}
	}
});
mock.module(new URL('../auth/publicOrigin.ts', import.meta.url).href, {
	namedExports: { resolvePublicOrigin: () => new URL('https://thingtime.test') }
});
mock.module(new URL('../rateLimit/enforce.ts', import.meta.url).href, {
	namedExports: {
		enforceRateLimit: async (_r: any, _key: any, _scope: any, options: any) => {
			assert.equal(options.failClosed, true);
			return { allowed };
		},
		rateLimitedResponseInit: () => ({ status: 429, headers: { 'Retry-After': '60' } })
	}
});
const history = await import('../../../routes/api/v1/devices/observations/_observations');
const settings = await import('../../../routes/api/v1/devices/observation-settings/_observation-settings');
const node = await import('../../../routes/api/v1/devices/node/observations/_observations');
const { createObservationCleanupLoader } = await import('../../../routes/api/v1/devices/observations/cleanup/_cleanup');
const req = (path: string, body?: unknown, headers: Record<string, string> = {}) =>
	new Request(`https://thingtime.test/api/v1/devices/${path}`, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'Content-Type': 'application/json', Origin: 'https://thingtime.test', 'X-Thingtime-Expected-Actor': 'owner', ...headers },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
const privateResponse = (r: Response) => {
	assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
	assert.equal(r.headers.get('Pragma'), 'no-cache');
};
beforeEach(() => {
	user = { id: 'owner', accountKind: 'user', temporary: false };
	actor = { userId: 'owner', deviceId: 'device', sessionId: 'session' };
	allowed = true;
	calls.length = 0;
});
test('owner history fixes account and forwards only registered query fields', async () => {
	const r = await history.loader({ request: req('observations?deviceId=device&type=location&ownerId=foreign') });
	assert.equal(r.status, 200);
	privateResponse(r);
	assert.equal(calls[0][1], 'owner');
	assert.equal(calls[0][2].deviceId, 'device');
	assert.equal('ownerId' in calls[0][2], false);
});
test('owner settings fences account switches and cross-origin mutations before service', async () => {
	const body = { deviceId: 'device', type: 'location', enabled: true };
	for (const headers of [{ 'X-Thingtime-Expected-Actor': 'foreign' }, { Origin: 'https://foreign.test' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
		const r = await settings.action({ request: req('observation-settings', body, headers) });
		assert.ok([403, 409].includes(r.status));
		privateResponse(r);
	}
	assert.equal(calls.length, 0);
	const r = await settings.action({ request: req('observation-settings', body) });
	assert.equal(r.status, 200);
	assert.deepEqual(calls[0], ['settings', 'owner', body]);
});
test('anonymous, service, temporary and rate-limited owner access fails privately', async () => {
	for (const value of [null, { id: 'owner', accountKind: 'service' }, { id: 'owner', accountKind: 'user', temporary: true }]) {
		user = value;
		const r = await history.loader({ request: req('observations?deviceId=device&type=location') });
		assert.ok([401, 403].includes(r.status));
		privateResponse(r);
	}
	user = { id: 'owner', accountKind: 'user' };
	allowed = false;
	const r = await settings.action({ request: req('observation-settings', { deviceId: 'device', type: 'location' }) });
	assert.equal(r.status, 429);
	privateResponse(r);
	assert.equal(calls.length, 0);
});
test('node route derives exact scope from credential, has no owner history and rejects revoked credentials', async () => {
	let r = await node.loader({ request: req('node/observations?deviceId=foreign&ownerId=other') });
	privateResponse(r);
	assert.deepEqual(calls[0], ['nodeSettings', actor]);
	r = await node.action({ request: req('node/observations', { id: 'sample', type: 'location' }) });
	assert.deepEqual(calls[1], ['record', actor, { id: 'sample', type: 'location' }]);
	actor = null;
	r = await node.loader({ request: req('node/observations') });
	assert.equal(r.status, 401);
	privateResponse(r);
	assert.equal(calls.length, 2);
});
test('cleanup is exact scheduler-only, missing configuration fails closed', async () => {
	let handler = createObservationCleanupLoader({ secret: () => undefined, sweep: async () => ({ ok: true } as any) });
	let r = await handler({ request: req('observations/cleanup') });
	assert.equal(r.status, 503);
	privateResponse(r);
	handler = createObservationCleanupLoader({ secret: () => 'fixture-only', sweep: async () => invoke('cleanup') as any });
	r = await handler({ request: req('observations/cleanup') });
	assert.equal(r.status, 401);
	privateResponse(r);
	r = await handler({ request: req('observations/cleanup', undefined, { Authorization: 'Bearer fixture-only' }) });
	assert.equal(r.status, 200);
	privateResponse(r);
	assert.deepEqual(calls, [['cleanup']]);
});
