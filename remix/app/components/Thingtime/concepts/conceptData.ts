import React from 'react';

// Shared pure-JSON helpers for the nested data viewer concepts
// (components/Thingtime/concepts). Every concept viewer is driven by a plain
// JSON thing plus an onChange(nextThing) callback, so a concept can be mounted
// on local state (docs demos), on useThingtime (the live editor), or on a
// fetched /api/v1/things document without changing the component.

export type ThingPath = Array<string | number>;

export type LeafType = 'string' | 'number' | 'boolean' | 'null' | 'undefined';
export type BranchType = 'object' | 'array';
export type ThingType = LeafType | BranchType;

export const thingTypeOf = (value: unknown): ThingType => {
	if (value === null) return 'null';
	if (Array.isArray(value)) return 'array';
	const type = typeof value;
	if (type === 'object') return 'object';
	if (type === 'string' || type === 'number' || type === 'boolean') return type;
	return 'undefined';
};

export const isBranch = (value: unknown): value is Record<string, unknown> | unknown[] =>
	value !== null && typeof value === 'object';

// emoji per type, matching the Icon names the live tree uses
export const thingTypeEmoji: Record<ThingType, string> = {
	object: '📦',
	array: '📚',
	string: '💬',
	number: '💯',
	boolean: '🌗',
	null: '❓',
	undefined: '❓'
};

export const getAtPath = (thing: unknown, path: ThingPath): unknown => {
	let current: unknown = thing;
	for (const key of path) {
		if (!isBranch(current)) return undefined;
		current = (current as Record<string, unknown>)[key as string];
	}
	return current;
};

// immutable deep set — clones only the spine, mirroring setThingtime semantics
export const setAtPath = (thing: unknown, path: ThingPath, value: unknown): unknown => {
	if (!path.length) return value;

	const [head, ...rest] = path;
	const branch: any = isBranch(thing) ? thing : typeof head === 'number' ? [] : {};
	const clone: any = Array.isArray(branch) ? [...branch] : { ...branch };
	clone[head] = setAtPath(clone[head], rest, value);
	return clone;
};

export const deleteAtPath = (thing: unknown, path: ThingPath): unknown => {
	if (!path.length) return thing;

	const parentPath = path.slice(0, -1);
	const key = path[path.length - 1];
	const parent = getAtPath(thing, parentPath);

	if (Array.isArray(parent)) {
		return setAtPath(
			thing,
			parentPath,
			parent.filter((item, idx) => idx !== Number(key))
		);
	}

	if (isBranch(parent)) {
		const clone = { ...(parent as Record<string, unknown>) };
		delete clone[key as string];
		return setAtPath(thing, parentPath, clone);
	}

	return thing;
};

// the "New Value", "New Value 1", … naming the live tree uses for new children
export const addChildAtPath = (thing: unknown, path: ThingPath, value: unknown = ''): unknown => {
	const parent = getAtPath(thing, path);

	if (Array.isArray(parent)) {
		return setAtPath(thing, path, [...parent, value]);
	}

	if (isBranch(parent)) {
		const base = 'New Value';
		let increment = 0;
		let key = base;
		while (Object.prototype.hasOwnProperty.call(parent, key) && increment <= 999) {
			increment++;
			key = `${base} ${increment}`;
		}
		return setAtPath(thing, [...path, key], value);
	}

	return thing;
};

export const renameKeyAtPath = (thing: unknown, path: ThingPath, nextKey: string): unknown => {
	if (!path.length || !nextKey) return thing;

	const parentPath = path.slice(0, -1);
	const currentKey = path[path.length - 1];
	const parent = getAtPath(thing, parentPath);

	if (Array.isArray(parent) || !isBranch(parent)) return thing;

	// rebuild preserving key order, exactly like Thingtime.tsx updatePath
	const next: Record<string, unknown> = {};
	Object.keys(parent as Record<string, unknown>).forEach((key) => {
		if (key === currentKey) {
			next[nextKey] = (parent as Record<string, unknown>)[key];
			return;
		}
		next[key] = (parent as Record<string, unknown>)[key];
	});

	return setAtPath(thing, parentPath, next);
};

export const childKeysOf = (value: unknown): Array<string | number> => {
	if (Array.isArray(value)) return value.map((item, idx) => idx);
	if (isBranch(value)) return Object.keys(value);
	return [];
};

// one-line, layperson-friendly preview of any value ("3 items", "Roses, tulips…")
export const summarizeThing = (value: unknown, maxLength = 60): string => {
	const type = thingTypeOf(value);

	if (type === 'string') {
		const text = String(value).trim().replace(/\s+/g, ' ');
		if (!text) return 'Empty text';
		return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
	}
	if (type === 'number') return String(value);
	if (type === 'boolean') return value ? 'Yes' : 'No';
	if (type === 'null' || type === 'undefined') return 'Imagine..';
	if (type === 'array') {
		const items = value as unknown[];
		if (!items.length) return 'Empty list';
		const leafPreviews = items
			.filter((item) => !isBranch(item))
			.slice(0, 3)
			.map((item) => summarizeThing(item, 16));
		if (leafPreviews.length) {
			return leafPreviews.join(', ') + (items.length > leafPreviews.length ? '…' : '');
		}
		return `${items.length} item${items.length === 1 ? '' : 's'}`;
	}

	const keys = childKeysOf(value);
	if (!keys.length) return 'Empty thing';
	const shown = keys.slice(0, 3).join(', ');
	return keys.length > 3 ? `${shown}…` : shown;
};

