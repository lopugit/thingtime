import assert from 'node:assert/strict';
import test from 'node:test';
import { activeMapboxNavigation, mapboxFavouritePoints, mapboxHeight, markerSelection, mapboxOrderedRoutePoints, mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates } from './mapboxData';

test('explicit source ordinals survive omitted invalid-coordinate points and remain authoritative', () => {
	const points = mapboxOrderedRoutePoints({
		items: [{ id: 'one', markerLabel: 1, crystal: { rank: 1 } }, { id: 'missing', markerLabel: 2, crystal: { rank: 2 } }, { id: 'three', markerLabel: 3, crystal: { rank: 3 } }],
		points: [{ id: 'one', coordinates: [144, -37] }, { id: 'missing', coordinates: null }, { id: 'three', coordinates: [145, -38] }]
	}, null);
	assert.deepEqual(points.map(point => point.markerLabel), ['1', '3']);
	assert.equal(mapboxOrderedRoutePoints({ items: [{ id: 'one', markerLabel: 1 }], points: [{ id: 'one', coordinates: [144, -37], markerLabel: 'A' }] }, null)[0].markerLabel, 'A');
});

test('full rank-sorted itinerary ordinals include unresolved rows and do not display arbitrary rank values', () => {
	const result = mapboxOrderedRoutePoints({ items: [
		{ id: 'third', crystal: { rank: 9 } }, { id: 'first', crystal: { rank: 7 } }, { id: 'unresolved', crystal: { rank: 8.5 } }
	], points: [{ id: 'third', coordinates: [145, -38] }, { id: 'first', coordinates: [144, -37] }] }, null);
	assert.deepEqual(result.map(point => [point.id, point.markerLabel]), [['first', '1'], ['third', '3']]);
});

test('Mapbox primitives retain only valid finite coordinates', () => {
	assert.equal(validCoordinates([180, 90]), true);
	assert.equal(validCoordinates([181, 0]), false);
	assert.equal(validCoordinates([1, Number.NaN]), false);
	assert.deepEqual(mapboxPoints([
		{ id: 'one', coordinates: [144.9, -37.8], label: 'Stop one' },
		{ id: 'bad', coordinates: [500, 0], label: 'Bad' }
	]), [{ id: 'one', coordinates: [144.9, -37.8], label: 'Stop one', item: { id: 'one', coordinates: [144.9, -37.8], label: 'Stop one' } }]);
	assert.equal(mapboxRoute({ type: 'LineString', coordinates: [[144.9, -37.8], [145, -37.9]] })?.geometry.coordinates.length, 2);
	assert.equal(mapboxRoute({ type: 'LineString', coordinates: [[144.9, -37.8], [999, 0]] }), null);
});

