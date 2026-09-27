import { componentScopeValue } from '../ComponentsLibrary/componentTemplate';

export type CollectionSource = {
	action: string;
	inputs: Record<string, string | number | boolean>;
	itemsPath: string;
	cursorPath: string;
	cursorInput: string;
	itemKey: string;
};
export type CollectionPage = {
	items: Record<string, any>[];
	cursor: string | null;
	seen: string[];
	bytes: number;
	pages: number;
};
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const safePart = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const path = (value: unknown, fallback: string) => {
	const text = value === undefined ? fallback : value;
	if (typeof text !== 'string' || text.length > 200 || !text.split('.').every(safePart)) throw new Error('Invalid collection source path.');
	return text;
};

/** A saved Action supplies each page; the collection never supplies API authority. */
export function collectionSource(value: unknown): CollectionSource | null {
	if (value === undefined || value === null) return null;
	if (!record(value) || typeof value.action !== 'string' || !value.action || value.action.length > 128 || /[{}$\s]/.test(value.action))
		throw new Error('Choose a saved collection source Action.');
	const inputs = value.inputs ?? {};
	if (!record(inputs) || Object.keys(inputs).length > 32 || JSON.stringify(inputs).length > 16384 ||
		Object.entries(inputs).some(([key, input]) => !safePart(key) || !['string', 'number', 'boolean'].includes(typeof input) || (typeof input === 'number' && !Number.isFinite(input))))
		throw new Error('Collection source inputs must be a bounded set of plain values.');
	const cursorInput = path(value.cursorInput, 'cursor');
	if (!safePart(cursorInput)) throw new Error('Invalid collection cursor input.');
	return { action: value.action, inputs, cursorInput, itemsPath: path(value.itemsPath, 'items'), cursorPath: path(value.cursorPath, 'nextCursor'), itemKey: path(value.itemKey, 'id') };
}

export function appendCollectionPage(source: CollectionSource, result: unknown, previous?: CollectionPage): CollectionPage {
	const rows = componentScopeValue(result as Record<string, unknown>, source.itemsPath);
	const rawCursor = componentScopeValue(result as Record<string, unknown>, source.cursorPath);
	if (!Array.isArray(rows) || rows.some((item) => !record(item))) throw new Error('The collection source must return a list of records.');
	if (rawCursor != null && rawCursor !== '' && (typeof rawCursor !== 'string' || rawCursor.length > 4096)) throw new Error('Invalid collection cursor.');
	const cursor = typeof rawCursor === 'string' && rawCursor ? rawCursor : null;
	const seen = previous?.seen || (typeof source.inputs[source.cursorInput] === 'string' && source.inputs[source.cursorInput] ? [String(source.inputs[source.cursorInput])] : []);
	if (cursor && seen.includes(cursor)) throw new Error('The collection source repeated a cursor.');
	const pages = (previous?.pages || 0) + 1;
	const bytes = (previous?.bytes || 0) + new TextEncoder().encode(JSON.stringify(result)).length;
	if (pages > 200 || bytes > 4 * 1024 * 1024) throw new Error('Narrow the source to at most 200 pages and 4 MB.');
	const items = [...(previous?.items || [])];
	const positions = new Map(items.map((item, index) => [componentScopeValue(item, source.itemKey), index]));
	for (const item of rows) {
		const key = componentScopeValue(item, source.itemKey);
		if ((typeof key !== 'string' || !key) && (typeof key !== 'number' || !Number.isFinite(key))) throw new Error('Every collection source record needs a stable key.');
		const position = positions.get(key);
		if (position === undefined) { positions.set(key, items.length); items.push(item); }
		else items[position] = item;
	}
	if (items.length > 10000) throw new Error('Filter or page the source to at most 10,000 records.');
	return { items, cursor, seen: cursor ? [...seen, cursor] : seen, bytes, pages };
}
