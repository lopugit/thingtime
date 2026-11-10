import type { MapboxPoint } from './mapboxData';

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const originalPoint = ({ item: _item, overlayKey: _key, markerGroup: _group, ...point }: MapboxPoint): MapboxPoint => point;
function groupingPath(value: unknown): string[] | null {
	if (typeof value !== 'string') return null;
	const parts = value.split('.');
	return parts.length > 1 && ['point', 'item'].includes(parts[0]) && parts.every(part => /^[A-Za-z0-9_-]+$/.test(part) && !forbidden.has(part)) ? parts : null;
}
function readPath(scope: unknown, parts: string[]): unknown {
	let value = scope;
	for (const part of parts) {
		if (!value || typeof value !== 'object') return undefined;
		const descriptor = Object.getOwnPropertyDescriptor(value, part);
		if (!descriptor || !('value' in descriptor)) return undefined;
		value = descriptor.value;
	}
	return value;
}
/** Associate visuals by an explicit authorized data key, never by coordinates.
 * Originals retain their IDs, roles and source rows; camera/route data is separate. */
export function groupMapboxMarkers(points: MapboxPoint[], path: unknown): MapboxPoint[] {
	const parts = groupingPath(path);
	if (!parts) return points;
	const groups = new Map<string, MapboxPoint>();
	const output: MapboxPoint[] = [];
	for (const source of points) {
		const point = originalPoint(source), item = source.item ?? point;
		const key = readPath({ point, item }, parts);
		if (!(typeof key === 'string' && key.trim()) && !(typeof key === 'number' && Number.isFinite(key))) { output.push(source); continue; }
		const overlayKey = JSON.stringify(['associated', typeof key, key]);
		const existing = groups.get(overlayKey);
		if (existing?.markerGroup) {
			existing.markerGroup.members.push({ point, item });
			existing.markerGroup.count++;
			existing.markerGroup.selected ||= !!source.selected;
			// Selection can belong to any original member while scope stays first.
			existing.selected = existing.selected || source.selected;
		} else {
			const display = { ...source, overlayKey, markerGroup: { key: key as string | number, count: 1, selected: !!source.selected, members: [{ point, item }] } };
			groups.set(overlayKey, display); output.push(display);
		}
	}
	return output;
}
