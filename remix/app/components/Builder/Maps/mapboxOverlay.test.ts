import assert from 'node:assert/strict';
import test from 'node:test';
import { mapboxMarkerVisual, scaleMapboxMarker, updateMapboxOverlay } from './mapboxOverlay';

class MarkerNode {
	children: MarkerNode[] = []; attributes: Record<string, string> = {}; textContent = ''; title = ''; src = ''; alt = ''; onError?: () => void; parent?: MarkerNode; onclick?: () => void;
	style: Record<string, any> = { setProperty(key: string, value: string) { this[key] = value; } };
	constructor(readonly tag: string, readonly ownerDocument: any) {}
	set innerHTML(_: string) { assert.fail('marker text must never be parsed as HTML'); }
	setAttribute(key: string, value: string) { this.attributes[key] = value; }
	getAttribute(key: string) { return this.attributes[key]; }
	removeAttribute(key: string) { delete this.attributes[key]; }
	append(node: MarkerNode) { this.children.push(node); node.parent = this; }
	contains(node: MarkerNode): boolean { return node === this || this.children.some(child => child.contains(node)); }
	focus() { this.ownerDocument.activeElement = this; }
	addEventListener(name: string, callback: () => void) { if (name === 'error') this.onError = callback; }
	remove() { this.parent?.children.splice(this.parent.children.indexOf(this), 1); }
}
function markerDocument(nodes: MarkerNode[] = []) {
	const document: any = { activeElement: null, createElement: (tag: string) => { const node = new MarkerNode(tag, document); nodes.push(node); return node; } };
	return document;
}
const markerButton = (anchor: MarkerNode) => anchor.children[0].children[0];

test('changing stops and route updates a loaded map without replacing it', () => {
	const priorDocument = (globalThis as any).document;
	(globalThis as any).document = markerDocument();
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
	const doc = markerDocument();
	(globalThis as any).document = doc;
	try {
		const gl = {
			LngLatBounds: class { extend() {} isEmpty() { return true; } },
			Marker: class { node: any; constructor({ element }: any) { this.node = element; } getElement() { return this.node; } setLngLat() { return this; } addTo() { return this; } remove() {} }
		};
		const map = { getSource: () => null };
		const data = { points: [{ id: 'fav', label: 'Favourite', coordinates: [144, -37] as [number, number] }], route: null, center: [144, -37] as [number, number], zoom: 10, fitBounds: false };
		const first = updateMapboxOverlay(map, gl, [], data);
		markerButton(first[0].getElement()).focus();
		const second = updateMapboxOverlay(map, gl, first, { ...data, points: [{ ...data.points[0], selected: true }] });
		assert.equal(doc.activeElement, markerButton(second[0].getElement()));
		assert.match(markerButton(second[0].getElement()).style.cssText, /min-width:44px;min-height:44px/);
	} finally { (globalThis as any).document = priorDocument; }
});

test('route fitting keeps favourites visible, numbered buttons select without HTML injection', () => {
	const priorDocument = (globalThis as any).document;
	const nodes: any[] = [], coordinates: unknown[] = [], selected: string[] = [];
	(globalThis as any).document = markerDocument(nodes);
	try {
		const map = { getSource: () => null, fitBounds: () => {} };
		const gl = {
			LngLatBounds: class { extend(value: unknown) { coordinates.push(value); } isEmpty() { return !coordinates.length; } },
			Marker: class { setLngLat() { return this; } addTo() { return this; } }
		};
		const favourite = { id: 'fav', coordinates: [110, -20] as [number, number], label: '<img onerror=evil>', markerLabel: '•', color: '#167d8d' };
		const stop = { id: 'stop', coordinates: [144, -37] as [number, number], label: 'Stop name', markerLabel: '1', color: '#c4513c', selected: true };
		updateMapboxOverlay(map, gl, [], { points: [favourite, stop], fitPoints: [stop], route: null, center: [144, -37], zoom: 10, fitBounds: true, onSelect: (point) => selected.push(point.id) });
		const buttons = nodes.filter(node => node.tag === 'button');
		assert.equal(buttons.length, 2);
		assert.equal(buttons[0].children[0].textContent, '•');
		assert.match(buttons[0].style.cssText, /background:transparent/);
		assert.match(buttons[0].children[0].style.cssText, /background:/);
		assert.equal(buttons[0].title, '<img onerror=evil>');
		assert.equal(buttons[1].children[0].textContent, '1');
		assert.equal(buttons[1].attributes['aria-pressed'], 'true');
		assert.deepEqual(coordinates, [[144, -37]]);
		buttons[0].onclick!(); buttons[1].onclick!();
		assert.deepEqual(selected, ['fav', 'stop']);
	} finally { (globalThis as any).document = priorDocument; }
});


