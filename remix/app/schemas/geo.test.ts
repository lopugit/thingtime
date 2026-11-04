import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseGeo, publicGeo, geoRadiusClause } from './geo';
test('geo validates coordinates and derives Mongo longitude-first order', () => {
	assert.deepEqual(parseGeo({ lat: -37.81, lng: 144.96, coordinates: [0, 0] }), {
		lat: -37.81,
		lng: 144.96,
		type: 'Point',
		coordinates: [144.96, -37.81]
	});
	for (const value of [null, [], { lat: '0', lng: 0 }, { lat: 91, lng: 0 }, { lat: 0, lng: -181 }, { lat: NaN, lng: 0 }, { lat: 0, lng: Infinity }])
		assert.equal(parseGeo(value), null);
	assert.equal(Object.keys(parseGeo({ lat: 0, lng: 0 })!)[0], 'type');
	assert.deepEqual(publicGeo({ lat: 0, lng: 0, extra: 'private' }), { lat: 0, lng: 0 });
	assert.deepEqual(geoRadiusClause({ lat: 0, lng: 180 }, 50), { geo: { $geoWithin: { $centerSphere: [[180, 0], 50 / 6371.0088] } } });
});
