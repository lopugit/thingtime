import { literalAttachmentId } from '../../Sharing/sharedMediaCore';
import { attachmentContentPath } from '../../../utils/attachmentContentUrl';

type MarkerLabelMode = 'title' | 'custom' | 'both' | 'none';
type MarkerAppearance = {
	markerIcon?: string;
	markerLabelMode?: MarkerLabelMode;
	customLabel?: string;
	markerIcons?: string[];
	avatarSrc?: string;
};
export type LngLat = [number, number];
export type MapboxMarkerGroup = { key: string | number; count: number; selected: boolean; members: Array<{ point: MapboxPoint; item: Record<string, unknown> }> };
export type MapboxPoint = { overlayKey?: string; markerGroup?: MapboxMarkerGroup; id: string; coordinates: LngLat; label: string; markerLabel?: string; color?: string; selected?: boolean; group?: 'favourite' | 'route'; appearance?: MarkerAppearance; item?: Record<string, unknown> };

export function publicMapboxToken(value: unknown): string | null {
	const token = value && typeof value === 'object' ? (value as Record<string, unknown>).publicToken : null;
	return typeof token === 'string' && /^pk\.[A-Za-z0-9._-]+$/.test(token) ? token : null;
}

export const validCoordinates = (value: unknown): value is LngLat =>
	Array.isArray(value) && value.length === 2 &&
	value.every((part) => typeof part === 'number' && Number.isFinite(part)) &&
	Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

const asRecord = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

function markerAppearance(value: unknown): MarkerAppearance | undefined {
	const input = asRecord(value);
	const appearance: MarkerAppearance = {};
	if (typeof input.markerIcon === 'string') appearance.markerIcon = input.markerIcon.trim();
	if (input.markerLabelMode === 'title' || input.markerLabelMode === 'custom' || input.markerLabelMode === 'both' || input.markerLabelMode === 'none') {
		appearance.markerLabelMode = input.markerLabelMode;
	}
	if (typeof input.markerLabel === 'string') appearance.customLabel = input.markerLabel.trim();
	const icons = typeof input.markerIcons === 'string' ? input.markerIcons.split(/[,\n]/) : input.markerIcons;
	if (Array.isArray(icons)) appearance.markerIcons = icons.flatMap((icon) => typeof icon === 'string' && icon.trim() ? [icon.trim()] : []);
	if (typeof input.markerAvatarAttachmentId === 'string') {
		const id = input.markerAvatarAttachmentId;
		const path = attachmentContentPath(id);
		// Runtime source rows never supply a URL or a delegated media credential.
		// The attachment endpoint checks the active viewer's own access.
		appearance.avatarSrc = literalAttachmentId(path) === id ? path : '';
	}
	return Object.keys(appearance).length ? appearance : undefined;
}

export function markerSelection(
	point: Pick<MapboxPoint, 'group' | 'id'>,
	config: { onSelectState?: unknown; onRouteSelectState?: unknown; onSelectQuery?: unknown; onRouteSelectQuery?: unknown; onSelectQueryParams?: unknown; onRouteSelectQueryParams?: unknown; queryScope?: unknown },
	query: Record<string, unknown>
): Record<string, unknown> | undefined {
	const route = point.group === 'route';
	const stateKey = route ? config.onRouteSelectState : config.onSelectState;
	if (typeof stateKey === 'string' && stateKey) {
		const otherKey = route ? config.onSelectState : config.onRouteSelectState;
		return {
			op: 'set', key: stateKey, value: point.id,
			...(typeof otherKey === 'string' && otherKey && otherKey !== stateKey ? { clear: [otherKey] } : {})
		};
	}
	const queryKey = route ? config.onRouteSelectQuery : config.onSelectQuery;
	if (typeof queryKey === 'string' && queryKey) {
		const extra = route ? config.onRouteSelectQueryParams : config.onSelectQueryParams;
		const params: Record<string, unknown> = { ...query };
		if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
			for (const [key, value] of Object.entries(extra)) {
				if (/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key) && (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null)) params[key] = value;
			}
		}
		params[queryKey] = point.id;
		if (config.queryScope !== 'page') return { op: 'query', params };
		const otherKey = route ? config.onSelectQuery : config.onRouteSelectQuery;
		if (typeof otherKey === 'string' && otherKey !== queryKey) delete params[otherKey];
		return { op: 'query', params, scope: 'page' };
	}
}

