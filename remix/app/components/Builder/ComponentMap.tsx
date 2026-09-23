import React from 'react';
import { NativeControlsEnabled } from './NativeComponentControls';
import { loadGoogleMaps } from './googleMapsSdk';

export type MapPoint = { lat: number; lng: number; title: string; href?: string };
const finite = (value: unknown, min: number, max: number, fallback: number) =>
	typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
export function mapPoints(value: unknown): MapPoint[] {
	if (!Array.isArray(value)) return [];
	if (value.length > 1000) throw new Error('Map has more than 1,000 points. Filter or page its source.');
	return value.flatMap((point) => {
		if (
			!point ||
			typeof point !== 'object' ||
			typeof point.lat !== 'number' ||
			typeof point.lng !== 'number' ||
			!Number.isFinite(point.lat) ||
			!Number.isFinite(point.lng) ||
			Math.abs(point.lat) > 90 ||
			Math.abs(point.lng) > 180
		)
			return [];
		const href =
			typeof point.href === 'string' && /^\/(?!\/)/.test(point.href) && !/[\\\u0000-\u0020]/.test(point.href) ? point.href.slice(0, 2000) : undefined;
		return [{ lat: point.lat, lng: point.lng, title: typeof point.title === 'string' ? point.title.slice(0, 200) : '', ...(href ? { href } : {}) }];
	});
}
// Only renders supplied coordinates. Saved Actions own all lookup requests,
// record semantics and permissions; this primitive has no workspace knowledge.
export function ComponentMap({
	apiKey,
	points,
	title,
	latitude,
	longitude,
	zoom,
	height,
	mapId,
	fitBounds
}: {
	apiKey?: unknown;
	points?: unknown;
	title?: unknown;
	latitude?: unknown;
	longitude?: unknown;
	zoom?: unknown;
	height?: unknown;
	mapId?: unknown;
	fitBounds?: unknown;
}) {
	const enabled = React.useContext(NativeControlsEnabled);
	const host = React.useRef<HTMLDivElement>(null);
	const [error, setError] = React.useState('');
	const key = typeof apiKey === 'string' && /^[A-Za-z0-9_-]{10,200}$/.test(apiKey) ? apiKey : '';
	let pointError = '',
		parsed: MapPoint[] = [];
	try {
		parsed = mapPoints(points);
	} catch (failure) {
		pointError = (failure as Error).message;
	}
	const data = JSON.stringify(parsed);
	const lat = finite(latitude, -90, 90, 0),
		lng = finite(longitude, -180, 180, 0),
		scale = finite(zoom, 0, 22, 3);
	const label = typeof title === 'string' ? title.slice(0, 200) : 'Map';
	const id = typeof mapId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(mapId) ? mapId : 'DEMO_MAP_ID';
	React.useEffect(() => {
		if (!enabled || !key || pointError) return;
		let live = true,
			map: any;
		const markers: any[] = [];
		setError('');
		void loadGoogleMaps(key)
			.then(async (maps) => {
				const [{ Map }, { AdvancedMarkerElement }] = await Promise.all([maps.importLibrary('maps'), maps.importLibrary('marker')]);
				if (!live || !host.current) return;
				map = new Map(host.current, { center: { lat, lng }, zoom: scale, mapId: id, renderingType: maps.RenderingType.RASTER });
				const bounds = new maps.LatLngBounds();
				for (const point of JSON.parse(data) as MapPoint[]) {
					const position = { lat: point.lat, lng: point.lng };
					const marker = new AdvancedMarkerElement({ map, position, title: point.title, gmpClickable: !!point.href });
					if (point.href)
						marker.addListener('click', () => {
							if (live) window.location.assign(point.href!);
						});
					markers.push(marker);
					bounds.extend(position);
				}
				if (markers.length && fitBounds !== false) {
					map.fitBounds(bounds);
					if (markers.length === 1)
						maps.event.addListenerOnce(map, 'idle', () => {
							if (live) map.setZoom(Math.max(scale, 15));
						});
				}
			})
			.catch((failure) => {
				if (live) setError(failure instanceof Error ? failure.message : 'Map could not load.');
			});
		return () => {
			live = false;
			for (const marker of markers) marker.map = null;
		};
	}, [enabled, key, data, lat, lng, scale, id, fitBounds, pointError]);
	if (!enabled) return <p>{label} (available on an interactive component).</p>;
	if (pointError || error) return <p role="alert">{pointError || error}</p>;
	if (!key) return <p>Connect a map key to display this map.</p>;
	return (
		<div
			ref={host}
			role="region"
			aria-label={label}
			style={{ width: '100%', height: finite(height, 180, 1200, 420), minWidth: 0, borderRadius: 12, overflow: 'hidden' }}
		/>
	);
}
