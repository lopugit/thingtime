import type { JsonValue } from '../utils/boundedJson.ts';
import type { TimelineSnapshot } from './contract.ts';

export type TimelineValue = { exists: false } | { exists: true; value: JsonValue };
export type TimelineChange = { path: string[]; before: TimelineValue; after: TimelineValue };
const object = (value: unknown): value is Record<string, JsonValue> => !!value && typeof value === 'object' && !Array.isArray(value);
const slot = (value: Record<string, JsonValue>, key: string): TimelineValue =>
	Object.prototype.hasOwnProperty.call(value, key) ? { exists: true, value: value[key] } : { exists: false };

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

/** UI-only expansion of webpage block changes by stable id. Array order still
 * has its own change and the canonical merge/replay contract stays atomic. */
export function timelineDisplayChanges(before: TimelineSnapshot | null, after: TimelineSnapshot | null): TimelineChange[] {
	const changes = timelineChanges(before, after);
	const isPage = (snapshot: TimelineSnapshot | null) =>
		snapshot?.adapter === 'webpage-draft' ||
		(snapshot?.adapter === 'thing-content' &&
			Array.isArray((snapshot.value as any)?.thingtime) &&
			(snapshot.value as any).thingtime.includes('webpage'));
	if (!isPage(before) || !isPage(after)) return changes;
	return changes.flatMap((change) => {
		if (
			JSON.stringify(change.path) !== '["crystal","blocks"]' ||
			!change.before.exists ||
			!change.after.exists ||
			!Array.isArray(change.before.value) ||
			!Array.isArray(change.after.value)
		)
			return [change];
		const old = change.before.value;
		const next = change.after.value;
		const identifiable = (blocks: JsonValue[]) =>
			blocks.length <= 120 &&
			blocks.every((block) => object(block) && typeof block.id === 'string') &&
			new Set(blocks.map((block: any) => block.id)).size === blocks.length;
		if (!identifiable(old) || !identifiable(next)) return [change];
		const oldMap = new Map(old.map((block: any) => [block.id, block]));
		const newMap = new Map(next.map((block: any) => [block.id, block]));
		const details: TimelineChange[] = [];
		for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
			const a = oldMap.get(id);
			const b = newMap.get(id);
			const snapshot = (value: JsonValue | undefined): TimelineSnapshot | null =>
				value === undefined ? null : { adapter: 'display', version: 1, value };
			for (const item of timelineChanges(snapshot(a), snapshot(b))) details.push({ ...item, path: ['crystal', 'blocks', id, ...item.path] });
			if (details.length > 120) return [change];
		}
		const order = (blocks: JsonValue[]) => blocks.map((block: any) => block.id);
		if (JSON.stringify(order(old)) !== JSON.stringify(order(next)))
			details.unshift({
				path: ['crystal', 'blocks', 'order'],
				before: { exists: true, value: order(old).join(' → ') },
				after: { exists: true, value: order(next).join(' → ') }
			});
		return details.length ? details : [change];
	});
}

export function timelineChangeLabel(path: string[]): string {
	if (path.length === 1 && path[0] === 'folderId') return 'Folder';
	const parts = path[0] === 'crystal' ? path.slice(1) : path;
	if (!parts.length) return 'Thing';
	return parts.map((part) => part.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')).join(' › ');
}

export function timelineValueLabel(slot: TimelineValue, path: string[] = []): string {
	if (slot.exists && slot.value === null && path.length === 1 && path[0] === 'folderId') return 'My Things';
	if (!slot.exists) return 'Not set';
	if (slot.value === null) return 'Empty';
	if (typeof slot.value === 'string') {
		if (path.length === 4 && path[0] === 'crystal' && path[1] === 'blocks' && path[3] === 'component' && /^restored-[a-f0-9]{48}$/.test(slot.value))
			return 'Recorded private component';
		return slot.value === '' ? 'Empty text' : slot.value;
	}
	if (typeof slot.value === 'boolean') return slot.value ? 'On' : 'Off';
	if (typeof slot.value === 'number') return String(slot.value);
	if (Array.isArray(slot.value)) return `${slot.value.length} ${slot.value.length === 1 ? 'item' : 'items'}`;
	return 'Structured content';
}
