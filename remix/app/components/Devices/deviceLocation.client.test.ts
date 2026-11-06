import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceLocationPoints, type DeviceLocationObservation } from './deviceLocation.client';
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