export function mapboxPoints(value: unknown): MapboxPoint[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry, index) => {
		if (!entry || typeof entry !== 'object' || !validCoordinates(entry.coordinates)) return [];
		const appearance = markerAppearance({ ...entry, markerLabel: entry.markerLabelMode === undefined ? undefined : entry.markerLabel });
		return [{
			item: entry,
			id: typeof entry.id === 'string' ? entry.id : String(index),
			coordinates: entry.coordinates,
			label: typeof entry.label === 'string' ? entry.label : '',
			...(typeof entry.markerLabel === 'string' && !appearance?.markerLabelMode ? { markerLabel: entry.markerLabel } : {}),
			...(typeof entry.color === 'string' && /^#[a-f0-9]{6}$/i.test(entry.color) ? { color: entry.color } : {}),
			...(typeof entry.selected === 'boolean' ? { selected: entry.selected } : {}),
			...(entry.group === 'favourite' || entry.group === 'route' ? { group: entry.group } : {}),
			...(appearance ? { appearance } : {})
		}];
	});
}

/** Stored independently supplied place coordinates; no provider search results are persisted here. */
export function mapboxFavouritePoints(value: unknown): MapboxPoint[] {
	if (!Array.isArray(value)) return [];
	return value.flatMap((item, index) => {
		const points = mapboxPoints([{
			id: typeof item?.id === 'string' ? item.id : String(index),
			label: item?.label ?? item?.crystal?.title,
			coordinates: item?.coordinates ?? [item?.crystal?.longitude, item?.crystal?.latitude],
			markerLabel: '•', color: '#167d8d', group: 'favourite'
		}]);
		const appearance = markerAppearance(item?.crystal);
		return points.map((point) => ({ ...point, item, ...(appearance ? { appearance } : {}) }));
	});
}

export function mapboxHeight(value: unknown): number | string {
	if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
	if (typeof value === 'string' && (/^\d+(?:\.\d+)?(?:px|%|dvh|svh|vh|rem)$/.test(value) ||
		/^calc\([\d\s.+*/()%-]+(?:px|dvh|svh|vh|rem)[\d\s.+*/()%-]*(?:px|dvh|svh|vh|rem)?\)$/.test(value))) return value;
	return 420;
}

/** Only the active route may consume a live, in-memory Navigation result. */
export function activeMapboxNavigation(value: unknown, routeId: unknown): Record<string, any> | null {
	return value && typeof value === 'object' && !Array.isArray(value) && typeof routeId === 'string' && routeId &&
		(value as Record<string, unknown>).routeId === routeId ? value as Record<string, any> : null;
}

