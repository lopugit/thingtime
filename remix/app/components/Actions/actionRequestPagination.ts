import type { ActionRequestPagination } from '~/schemas/actionRequestPagination';

const read = (root: unknown, path: string): unknown => path.split('.').reduce<unknown>((value, key) =>
	value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, key) ? (value as Record<string, unknown>)[key] : undefined, root);
const replace = (root: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> => {
	const [key, ...tail] = path.split('.');
	return { ...root, [key]: tail.length ? replace(root[key] as Record<string, unknown>, tail.join('.'), value) : value };
};
const cursorKey = (value: unknown): string => {
	if ((typeof value !== 'string' || !value || value.length > 2000) && (typeof value !== 'number' || !Number.isFinite(value)))
		throw new Error('Pagination returned an invalid cursor');
	return String(value);
};

// request checks the shared Action identity, deadline, operation and byte
// budgets on every page. Nothing retries a request or accepts a partial list.
export async function requestActionPages(
	spec: ActionRequestPagination,
	query: Record<string, unknown>,
	request: (query: Record<string, unknown>, page: number) => Promise<unknown>,
	maximumBytes: number
): Promise<Record<string, unknown>> {
	let result: Record<string, unknown> | undefined;
	let nextQuery = { ...query };
	const cursors = new Set<string>();
	if (query[spec.cursorParam] != null && query[spec.cursorParam] !== '') cursors.add(cursorKey(query[spec.cursorParam]));
	const items: unknown[] = [], positions = new Map<string, number>();
	for (let page = 1; page <= spec.maxPages; page++) {
		const response = await request(nextQuery, page);
		if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('Pagination needs an object response');
		const list = read(response, spec.itemsPath), cursor = read(response, spec.cursorPath);
		if (!Array.isArray(list) || cursor === undefined) throw new Error('The pagination response no longer matches its configured fields');
		result ??= response as Record<string, unknown>;
		for (const item of list) {
			const key = spec.itemKey ? cursorKey(read(item, spec.itemKey)) : undefined;
			const position = key === undefined ? undefined : positions.get(key);
			if (position !== undefined) items[position] = item;
			else { if (key !== undefined) positions.set(key, items.length); items.push(item); }
			if (items.length > spec.maxItems) throw new Error('Pagination exceeds the configured item budget');
		}
		result = replace(replace(result, spec.itemsPath, items), spec.cursorPath, cursor);
		if (new TextEncoder().encode(JSON.stringify(result)).byteLength > maximumBytes) throw new Error('The combined pages exceed the Action result byte budget');
		if (cursor === null) return result;
		const key = cursorKey(cursor);
		if (cursors.has(key)) throw new Error('Pagination repeated a cursor');
		if (typeof cursor === 'number' && typeof nextQuery[spec.cursorParam] === 'number' && cursor <= (nextQuery[spec.cursorParam] as number))
			throw new Error('Pagination moved backwards');
		cursors.add(key);
		nextQuery = { ...query, [spec.cursorParam]: cursor };
	}
	throw new Error('Pagination exceeds the configured page budget');
}
