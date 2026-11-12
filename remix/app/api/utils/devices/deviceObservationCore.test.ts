import assert from 'node:assert/strict';
import test from 'node:test';
import {
	normalizeDeviceObservation,
	observationSettings,
	observationExpired,
	observationCutoff,
	observationCursor,
	parseObservationCursor
} from './deviceObservationCore';
const now = Date.parse('2026-11-06T12:00:00Z');
const sample = {
	id: 'sample',
	type: 'location',
	collectionId: 'grant',
	observedAt: '2026-11-06T11:00:00Z',
	value: { latitude: 55.1, longitude: 12.2, accuracyMeters: 0 }
};
test('registered location validates exact numeric fields, precision, sources and real times', () => {
	assert.deepEqual(normalizeDeviceObservation(sample, now), { ...sample, observedAt: '2026-11-06T11:00:00.000Z' });
	assert.ok(
		normalizeDeviceObservation(
			{ ...sample, value: { ...sample.value, precision: 'approximate', source: 'core-location', altitudeMeters: -10, verticalAccuracyMeters: 5 } },
			now
		)
	);
	for (const value of [
		null,
		{},
		{ ...sample, ownerId: 'other' },
		{ ...sample, type: 'unknown' },
		{ ...sample, observedAt: 'invalid' },
		{ ...sample, observedAt: '2026-11-06T12:01:01Z' },
		{ ...sample, value: { ...sample.value, latitude: '55' } },
		{ ...sample, value: { ...sample.value, longitude: 181 } },
		{ ...sample, value: { ...sample.value, accuracyMeters: -1 } },
		{ ...sample, value: { ...sample.value, precision: 'gps' } },
		{ ...sample, value: { ...sample.value, secret: 'x' } },
		{ ...sample, value: { ...sample.value, latitude: NaN } }
	])
		assert.equal(normalizeDeviceObservation(value, now), null);
	// Offline historic measurements are valid; never invent a current sample time.
	assert.ok(normalizeDeviceObservation({ ...sample, observedAt: '2000-01-01T00:00:00Z' }, now));
});
test('collection defaults disabled/Never; retention is observation-time based at exact boundary', () => {
	assert.deepEqual(observationSettings({}, 'location'), { enabled: false, retentionMs: null, collectionId: null });
	assert.equal(observationExpired(sample.observedAt, 3600_000, now), true);
	assert.equal(observationExpired(sample.observedAt, 3600_001, now), false);
	assert.equal(observationExpired(sample.observedAt, null, now), false);
	assert.ok(Number.isFinite(observationCutoff(Number.MAX_SAFE_INTEGER, now).getTime()));
});
test('opaque cursors roundtrip only validated stable tuples', () => {
	const value = { id: 'stable', observedAt: '2026-11-06T11:00:00.000Z' };
	assert.deepEqual(parseObservationCursor(observationCursor(value)), value);
	for (const bad of ['bad', Buffer.from('["bad","id"]').toString('base64url'), '123']) assert.throws(() => parseObservationCursor(bad));
});
