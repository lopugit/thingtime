import { componentScopeValue } from '../ComponentsLibrary/componentTemplate';

export type CollectionSource = {
	action: string;
	inputs: Record<string, string | number | boolean>;
	itemsPath: string;
	cursorPath: string;
	cursorInput: string;
	itemKey: string;
	totalPath: string;
	offsetInput?: string;
	limitInput?: string;
};
export type CollectionPage = {
	items: Record<string, any>[];
	cursor: string | null;
	seen: string[];
	bytes: number;
	pages: number;
	total?: number;
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
	const offsetInput = value.offsetInput === undefined ? undefined : path(value.offsetInput, 'offset');
	const limitInput = value.limitInput === undefined ? undefined : path(value.limitInput, 'limit');
	if ((offsetInput && !safePart(offsetInput)) || (limitInput && !safePart(limitInput)) || (limitInput && !offsetInput)) throw new Error('Invalid collection offset input.');
	return { action: value.action, inputs, cursorInput, offsetInput, limitInput, itemsPath: path(value.itemsPath, 'items'), cursorPath: path(value.cursorPath, 'nextCursor'), itemKey: path(value.itemKey, 'id'), totalPath: path(value.totalPath, 'total') };
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
	const total = componentScopeValue(result as Record<string, unknown>, source.totalPath);
	if (total != null && (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)) throw new Error('Invalid collection total.');
	const items = [...(previous?.items || [])];
	const positions = new Map(items.map((item, index) => [componentScopeValue(item, source.itemKey), index]));
	for (const item of rows) {
		const key = componentScopeValue(item, source.itemKey);
		if ((typeof key !== 'string' || !key) && (typeof key !== 'number' || !Number.isFinite(key))) throw new Error('Every collection source record needs a stable key.');
		const position = positions.get(key);
		if (position === undefined) { positions.set(key, items.length); items.push(item); }
		else items[position] = item;
	}

	return { items, cursor, seen: cursor ? [...seen, cursor] : seen, bytes, pages, ...((typeof total === 'number' ? total : previous?.total) != null ? { total: typeof total === 'number' ? total : previous?.total } : {}) };
}

/** Offset Actions must confirm their slice so an ignored input cannot masquerade as another page. */
export function collectionOffsetPage(source: CollectionSource, result: unknown, offset: number, limit: number): CollectionPage {
 if (!record(result) || result.offset !== offset) throw new Error('The collection source did not confirm the requested offset.');
 const page = appendCollectionPage(source, result);
 if (page.items.length > limit) throw new Error('The collection source exceeded the requested page size.');
 return page;
}

type CollectionSourceResponse = { status?: unknown; result?: unknown; cache?: unknown; [key: string]: unknown };

/** A cursor-backed collection publishes only a complete set from a successful cursor read. */
export async function loadCollectionPages(
	source: CollectionSource,
	run: (cursor?: string) => Promise<CollectionSourceResponse>,
	stale: () => boolean,
	initial = source.inputs[source.cursorInput] as unknown
): Promise<CollectionSourceResponse> {
	const seen = new Set<string>(typeof initial === 'string' && initial ? [initial] : []);
	const points = new Map<unknown, unknown>();
	let cursor: string | undefined;
	let noStore = false;
	do {
		if (stale()) throw new Error('Collection source changed.');
		const response = await run(cursor);
		if (stale()) throw new Error('Collection source changed.');
		if (response.status !== 'ok') return response;
		const page = appendCollectionPage(source, response.result);
		for (const point of page.items) points.set(componentScopeValue(point, source.itemKey), point);
		noStore ||= response.cache === 'no-store';
		cursor = page.cursor || undefined;
		if (cursor && seen.has(cursor)) throw new Error('The collection source repeated a cursor.');
		if (cursor) seen.add(cursor);
	} while (cursor);
	return { status: 'ok', result: [...points.values()], ...(noStore ? { cache: 'no-store' } : {}) };
}


export function indexCollectionRows(rows: unknown, keyPath: string): Record<string, unknown[]> {
	const indexed: Record<string, unknown[]> = Object.create(null);
	if (!Array.isArray(rows)) return indexed;
	for (const row of rows) {
		const key = componentScopeValue(row, keyPath);
		if (!(typeof key === 'string' && key) && !(typeof key === 'number' && Number.isFinite(key))) continue;
		const name = String(key);
		if (['__proto__', 'constructor', 'prototype'].includes(name)) continue;
		(indexed[name] ??= []).push(row);
	}
	return indexed;
}
