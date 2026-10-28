import assert from 'node:assert/strict';
import test from 'node:test';
import { mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates } from './mapboxData';

test('Mapbox primitives retain only valid finite coordinates', () => {
	assert.equal(validCoordinates([180, 90]), true);
	assert.equal(validCoordinates([181, 0]), false);
	assert.equal(validCoordinates([1, Number.NaN]), false);
	assert.deepEqual(mapboxPoints([
		{ id: 'one', coordinates: [144.9, -37.8], label: 'Stop one' },
		{ id: 'bad', coordinates: [500, 0], label: 'Bad' }
	]), [{ id: 'one', coordinates: [144.9, -37.8], label: 'Stop one' }]);
	assert.equal(mapboxRoute({ type: 'LineString', coordinates: [[144.9, -37.8], [145, -37.9]] })?.geometry.coordinates.length, 2);
	assert.equal(mapboxRoute({ type: 'LineString', coordinates: [[144.9, -37.8], [999, 0]] }), null);
});

test('Mapbox style URL stays on the official style origin', () => {
	assert.equal(mapboxStyle('mapbox://styles/mapbox/light-v11'), 'mapbox://styles/mapbox/light-v11');
	assert.equal(mapboxStyle('https://api.mapbox.com/styles/v1/mapbox/streets-v12'), 'https://api.mapbox.com/styles/v1/mapbox/streets-v12');
	assert.equal(mapboxStyle('https://other.test/styles/v1/mapbox/private'), 'mapbox://styles/mapbox/streets-v12');
});

test('browser configuration accepts only public Mapbox tokens', () => {
	assert.equal(publicMapboxToken({ publicToken: 'pk.sample-token' }), 'pk.sample-token');
	assert.equal(publicMapboxToken({ publicToken: 'sk.secret-token' }), null);
	assert.equal(publicMapboxToken({ publicToken: 'pk.bad token' }), null);
});
