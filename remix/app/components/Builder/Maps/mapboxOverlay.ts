import { applyMapboxMarkerScale } from './mapboxScale';
import { characterMediaUrl } from '../../Characters/characterMedia';
import type { LngLat, MapboxPoint } from './mapboxData';

export type MapboxOverlayData = {
	points: MapboxPoint[];
	route: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: LngLat[] } } | null;
	center: LngLat;
	zoom: number;
	fitBounds: boolean;
	fitPoints?: MapboxPoint[];
	lineColor?: string;
	characterId?: string;
	onSelect?: (point: MapboxPoint) => void;
	// Already-authorized Builder content owns its presentation and controls.
	// These neutral SDK anchors contain React portals, never raw HTML strings.
	markerElements?: Map<string, HTMLElement>;
	document?: Document;
	markerScale?: number;
};

export const mapboxPointKey = (point: MapboxPoint) => point.overlayKey ?? JSON.stringify([point.group || '', point.id]);

const defaultButtons = new WeakMap<HTMLElement, HTMLButtonElement>();
const markerVisuals = new WeakMap<HTMLElement, HTMLElement>();
export function mapboxMarkerVisual(anchor: HTMLElement): HTMLElement {
	let visual = markerVisuals.get(anchor);
	if (!visual) {
		visual = anchor.ownerDocument.createElement('div');
		visual.setAttribute('data-tt-map-marker-visual', '');
		anchor.append(visual);
		markerVisuals.set(anchor, visual);
	}
	return visual;
}
export function scaleMapboxMarker(anchor: HTMLElement, scale: number) {
	const visual = markerVisuals.get(anchor);
	if (visual) applyMapboxMarkerScale(anchor, visual, scale);
}

function renderMarker(node: HTMLElement, point: MapboxPoint, characterId?: string) {
	const legacyLabel = point.markerLabel ?? (point.label || '•');
	const appearance = point.appearance;
	if (!appearance) {
		node.textContent = legacyLabel;
		return;
	}

	const custom = appearance.customLabel || '';
	const mode = appearance.markerLabelMode;
	const caption = mode === 'title' ? point.label : mode === 'custom' ? custom
		: mode === 'both' ? [point.label, custom].filter(Boolean).join(' · ') : '';
	const label = [
		point.group === 'route' && legacyLabel ? `Stop ${legacyLabel}` : '',
		point.label, mode === 'custom' || mode === 'both' ? custom : '',
		...(appearance.markerIcons ?? [])
	]
		.filter(Boolean).join(', ');
	if (label) node.setAttribute('aria-label', label);

	const document = node.ownerDocument ?? globalThis.document;
	const row = document.createElement('span');
	row.style.cssText = 'display:flex;align-items:center;justify-content:center;gap:5px;min-width:0';
	node.append(row);
	const text = (parent: HTMLElement, value: string, css = '') => {
		const span = document.createElement('span');
		span.textContent = value;
		span.style.cssText = css;
		parent.append(span);
		return span;
	};

	if (point.group === 'route') text(row, legacyLabel, 'display:grid;place-items:center;min-width:21px;min-height:21px;border:1px solid currentColor;border-radius:50%;flex:none');
	const icon = appearance.markerIcon;
	const fallback = point.group === 'route' ? '' : point.markerLabel || '•';
	if (appearance.avatarSrc) {
		const avatar = document.createElement('img');
		avatar.alt = '';
		avatar.referrerPolicy = 'no-referrer';
		avatar.decoding = 'async';
		avatar.loading = 'lazy';
		avatar.style.cssText = 'width:27px;height:27px;flex:none;border-radius:50%;object-fit:cover';
		avatar.addEventListener('error', () => {
			if (fallback && !icon) text(row, fallback);
			avatar.remove();
		}, { once: true });
		avatar.src = characterMediaUrl(appearance.avatarSrc, characterId) ?? '';
		row.append(avatar);
	}
	if (icon || (!appearance.avatarSrc && fallback)) text(row, icon || fallback, 'flex:none;max-width:5ch;overflow:hidden;text-overflow:ellipsis');
	if (caption) text(row, caption, 'min-width:0;white-space:normal;overflow-wrap:anywhere;text-wrap:pretty');
	if (appearance.markerIcons?.length) {
		const icons = text(node, appearance.markerIcons.join(' '), 'display:block;white-space:normal;overflow-wrap:anywhere;font-size:12px');
		icons.setAttribute('aria-hidden', 'true');
	}
}

