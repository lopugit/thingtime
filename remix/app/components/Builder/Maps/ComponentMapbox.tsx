import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { NativeControlsEnabled } from '../NativeComponentControls';
import { loadMapbox } from './mapboxSdk';
import { mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates, type LngLat } from './mapboxData';
import { updateMapboxOverlay, type MapboxOverlayData } from './mapboxOverlay';

type MapProps = {
	vaultId?: unknown;
	styleUrl?: unknown;
	center?: unknown;
	zoom?: unknown;
	points?: unknown;
	route?: unknown;
	fitBounds?: unknown;
	height?: unknown;
	title?: unknown;
};

const number = (value: unknown, min: number, max: number, fallback: number) =>
	typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

export function ComponentMapbox(props: MapProps) {
	const user = useCurrentUser();
	// A changed account unmounts the old map before a new token can be requested.
	return <MapboxViewport key={user?.id || 'anonymous'} {...props} />;
}

function MapboxViewport({ vaultId, styleUrl, center, zoom, points, route, fitBounds, height, title }: MapProps) {
	const enabled = React.useContext(NativeControlsEnabled);
	const host = React.useRef<HTMLDivElement>(null);
	const mapRef = React.useRef<any>(null);
	const glRef = React.useRef<any>(null);
	const pinsRef = React.useRef<any[]>([]);
	const readyRef = React.useRef(false);
	const viewportRef = React.useRef<{ center: LngLat; zoom: number } | null>(null);
	const [error, setError] = React.useState('');
	const id = typeof vaultId === 'string' ? vaultId.trim() : '';
	const style = mapboxStyle(styleUrl);
	const origin = validCoordinates(center) ? center : [144.9631, -37.8136] as LngLat;
	const scale = number(zoom, 0, 22, 11);
	const markers = mapboxPoints(points);
	const line = mapboxRoute(route);
	const dataKey = JSON.stringify({ points: markers, route: line, center: origin, zoom: scale, fitBounds: fitBounds !== false });
	// The load callback always reads the newest data, even if props change while the SDK loads.
	const dataRef = React.useRef<MapboxOverlayData>(JSON.parse(dataKey));
	dataRef.current = JSON.parse(dataKey);
	const label = typeof title === 'string' && title.trim() ? title : 'Map';
	const applyData = () => {
		if (!readyRef.current || !mapRef.current || !glRef.current) return;
		const data = dataRef.current;
		pinsRef.current = updateMapboxOverlay(mapRef.current, glRef.current, pinsRef.current, data);
		const prior = viewportRef.current;
		if ((!data.fitBounds || (!data.points.length && !data.route)) &&
			(!prior || prior.zoom !== data.zoom || prior.center[0] !== data.center[0] || prior.center[1] !== data.center[1])) {
			mapRef.current.jumpTo({ center: data.center, zoom: data.zoom });
		}
		viewportRef.current = { center: data.center, zoom: data.zoom };
	};
	const applyDataRef = React.useRef(applyData);
	applyDataRef.current = applyData;

	React.useEffect(() => {
		if (!enabled || !id || !host.current) return;
		const abort = new AbortController();
		let live = true;
		setError('');
		void (async () => {
			try {
				await requireThingtimeCapability('api.maps', '1.0.0');
				if (!live) return;
				const response = await fetch('/api/v1/maps', {
					method: 'POST', credentials: 'same-origin', cache: 'no-store',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ operation: 'browser-config', vaultId: id }), signal: abort.signal
				});
				if (!response.ok) throw new Error('Map configuration is unavailable.');
				const config = await response.json();
				const publicToken = config?.ok ? publicMapboxToken(config) : null;
				if (!publicToken) throw new Error('Map configuration is unavailable.');
				if (!live) return;
				const gl = await loadMapbox();
				if (!live || !host.current) return;
				const current = dataRef.current;
				const map = new gl.Map({
					container: host.current, accessToken: publicToken, style,
					center: current.center, zoom: current.zoom, attributionControl: true
				});
				mapRef.current = map;
				glRef.current = gl;
				viewportRef.current = { center: current.center, zoom: current.zoom };
				map.addControl(new gl.NavigationControl({ showCompass: false }), 'top-right');
				map.on('load', () => {
					if (!live) return;
					readyRef.current = true;
					setError('');
					applyDataRef.current();
				});
				map.on('error', () => { if (live) setError('Map tiles could not load.'); });
			} catch {
				if (live) setError('Map could not load. Check the vault connection and this page’s access.');
			}
		})();
		return () => {
			live = false;
			abort.abort();
			readyRef.current = false;
			for (const pin of pinsRef.current) pin.remove();
			pinsRef.current = [];
			mapRef.current?.remove();
			mapRef.current = null;
			glRef.current = null;
			viewportRef.current = null;
		};
	}, [enabled, id, style]);

	React.useEffect(() => { applyDataRef.current(); }, [dataKey]);

	if (!enabled) return <p role="note">{label} is available on the interactive page.</p>;
	if (!id) return <p role="note">Choose a Mapbox vault connection to display the map.</p>;
	return <div style={{ width: '100%', minWidth: 0 }}>
		{error ? <p role="alert" style={{ color: 'var(--tt-muted, #5a5a66)' }}>{error}</p> : null}
		<div ref={host} role="region" aria-label={label} tabIndex={0}
			style={{ width: '100%', height: number(height, 180, 1200, 420), minWidth: 0, borderRadius: 'var(--tt-radius-md, 12px)', overflow: 'hidden', border: '1px solid var(--tt-border, #e0e0e0)' }} />
	</div>;
}
