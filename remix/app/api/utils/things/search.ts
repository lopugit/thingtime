import { ensureIndexes, getThingsCollection } from '../mongodb/collections';
import { KEY_SEGMENT_PATTERN } from '~/schemas/registry';
import {
  asViewer,
  canViewInherited,
  chronoCursorClause,
  fail,
  isFail,
  isPostThing,
  oldestCursorClause,
  parseChronoCursor,
  toPublicPosts,
  toPublicThings,
  visibilityQueryFor,
  withMatch,
  type Fail,
  type PublicPost,
  type PublicThing,
  type ThingDoc,
  type Viewer
} from './things';

// Structured search over the things collection — the API behind /search.
//
// Callers describe conditions in a small whitelisted grammar (field + operator
// + primitive value); we compile it into a MongoDB filter. NOTHING from the
// request reaches Mongo verbatim: field paths are validated segment-by-segment
// (no $, no NUL, bounded depth), operators map through an explicit whitelist,
// values must be bounded primitives (objects are rejected, which is what closes
// the operator-injection door), and user text never becomes a raw regex — only
// escaped literals via contains/startsWith/endsWith. Visibility is enforced the
// same way as the feed: a DB-level superset (public + own) plus the exact
// per-doc acl check before projection.

export const SEARCH_OPERATORS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'in',
  'nin',
  'exists',
  'type',
  'contains',
  'startsWith',
  'endsWith'
] as const;
export type SearchOperator = (typeof SEARCH_OPERATORS)[number];

// friendly datatype names → mongo $type aliases ('number' covers int/long/
// double/decimal, which is exactly the developer-datatype semantics we want)
const TYPE_ALIASES: Record<string, string> = {
  string: 'string',
  number: 'number',
  boolean: 'bool',
  date: 'date',
  array: 'array',
  object: 'object',
  null: 'null'
};

const MAX_CONDITIONS = 32;
const MAX_GROUP_DEPTH = 3;
const MAX_IN_VALUES = 50;
const MAX_FIELD_PATH_CHARS = 128;
const MAX_FIELD_DEPTH = 6;
const MAX_STRING_VALUE_CHARS = 512;
const MAX_TEXT_QUERY_CHARS = 200;
const MAX_SEARCH_LIMIT = 50;
const DEFAULT_SEARCH_LIMIT = 20;
// ranked text results page by offset within a bounded window (mirrors the
// ranked feed's determinism trade-off)
const MAX_RANKED_OFFSET = 500;
// match counts are a UX nicety, never worth a collection scan hanging a request
const COUNT_LIMIT = 1000;
const COUNT_MAX_TIME_MS = 2000;

// Root fields searchable by name; anything else lives under crystal (bare
// names like "legs" auto-prefix to crystal.legs so the GUI can stay simple).
const ROOT_FIELDS = new Set(['tags', 'thingtime', 'createdAt', 'updatedAt', 'shareId', 'targetId']);
const DATE_FIELDS = new Set(['createdAt', 'updatedAt']);
// the same grammar data-crystal keys are stored under — a storable key is
// always a searchable key (single source: schemas/registry.ts)
const FIELD_SEGMENT = KEY_SEGMENT_PATTERN;

export type SearchCondition = {
  field?: unknown;
  op?: unknown;
  value?: unknown;
  values?: unknown;
};

export type SearchGroup = {
  mode?: unknown; // 'all' (default) | 'any'
  conditions?: unknown;
};

export type SearchQuery = {
  q?: unknown;
  mode?: unknown;
  conditions?: unknown;
  thingtime?: unknown;
  tags?: unknown;
  from?: unknown;
  to?: unknown;
  sort?: unknown; // 'relevance' (default with q) | 'newest' (default without) | 'oldest'
  cursor?: unknown;
  limit?: unknown;
};

export type SearchResult = {
  ok: true;
  things: PublicThing[];
  // post projections for result things that are posts, keyed by thing id, so
  // the UI can render full post cards without a second round-trip
  posts: Record<string, PublicPost>;
  nextCursor: string | null;
  // capped count of matching docs (null when the count timed out)
  total: number | null;
  totalCapped: boolean;
  ranked: boolean;
};