export const countChildren = (value: unknown): number => childKeysOf(value).length;

export const childCountLabel = (value: unknown): string => {
	const count = countChildren(value);
	if (Array.isArray(value)) return `${count} item${count === 1 ? '' : 's'}`;
	return `${count} field${count === 1 ? '' : 's'}`;
};

// friendly emoji guess for a key name, so laypeople get visual anchors
const KEY_EMOJI_RULES: Array<[RegExp, string]> = [
	[/^(name|title|label)$/i, '🏷️'],
	[/(image|photo|picture|avatar|banner)/i, '🖼️'],
	[/(video|movie|film)/i, '🎥'],
	[/(music|audio|song)/i, '🎵'],
	[/(price|cost|amount|budget|total|currency)/i, '💵'],
	[/(email|mail)/i, '✉️'],
	[/(phone|mobile|tel)/i, '📱'],
	[/(url|link|website|site)/i, '🔗'],
	[/(date|time|created|updated|when|schedule)/i, '⏰'],
	[/(location|address|place|city|country|geo|lat|lng|coords)/i, '📍'],
	[/(user|author|owner|person|people|friend)/i, '👤'],
	[/(tag|tags|category|categories|kind|type)/i, '🧩'],
	[/(note|description|summary|text|bio|about|story)/i, '💬'],
	[/(setting|config|option|preference)/i, '⚙️'],
	[/(garden|plant|flower|tree)/i, '🌱'],
	[/(home|house)/i, '🏡'],
	[/(favorite|favourite|star|like)/i, '⭐'],
	[/(list|items|children|posts|things)/i, '📚'],
	[/(idea|imagine|dream|wish)/i, '✨'],
	[/(money|bank|finance|saving)/i, '💰'],
	[/(recipe|food|meal|ingredient)/i, '🍳'],
	[/(map|world|travel|trip)/i, '🌍']
];

export const keyEmoji = (key: string | number, value?: unknown): string => {
	if (typeof key === 'number') return '📄';
	for (const [pattern, emoji] of KEY_EMOJI_RULES) {
		if (pattern.test(key)) return emoji;
	}
	return thingTypeEmoji[thingTypeOf(value)];
};

export const humanizeKey = (key: string | number): string => {
	if (typeof key === 'number') return `#${key + 1}`;
	// keep already-human keys; split camelCase/snake_case/kebab-case gently
	return String(key)
		.replace(/[_-]+/g, ' ')
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2')
		.replace(/^\w/, (c) => c.toUpperCase());
};

export type ThingMutations = {
	setValue: (path: ThingPath, value: unknown) => void;
	deleteValue: (path: ThingPath) => void;
	addChild: (path: ThingPath, value?: unknown) => void;
	renameKey: (path: ThingPath, nextKey: string) => void;
};

// Controlled-component adapter: every concept viewer takes (thing,
// onThingChange) and derives its mutations from this hook, so the same viewer
// mounts on local state, useThingtime, or a fetched thing without changes.
export const useThingMutations = (thing: unknown, onThingChange?: (next: unknown) => void): ThingMutations =>
	React.useMemo(
		() => ({
			setValue: (path, value) => onThingChange?.(setAtPath(thing, path, value)),
			deleteValue: (path) => onThingChange?.(deleteAtPath(thing, path)),
			addChild: (path, value = '') => onThingChange?.(addChildAtPath(thing, path, value)),
			renameKey: (path, nextKey) => onThingChange?.(renameKeyAtPath(thing, path, nextKey))
		}),
		[thing, onThingChange]
	);

export type ConceptThingApi = {
	thing: unknown;
	setValue: (path: ThingPath, value: unknown) => void;
	deleteValue: (path: ThingPath) => void;
	addChild: (path: ThingPath, value?: unknown) => void;
	renameKey: (path: ThingPath, nextKey: string) => void;
	replaceThing: (next: unknown) => void;
};

// Local-state adapter used by the docs demos. The live editor would pass the
// same shape backed by useThingtime()/setThingtime instead.
export const useConceptThing = (initial: unknown, onChange?: (next: unknown) => void): ConceptThingApi => {
	const [thing, setThing] = React.useState(initial);

	const commit = React.useCallback(
		(next: unknown) => {
			setThing(next);
			onChange?.(next);
		},
		[onChange]
	);

	return React.useMemo(
		() => ({
			thing,
			setValue: (path, value) => commit(setAtPath(thing, path, value)),
			deleteValue: (path) => commit(deleteAtPath(thing, path)),
			addChild: (path, value = '') => commit(addChildAtPath(thing, path, value)),
			renameKey: (path, nextKey) => commit(renameKeyAtPath(thing, path, nextKey)),
			replaceThing: commit
		}),
		[thing, commit]
	);
};
