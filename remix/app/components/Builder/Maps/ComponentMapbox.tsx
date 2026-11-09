import React from 'react';
import { createPortal } from 'react-dom';
import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { useCurrentUser } from '~/hooks/useCurrentUser';
import { CHARACTER_HEADER, useCharacterScope } from '../../Characters/CharacterScope';
import { characterMediaUrl } from '../../Characters/characterMedia';
import { ComponentLocalControl, NativeControlsEnabled } from '../NativeComponentControls';
import { ComponentDataScope } from '../ComponentSelect';
import { ComponentInstanceIdentity } from '../componentInstanceIdentity';
import { useThingSource } from '../liveComponent';
import { useWebpageRuntime } from '../webpageRuntime';
import { collectionSource } from '../collectionSource';
import { resolveTemplate } from '~/components/ComponentsLibrary/componentTemplate';
import { loadMapbox } from './mapboxSdk';
import { activeMapboxNavigation, mapboxFavouritePoints, mapboxHeight, markerSelection, mapboxOrderedRoutePoints, mapboxPoints, mapboxRoute, mapboxStyle, publicMapboxToken, validCoordinates, type LngLat, type MapboxPoint } from './mapboxData';
import { mapboxPointKey, mapboxMarkerVisual, scaleMapboxMarker, updateMapboxOverlay, type MapboxOverlayData } from './mapboxOverlay';
import { groupMapboxMarkers } from './mapboxGrouping';
import { mapboxMarkerScale, observeMapboxZoom } from './mapboxScale';
import { observeMapboxContainer } from './mapboxResize';