const sanitizeFieldPath = (raw: unknown): string | Fail => {
  if (typeof raw !== 'string') return fail(400, 'Each condition needs a field');
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_FIELD_PATH_CHARS) {
    return fail(400, 'Condition fields must be short non-empty paths');
  }
  if (ROOT_FIELDS.has(trimmed)) return trimmed;

  const path = trimmed.startsWith('crystal.') ? trimmed.slice('crystal.'.length) : trimmed;
  const segments = path.split('.');
  if (!segments.length || segments.length > MAX_FIELD_DEPTH) {
    return fail(400, `Condition fields can nest at most ${MAX_FIELD_DEPTH} levels`);
  }
  for (const segment of segments) {
    if (!FIELD_SEGMENT.test(segment)) {
      return fail(
        400,
        `Condition field segments are letters/numbers/_/- separated by dots (got ${trimmed.slice(0, 80)})`
      );
    }
  }
  return `crystal.${segments.join('.')}`;
};

type Scalar = string | number | boolean | null | Date;

// Bounded primitives only. Objects/arrays are rejected here — that's the rule
// that makes operator injection ({ $where: ... } as a "value") impossible.
const sanitizeScalar = (field: string, value: unknown): Scalar | Fail => {
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return fail(400, 'Condition numbers must be finite');
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_STRING_VALUE_CHARS) {
      return fail(400, `Condition values can be at most ${MAX_STRING_VALUE_CHARS} characters`);
    }
    if (DATE_FIELDS.has(field)) {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return fail(400, `${field} conditions need a valid date`);
      return date;
    }
    return value;
  }
  return fail(400, 'Condition values must be strings, numbers, booleans, or null');
};

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// gt/gte/lt/lte/between operands: ordered scalars only
const sanitizeOrdered = (field: string, op: string, value: unknown): string | number | Date | Fail => {
  const scalar = sanitizeScalar(field, value);
  if (isFail(scalar)) return scalar;
  if (scalar === null || typeof scalar === 'boolean') {
    return fail(400, `${op} conditions need a number, text, or date value (field ${field})`);
  }
  return scalar;
};

const buildCondition = (input: SearchCondition): Record<string, any> | Fail => {
  const field = sanitizeFieldPath(input.field);
  if (isFail(field)) return field;

  const op = typeof input.op === 'string' && input.op.trim() ? (input.op.trim() as string) : 'eq';
  if (!SEARCH_OPERATORS.includes(op as SearchOperator)) {
    return fail(400, `Unknown search operator: ${op.slice(0, 40)} (use ${SEARCH_OPERATORS.join(', ')})`);
  }

  switch (op as SearchOperator) {
    case 'eq':
    case 'ne': {
      const value = sanitizeScalar(field, input.value);
      if (isFail(value)) return value;
      return { [field]: { [op === 'eq' ? '$eq' : '$ne']: value } };
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const value = sanitizeOrdered(field, op, input.value);
      if (isFail(value)) return value;
      return { [field]: { [`$${op}`]: value } };
    }
    case 'between': {
      // one atomic range condition — values: [low, high] (either end may be
      // null/undefined for open-ended ranges, but not both)
      const raw = Array.isArray(input.values) ? input.values : [input.value, (input as any).value2];
      const [lowRaw, highRaw] = raw;
      const range: Record<string, any> = {};
      if (lowRaw !== undefined && lowRaw !== null && lowRaw !== '') {
        const low = sanitizeOrdered(field, op, lowRaw);
        if (isFail(low)) return low;
        range.$gte = low;
      }
      if (highRaw !== undefined && highRaw !== null && highRaw !== '') {
        const high = sanitizeOrdered(field, op, highRaw);
        if (isFail(high)) return high;
        range.$lte = high;
      }
      if (!Object.keys(range).length) return fail(400, `between conditions need a low and/or high value (field ${field})`);
      return { [field]: range };
    }
    case 'in':
    case 'nin': {
      const raw = Array.isArray(input.values) ? input.values : Array.isArray(input.value) ? input.value : null;
      if (!raw || !raw.length) return fail(400, `${op} conditions need a values list (field ${field})`);
      if (raw.length > MAX_IN_VALUES) {
        return fail(400, `${op} conditions can list at most ${MAX_IN_VALUES} values`);
      }
      const values: Scalar[] = [];
      for (const entry of raw) {
        const value = sanitizeScalar(field, entry);
        if (isFail(value)) return value;
        values.push(value);
      }
      return { [field]: { [op === 'in' ? '$in' : '$nin']: values } };
    }
    case 'exists': {
      const wanted = input.value === undefined ? true : input.value === true || input.value === 'true';
      return { [field]: { $exists: wanted } };
    }
    case 'type': {
      const alias = typeof input.value === 'string' ? TYPE_ALIASES[input.value.trim()] : undefined;
      if (!alias) {
        return fail(400, `type conditions need one of: ${Object.keys(TYPE_ALIASES).join(', ')} (field ${field})`);
      }
      return { [field]: { $type: alias } };
    }
    case 'contains':
    case 'startsWith':
    case 'endsWith': {
      const value = sanitizeScalar(field, input.value);
      if (isFail(value)) return value;
      if (typeof value !== 'string' || !value.length) {
        return fail(400, `${op} conditions need a text value (field ${field})`);
      }
      const literal = escapeRegExp(value);
      const pattern = op === 'startsWith' ? `^${literal}` : op === 'endsWith' ? `${literal}$` : literal;
      return { [field]: { $regex: pattern, $options: 'i' } };
    }
  }
};

