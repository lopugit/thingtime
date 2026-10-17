import { buildGroup, GENERIC_SEARCH_EXCLUDED_THINGTIME, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT, MAX_TEXT_QUERY_CHARS } from '../api/utils/things/searchGrammar';
import { localSearchText } from './librarySearch';
import { isLocalAttachment } from './attachments';
import type { LocalThing } from './things';
import { WorkspaceError } from './storage';

const invalid = (message: string): never => { throw new WorkspaceError('INVALID_LOCAL_SEARCH', message); };
const MISSING = Symbol('missing');
const PREFIX = 'device-search:';
const excluded = new Set<string>(GENERIC_SEARCH_EXCLUDED_THINGTIME);
const ALLOWED = new Set(['q', 'mode', 'conditions', 'thingtime', 'sort', 'cursor', 'limit', 'workspace', 'device']);

// Traverse only saved own properties. Array traversal follows the same field
// grammar as server search; never expose prototypes or evaluate user code.
function valuesAt(value: unknown, path: string[]): unknown[] {
 if (!path.length) return [value];
 if (Array.isArray(value)) {
  if (/^(0|[1-9]\d*)$/.test(path[0])) return valuesAt(Object.prototype.hasOwnProperty.call(value, path[0]) ? value[Number(path[0])] : MISSING, path.slice(1));
  return value.length ? value.flatMap(entry => valuesAt(entry, path)) : [MISSING];
 }
 if (!value || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, path[0])) return [MISSING];
 return valuesAt((value as Record<string, unknown>)[path[0]], path.slice(1));
}
const elements = (value: unknown): unknown[] => Array.isArray(value) ? [value, ...value] : [value];
const equal = (actual: unknown, expected: unknown) => expected === null ? actual === null || actual === MISSING
 : expected instanceof Date ? actual instanceof Date && actual.getTime() === expected.getTime() : actual === expected;
function ordered(actual: unknown, expected: unknown, op: string) {
 const left = actual instanceof Date ? actual.getTime() : actual, right = expected instanceof Date ? expected.getTime() : expected;
 if ((actual instanceof Date) !== (expected instanceof Date) || typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) return false;
 return op === '$gt' ? left > (right as string | number) : op === '$gte' ? left >= (right as string | number) : op === '$lt' ? left < (right as string | number) : left <= (right as string | number);
}
function hasType(value: unknown, type: unknown) {
 if (value === MISSING) return false;
 return type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'date' ? value instanceof Date
  : type === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
  : type === 'bool' ? typeof value === 'boolean' : typeof value === type;
}
// This accepts ONLY clauses produced by buildGroup above, never caller Mongo
// syntax. Keep unsupported compiler output fail-closed instead of ignoring it.
function compileMatch(clause: Record<string, any>): (row: Record<string, unknown>) => boolean {
 const checks = Object.entries(clause).map(([field, predicate]) => {
  if (field === '$and' || field === '$or') {
   const parts = predicate.map(compileMatch) as Array<(row: Record<string, unknown>) => boolean>;
   return (row: Record<string, unknown>) => field === '$and' ? parts.every(check => check(row)) : parts.some(check => check(row));
  }
  const path = field.split('.');
  const operations = Object.entries(predicate).map(([op, value]) => {
   if (op === '$eq') return (_values: unknown[], candidates: unknown[]) => candidates.some(actual => equal(actual, value));
   if (op === '$ne') return (_values: unknown[], candidates: unknown[]) => !candidates.some(actual => equal(actual, value));
   if (op === '$in' || op === '$nin') return (_values: unknown[], candidates: unknown[]) => {
    const found = (value as unknown[]).some(expected => candidates.some(actual => equal(actual, expected)));
    return op === '$in' ? found : !found;
   };
   if (['$gt', '$gte', '$lt', '$lte'].includes(op)) return (_values: unknown[], candidates: unknown[]) => candidates.some(actual => ordered(actual, value, op));
   if (op === '$exists') return (values: unknown[]) => values.some(actual => actual !== MISSING) === value;
   if (op === '$type') return (_values: unknown[], candidates: unknown[]) => candidates.some(actual => hasType(actual, value));
   if (op === '$regex') { const pattern = new RegExp(String(value), 'i'); return (_values: unknown[], candidates: unknown[]) => candidates.some(actual => typeof actual === 'string' && pattern.test(actual)); }
   if (op === '$options' && value === 'i') return () => true;
   return invalid('Unsupported device search condition.');
  });
  return (row: Record<string, unknown>) => {
   const values = valuesAt(row, path), candidates = values.flatMap(elements);
   return operations.every(check => check(values, candidates));
  };
 });
 return row => checks.every(check => check(row));
}

