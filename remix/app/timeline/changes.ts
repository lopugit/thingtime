import type { JsonValue } from '../utils/boundedJson.ts';
import type { TimelineSnapshot } from './contract.ts';

export type TimelineValue = { exists: false } | { exists: true; value: JsonValue };
export type TimelineChange = { path: string[]; before: TimelineValue; after: TimelineValue };
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const slot = (value: Record<string, JsonValue>, key: string): TimelineValue => Object.prototype.hasOwnProperty.call(value, key) ? { exists: true, value: value[key] } : { exists: false };

/** Bounded presentation diff, never a replay/merge instruction. Large arrays or
 * deep programs become one change instead of freezing the history interface. */
export function timelineChanges(before: TimelineSnapshot | null, after: TimelineSnapshot | null): TimelineChange[] {
	const changes: TimelineChange[] = [];
	let remaining = 1200;
	const visit = (old: TimelineValue, next: TimelineValue, path: string[]) => {
		if (JSON.stringify(old) === JSON.stringify(next)) return;
		if (--remaining > 0 && path.length < 8 && old.exists && next.exists && object(old.value) && object(next.value)) {
			const keys = [...new Set([...Object.keys(old.value), ...Object.keys(next.value)])];
			if (keys.length <= remaining) {
				for (const key of keys) visit(slot(old.value, key), slot(next.value, key), [...path, key]);
				return;
			}
		}
		changes.push({ path, before: old, after: next });
	};
	visit(before ? { exists: true, value: before.value } : { exists: false }, after ? { exists: true, value: after.value } : { exists: false }, []);
	return changes;
}

export function timelineChangeLabel(path: string[]): string {
	const parts = path[0] === 'crystal' ? path.slice(1) : path;
	if (!parts.length) return 'Thing';
	return parts.map(part => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')).join(' › ');
}

export function timelineValueLabel(slot: TimelineValue): string {
	if (!slot.exists) return 'Not set';
	if (slot.value === null) return 'Empty';
	if (typeof slot.value === 'string') return slot.value === '' ? 'Empty text' : slot.value;
	if (typeof slot.value === 'boolean') return slot.value ? 'On' : 'Off';
	if (typeof slot.value === 'number') return String(slot.value);
	if (Array.isArray(slot.value)) return `${slot.value.length} ${slot.value.length === 1 ? 'item' : 'items'}`;
	return 'Structured content';
}
