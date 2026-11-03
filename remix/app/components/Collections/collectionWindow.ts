export type CollectionSize = 5 | 10 | 15 | 20 | 'all' | 'infinite';
export const COLLECTION_SIZES = [5, 10, 15, 20, 'all', 'infinite'] as const;

export function collectionWindow(total: number, size: CollectionSize, requestedPage: number, visible = 10) {
	const count = Math.max(0, total);
	if (size === 'all') return { page: 1, pages: 1, start: 0, end: count, pageSize: Math.max(1, count) };
	const pageSize = size === 'infinite' ? 10 : size;
	const pages = Math.max(1, Math.ceil(count / pageSize));
	const page = Math.min(pages, Math.max(1, Math.trunc(requestedPage) || 1));
	const start = size === 'infinite' ? 0 : (page - 1) * pageSize;
	const end = Math.min(count, size === 'infinite' ? Math.max(10, visible) : start + pageSize);
	return { page, pages, start, end, pageSize };
}