test('favourite projections validate stored coordinates, keep labels separate from marker text', () => {
	assert.deepEqual(mapboxFavouritePoints([{ id: 'place', crystal: { title: '<script>address</script>', longitude: 144, latitude: -37 } }, { id: 'bad', crystal: { longitude: '144', latitude: -37 } }]), [
		{ id: 'place', coordinates: [144, -37], label: '<script>address</script>', markerLabel: '•', color: '#167d8d', group: 'favourite', item: { id: 'place', crystal: { title: '<script>address</script>', longitude: 144, latitude: -37 } } }
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


test('stops inherit favourite marker appearance but can independently clear or override fields', () => {
	const crystal = {
		title: 'Place', longitude: 144, latitude: -37, markerIcon: '★',
		markerLabelMode: 'both', markerLabel: 'Pick-up', markerIcons: '♿, 🚲\n ',
		markerAvatarAttachmentId: 'account-photo'
	};
	const [favourite] = mapboxFavouritePoints([{ id: 'place', crystal }]);
	assert.deepEqual(favourite.appearance, {
		markerIcon: '★', markerLabelMode: 'both', customLabel: 'Pick-up', markerIcons: ['♿', '🚲'],
		avatarSrc: '/api/v1/attachments/content?id=account-photo'
	});
	const [stop] = mapboxOrderedRoutePoints({
		points: [{ id: 'stop', label: 'Stop', coordinates: [144, -37] }],
		items: [{ id: 'stop', favorite: { crystal }, crystal: { rank: 3, markerIcon: '📦', markerIcons: '', markerAvatarAttachmentId: '' } }]
	}, null);
	assert.deepEqual(stop.appearance, { ...favourite.appearance, markerIcon: '📦', markerIcons: [], avatarSrc: '' });
});

test('markers cannot source avatars from a URL or inject attachment query options', () => {
	for (const markerAvatarAttachmentId of ['https://example.com/avatar', 'photo&key=secret', 'javascript:alert(1)']) {
		const [point] = mapboxPoints([{ id: 'point', coordinates: [144, -37], markerAvatarAttachmentId }]);
		assert.equal(point.appearance?.avatarSrc, '');
	}
	const [point] = mapboxPoints([{ id: 'point', coordinates: [144, -37], markerAvatar: 'https://example.com/avatar' }]);
	assert.equal(point.appearance?.avatarSrc, undefined);
});

test('favourite and stop selection can use separate local state without changing query', () => {
	const config = { onSelectState: 'favouriteId', onRouteSelectState: 'stopId', onSelectQuery: 'legacy' };
	const query = { routeId: 'current' };
	assert.deepEqual(markerSelection({ id: 'a', group: 'favourite' }, config, query), { op: 'set', key: 'favouriteId', value: 'a', clear: ['stopId'] });
	assert.deepEqual(markerSelection({ id: 'b', group: 'route' }, config, query), { op: 'set', key: 'stopId', value: 'b', clear: ['favouriteId'] });
	assert.deepEqual(markerSelection({ id: 'a', group: 'favourite' }, { onSelectQuery: 'legacy' }, query), {
		op: 'query', params: { routeId: 'current', legacy: 'a' }
	});
	assert.deepEqual(markerSelection({ id: 'b', group: 'route' }, { onRouteSelectQuery: 'stopId', queryScope: 'page' }, query), {
		op: 'query', scope: 'page', params: { routeId: 'current', stopId: 'b' }
	});
	const both = { onSelectQuery: 'favoriteId', onRouteSelectQuery: 'stopId', queryScope: 'page' };
	assert.deepEqual(markerSelection({ id: 'b', group: 'route' }, both, { ...query, favoriteId: 'a' }), {
		op: 'query', scope: 'page', params: { routeId: 'current', stopId: 'b' }
	});
	assert.deepEqual(markerSelection({ id: 'a', group: 'favourite' }, both, { ...query, stopId: 'b' }), {
		op: 'query', scope: 'page', params: { routeId: 'current', favoriteId: 'a' }
	});
});

test('marker selection can atomically navigate to its related view', () => {
 assert.deepEqual(markerSelection({ group: 'favourite', id: 'item' }, { onSelectQuery: 'favoriteId', onSelectQueryParams: { view: 'favourites' }, queryScope: 'page' }, { view: 'routes' }), { op: 'query', scope: 'page', params: { view: 'favourites', favoriteId: 'item' } });
});

test('transient optimization numbers the full itinerary with unresolved slots and preserves authored labels', () => {
 const source = { items: [{id:'a',crystal:{rank:7}},{id:'missing',crystal:{rank:8}},{id:'c',crystal:{rank:9}}], points: [{id:'a',coordinates:[144,-37]},{id:'c',coordinates:[145,-38]}] };
 const result = mapboxOrderedRoutePoints(source,{orderedStopIds:['c','a']});
 assert.deepEqual(result.map(p=>[p.id,p.markerLabel]),[['c','1'],['a','3']]);
 source.points[0] = {...source.points[0],markerLabel:'Authored'} as any;
 assert.equal(mapboxOrderedRoutePoints(source,{orderedStopIds:['c','a']})[1].markerLabel,'Authored');
});
