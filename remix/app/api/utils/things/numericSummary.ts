type Failure = { ok: false; status: number; error: string };
type SummaryActor = 'user' | 'pat' | 'app' | 'anonymous';
type PageQuery = { thingtime: string[]; schemaId: string; parentId: string; cursor: string | null; limit: number };
type Page = Failure | { ok: true; things: { crystal: unknown }[]; nextCursor: string | null };
type Summary = Failure | { ok: true; summary: { max: number | null } };

const allowedParams = new Set(['thingtime', 'schemaId', 'parentId', 'maxCrystalField', 'excludeArchived']);
const reservedFields = new Set(['__proto__', 'prototype', 'constructor']);
const cancelled = (): Failure => ({ ok: false, status: 499, error: 'Numeric summary cancelled' });
const unavailable = (): Failure => ({ ok: false, status: 503, error: 'Numeric summary is unavailable' });

/** Summarize only projected rows supplied by the existing authorized list path. */
export async function readThingNumericSummary(
	params: URLSearchParams,
	actor: SummaryActor,
	readPage: (query: PageQuery) => Promise<Page>,
	signal?: AbortSignal
): Promise<Summary> {
	if (actor === 'anonymous') return { ok: false, status: 401, error: 'Sign in to read a numeric summary' };
	if (actor === 'app') return { ok: false, status: 403, error: 'Numeric summaries require a first-party Things read' };
	const field = params.get('maxCrystalField');
	const schemaId = params.get('schemaId');
	const parentId = params.get('parentId');
	const archiveFilter = params.get('excludeArchived');
	if (Array.from(params.keys()).some((key) => !allowedParams.has(key) || params.getAll(key).length !== 1) ||
		params.get('thingtime') !== 'data' || !schemaId || !parentId ||
		!field || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(field) || reservedFields.has(field) ||
		(archiveFilter !== null && archiveFilter !== 'true' && archiveFilter !== 'false')) {
		return { ok: false, status: 400, error: 'Invalid Things numeric summary query' };
	}

	let max: number | null = null;
	let cursor: string | null = null;
	const seen = new Set<string>();
	try {
		do {
			if (signal?.aborted) return cancelled();
			const page = await readPage({ thingtime: ['data'], schemaId, parentId, cursor, limit: 50 });
			if (signal?.aborted) return cancelled();
			if (page.ok === false) return page;
			for (const { crystal } of page.things) {
				if (!crystal || typeof crystal !== 'object' || Array.isArray(crystal)) continue;
				const row = crystal as Record<string, unknown>;
				if ((archiveFilter === 'true' && Object.prototype.hasOwnProperty.call(row, 'archived') && row.archived === true) || !Object.prototype.hasOwnProperty.call(row, field)) continue;
				const value = row[field];
				if (typeof value === 'number' && Number.isFinite(value) && (max === null || value > max)) max = value;
			}
			cursor = page.nextCursor;
			if (cursor !== null) {
				if (!cursor || seen.has(cursor)) return unavailable();
				seen.add(cursor);
			}
		} while (cursor !== null);
		return { ok: true, summary: { max } };
	} catch {
		return signal?.aborted ? cancelled() : unavailable();
	}
}
