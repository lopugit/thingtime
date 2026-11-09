import { componentScopeValue, literalMapSourceAction, resolveTemplate } from '../../ComponentsLibrary/componentTemplate';
import { appendCollectionPage, collectionSource, type CollectionSource } from '../collectionSource';

type SourceResponse = { status?: unknown; result?: unknown; cache?: unknown; [key: string]: unknown };
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);

type MapPointSource = CollectionSource & { refresh?: 'load' | 'manual' | 'interval'; intervalMs?: number; showError?: boolean };

export function mapboxPointsSource(value: unknown, scope: Record<string, unknown>): MapPointSource | null {
	if (value == null) return null;
	if (!record(value) || !literalMapSourceAction(value)) throw new Error('Choose a saved map points Action.');
	const { refresh, intervalMs, showError } = value;
	if ((refresh !== undefined && !['load', 'manual', 'interval'].includes(refresh)) ||
		(intervalMs !== undefined && (refresh !== 'interval' || !Number.isSafeInteger(intervalMs) || intervalMs <= 0)) ||
		(showError !== undefined && typeof showError !== 'boolean')) throw new Error('Invalid map points source options.');
	const binding = collectionSource({ ...value, inputs: resolveTemplate(value.inputs, scope) });
	if (!binding || binding.offsetInput) throw new Error('Map points sources use cursor pagination.');
	return { ...binding, refresh, intervalMs, showError };
}

/** The points layer publishes only a complete set from a successful cursor read. */
export async function loadMapboxPointPages(
	source: CollectionSource,
	run: (cursor?: string) => Promise<SourceResponse>,
	stale: () => boolean
): Promise<SourceResponse> {
	const initial = source.inputs[source.cursorInput];
	const seen = new Set<string>(typeof initial === 'string' && initial ? [initial] : []);
	const points = new Map<unknown, unknown>();
	let cursor: string | undefined;
	let noStore = false;
	do {
		if (stale()) throw new Error('Map source changed.');
		const response = await run(cursor);
		if (stale()) throw new Error('Map source changed.');
		if (response.status !== 'ok') return response;
		const page = appendCollectionPage(source, response.result);
		for (const point of page.items) points.set(componentScopeValue(point, source.itemKey), point);
		noStore ||= response.cache === 'no-store';
		cursor = page.cursor || undefined;
		if (cursor && seen.has(cursor)) throw new Error('The map source repeated a cursor.');
		if (cursor) seen.add(cursor);
	} while (cursor);
	return { status: 'ok', result: [...points.values()], ...(noStore ? { cache: 'no-store' } : {}) };
}

/** Publish validated authorized pages progressively; the caller owns access invalidation. */
export async function loadMapboxSourcePages(
	run: (cursor?: string) => Promise<SourceResponse>,
	stale: () => boolean,
	initialCursor?: unknown,
	publish?: (response: SourceResponse) => void
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
		const snapshot = { ...result };
		for (const key of ['items', 'points'] as const) if (key in result) snapshot[key] = [...lists[key].values()];
		publish?.({ ...first, result: snapshot, ...(noStore ? { cache: 'no-store' } : {}) });
	} while (cursor);
	for (const key of ['items', 'points'] as const) if (key in result) result[key] = [...lists[key].values()];
	return { ...first, result: { ...result, nextCursor: null }, ...(noStore ? { cache: 'no-store' } : {}) };
}
