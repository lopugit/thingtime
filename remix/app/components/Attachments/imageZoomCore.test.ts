import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boundImageZoom, INITIAL_IMAGE_ZOOM, zoomImageAt } from './imageZoomCore';

const square = { width: 300, height: 300, imageWidth: 300, imageHeight: 300 };
test('pinching around off-centre text preserves its position', () => {
	const focus = { x: 40, y: -25 };
	const result = zoomImageAt(INITIAL_IMAGE_ZOOM, 2, focus, focus, square);
	assert.deepEqual(result, { scale: 2, x: -40, y: 25 });
	assert.equal(focus.x * result.scale + result.x, focus.x);
	assert.equal(focus.y * result.scale + result.y, focus.y);
});
test('moving the pinch midpoint pans the image', () => {
	assert.deepEqual(zoomImageAt({ scale: 2, x: 0, y: 0 }, 2, { x: 0, y: 0 }, { x: 30, y: 40 }, square), { scale: 2, x: 30, y: 40 });
});
test('scale limits preserve the focal point using the clamped scale', () => {
	assert.deepEqual(zoomImageAt(INITIAL_IMAGE_ZOOM, 99, { x: 10, y: 10 }, { x: 10, y: 10 }, square), { scale: 5, x: -40, y: -40 });
	assert.deepEqual(boundImageZoom({ scale: 0.1, x: 100, y: -100 }, square), INITIAL_IMAGE_ZOOM);
});
test('portrait letterboxing cannot be panned into blank space', () => {
	const portrait = { width: 300, height: 500, imageWidth: 100, imageHeight: 500 };
	assert.deepEqual(boundImageZoom({ scale: 2, x: 1000, y: -1000 }, portrait), { scale: 2, x: 0, y: -250 });
	assert.deepEqual(boundImageZoom({ scale: 4, x: -1000, y: 1000 }, portrait), { scale: 4, x: -50, y: 750 });
});
test('zooming back to fit recentres a previously panned image', () => {
	assert.deepEqual(zoomImageAt({ scale: 3, x: 120, y: -100 }, 1, { x: 50, y: 60 }, { x: 70, y: 80 }, square), INITIAL_IMAGE_ZOOM);
});
