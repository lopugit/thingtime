import React from 'react';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { ComponentLocalControl, NativeControlsEnabled } from '../NativeComponentControls';
import { ComponentDataScope } from '../ComponentSelect';
import { useThingSource } from '../liveComponent';
import { useWebpageRuntime } from '../webpageRuntime';
import { collectionSource } from '../collectionSource';
import { resolveTemplate } from '~/components/ComponentsLibrary/componentTemplate';
import { loadMapbox } from './mapboxSdk';
import { activeMapboxNavigation, mapboxFavouritePoints, mapboxHeight, mapboxOrderedRoutePoints, mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates, type LngLat, type MapboxPoint } from './mapboxData';
import { updateMapboxOverlay, type MapboxOverlayData } from './mapboxOverlay';
import { observeMapboxContainer } from './mapboxResize';

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
	favouritesSource?: unknown;
	routeSource?: unknown;
	showFavourites?: unknown;
	selectedFavouriteId?: unknown;
	selectedRoutePointId?: unknown;
	onSelectQuery?: unknown;
	onRouteSelectQuery?: unknown;
	focusPoint?: unknown;
	focusZoom?: unknown;
	transientRoute?: unknown;
	routeId?: unknown;
};

const number = (value: unknown, min: number, max: number, fallback: number) =>
	typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback;

export function ComponentMapbox(props: MapProps) {
	const user = useCurrentUser();
	// A changed account unmounts the old map before a new token can be requested.
	return <MapboxViewport key={user?.id || 'anonymous'} {...props} />;
}

