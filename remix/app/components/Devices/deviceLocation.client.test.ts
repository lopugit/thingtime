import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceLocationPoints, readDeviceLocations, type DeviceLocationObservation } from './deviceLocation.client';
const now = Date.parse('2026-11-06T12:00:00Z');
const observation = (id: string, age: number, value = {}): DeviceLocationObservation => ({
	id,
	deviceId: 'device',
	type: 'location',
	observedAt: new Date(now - age).toISOString(),
	receivedAt: new Date(now).toISOString(),
	value: { latitude: -37, longitude: 144, accuracyMeters: 25, ...value }
});
test('map preserves source coordinates and time and labels age independently of color', () => {
	const points = deviceLocationPoints([observation('a', 1000), observation('b', 7200000), observation('c', 172800000)], 'a', now);
	assert.deepEqual(
		points.map((p) => p.coordinates),
		[
			[144, -37],
			[144, -37],
			[144, -37]
		]
	);
	assert.deepEqual(
		points.map((p) => p.ageBand),
		['Recent', 'Today', 'Earlier']
	);
	assert.equal(points[0].latest, true);
	assert.match(points[0].label, /Latest/);
	assert.equal(new Set(points.map((p) => p.color)).size, 3);
});
test('invalid coordinates never place a false location at zero', () => {
	assert.deepEqual(deviceLocationPoints([observation('bad', 0, { latitude: NaN }), observation('bad', 0, { longitude: 200 })], undefined, now), []);
});


test('history requests ten observations per cursor without a total-history cap', async (t) => {
	const origin = 'https://location-paging.example';
	const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
	Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { origin } } });
	t.after(() => {
		if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
		else Reflect.deleteProperty(globalThis, 'window');
	});
	const requests: URL[] = [];
	t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input), origin);
		if (url.pathname === '/.well-known/thingtime-capabilities.json') return Response.json({ schemaVersion: 1, origin, features: { 'api.devices-observations': { version: '1.0.0' } } });
		requests.push(url);
		assert.equal(new Headers(init?.headers).get('X-Thingtime-Expected-Actor'), 'owner');
		assert.equal(url.searchParams.get('limit'), '10');
		assert.equal(url.searchParams.get('deviceId'), 'device');
		assert.equal(url.searchParams.get('from'), '2026-11-01T00:00:00Z');
		const offset = Number(url.searchParams.get('cursor') || 0);
		return Response.json({ ok: true, observations: Array.from({ length: 10 }, (_, i) => observation(String(offset + i), (offset + i) * 1000)), latest: null, settings: { enabled: true, retentionMs: null, collectionId: 'collection' }, nextCursor: offset < 120 ? String(offset + 10) : null });
	});
	const rows: DeviceLocationObservation[] = [];
	let cursor: string | undefined;
	do {
		const page = await readDeviceLocations({ origin, ownerId: 'owner', deviceId: 'device' }, new AbortController().signal, { ...(cursor ? { cursor } : {}), from: '2026-11-01T00:00:00Z' });
		rows.push(...page.observations);
		cursor = page.nextCursor || undefined;
	} while (cursor);
	assert.equal(rows.length, 130);
	assert.equal(requests.length, 13);
	assert.deepEqual(rows.map(row => row.id), Array.from({ length: 130 }, (_, i) => String(i)));
});
