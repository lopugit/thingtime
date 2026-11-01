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

test('reconciled marker selection restores keyboard focus to the same point', () => {
	const priorDocument = (globalThis as any).document;
	const doc: any = { activeElement: null, createElement: () => ({ style: {}, attributes: {} as Record<string, string>, setAttribute(key: string, value: string) { this.attributes[key] = value; }, getAttribute(key: string) { return this.attributes[key]; }, focus() { doc.activeElement = this; } }) };
	(globalThis as any).document = doc;
	try {
		const gl = {
			LngLatBounds: class { extend() {} isEmpty() { return true; } },
			Marker: class { node: any; constructor({ element }: any) { this.node = element; } getElement() { return this.node; } setLngLat() { return this; } addTo() { return this; } remove() {} }
		};
		const map = { getSource: () => null };
		const data = { points: [{ id: 'fav', coordinates: [144, -37] as [number, number], label: 'Favourite' }], route: null, center: [144, -37] as [number, number], zoom: 10, fitBounds: false };
		const first = updateMapboxOverlay(map, gl, [], data);
		first[0].getElement().focus();
		const second = updateMapboxOverlay(map, gl, first, { ...data, points: [{ ...data.points[0], selected: true }] });
		assert.equal(doc.activeElement, second[0].getElement());
		assert.match(second[0].getElement().style.cssText, /min-width:44px;min-height:44px/);
	} finally { (globalThis as any).document = priorDocument; }
});

test('route fitting keeps favourites visible, numbered buttons select without HTML injection', () => {
	const priorDocument = (globalThis as any).document;
	const nodes: any[] = [], coordinates: unknown[] = [], selected: string[] = [];
	(globalThis as any).document = { createElement: () => { const node = { style: {}, attributes: {} as Record<string, string>, setAttribute(key: string, value: string) { this.attributes[key] = value; }, textContent: '' }; nodes.push(node); return node; } };
	try {
		const map = { getSource: () => null, fitBounds: () => {} };
		const gl = {
			LngLatBounds: class { extend(value: unknown) { coordinates.push(value); } isEmpty() { return !coordinates.length; } },
			Marker: class { setLngLat() { return this; } addTo() { return this; } }
		};
		const favourite = { id: 'fav', coordinates: [110, -20] as [number, number], label: '<img onerror=evil>', markerLabel: '•', color: '#167d8d' };
		const stop = { id: 'stop', coordinates: [144, -37] as [number, number], label: 'Stop name', markerLabel: '1', color: '#c4513c', selected: true };
		updateMapboxOverlay(map, gl, [], { points: [favourite, stop], fitPoints: [stop], route: null, center: [144, -37], zoom: 10, fitBounds: true, onSelect: (point) => selected.push(point.id) });
		assert.equal(nodes.length, 2);
		assert.equal(nodes[0].textContent, '•');
		assert.equal(nodes[0].title, '<img onerror=evil>');
		assert.equal(nodes[1].textContent, '1');
		assert.equal(nodes[1].attributes['aria-pressed'], 'true');
		assert.deepEqual(coordinates, [[144, -37]]);
		nodes[0].onclick(); nodes[1].onclick();
		assert.deepEqual(selected, ['fav', 'stop']);
	} finally { (globalThis as any).document = priorDocument; }
});