const isGroup = (entry: any): entry is SearchGroup =>
  !!entry && typeof entry === 'object' && Array.isArray(entry.conditions);

const buildGroup = (group: SearchGroup, depth: number, counter: { total: number }): Record<string, any> | Fail => {
  if (depth > MAX_GROUP_DEPTH) return fail(400, `Condition groups can nest at most ${MAX_GROUP_DEPTH} levels`);
  const entries = Array.isArray(group.conditions) ? group.conditions : [];
  if (!entries.length) return fail(400, 'Condition groups need at least one condition');

  const built: Record<string, any>[] = [];
  for (const entry of entries) {
    counter.total += 1;
    if (counter.total > MAX_CONDITIONS) {
      return fail(400, `Searches can have at most ${MAX_CONDITIONS} conditions`);
    }
    const clause = isGroup(entry) ? buildGroup(entry, depth + 1, counter) : buildCondition(entry as SearchCondition);
    if (isFail(clause)) return clause;
    built.push(clause);
  }

  if (built.length === 1) return built[0];
  return group.mode === 'any' ? { $or: built } : { $and: built };
};

const csvList = (value: unknown, max = 20): string[] => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    if (out.length >= max) break;
  }
  return out;
};

const parseDate = (value: unknown): Date | null | Fail => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail(400, 'Invalid date') : value;
  if (typeof value !== 'string' && typeof value !== 'number') return fail(400, 'Dates must be ISO strings');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fail(400, 'Invalid date') : date;
};

