import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMapboxNavigation, mapboxFavouritePoints, mapboxHeight, mapboxOrderedRoutePoints, mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates } from './mapboxData';

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

test('favourite projections validate stored coordinates, keep labels separate from marker text', () => {
	assert.deepEqual(mapboxFavouritePoints([{ id: 'place', crystal: { title: '<script>address</script>', longitude: 144, latitude: -37 } }, { id: 'bad', crystal: { longitude: '144', latitude: -37 } }]), [
		{ id: 'place', coordinates: [144, -37], label: '<script>address</script>', markerLabel: '•', color: '#167d8d', group: 'favourite' }
	]);
	assert.equal(mapboxPoints([{ coordinates: [144, -37], color: 'url(evil)' }])[0].color, undefined);
});

test('only the selected route can show transient provider navigation geometry', () => {
	const navigation = { routeId: 'route-a', geometry: { type: 'LineString', coordinates: [[144, -37], [145, -38]] } };
	assert.equal(activeMapboxNavigation(navigation, 'route-a'), navigation);
	assert.equal(activeMapboxNavigation(navigation, 'route-b'), null);
	assert.equal(activeMapboxNavigation(navigation, ''), null);
	assert.equal(activeMapboxNavigation(navigation, undefined), null);
});

test('responsive map heights allow viewport layouts but refuse executable CSS', () => {
	assert.equal(mapboxHeight('calc(100dvh - 64px)'), 'calc(100dvh - 64px)');
	assert.equal(mapboxHeight('100%'), '100%');
	assert.equal(mapboxHeight(1600), 1600);
	assert.equal(mapboxHeight('url(https://other.test)'), 420);
	assert.equal(mapboxHeight(-1), 420);
});

test('route numbering uses global rank across pages until a matching live optimized order is available', () => {
	const result = {
		points: [{ id: 'later', label: 'Later', coordinates: [144, -37] }, { id: 'first', label: 'First', coordinates: [145, -38] }],
		items: [{ id: 'later', crystal: { rank: 20 } }, { id: 'first', crystal: { rank: 1 } }]
	};
	assert.deepEqual(mapboxOrderedRoutePoints(result, null).map((point) => point.id), ['first', 'later']);
	assert.deepEqual(mapboxOrderedRoutePoints(result, { orderedStopIds: ['later', 'first'] }).map((point) => point.id), ['later', 'first']);
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