/** Source pages can be locally sorted; rank the complete stop set before numbering. */
export function mapboxOrderedRoutePoints(value: unknown, navigation: Record<string, any> | null): MapboxPoint[] {
	const result = value && typeof value === 'object' ? value as Record<string, unknown> : {};
	const points = mapboxPoints(result.points);
	const ranks = new Map<string, number>();
	const appearances = new Map<string, MarkerAppearance>();
	const items = new Map<string, Record<string, unknown>>();
	if (Array.isArray(result.items)) for (const item of result.items) {
		if (typeof item?.id !== 'string') continue;
		items.set(item.id, item);
		if (typeof item?.crystal?.rank === 'number' && Number.isFinite(item.crystal.rank)) ranks.set(item.id, item.crystal.rank);
		const inherited = markerAppearance(item.favorite?.crystal);
		const own = markerAppearance(item.crystal);
		if (inherited || own) appearances.set(item.id, { ...inherited, ...own });
	}
	// Ordinals belong to the complete itinerary, before invalid/unresolved
	// coordinates are omitted. Rank is an ordering key, never the displayed
	// number: nonconsecutive and fractional ranks still produce 1, 2, 3.
	const ordinalIds = [...items.keys()];
	const ordinalSeen = new Set(ordinalIds);
	if (!ordinalIds.length && Array.isArray(result.points)) result.points.forEach((point: any, index: number) => {
		const id = typeof point?.id === 'string' ? point.id : String(index);
		if (!ordinalSeen.has(id)) { ordinalSeen.add(id); ordinalIds.push(id); }
	});
	ordinalIds.sort((left, right) => (ranks.get(left) ?? Infinity) - (ranks.get(right) ?? Infinity));
	// Transient optimization reorders the resolved members within their full
	// itinerary slots. Unresolved stops keep a slot instead of disappearing
	// from numbering, and source-provided labels below remain authoritative.
	const optimized = Array.isArray(navigation?.orderedStopIds) ? navigation.orderedStopIds.filter((id: unknown): id is string => typeof id === 'string' && ordinalSeen.has(id)) : [];
	const uniqueOptimized = [...new Set<string>(optimized)];
	const optimizedIds = new Set(uniqueOptimized);
	let optimizedIndex = 0;
	for (let index = 0; index < ordinalIds.length; index++) if (optimizedIds.has(ordinalIds[index])) ordinalIds[index] = uniqueOptimized[optimizedIndex++];
	const ordinals = new Map(ordinalIds.map((id, index) => [id, String(index + 1)]));
	const order = new Map<unknown, number>(Array.isArray(navigation?.orderedStopIds) ? navigation.orderedStopIds.map((id: unknown, index: number) => [id, index]) : []);
	return points.sort((a, b) => {
		const left = order.size ? order.get(a.id) : ranks.get(a.id), right = order.size ? order.get(b.id) : ranks.get(b.id);
		return (left ?? Infinity) - (right ?? Infinity);
	}).map((point) => {
		const appearance = appearances.get(point.id);
		const item = items.get(point.id) ?? point.item;
		const sourceLabel = item?.markerLabel;
		const markerLabel = point.markerLabel ?? (typeof sourceLabel === 'string' || (typeof sourceLabel === 'number' && Number.isFinite(sourceLabel)) ? String(sourceLabel) : ordinals.get(point.id));
		return { ...point, ...(markerLabel === undefined ? {} : { markerLabel }), item, ...(appearance ? { appearance: { ...appearance, ...point.appearance } } : {}) };
	});
}

export function mapboxRoute(value: unknown): { type: 'Feature'; properties: Record<string, never>; geometry: { type: 'LineString'; coordinates: LngLat[] } } | null {
	const candidate = value && typeof value === 'object' ? value as Record<string, unknown> : null;
	const geometry = candidate?.type === 'Feature' ? candidate.geometry : candidate;
	if (!geometry || typeof geometry !== 'object') return null;
	const line = geometry as { type?: unknown; coordinates?: unknown };
	if (line.type !== 'LineString' || !Array.isArray(line.coordinates) || !line.coordinates.every(validCoordinates)) return null;
	return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coordinates } };
}

export function mapboxStyle(value: unknown): string {
	if (typeof value !== 'string') return 'mapbox://styles/mapbox/streets-v12';
	if (/^mapbox:\/\/styles\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(value)) return value;
	try {
		const url = new URL(value);
		if (url.protocol === 'https:' && url.hostname === 'api.mapbox.com' && /^\/styles\/v1\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname) && !url.search && !url.hash) return value;
	} catch { /* invalid URL */ }
	return 'mapbox://styles/mapbox/streets-v12';
}