test('rich marker keeps its stop number and renders labels, icons and avatar through DOM properties', () => {
	const priorDocument = (globalThis as any).document;
	(globalThis as any).document = markerDocument();
	try {
		const gl = {
			LngLatBounds: class { extend() {} isEmpty() { return true; } },
			Marker: class { constructor(readonly options: { element: MarkerNode }) {} setLngLat() { return this; } addTo() { return this; } }
		};
		const label = '<img src=x onerror=evil>';
		const avatarSrc = '/api/v1/attachments/content?id=account-photo';
		const points = [{
			id: 'stop', coordinates: [144, -37] as [number, number], group: 'route' as const, label: 'Pickup', markerLabel: '2',
			appearance: { markerLabelMode: 'both' as const, customLabel: label, markerIcon: '★', markerIcons: ['🚲', '♿'], avatarSrc }
		}];
		const pins = updateMapboxOverlay({ getSource: () => null }, gl, [], {
			points, route: null, center: [144, -37], zoom: 10, fitBounds: false
		});
		const button = markerButton(pins[0].options.element as MarkerNode);
		const [row, icons] = button.children[0].children;
		assert.equal(button.attributes['aria-label'], `Stop 2, Pickup, ${label}, 🚲, ♿`);
		assert.deepEqual(row.children.map((node) => node.textContent), ['2', '', '★', `Pickup · ${label}`]);
		assert.equal(row.children[1].tag, 'img');
		assert.equal(row.children[1].src, avatarSrc);
		assert.equal(row.children[1].alt, '');
		assert.equal(icons.textContent, '🚲 ♿');
		row.children[1].onError?.();
		assert.deepEqual(row.children.map((node) => node.textContent), ['2', '★', `Pickup · ${label}`]);
		const characterPins = updateMapboxOverlay({ getSource: () => null }, gl, [], {
			points, route: null, center: [144, -37], zoom: 10, fitBounds: false, characterId: 'trusted-character'
		});
		const characterAvatar = markerButton(characterPins[0].options.element).children[0].children[0].children[1] as MarkerNode;
		assert.equal(characterAvatar.src, avatarSrc + '&character=trusted-character');
	} finally { (globalThis as any).document = priorDocument; }
});

test('custom marker scaling retains SDK anchor, portal host and actual focused control', () => {
	const document = markerDocument();
	const anchor = document.createElement('div');
	anchor.style.transform = 'translate(160px, 100px)';
	const visual = mapboxMarkerVisual(anchor);
	const button = document.createElement('button'); visual.append(button); button.focus();
	let created = 0, removed = 0;
	const gl = {
		LngLatBounds: class { extend() {} isEmpty() { return true; } },
		Marker: class {
			element: MarkerNode;
			constructor(options: { element: MarkerNode }) { this.element = options.element; created++; }
			getElement() { return this.element; } setLngLat() { return this; } addTo() { return this; } remove() { removed++; }
		}
	};
	const data = { document, markerElements: new Map([['["","fav"]', anchor]]), points: [{ id: 'fav', label: 'Favourite', coordinates: [144, -37] as [number, number] }], route: null, center: [144, -37] as [number, number], zoom: 10, fitBounds: false };
	const pins = updateMapboxOverlay({ getSource: () => null }, gl, [], data);
	scaleMapboxMarker(anchor, 0.5); scaleMapboxMarker(anchor, 1.5);
	assert.equal(created, 1); assert.equal(removed, 0); assert.equal(pins[0].getElement(), anchor);
	assert.equal(mapboxMarkerVisual(anchor), visual); assert.equal(document.activeElement, button);
	assert.equal(anchor.style.transform, 'translate(160px, 100px)'); assert.equal(visual.style.transform, 'scale(1.5)');
	const next = updateMapboxOverlay({ getSource: () => null }, gl, pins, { ...data, markerScale: 0.8 });
	assert.equal(next[0], pins[0]); assert.equal(created, 1); assert.equal(document.activeElement, button);
});

test('default keyed marker retains anchor and focused button when associated members arrive', async () => {
	const { groupMapboxMarkers } = await import('./mapboxGrouping');
	const document = markerDocument(); let created = 0;
	const gl = {
		LngLatBounds: class { extend() {} isEmpty() { return true; } },
		Marker: class { element: MarkerNode; constructor(options: { element: MarkerNode }) { this.element = options.element; created++; } getElement() { return this.element; } setLngLat() { return this; } addTo() { return this; } remove() { assert.fail('stable group must retain anchor'); } }
	};
	const original = { id: 'first', label: 'First', coordinates: [144, -37] as [number, number], item: { association: 'same' } };
	const base = { document, route: null, center: [144, -37] as [number, number], zoom: 10, fitBounds: false };
	const first = updateMapboxOverlay({ getSource: () => null }, gl, [], { ...base, points: groupMapboxMarkers([original], 'item.association') });
	const button = markerButton(first[0].getElement()); button.focus();
	const next = updateMapboxOverlay({ getSource: () => null }, gl, first, { ...base, points: groupMapboxMarkers([original, { ...original, id: 'second' }], 'item.association') });
	assert.equal(created, 1); assert.equal(next[0], first[0]); assert.equal(markerButton(next[0].getElement()), button); assert.equal(document.activeElement, button);
});