function MapboxViewport({ vaultId, styleUrl, center, zoom, points, route, fitBounds, height, title,
	favouritesSource, routeSource, showFavourites, selectedFavouriteId, selectedRoutePointId,
	onSelectQuery, onRouteSelectQuery, focusPoint, focusZoom, transientRoute, routeId }: MapProps) {
	const enabled = React.useContext(NativeControlsEnabled);
	const scope = React.useContext(ComponentDataScope);
	const local = React.useContext(ComponentLocalControl);
	const runtime = useWebpageRuntime();
	const source = (value: unknown) => {
		try { return { binding: collectionSource(resolveTemplate(value, { ...scope, query: runtime.query })), error: '' }; }
		catch { return { binding: null, error: 'Map source configuration is invalid.' }; }
	};
	const favouriteConfig = source(favouritesSource), routeConfig = source(routeSource);
	const favouriteBinding = favouriteConfig.binding;
	const rawRouteBinding = routeConfig.binding;
	const routeBinding = rawRouteBinding && ('routeId' in rawRouteBinding.inputs) && !rawRouteBinding.inputs.routeId ? null : rawRouteBinding;
	const favourites = useThingSource({ source: favouriteBinding, cacheId: `map:favourites:${favouriteBinding?.action || ''}`, argValues: {}, interactive: enabled, loadAllPages: true, resolvedInputs: true });
	const selectedRoute = useThingSource({ source: routeBinding, cacheId: `map:route:${routeBinding?.action || ''}`, argValues: {}, interactive: enabled, loadAllPages: true, resolvedInputs: true });
	const host = React.useRef<HTMLDivElement>(null);
	const mapRef = React.useRef<any>(null);
	const glRef = React.useRef<any>(null);
	const pinsRef = React.useRef<any[]>([]);
	const readyRef = React.useRef(false);
	const viewportRef = React.useRef<{ center: LngLat; zoom: number } | null>(null);
	const boundsKeyRef = React.useRef('');
	const focusRef = React.useRef({ value: focusPoint, zoom: focusZoom, key: '' });
	focusRef.current = { ...focusRef.current, value: focusPoint, zoom: focusZoom };
	const [error, setError] = React.useState('');
	const id = typeof vaultId === 'string' ? vaultId.trim() : '';
	const style = mapboxStyle(styleUrl);
	const origin = validCoordinates(center) ? center : [144.9631, -37.8136] as LngLat;
	const scale = number(zoom, 0, 22, 11);
	const favouriteResult = favourites.scope.result as { items?: unknown } | undefined;
	const routeResult = selectedRoute.scope.result as { points?: unknown } | undefined;
	const navigation = activeMapboxNavigation(transientRoute, routeId ?? routeBinding?.inputs.routeId);
	const stops = mapboxOrderedRoutePoints(routeResult, navigation);
	const routePoints: MapboxPoint[] = stops.map((point, index) => ({ ...point, group: 'route', markerLabel: String(index + 1), color: '#c4513c', selected: point.id === selectedRoutePointId }));
	const favouritePoints = showFavourites === false || showFavourites === 'false' ? [] : mapboxFavouritePoints(favouriteResult?.items).map((point) => ({ ...point, selected: point.id === selectedFavouriteId }));
	const markers = [...favouritePoints, ...mapboxPoints(points), ...routePoints];
	const line = mapboxRoute(navigation?.geometry ?? route);
	const dataKey = JSON.stringify({ points: markers, route: line, center: origin, zoom: scale, fitBounds: fitBounds !== false, ...(routePoints.length ? { fitPoints: routePoints } : {}), ...(routePoints.length || navigation ? { lineColor: '#c4513c' } : {}) });
	// The load callback always reads the newest data, even if props change while the SDK loads.
	const dataRef = React.useRef<MapboxOverlayData>(JSON.parse(dataKey));
	dataRef.current = JSON.parse(dataKey);
	const label = typeof title === 'string' && title.trim() ? title : 'Map';
	const onSelectRef = React.useRef<(point: MapboxPoint) => void>(() => {});
	onSelectRef.current = (point) => {
		const key = point.group === 'route' ? onRouteSelectQuery : onSelectQuery;
		if (typeof key === 'string') local?.({ op: 'query', params: { ...runtime.query, [key]: point.id } });
	};
	const applyData = () => {
		if (!readyRef.current || !mapRef.current || !glRef.current) return;
		const data = dataRef.current;
		const boundsKey = JSON.stringify({ points: (data.fitPoints ?? data.points).map((point) => point.coordinates), route: data.route, fit: data.fitBounds });
		pinsRef.current = updateMapboxOverlay(mapRef.current, glRef.current, pinsRef.current, { ...data, fitBounds: data.fitBounds && boundsKey !== boundsKeyRef.current, onSelect: (point) => onSelectRef.current(point) });
		boundsKeyRef.current = boundsKey;
		const prior = viewportRef.current;
		if ((!data.fitBounds || (!data.points.length && !data.route)) &&
			(!prior || prior.zoom !== data.zoom || prior.center[0] !== data.center[0] || prior.center[1] !== data.center[1])) {
			mapRef.current.jumpTo({ center: data.center, zoom: data.zoom });
		}
		viewportRef.current = { center: data.center, zoom: data.zoom };
		const focus = focusRef.current;
		const focusKey = JSON.stringify([focus.value, focus.zoom]);
		if (validCoordinates(focus.value) && focus.key !== focusKey) {
			mapRef.current.jumpTo({ center: focus.value, zoom: number(focus.zoom, 0, 22, 15) });
		}
		focusRef.current.key = focusKey;
	};
	const applyDataRef = React.useRef(applyData);
	applyDataRef.current = applyData;

	React.useEffect(() => {
		if (!enabled || !id || !host.current) return;
		const abort = new AbortController();
		let live = true;
		let stopObservingResize = () => {};
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
				stopObservingResize = observeMapboxContainer(host.current, map);
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
			stopObservingResize();
			readyRef.current = false;
			for (const pin of pinsRef.current) pin.remove();
			pinsRef.current = [];
			mapRef.current?.remove();
			mapRef.current = null;
			glRef.current = null;
			viewportRef.current = null;
			boundsKeyRef.current = '';
			focusRef.current.key = '';
		};
	}, [enabled, id, style]);

	React.useEffect(() => { applyDataRef.current(); }, [dataKey]);
	const focusKey = JSON.stringify(focusPoint);
	React.useEffect(() => {
		applyDataRef.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- serialized coordinate tuple
	}, [focusKey, focusZoom]);

	if (!enabled) return <p role="note">{label} is available on the interactive page.</p>;
	if (!id) return <p role="note">Choose a Mapbox vault connection to display the map.</p>;
	const sourceError = favouriteConfig.error || routeConfig.error || favourites.scope.error || selectedRoute.scope.error;
	return <div style={{ width: '100%', minWidth: 0, ...(height === '100%' ? { height: '100%' } : {}) }}>
		{error ? <p role="alert" style={{ color: 'var(--tt-muted, #5a5a66)' }}>{error}</p> : null}
		{sourceError ? <p role="alert">Map records could not refresh. {sourceError}</p> : null}
		<div ref={host} role="region" aria-label={label} tabIndex={0}
			style={{ width: '100%', height: mapboxHeight(height), minWidth: 0, borderRadius: 'var(--tt-radius-md, 12px)', overflow: 'hidden', border: '1px solid var(--tt-border, #e0e0e0)' }} />
	</div>;
}
