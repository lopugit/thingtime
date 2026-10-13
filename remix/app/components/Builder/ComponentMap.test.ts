import assert from 'node:assert/strict';
import test from 'node:test';
import { mapPoints } from './ComponentMap';
test('map points accept only finite coordinates and local click destinations', () => {
	const points = mapPoints([
		{ lat: 0, lng: 0, title: 'Zero', href: '/p/map?id=1' },
		{ lat: 90, lng: 180, title: 'Edge', href: 'https://elsewhere.test/private' },
		{ lat: NaN, lng: 1 },
		{ lat: 91, lng: 1 },
		{ lat: 1, lng: 2, href: '/\\elsewhere.test' },
		{ lat: 1, lng: 2, href: '//elsewhere.test' }
	]);
	assert.deepEqual(points[0], { lat: 0, lng: 0, title: 'Zero', href: '/p/map?id=1' });
	assert.equal(points.length, 4);
	assert.ok(points.slice(1).every((point) => !point.href));
	assert.throws(() => mapPoints(Array(1001).fill({ lat: 0, lng: 0 })), /1,000/);
});

test('copied map links can target their current page without permitting other origins', () => {
	const points = mapPoints([
		{ lat: 1, lng: 2, href: '?view=detail&id=record' },
		{ lat: 1, lng: 2, href: '#details' }
	]);
	assert.equal(points[0].href, '?view=detail&id=record');
	assert.equal(points[1].href, '#details');
});
