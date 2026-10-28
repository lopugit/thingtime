import type { LngLat, MapboxPoint } from './mapboxData';

export type MapboxOverlayData = {
	points: MapboxPoint[];
	route: { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: LngLat[] } } | null;
	center: LngLat;
	zoom: number;
	fitBounds: boolean;
};

/** Change a loaded map's overlays in place. Its SDK instance and token stay intact. */
export function updateMapboxOverlay(map: any, gl: any, oldPins: any[], data: MapboxOverlayData): any[] {
	for (const pin of oldPins) pin.remove();
	if (data.route) {
		const source = map.getSource('tt-route');
		if (source) source.setData(data.route);
		else {
			map.addSource('tt-route', { type: 'geojson', data: data.route });
			map.addLayer({ id: 'tt-route', type: 'line', source: 'tt-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#2d677a', 'line-width': 5 } });
		}
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
		node.textContent = point.label || '•';
		node.style.cssText = 'max-width:180px;min-height:28px;padding:3px 8px;border:1px solid #d5dadd;border-radius:999px;background:#fff;color:#183c49;box-shadow:0 1px 5px #0004;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 12px system-ui,sans-serif;';
		bounds.extend(point.coordinates);
		return new gl.Marker({ element: node }).setLngLat(point.coordinates).addTo(map);
	});
	for (const coordinate of data.route?.geometry.coordinates || []) bounds.extend(coordinate);
	if (data.fitBounds && !bounds.isEmpty()) map.fitBounds(bounds, { padding: 42, maxZoom: data.points.length + (data.route?.geometry.coordinates.length || 0) === 1 ? 15 : 17, duration: 0 });
	return pins;
}
