import { searchThings, type SearchQuery, type SearchResult } from '../things/search';
import type { Viewer, AppLens } from '../things/things';
import { buildOverview, decodeOverviewCursor, overviewCursor, OverviewError, OVERVIEW_ROLES, type OverviewInput, type OverviewRole, type OverviewThing } from './overviewCore';

export type OverviewSearch = (viewer: Viewer, query: SearchQuery, app: AppLens) => Promise<{ ok: false; status: number; error: string } | SearchResult>;

/** Search remains the sole read boundary: ACL, scoped PAT and app namespace
 * checks are exactly those of the canonical Things API. The deadline bounds
 * work for one response, not the number of records a project may contain. */
export async function readAgentOverview(viewer: Viewer, input: OverviewInput, app: AppLens = null, options: {
	search?: OverviewSearch; signal?: AbortSignal; budgetMs?: number; now?: () => number;
} = {}) {
	const search = options.search || searchThings, now = options.now || Date.now;
	const deadline = now() + (options.budgetMs ?? 8_000);
	const decoded = input.cursor ? decodeOverviewCursor(input) : null;
	const scanStart = decoded?.scanStart;
	const coreInput = { ...input, scanStart, cursor: decoded?.after ? input.cursor : '' };
	const records = Object.fromEntries(OVERVIEW_ROLES.map(role => [role, []])) as Record<OverviewRole, OverviewThing[]>;
	const cursors = new Map<OverviewRole, string | null>();
	const seen = new Map<OverviewRole, Set<string>>();
	for (const role of OVERVIEW_ROLES) if (input.schemas[role] && (!scanStart || Object.prototype.hasOwnProperty.call(scanStart, role))) { cursors.set(role, scanStart?.[role] ?? null); seen.set(role, new Set()); }
	let complete = true;
	while (cursors.size) {
		for (const [role, cursor] of cursors) {
			options.signal?.throwIfAborted();
			if (now() >= deadline) { complete = false; break; }
			const schema = input.schemas[role]!;
			const query: SearchQuery = { thingtime: 'data', sort: 'oldest', limit: 50, cursor,
				conditions: [{ mode: 'any', conditions: [{ field: 'crystal.schema', op: 'eq', value: schema }, { field: 'crystal.schemaId', op: 'eq', value: schema }] }] };
			// An in-flight canonical query cannot be forcibly canceled, but its
			// completion is fenced and no additional work starts after the deadline.
			const result = await new Promise<Awaited<ReturnType<OverviewSearch>> | null>((resolve, reject) => {
				const abort = () => { clearTimeout(timer); reject(options.signal?.reason); };
				const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve(null); }, Math.max(1, deadline - now()));
				options.signal?.addEventListener('abort', abort, { once: true });
				void search(viewer, query, app).then(value => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); resolve(value); }, error => { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); reject(error); });
			});
			options.signal?.throwIfAborted();
			if (!result) { complete = false; break; }
			if (result.ok === false) throw new OverviewError(result.status, 'The authorized overview records could not be read');
			records[role].push(...result.things.map(row => ({ id: row.id, crystal: row.crystal, createdAt: row.createdAt, updatedAt: row.updatedAt })));
			if (!result.nextCursor) cursors.delete(role);
			else {
				if (seen.get(role)!.has(result.nextCursor)) throw new OverviewError(409, 'Overview source pagination did not advance');
				seen.get(role)!.add(result.nextCursor); cursors.set(role, result.nextCursor);
			}
		}
		if (!complete) break;
	}
	// Canonical search pages are immutable snapshots individually, not a
	// database-wide transaction. Disclose this scope rather than claim atomic totals.
	// Deduplicate live pagination overlaps without retaining any foreign envelope.
	for (const role of OVERVIEW_ROLES) records[role] = [...new Map(records[role].map(row => [row.id, row])).values()];
	const result = buildOverview(coreInput, records, complete && !scanStart, new Date(now()).toISOString());
	if (!result.nextCursor && !complete) result.nextCursor = overviewCursor(input, undefined, Object.fromEntries(cursors));
	return { ...result, consistency: 'authorized-page-scan' as const,
		coverage: { ...result.coverage, scanContinued: !!scanStart, sourceScanComplete: complete, unresolvedParents: !complete || !!scanStart } };
}
