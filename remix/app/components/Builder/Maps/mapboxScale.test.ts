import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMapboxMarkerScale, mapboxMarkerScale, observeMapboxZoom } from './mapboxScale';

test('marker scale accepts numeric strings, clamps visual scale, and treats zoom zero as actual camera', () => {
	assert.deepEqual(mapboxMarkerScale(undefined, false, 12, 0), { markerBaseScale: 1, markerScale: 1 });
	assert.deepEqual(mapboxMarkerScale('0.8', 'true', '12', 12), { markerBaseScale: 0.8, markerScale: 0.8 });
	assert.equal(mapboxMarkerScale(1, true, 12, 0).markerScale, 0.5);
	assert.equal(mapboxMarkerScale(1, true, 12, 16).markerScale, 1.5);
	assert.equal(mapboxMarkerScale(0, true, 12, 0).markerScale, 0.2);
	assert.equal(mapboxMarkerScale(99, false, 12, 12).markerScale, 2);
	assert.equal(mapboxMarkerScale('bad', false, 12, 12).markerScale, 1);
});
test('zoom reads coalesce in owner RAF and cleanup cancels pending and stale callbacks', () => {
	let zoom = 0, listener: (() => void) | undefined, pending: FrameRequestCallback | undefined, cancelled = 0;
	const values: number[] = [];
	const map = { getZoom: () => zoom, on: (_: string, receive: () => void) => { listener = receive; }, off: (_: string, receive: () => void) => { assert.equal(receive, listener); listener = undefined; } };
	const view = { requestAnimationFrame: (callback: FrameRequestCallback) => { assert.equal(pending, undefined); pending = callback; return 17; }, cancelAnimationFrame: (handle: number) => { assert.equal(handle, 17); cancelled++; } };
	const stop = observeMapboxZoom(map, view, value => values.push(value));
	assert.deepEqual(values, [0]);
	listener!(); zoom = 8; listener!(); const frame = pending!; pending = undefined; frame(0);
	assert.deepEqual(values, [0, 8]);
	listener!(); const stale = pending!; stop(); stale(0);
	assert.equal(cancelled, 1); assert.equal(listener, undefined); assert.deepEqual(values, [0, 8]);
});
test('scaling preserves SDK positioning transform and exposes inverse target size', () => {
	const properties = new Map<string, string>();
	const anchor = { style: { transform: 'translate(120px, 90px)', setProperty: (key: string, value: string) => properties.set(key, value) } };
	const visual = { style: { transform: '', transformOrigin: '', setProperty: (key: string, value: string) => properties.set(key, value) } };
	applyMapboxMarkerScale(anchor as unknown as HTMLElement, visual as unknown as HTMLElement, 0.5);
	assert.equal(anchor.style.transform, 'translate(120px, 90px)'); assert.equal(visual.style.transform, 'scale(0.5)');
	assert.equal(properties.get('--tt-map-marker-scale'), '0.5'); assert.equal(properties.get('--tt-map-marker-min-target'), '88px');
});