type MapProps = {
	markerContent?: React.ReactNode;
	markerGroupPath?: unknown;
	markerScale?: unknown; markerScaleWithZoom?: unknown; markerScaleReferenceZoom?: unknown;
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
	onSelectQueryParams?: unknown;
	onRouteSelectQueryParams?: unknown;
	onSelectState?: unknown;
	onRouteSelectState?: unknown;
	queryScope?: unknown;
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

function MapboxViewport({ vaultId, styleUrl, center, zoom, points, route, fitBounds, height, title, markerContent, markerGroupPath, markerScale, markerScaleWithZoom, markerScaleReferenceZoom,
	favouritesSource, routeSource, showFavourites, selectedFavouriteId, selectedRoutePointId,
	onSelectQuery, onRouteSelectQuery, onSelectQueryParams, onRouteSelectQueryParams, onSelectState, onRouteSelectState, queryScope, focusPoint, focusZoom, transientRoute, routeId }: MapProps) {
	const enabled = React.useContext(NativeControlsEnabled);
	const scope = React.useContext(ComponentDataScope);
	const instanceId = React.useId();
	const local = React.useContext(ComponentLocalControl);
	const runtime = useWebpageRuntime();
	const characterId = useCharacterScope()?.id;
	const composedMarkers = markerContent !== undefined && markerContent !== null;
	const [compositionReady, setCompositionReady] = React.useState(false);
	const sourcesEnabled = enabled && (!composedMarkers || compositionReady);
	const source = (value: unknown) => {
		try { return { binding: collectionSource(resolveTemplate(value, { ...scope, query: runtime.query })), error: '' }; }
		catch { return { binding: null, error: 'Map source configuration is invalid.' }; }
	};
	const favouriteConfig = source(favouritesSource), routeConfig = source(routeSource);
	const favouriteBinding = favouriteConfig.binding;
	const rawRouteBinding = routeConfig.binding;
	const routeBinding = rawRouteBinding && ('routeId' in rawRouteBinding.inputs) && !rawRouteBinding.inputs.routeId ? null : rawRouteBinding;
	const favourites = useThingSource({ source: favouriteBinding, cacheId: `map:favourites:${favouriteBinding?.action || ''}`, argValues: {}, interactive: sourcesEnabled, loadAllPages: true, resolvedInputs: true });
	const selectedRoute = useThingSource({ source: routeBinding, cacheId: `map:route:${routeBinding?.action || ''}`, argValues: {}, interactive: sourcesEnabled, loadAllPages: true, resolvedInputs: true });
	const host = React.useRef<HTMLDivElement>(null);
	const mapRef = React.useRef<any>(null);
	const glRef = React.useRef<any>(null);
	const pinsRef = React.useRef<any[]>([]);
	const markerHosts = React.useRef(new Map<string, HTMLElement>());
	const [portalHosts, setPortalHosts] = React.useState(new Map<string, HTMLElement>());
	const readyRef = React.useRef(false);
	const viewportRef = React.useRef<{ center: LngLat; zoom: number } | null>(null);
	const boundsKeyRef = React.useRef('');
	const focusRef = React.useRef({ value: focusPoint, zoom: focusZoom, key: '' });
	focusRef.current = { ...focusRef.current, value: focusPoint, zoom: focusZoom };
	const [error, setError] = React.useState('');
	const [actualZoom, setActualZoom] = React.useState(number(zoom, 0, 22, 11));
	const markerScaling = mapboxMarkerScale(markerScale, markerScaleWithZoom, markerScaleReferenceZoom, actualZoom);
	const markerScalingRef = React.useRef(markerScaling); markerScalingRef.current = markerScaling;
	const id = typeof vaultId === 'string' ? vaultId.trim() : '';
	const style = mapboxStyle(styleUrl);
	const origin = validCoordinates(center) ? center : [144.9631, -37.8136] as LngLat;
	const scale = number(zoom, 0, 22, 11);
	const favouriteResult = favourites.scope.result as { items?: unknown } | undefined;
	const routeResult = selectedRoute.scope.result as { points?: unknown } | undefined;
	const navigation = activeMapboxNavigation(transientRoute, routeId ?? routeBinding?.inputs.routeId);
	const stops = mapboxOrderedRoutePoints(routeResult, navigation);
	const routePoints: MapboxPoint[] = stops.map((point, index) => ({ ...point, group: 'route', markerLabel: point.markerLabel ?? String(index + 1), color: '#c4513c', selected: point.id === selectedRoutePointId }));
	const favouritePoints = showFavourites === false || showFavourites === 'false' ? [] : mapboxFavouritePoints(favouriteResult?.items).map((point) => ({ ...point, selected: point.id === selectedFavouriteId }));
	const originalMarkers = [...favouritePoints, ...mapboxPoints(points), ...routePoints];
	const markers = groupMapboxMarkers(originalMarkers, markerGroupPath);
	const line = mapboxRoute(navigation?.geometry ?? route);
	// Original rows belong to the authored portal scope. The SDK overlay only
	// needs normalized fields and should not refresh for unrelated row changes.
	const overlayPoint = ({ item: _item, markerGroup: _group, ...point }: MapboxPoint) => point;
	const dataKey = JSON.stringify({ points: markers.map(overlayPoint), route: line, center: origin, zoom: scale, fitBounds: fitBounds !== false, fitPoints: (routePoints.length ? routePoints : originalMarkers).map(overlayPoint), ...(routePoints.length || navigation ? { lineColor: '#c4513c' } : {}) });
	// The load callback always reads the newest data, even if props change while the SDK loads.
	const dataRef = React.useRef<MapboxOverlayData>(JSON.parse(dataKey));
	dataRef.current = JSON.parse(dataKey);
	const label = typeof title === 'string' && title.trim() ? title : 'Map';
	const onSelectRef = React.useRef<(point: MapboxPoint) => void>(() => {});
	onSelectRef.current = (point) => {
		const selection = markerSelection(point, { onSelectState, onRouteSelectState, onSelectQuery, onRouteSelectQuery, onSelectQueryParams, onRouteSelectQueryParams, queryScope }, runtime.query);
		if (selection) local?.(selection);
	};
	const applyData = () => {
		if (!readyRef.current || !mapRef.current || !glRef.current || !host.current) return;
		const document = host.current.ownerDocument;
		const data = dataRef.current;
		const hosts = new Map<string, HTMLElement>();
		if (composedMarkers) for (const point of data.points) {
			const key = mapboxPointKey(point);
			hosts.set(key, markerHosts.current.get(key) ?? document.createElement('div'));
		}
		markerHosts.current = hosts;
		const visualHosts = new Map([...hosts].map(([key, anchor]) => [key, mapboxMarkerVisual(anchor)]));
		setPortalHosts(previous => previous.size === visualHosts.size && [...visualHosts].every(([key, visual]) => previous.get(key) === visual) ? previous : visualHosts);
		const boundsKey = JSON.stringify({ points: (data.fitPoints ?? data.points).map((point) => point.coordinates), route: data.route, fit: data.fitBounds });
		pinsRef.current = updateMapboxOverlay(mapRef.current, glRef.current, pinsRef.current, { ...data, markerScale: markerScalingRef.current.markerScale, characterId, document, markerElements: hosts, fitBounds: data.fitBounds && boundsKey !== boundsKeyRef.current, onSelect: (point) => onSelectRef.current(point) });
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
		let stopObservingZoom = () => {};
		setError('');
		void (async () => {
			try {
				if (composedMarkers) {
					try {
						await requireThingtimeCapability('api.webpages-resolve', '1.10.0');
						await requireThingtimeCapability('api.actions-run', '1.39.0');
					}
					catch {
						if (live) setError('This Thingtime origin does not support authored map markers.');
						return;
					}
					if (!live) return;
					setCompositionReady(true);
				}
				await requireThingtimeCapability('api.maps', '1.2.0');
				if (!live) return;
				const response = await fetch('/api/v1/maps', {
					method: 'POST', credentials: 'same-origin', cache: 'no-store',
					headers: { 'Content-Type': 'application/json', ...(characterId ? { [CHARACTER_HEADER]: characterId } : {}) },
					body: JSON.stringify({ operation: 'browser-config', vaultId: id }), signal: abort.signal
				});
				if (!response.ok) throw new Error('Map configuration is unavailable.');
				const config = await response.json();
				const publicToken = config?.ok ? publicMapboxToken(config) : null;
				if (!publicToken) throw new Error('Map configuration is unavailable.');
				if (!live || !host.current) return;
				const gl = await loadMapbox(host.current.ownerDocument);
				if (!live || !host.current) return;
				const current = dataRef.current;
				const map = new gl.Map({
					container: host.current, accessToken: publicToken, style,
					center: current.center, zoom: current.zoom, attributionControl: true
				});
				mapRef.current = map;
				glRef.current = gl;
				const view = host.current.ownerDocument.defaultView;
				if (view) stopObservingZoom = observeMapboxZoom(map, view, setActualZoom);
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
			stopObservingZoom();
			readyRef.current = false;
			for (const pin of pinsRef.current) pin.remove();
			pinsRef.current = [];
			markerHosts.current.clear();
			setPortalHosts(new Map());
			mapRef.current?.remove();
			mapRef.current = null;
			glRef.current = null;
			viewportRef.current = null;
			boundsKeyRef.current = '';
			focusRef.current.key = '';
		};
	}, [enabled, id, style, characterId, composedMarkers]);

	React.useEffect(() => { applyDataRef.current(); }, [dataKey, composedMarkers]);
	React.useLayoutEffect(() => { for (const pin of pinsRef.current) { const anchor = pin.getElement?.(); if (anchor) scaleMapboxMarker(anchor, markerScaling.markerScale); } }, [markerScaling.markerScale]);
	const focusKey = JSON.stringify(focusPoint);
	React.useEffect(() => {
		applyDataRef.current();
		// eslint-disable-next-line react-hooks/exhaustive-deps -- serialized coordinate tuple
	}, [focusKey, focusZoom]);

	if (!enabled) return <div><p role="note">{label} is available on the interactive page.</p>{composedMarkers ? <div aria-label="Map marker template"><ComponentInstanceIdentity.Provider value={instanceId}>{markerContent}</ComponentInstanceIdentity.Provider></div> : null}</div>;
	if (!id) return <p role="note">Choose a Mapbox vault connection to display the map.</p>;
	const sourceError = favouriteConfig.error || routeConfig.error || favourites.scope.error || selectedRoute.scope.error;
	return <div style={{ width: '100%', minWidth: 0, ...(height === '100%' ? { height: '100%' } : {}) }}>
		{error ? <p role="alert" style={{ color: 'var(--tt-muted, #5a5a66)' }}>{error}</p> : null}
		{sourceError ? <p role="alert">Map records could not refresh. {sourceError}</p> : null}
		<div ref={host} role="region" aria-label={label} tabIndex={0}
			style={{ width: '100%', height: mapboxHeight(height), minWidth: 0, borderRadius: 'var(--tt-radius-md, 12px)', overflow: 'hidden', border: '1px solid var(--tt-border, #e0e0e0)' }} />
		{composedMarkers && markers.map(point => {
			const key = mapboxPointKey(point), target = portalHosts.get(key);
			if (!target) return null;
			const representative = point.markerGroup?.members[0].point ?? point;
			const boundPoint = { ...overlayPoint(representative), ...(point.appearance ? { appearance: { ...point.appearance, avatarSrc: characterMediaUrl(point.appearance.avatarSrc, characterId) ?? '' } } : {}) };
			return createPortal(<ComponentInstanceIdentity.Provider value={`${instanceId}:${key}`}><ComponentDataScope.Provider value={{ ...scope, map: { zoom: actualZoom, ...markerScaling }, markerGroup: point.markerGroup ?? null, point: boundPoint, item: point.item ?? boundPoint }}>{markerContent}</ComponentDataScope.Provider></ComponentInstanceIdentity.Provider>, target, key);
		})}
	</div>;
}
