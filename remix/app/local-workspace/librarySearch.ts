import { isLocalLibraryThing, type LocalThing } from './things';
import { WorkspaceError } from './storage';

export type LibrarySearchQuery = { q?: unknown; thingtime?: unknown; cursor?: unknown; limit?: unknown };
const invalid = (message: string): never => { throw new WorkspaceError('INVALID_LOCAL_SEARCH', message); };
const fold = (text: string) => text.normalize('NFKC').toLowerCase();

/** Search authored values, not JSON field names or local bookkeeping. The
 * workspace's record/byte quotas bound this scan; values were validated on write. */
export function localSearchText(row: LocalThing) {
 const pending: unknown[] = [row.crystal, row.tags || []], text: string[] = [];
 while (pending.length) {
  const value = pending.pop();
  if (typeof value === 'string') text.push(value);
  else if (Array.isArray(value)) for (const entry of value) pending.push(entry);
  else if (value && typeof value === 'object') for (const entry of Object.values(value)) pending.push(entry);
 }
 return fold(text.join('\n'));
}

/** A library-only literal text search. Public/structured discovery retains its
 * own API contract; this helper grants no identity, ACL or remote authority. */
export function searchLocalLibrary(rows: LocalThing[], query: LibrarySearchQuery = {}) {
 if (query.q !== undefined && typeof query.q !== 'string') invalid('Search text must be a string.');
 const q = fold(String(query.q || '').trim());
 if (q.length > 200) invalid('Search text must be at most 200 characters.');
 if (query.thingtime !== undefined && typeof query.thingtime !== 'string') invalid('Search kinds must be a comma-separated string.');
 const kinds = [...new Set(String(query.thingtime || '').split(',').map(kind => kind.trim()).filter(Boolean))].sort();
 if (kinds.length > 20 || kinds.some(kind => kind.length > 64)) invalid('Too many or invalid search kinds.');
 const limit = Math.max(1, Math.min(50, Math.floor(Number(query.limit) || 20)));
 const key = JSON.stringify([q, kinds]);
 if (key.length > 1500) invalid('Search filters are too large. Use fewer kinds.');
 let after: string | undefined;
 if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
  if (typeof query.cursor !== 'string' || query.cursor.length > 4096 || !query.cursor.startsWith('local-search:')) invalid('Reload this search to browse saved device content.');
  try {
   const cursor = JSON.parse(String(query.cursor).slice(13));
   if (!Array.isArray(cursor) || cursor.length !== 2 || cursor[0] !== key || typeof cursor[1] !== 'string') invalid('Search filters changed. Start a new search.');
   after = cursor[1];
  } catch { invalid('Invalid or changed search cursor. Start a new search.'); }
 }
 let matches = rows.filter(row => isLocalLibraryThing(row) && (!kinds.length || kinds.some(kind => row.thingtime.includes(kind))) && (!q || localSearchText(row).includes(q)))
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
 const total = matches.length;
 if (after) {
  const index = matches.findIndex(row => row.id === after);
  if (index < 0) invalid('Search results changed. Start a new search.');
  matches = matches.slice(index + 1);
 }
 const things = matches.slice(0, limit);
 return { ok: true as const, things, total, totalCapped: false, ranked: false, posts: {},
  nextCursor: matches.length > limit ? `local-search:${JSON.stringify([key, things.at(-1)!.id])}` : null, localWorkspace: true };
}