/** Change a loaded map's overlays in place. Its SDK instance and token stay intact. */
export function updateMapboxOverlay(map: any, gl: any, oldPins: any[], data: MapboxOverlayData): any[] {
	const document = data.document ?? globalThis.document;
	const focused = oldPins.find((pin) => pin.getElement?.() === document.activeElement || pin.getElement?.()?.contains?.(document.activeElement))?.getElement?.()?.getAttribute('data-tt-map-point');
	const retained = new Map<HTMLElement, any>();
	const elements = new Set(data.markerElements?.values());
	const defaultKeys = new Set(data.points.filter(point => !data.markerElements?.has(mapboxPointKey(point))).map(mapboxPointKey));
	const retainedDefaults = new Map<string, any>();
	for (const pin of oldPins) {
		const element = pin.getElement?.();
		if (elements.has(element)) retained.set(element, pin);
		else if (element && defaultButtons.has(element) && defaultKeys.has(element.getAttribute('data-tt-map-point'))) retainedDefaults.set(element.getAttribute('data-tt-map-point'), pin);
		else pin.remove();
	}
	if (data.route) {
		const source = map.getSource('tt-route');
		if (source) source.setData(data.route);
		else {
			map.addSource('tt-route', { type: 'geojson', data: data.route });
			map.addLayer({ id: 'tt-route', type: 'line', source: 'tt-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': data.lineColor || '#2d677a', 'line-width': 5 } });
		}
		if (data.lineColor) map.setPaintProperty?.('tt-route', 'line-color', data.lineColor);
	} else if (map.getSource('tt-route')) {
		map.removeLayer('tt-route');
		map.removeSource('tt-route');
	}
	const bounds = new gl.LngLatBounds();
	const pins = data.points.map((point) => {
		const key = mapboxPointKey(point);
		const custom = data.markerElements?.get(key);
		if (custom) {
			custom.setAttribute('data-tt-map-point', key);
			mapboxMarkerVisual(custom);
			scaleMapboxMarker(custom, data.markerScale ?? 1);
			const pin = retained.get(custom) ?? new gl.Marker({ element: custom }).setLngLat(point.coordinates).addTo(map);
			pin.setLngLat(point.coordinates);
			// Mapbox adds image semantics to its anchor. Authored children own
			// accessible names, focus and actions, including native buttons/links.
			custom.removeAttribute('role');
			custom.removeAttribute('aria-label');
			custom.removeAttribute('tabindex');
			return pin;
		}
		const prior = retainedDefaults.get(key);
		const anchor = prior?.getElement() ?? document.createElement('div');
		anchor.setAttribute('data-tt-map-point', key);
		const visual = mapboxMarkerVisual(anchor);
		const node = defaultButtons.get(anchor) ?? document.createElement('button');
		if (!defaultButtons.has(anchor)) { visual.append(node); defaultButtons.set(anchor, node); }
		node.textContent = '';
		node.type = 'button';
		node.title = point.label || 'Map point';
		node.setAttribute('aria-label', point.label || 'Map point');
		node.setAttribute('data-tt-map-point', key);
		node.setAttribute('aria-pressed', point.selected ? 'true' : 'false');
		const face = document.createElement('span');
		face.setAttribute('data-tt-map-marker-face', '');
		face.style.cssText = `display:flex;flex-direction:column;justify-content:center;max-width:${point.appearance ? 'min(240px, calc(100vw - 32px))' : '180px'};min-width:44px;min-height:44px;padding:5px 10px;border:2px solid #fff;border-radius:999px;background:${point.color || '#ffffff'};color:${point.color ? '#ffffff' : '#183c49'};box-shadow:${point.selected ? '0 0 0 4px #183c49,0 2px 8px #0005' : '0 2px 7px #0005'};cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 14px system-ui,sans-serif;`;
		renderMarker(face, point, data.characterId);
		node.append(face);
		if (face.getAttribute('aria-label')) node.setAttribute('aria-label', face.getAttribute('aria-label')!);
		node.style.cssText = 'display:grid;place-items:center;min-width:44px;min-height:44px;padding:0;border:0;background:transparent;color:inherit;cursor:pointer';
		anchor.style.zIndex = point.selected ? '2' : point.group === 'route' ? '1' : '';
		node.onclick = () => data.onSelect?.(point);
		const ariaLabel = node.getAttribute?.('aria-label');
		const pin = prior ?? new gl.Marker({ element: anchor }).setLngLat(point.coordinates).addTo(map);
		pin.setLngLat(point.coordinates);
		// The SDK assigns role=img during construction; restore native control
		// semantics after it has attached the marker.
		node.setAttribute('role', 'button');
		if (ariaLabel) node.setAttribute('aria-label', ariaLabel);
		anchor.removeAttribute('role'); anchor.removeAttribute('aria-label'); anchor.removeAttribute('tabindex');
		scaleMapboxMarker(anchor, data.markerScale ?? 1);
		node.style.minWidth = 'var(--tt-map-marker-min-target, 44px)';
		node.style.minHeight = 'var(--tt-map-marker-min-target, 44px)';
		if (key === focused) node.focus({ preventScroll: true });
		return pin;
	});
	const fittedPoints = (data.fitPoints ?? data.points).filter(point => point.fitBounds !== false);
	for (const point of fittedPoints) bounds.extend(point.coordinates);
	for (const coordinate of data.route?.geometry.coordinates || []) bounds.extend(coordinate);
	if (data.fitBounds && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 42, maxZoom: fittedPoints.length + (data.route?.geometry.coordinates.length || 0) === 1 ? 15 : 17, duration: 0 });
	return pins;
}
