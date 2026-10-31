type SourceResponse = { status?: unknown; result?: unknown; cache?: unknown; [key: string]: unknown };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Drain an Action's standard cursor contract without retaining partial or stale results. */
export async function loadMapboxSourcePages(
	run: (cursor?: string) => Promise<SourceResponse>,
	stale: () => boolean,
	initialCursor?: unknown
): Promise<SourceResponse> {
	const seen = new Set<string>(typeof initialCursor === 'string' && initialCursor ? [initialCursor] : []);
	const lists = { items: new Map<unknown, unknown>(), points: new Map<unknown, unknown>() };
	let first: SourceResponse | undefined, result: Record<string, unknown> = {}, cursor: string | undefined, noStore = false;
	do {
		if (stale()) throw new Error('Map source changed.');
		const response = await run(cursor);
		if (stale()) throw new Error('Map source changed.');
		if (response.status !== 'ok') return response;
		if (!record(response.result)) throw new Error('The map source must return a record.');
		if (!Array.isArray(response.result.items) && !Array.isArray(response.result.points)) throw new Error('The map source must return a list of records.');
		first ??= response;
		result = { ...result, ...response.result };
		noStore ||= response.cache === 'no-store';
		for (const key of ['items', 'points'] as const) {
			if (response.result[key] === undefined) continue;
			if (!Array.isArray(response.result[key])) throw new Error('The map source must return lists of records.');
			for (const item of response.result[key]) {
				if (!record(item) || !((typeof item.id === 'string' && item.id) || (typeof item.id === 'number' && Number.isFinite(item.id)))) throw new Error('Map source records require stable IDs.');
				lists[key].set(item.id, item);
			}
		}
		const next = response.result.nextCursor;
		if (next != null && next !== '' && (typeof next !== 'string' || next.length > 4096)) throw new Error('Invalid map source cursor.');
		cursor = typeof next === 'string' && next ? next : undefined;
		if (cursor && seen.has(cursor)) throw new Error('The map source repeated a cursor.');
		if (cursor) seen.add(cursor);
	} while (cursor);
	for (const key of ['items', 'points'] as const) if (key in result) result[key] = [...lists[key].values()];
	return { ...first, result: { ...result, nextCursor: null }, ...(noStore ? { cache: 'no-store' } : {}) };
}
