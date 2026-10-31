import type { LngLat, MapboxPoint } from './mapboxData';

export type MapboxOverlayData = {
	points: MapboxPoint[];
	route: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: LngLat[] } } | null;
	center: LngLat;
	zoom: number;
	fitBounds: boolean;
	fitPoints?: MapboxPoint[];
	lineColor?: string;
	onSelect?: (point: MapboxPoint) => void;
};

/** Change a loaded map's overlays in place. Its SDK instance and token stay intact. */
export function updateMapboxOverlay(map: any, gl: any, oldPins: any[], data: MapboxOverlayData): any[] {
	const focused = oldPins.find((pin) => pin.getElement?.() === document.activeElement)?.getElement?.()?.getAttribute('data-tt-map-point');
	for (const pin of oldPins) pin.remove();
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
		const node = document.createElement('button');
		node.type = 'button';
		node.title = point.label || 'Map point';
		node.setAttribute('aria-label', point.label || 'Map point');
		const key = JSON.stringify([point.group || '', point.id]);
		node.setAttribute('data-tt-map-point', key);
		node.textContent = point.markerLabel ?? (point.label || '•');
		node.setAttribute('aria-pressed', point.selected ? 'true' : 'false');
		node.style.cssText = `max-width:180px;min-width:44px;min-height:44px;padding:5px 10px;border:2px solid #fff;border-radius:999px;background:${point.color || '#ffffff'};color:${point.color ? '#ffffff' : '#183c49'};box-shadow:${point.selected ? '0 0 0 4px #183c49,0 2px 8px #0005' : '0 2px 7px #0005'};cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:700 14px system-ui,sans-serif;`;
		node.onclick = () => data.onSelect?.(point);
		const pin = new gl.Marker({ element: node }).setLngLat(point.coordinates).addTo(map);
		if (key === focused) node.focus({ preventScroll: true });
		return pin;
	});
	for (const point of data.fitPoints ?? data.points) bounds.extend(point.coordinates);
	for (const coordinate of data.route?.geometry.coordinates || []) bounds.extend(coordinate);
	if (data.fitBounds && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 42, maxZoom: data.points.length + (data.route?.geometry.coordinates.length || 0) === 1 ? 15 : 17, duration: 0 });
	return pins;
}
