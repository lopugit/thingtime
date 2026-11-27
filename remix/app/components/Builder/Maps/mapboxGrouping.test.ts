import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMapboxMarkers } from './mapboxGrouping';
import { mapboxPointKey } from './mapboxOverlay';
import { mapboxPoints, type MapboxPoint } from './mapboxData';
const point = (id: string, key?: unknown, coordinates: [number, number] = [144, -37], group: 'favourite' | 'route' = 'favourite'): MapboxPoint => ({ id, label: id, coordinates, group, markerLabel: group === 'route' ? id : '•', item: { id, markerGroupId: key } });

test('explicit association groups regardless of coordinates; colocation alone never groups', () => {
	const input = [point('fav', 'saved'), point('route1', 'saved', [145, -38], 'route'), point('other', 'different'), point('none1'), point('none2')];
	const before = JSON.stringify(input);
	const output = groupMapboxMarkers(input, 'item.markerGroupId');
	assert.equal(output.length, 4); assert.equal(output[0].markerGroup?.count, 2);
	assert.deepEqual(output[0].coordinates, [144, -37]); assert.equal(output[1].markerGroup?.count, 1);
	assert.equal(output[2], input[3]); assert.equal(output[3], input[4]);
	assert.equal(JSON.stringify(input), before);
	assert.equal(groupMapboxMarkers(input, undefined), input);
});
test('progressive group identity is stable and every original route stop remains an independent member', () => {
	const fav = point('fav', 7), route1 = point('stop1', 7, [144, -37], 'route'), route2 = point('stop2', 7, [146, -39], 'route');
	const first = groupMapboxMarkers([fav], 'item.markerGroupId')[0];
	const expanded = groupMapboxMarkers([fav, route1, route2], 'item.markerGroupId')[0];
	assert.equal(mapboxPointKey(first), mapboxPointKey(expanded));
	assert.equal(expanded.id, fav.id); assert.equal(expanded.item, fav.item);
	assert.deepEqual(expanded.markerGroup?.members.map(member => [member.point.id, member.point.group, member.point.markerLabel, member.item.id]), [['fav', 'favourite', '•', 'fav'], ['stop1', 'route', 'stop1', 'stop1'], ['stop2', 'route', 'stop2', 'stop2']]);
	assert.equal(expanded.markerGroup?.members[0].point.item, undefined);
	assert.equal(groupMapboxMarkers([fav, { ...route1, selected: true }], 'item.markerGroupId')[0].markerGroup?.selected, true);
	assert.equal(groupMapboxMarkers([fav, point('string', '7')], 'item.markerGroupId').length, 2);
});
test('safe own-property paths reject prototype traversal, accessors, invalid values and input identity overrides', () => {
	const input = point('a', 'key'); let invoked = false;
	Object.defineProperty(input.item!, 'accessor', { get() { invoked = true; return 'key'; } });
	for (const path of ['item.__proto__.markerGroupId', 'item.constructor', 'item.accessor', 'window.x', 'item[markerGroupId]']) assert.equal(groupMapboxMarkers([input], path)[0].markerGroup, undefined);
	assert.equal(invoked, false);
	for (const value of ['', '  ', null, true, Infinity, {}, []]) assert.equal(groupMapboxMarkers([point('a', value)], 'item.markerGroupId')[0].markerGroup, undefined);
	const normalized = mapboxPoints([{ id: 'hostile', coordinates: [144, -37], overlayKey: 'spoof', markerGroup: { key: 'spoof' } }])[0];
	assert.equal(normalized.overlayKey, undefined); assert.equal(normalized.markerGroup, undefined);
});
test('visual grouping leaves route order, fit points and geometry unchanged', () => {
	const stops = [point('1', 'same', [144, -37], 'route'), point('2', 'same', [145, -38], 'route')];
	const geometry = { type: 'LineString', coordinates: stops.map(stop => stop.coordinates) };
	const before = JSON.stringify({ stops, geometry });
	assert.equal(groupMapboxMarkers(stops, 'item.markerGroupId').length, 1);
	assert.equal(JSON.stringify({ stops, geometry }), before);
});