export const searchThings = async (viewerInput: string | Viewer, query: SearchQuery): Promise<Fail | SearchResult> => {
  const viewer = asViewer(viewerInput);
  const limit = Math.min(Math.max(1, Number(query.limit) || DEFAULT_SEARCH_LIMIT), MAX_SEARCH_LIMIT);

  const q = typeof query.q === 'string' ? query.q.trim().slice(0, MAX_TEXT_QUERY_CHARS) : '';
  const sort =
    query.sort === 'newest' || query.sort === 'oldest' || query.sort === 'relevance'
      ? query.sort
      : q
        ? 'relevance'
        : 'newest';
  if (sort === 'relevance' && !q) return fail(400, 'Relevance sorting needs a text query (q)');

  const clauses: Record<string, any>[] = [];

  if (query.conditions !== undefined && query.conditions !== null) {
    if (!Array.isArray(query.conditions)) return fail(400, 'conditions must be a list');
    if (query.conditions.length) {
      const group = buildGroup(
        { mode: query.mode === 'any' ? 'any' : 'all', conditions: query.conditions },
        1,
        { total: 0 }
      );
      if (isFail(group)) return group;
      clauses.push(group);
    }
  }

  const thingtime = csvList(query.thingtime);
  if (thingtime.length) {
    // v1 posts have no thingtime array — a 'post' filter must match them too
    clauses.push(
      thingtime.includes('post')
        ? { $or: [{ thingtime: { $in: thingtime } }, { kind: 'post' }] }
        : { thingtime: { $in: thingtime } }
    );
  }

  const tags = csvList(query.tags).map((tag) => tag.toLowerCase());
  if (tags.length) clauses.push({ tags: { $in: tags } });

  const from = parseDate(query.from);
  if (isFail(from)) return from;
  const to = parseDate(query.to);
  if (isFail(to)) return to;
  if (from || to) {
    const range: Record<string, Date> = {};
    if (from) range.$gte = from;
    if (to) range.$lte = to;
    clauses.push({ createdAt: range });
  }

  // Same audience model as the feed: the DB match is a superset (public things
  // + the viewer's own), the exact acl verdict happens per doc below. Things
  // carrying ['tt:inherit'] (comments/reactions) only surface for their owner —
  // matching listThings, attached things aren't independently discoverable.
  const visibility = visibilityQueryFor(viewer, []);
  if (!visibility) return { ok: true, things: [], posts: {}, nextCursor: null, total: 0, totalCapped: false, ranked: false };

  const baseMatch = withMatch(visibility, ...clauses);
  const ranked = sort === 'relevance';
  // $text must sit in a top-level $and (withMatch provides exactly that)
  const textClause = q ? { $text: { $search: q } } : null;
  const match = textClause ? withMatch(textClause, visibility, ...clauses) : baseMatch;

  await ensureIndexes();
  const things = await getThingsCollection();

  const fetchPage = async (): Promise<{ docs: ThingDoc[]; nextCursor: string | null }> => {
    if (ranked) {
      const offset = Math.min(Math.max(0, Number(query.cursor) || 0), MAX_RANKED_OFFSET);
      const docs = (await things
        .find(match as any, { projection: { score: { $meta: 'textScore' } } } as any)
        .sort({ score: { $meta: 'textScore' }, createdAt: -1, shareId: 1 } as any)
        .skip(offset)
        .limit(limit + 1)
        .toArray()) as any as ThingDoc[];
      // the clamp allows offsets up to and including MAX_RANKED_OFFSET
      const nextOffset = offset + limit;
      return { docs, nextCursor: docs.length > limit && nextOffset <= MAX_RANKED_OFFSET ? String(nextOffset) : null };
    }
    const parsed = parseChronoCursor(typeof query.cursor === 'string' ? query.cursor : null);
    const cursorClause = parsed ? (sort === 'oldest' ? oldestCursorClause(parsed) : chronoCursorClause(parsed)) : null;
    const pageMatch = cursorClause ? withMatch(match, cursorClause) : match;
    const docs = (await things
      .find(pageMatch as any)
      .sort(sort === 'oldest' ? { createdAt: 1, shareId: 1 } : { createdAt: -1, shareId: 1 })
      .limit(limit + 1)
      .toArray()) as any as ThingDoc[];
    const last = docs.slice(0, limit)[Math.min(docs.length, limit) - 1];
    return {
      docs,
      nextCursor: docs.length > limit && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null
    };
  };

  // Capped count for the "N things match" readout — only on the FIRST page
  // (load-more keeps the total it already has), concurrent with the page find,
  // and approximate by design: it counts the DB visibility superset, so
  // circle-restricted docs the exact acl pass rejects may be included.
  const fetchTotal = async (): Promise<{ total: number | null; totalCapped: boolean }> => {
    if (query.cursor) return { total: null, totalCapped: false };
    try {
      const count = await things.countDocuments(match as any, { limit: COUNT_LIMIT + 1, maxTimeMS: COUNT_MAX_TIME_MS });
      return count > COUNT_LIMIT ? { total: COUNT_LIMIT, totalCapped: true } : { total: count, totalCapped: false };
    } catch {
      return { total: null, totalCapped: false };
    }
  };

  const [{ docs, nextCursor }, { total, totalCapped }] = await Promise.all([fetchPage(), fetchTotal()]);
  const page = docs.slice(0, limit);

  // exact acl evaluation — the DB match is only a superset; the cursor advances
  // over the raw page so filtered docs are skipped, not resurfaced. Verdicts
  // resolve concurrently (inherit chains each cost lookups).
  const verdicts = await Promise.all(page.map((doc) => canViewInherited(doc, viewer)));
  const visible = page.filter((_, index) => verdicts[index]);

  const publicThings = await toPublicThings(visible, viewer);
  const postDocs = visible.filter((doc) => isPostThing(doc));
  const postProjections = postDocs.length ? await toPublicPosts(postDocs, viewer) : [];
  const posts: Record<string, PublicPost> = {};
  for (const post of postProjections) posts[post.id] = post;

  return { ok: true, things: publicThings, posts, nextCursor, total, totalCapped, ranked };
};
