import type { EditorJsBlock, EditorJsDoc } from './editorJsValue';

export type HistoryChange = { blockId: string; path: string[]; before: unknown; after: unknown };
export type EditorHistoryEvent = {
	id: number;
	parentId: number | null;
	time: number;
	label: string;
	doc: EditorJsDoc;
	changes: HistoryChange[];
};
const copy = <T>(value: T): T => (value === undefined ? value : JSON.parse(JSON.stringify(value)));
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const safeKey = (key: string) => !['__proto__', 'prototype', 'constructor'].includes(key);
const diff = (id: string, before: unknown, after: unknown, path: string[], changes: HistoryChange[]) => {
	if (equal(before, after)) return;
	if ((object(before) && object(after)) || (path.length > 0 && (object(before) || object(after)))) {
		const old = object(before) ? before : {},
			next = object(after) ? after : {};
		for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) if (safeKey(key)) diff(id, old[key], next[key], [...path, key], changes);
	} else changes.push({ blockId: id, path, before: copy(before), after: copy(after) });
};
export const documentChanges = (before: EditorJsDoc, after: EditorJsDoc): HistoryChange[] => {
	const changes: HistoryChange[] = [];
	const old = new Map(before.blocks.map((b) => [b.id!, b]));
	const next = new Map(after.blocks.map((b) => [b.id!, b]));
	for (const id of new Set([...old.keys(), ...next.keys()])) diff(id, old.get(id), next.get(id), [], changes);
	const oldOrder = before.blocks.map((b) => b.id),
		newOrder = after.blocks.map((b) => b.id);
	if (!equal(oldOrder, newOrder)) changes.push({ blockId: '', path: ['order'], before: oldOrder, after: newOrder });
	return changes;
};
const labelChanges = (changes: HistoryChange[]) => {
	if (changes.some((c) => c.path[0] === 'type')) return 'Change block type';
	if (changes.some((c) => !c.path.length && c.before === undefined)) return 'Add block';
	if (changes.some((c) => !c.path.length && c.after === undefined)) return 'Delete block';
	if (changes.some((c) => c.path[0] === 'tunes')) return 'Block style';
	if (changes.every((c) => c.path[0] === 'order')) return 'Move block';
	return 'Edit block';
};

/** Immutable branching history. A new edit never discards a previously recorded future. */
export class EditorHistory {
	events: EditorHistoryEvent[] = [];
	cursor = 0;
	version = 0;
	private listeners = new Set<() => void>();
	private preferred = new Map<number, number>();
	initialize(doc: EditorJsDoc) {
		if (this.events.length) return;
		this.events.push({ id: 0, parentId: null, time: Date.now(), label: 'Opened document', doc: copy(doc), changes: [] });
		this.notify();
	}
	subscribe = (fn: () => void) => {
		this.listeners.add(fn);
		return () => {
			this.listeners.delete(fn);
		};
	};
	getVersion = () => this.version;
	private notify() {
		this.version++;
		this.listeners.forEach((fn) => fn());
	}
	get current() {
		return this.events[this.cursor];
	}
	get undoId() {
		return this.current?.parentId ?? null;
	}
	get redoId() {
		return this.preferred.get(this.cursor) ?? [...this.events].reverse().find((e) => e.parentId === this.cursor)?.id ?? null;
	}
	record(doc: EditorJsDoc, label?: string) {
		if (!this.events.length) {
			this.initialize(doc);
			return;
		}
		const changes = documentChanges(this.current.doc, doc);
		if (!changes.length) return;
		// Share unchanged blocks across events; typing in one block must not copy the entire document.
		const oldBlocks = new Map(this.current.doc.blocks.map((block) => [block.id, block]));
		const snapshot = { blocks: doc.blocks.map((block) => (equal(oldBlocks.get(block.id), block) ? oldBlocks.get(block.id)! : copy(block))) };
		const event = { id: this.events.length, parentId: this.cursor, time: Date.now(), label: label || labelChanges(changes), doc: snapshot, changes };
		this.preferred.set(this.cursor, event.id);
		this.events.push(event);
		this.cursor = event.id;
		this.notify();
	}
	select(id: number) {
		const event = this.events[id];
		if (!event) return;
		if (event.parentId !== null) this.preferred.set(event.parentId, id);
		this.cursor = id;
		this.notify();
	}
	/** Apply/revert just this event's fields. Conflicting later edits are never overwritten silently. */
	patch(id: number, direction: 'revert' | 'reapply'): { doc: EditorJsDoc; conflicts: number } {
		const doc = copy(this.current.doc),
			event = this.events[id];
		let conflicts = 0;
		if (!event) return { doc, conflicts: 1 };
		const changes = direction === 'revert' ? [...event.changes].reverse() : event.changes;
		for (const change of changes) {
			const expected = direction === 'revert' ? change.after : change.before;
			const value = direction === 'revert' ? change.before : change.after;
			if (!change.blockId) continue;
			const index = doc.blocks.findIndex((b) => b.id === change.blockId);
			if (!change.path.length) {
				if (!equal(doc.blocks[index], expected)) {
					conflicts++;
					continue;
				}
				if (value === undefined) doc.blocks.splice(index, 1);
				else if (index >= 0) doc.blocks[index] = copy(value as EditorJsBlock);
				else {
					const source = direction === 'revert' ? this.events[event.parentId!]?.doc : event.doc;
					const at = source?.blocks.findIndex((b) => b.id === change.blockId) ?? 0;
					const next = source?.blocks.slice(at + 1).find((b) => doc.blocks.some((current) => current.id === b.id));
					const previous = source?.blocks
						.slice(0, at)
						.reverse()
						.find((b) => doc.blocks.some((current) => current.id === b.id));
					const position = next
						? doc.blocks.findIndex((b) => b.id === next.id)
						: previous
						? doc.blocks.findIndex((b) => b.id === previous.id) + 1
						: at;
					doc.blocks.splice(Math.max(0, position), 0, copy(value as EditorJsBlock));
				}
				continue;
			}
			let parent: any = doc.blocks[index];
			for (const key of change.path.slice(0, -1)) {
				if (parent && parent[key] === undefined && expected === undefined && value !== undefined) parent[key] = {};
				parent = parent?.[key];
			}
			const key = change.path.at(-1)!;
			if (!parent || !equal(parent[key], expected)) {
				conflicts++;
				continue;
			}
			if (value === undefined) delete parent[key];
			else parent[key] = copy(value);
		}
		const order = event.changes.find((c) => !c.blockId);
		if (order) {
			const from = (direction === 'revert' ? order.after : order.before) as string[];
			const to = (direction === 'revert' ? order.before : order.after) as string[];
			// Add/delete positions are handled above. Reorder common blocks even when the
			// same event also edits fields, leaving subsequently inserted blocks in place.
			const common = new Set(from.filter((id) => to.includes(id)));
			const expected = from.filter((id) => common.has(id));
			const wanted = to.filter((id) => common.has(id));
			if (!equal(expected, wanted)) {
				const actual = this.current.doc.blocks.filter((b) => common.has(b.id!)).map((b) => b.id);
				if (!equal(actual, expected)) conflicts++;
				else {
					const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
					let index = 0;
					doc.blocks = doc.blocks.map((b) => (common.has(b.id!) ? blocks.get(wanted[index++])! : b));
				}
			}
		}
		return { doc, conflicts };
	}
}