/** A bounded, read-only search of ONE leased workspace snapshot. Field filters
 * use the canonical server grammar. Free text is literal authored-value search,
 * not a simulation of Mongo's stemming, ranking or private account discovery. */
export async function searchLocalThings(rows: LocalThing[], query: Record<string, unknown>, scopeKey: string) {
 for (const [key, value] of Object.entries(query)) if (value !== undefined && !ALLOWED.has(key)) invalid(`Device search does not support the ${key} filter.`);
 if (query.q !== undefined && typeof query.q !== 'string') invalid('Search text must be a string.');
 const q = String(query.q || '').trim().normalize('NFKC').toLowerCase();
 if (q.length > MAX_TEXT_QUERY_CHARS) invalid(`Search text must be at most ${MAX_TEXT_QUERY_CHARS} characters.`);
 if (query.thingtime !== undefined && typeof query.thingtime !== 'string') invalid('Search kinds must be a comma-separated string.');
 const kinds = [...new Set(String(query.thingtime || '').split(',').map(kind => kind.trim()).filter(Boolean))].sort();
 if (kinds.length > 20 || kinds.some(kind => kind.length > 64)) invalid('Too many or invalid search kinds.');
 if (query.sort !== undefined && query.sort !== 'newest' && query.sort !== 'oldest') invalid('Device search supports newest or oldest sorting; relevance ranking is available online.');
 const sort = query.sort || 'newest';
 if (query.mode !== undefined && query.mode !== 'all' && query.mode !== 'any') invalid('Search mode must be all or any.');
 if (query.conditions != null && !Array.isArray(query.conditions)) invalid('conditions must be a list');
 const conditions = (query.conditions || []) as unknown[];
 const filter = conditions.length ? buildGroup({ conditions, mode: query.mode }, 1, { total: 0 }) : {};
 if (filter.ok === false) invalid(filter.error);
 const rawLimit = query.limit ?? DEFAULT_SEARCH_LIMIT;
 if (typeof rawLimit !== 'number' || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_SEARCH_LIMIT) invalid(`Search limit must be an integer from 1 to ${MAX_SEARCH_LIMIT}.`);
 const limit = rawLimit as number;
 const serialized = new TextEncoder().encode(JSON.stringify([scopeKey, q, kinds, sort, filter]));
 if (serialized.byteLength > 32 * 1024) invalid('Device search filters must be at most 32 KiB.');
 const match = compileMatch(filter);
 const hash = await crypto.subtle.digest('SHA-256', serialized);
 const key = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
 let after: string | undefined;
 if (query.cursor != null && query.cursor !== '') {
  if (typeof query.cursor !== 'string' || query.cursor.length > 1024 || !query.cursor.startsWith(PREFIX)) invalid('Start a new device search to use these filters.');
  try {
   const value = JSON.parse(String(query.cursor).slice(PREFIX.length));
   if (!Array.isArray(value) || value.length !== 2 || value[0] !== key || typeof value[1] !== 'string' || value[1].length > 200) invalid('Search workspace or filters changed. Start a new search.');
   after = value[1];
  } catch { invalid('Invalid or changed device search cursor. Start a new search.'); }
 }
 let found = rows.filter(row => !row.thingtime.some(kind => excluded.has(kind))
  && !(isLocalAttachment(row) && row.localAttachment.draftId)
  && (!kinds.length || kinds.some(kind => row.thingtime.includes(kind)))
  && (!q || localSearchText(row).includes(q))
  && match({ ...row, shareId: row.id, createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }));
 found.sort((a, b) => (a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) * (sort === 'oldest' ? 1 : -1));
 const total = found.length;
 if (after) {
  const index = found.findIndex(row => row.id === after);
  if (index < 0) invalid('Search results changed. Start a new search.');
  found = found.slice(index + 1);
 }
 const things = found.slice(0, limit);
 return { ok: true as const, things, total, totalCapped: false, ranked: false, localWorkspace: true, source: 'device' as const, textMode: 'literal' as const,
  nextCursor: found.length > limit ? PREFIX + JSON.stringify([key, things.at(-1)!.id]) : null };
}
