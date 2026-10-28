import assert from 'node:assert/strict';
import test from 'node:test';
import { updateMapboxOverlay } from './mapboxOverlay';

test('changing stops and route updates a loaded map without replacing it', () => {
	const priorDocument = (globalThis as any).document;
	(globalThis as any).document = { createElement: () => ({ style: {}, setAttribute() {}, textContent: '', title: '' }) };
	try {
		const calls: string[] = [];
		let source: { setData: (value: unknown) => void } | null = null;
		const map = {
			getSource: () => source,
			addSource: (_id: string, value: unknown) => { calls.push('add-source'); source = { setData: () => calls.push('set-data') }; assert.ok(value); },
			addLayer: () => calls.push('add-layer'),
			removeLayer: () => calls.push('remove-layer'),
			removeSource: () => { calls.push('remove-source'); source = null; },
			fitBounds: () => calls.push('fit-bounds')
		};
		const gl = {
			LngLatBounds: class { count = 0; extend() { this.count++; } isEmpty() { return this.count === 0; } },
			Marker: class { setLngLat() { return this; } addTo() { calls.push('add-pin'); return this; } remove() { calls.push('remove-pin'); } }
		};
		const route = { type: 'Feature' as const, properties: {} as Record<string, never>, geometry: { type: 'LineString' as const, coordinates: [[144, -37], [145, -38]] as [number, number][] } };
		const first = updateMapboxOverlay(map, gl, [], { points: [{ id: 'a', coordinates: [144, -37], label: 'A' }], route, center: [144, -37], zoom: 10, fitBounds: true });
		assert.equal(first.length, 1);
		assert.deepEqual(calls, ['add-source', 'add-layer', 'add-pin', 'fit-bounds']);
		calls.length = 0;
		const second = updateMapboxOverlay(map, gl, first, { points: [{ id: 'b', coordinates: [145, -38], label: 'B' }], route, center: [144, -37], zoom: 10, fitBounds: true });
		assert.equal(second.length, 1);
		assert.deepEqual(calls, ['remove-pin', 'set-data', 'add-pin', 'fit-bounds']);
		calls.length = 0;
		updateMapboxOverlay(map, gl, second, { points: [], route: null, center: [144, -37], zoom: 10, fitBounds: false });
		assert.deepEqual(calls, ['remove-pin', 'remove-layer', 'remove-source']);
	} finally {
		if (priorDocument === undefined) delete (globalThis as any).document;
		else (globalThis as any).document = priorDocument;
	}
});
