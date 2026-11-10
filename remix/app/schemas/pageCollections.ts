export type PageCollectionBinding = {
	as: string;
	groupBy: string;
	itemsPath?: string;
	cursorPath?: string;
	cursorInput?: string;
	itemKey?: string;
};

const safePart = (value: string) => /^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(value) &&
	!['__proto__', 'constructor', 'prototype'].includes(value);
const path = (value: unknown): value is string =>
	typeof value === 'string' && value.length <= 200 && value.split('.').every(safePart);

export function pageCollectionBinding(value: unknown): PageCollectionBinding | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const { as, groupBy, itemsPath, cursorPath, cursorInput, itemKey } = value as Record<string, unknown>;
	if (typeof as !== 'string' || !safePart(as) || !path(groupBy) ||
		(itemsPath !== undefined && !path(itemsPath)) || (cursorPath !== undefined && !path(cursorPath)) ||
		(cursorInput !== undefined && (typeof cursorInput !== 'string' || !safePart(cursorInput))) ||
		(itemKey !== undefined && !path(itemKey))) return null;
	return { as, groupBy, ...(typeof itemsPath === 'string' ? { itemsPath } : {}), ...(typeof cursorPath === 'string' ? { cursorPath } : {}),
		...(typeof cursorInput === 'string' ? { cursorInput } : {}), ...(typeof itemKey === 'string' ? { itemKey } : {}) };
}
