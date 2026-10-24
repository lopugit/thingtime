import { KEY_SEGMENT_PATTERN, PROTECTED_THINGTIME, SEARCHABLE_ROOT_FIELDS, SEARCH_DATATYPES } from '~/schemas/registry';
import { emojiTokensForSearchTerm } from './emojiSearch';
type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });
const isFail = (value: unknown): value is Fail => !!value && typeof value === 'object' && (value as Fail).ok === false;
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Shared, bounded structured-search grammar. The server adds its authoritative
// visibility/owner predicates; device search only sees a leased local snapshot.
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
// double/decimal, which is exactly the developer-datatype semantics we want).
// Keys are the shared SEARCH_DATATYPES (registry) so server + client never drift;
// only 'boolean' remaps (→ 'bool'), the rest are identity.
const TYPE_ALIASES: Record<string, string> = Object.fromEntries(
  SEARCH_DATATYPES.map((name) => [name, name === 'boolean' ? 'bool' : name])
);

export const MAX_CONDITIONS = 32;
export const MAX_GROUP_DEPTH = 3;
const MAX_IN_VALUES = 50;
const MAX_FIELD_PATH_CHARS = 128;
const MAX_FIELD_DEPTH = 6;
const MAX_STRING_VALUE_CHARS = 512;
export const MAX_TEXT_QUERY_CHARS = 200;
export const MAX_SEARCH_LIMIT = 50;
export const DEFAULT_SEARCH_LIMIT = 20;
// ranked text results page by offset within a bounded window (mirrors the
// ranked feed's determinism trade-off)
export const MAX_RANKED_OFFSET = 500;
// match-count ceiling + timeout live in ../mongodb/cappedTotal (fetchCappedTotal),
// shared with the schema browser so /search and /schemas can't drift.
// Engagement filters (min reactions/comments) can't be expressed as an indexed
// match — counts live in child things (FUNDAMENTALS §3), so we score a bounded
// window of the newest/best-matching candidates and page within it by offset.
// Same determinism trade-off as the ranked feed's RANKED_CANDIDATE_WINDOW.
export const ENGAGEMENT_CANDIDATE_WINDOW = 400;
export const MAX_AUTHOR_CHARS = 64;
// Attachments are level-one things and intentionally participate in generic
// search. Other protected system kinds retain their existing exclusion.
export const GENERIC_SEARCH_EXCLUDED_THINGTIME = PROTECTED_THINGTIME.filter((kind) => kind !== 'attachment');

// Root fields searchable by name; anything else lives under crystal (bare
// names like "legs" auto-prefix to crystal.legs so the GUI can stay simple).
// Sourced from the shared registry list so the client suggestions can't drift.
const ROOT_FIELDS = new Set<string>(SEARCHABLE_ROOT_FIELDS);
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
  scope?: unknown; // 'visible' (default) | 'mine'; mine still preserves all access fences
  near?: unknown;
  radiusKm?: unknown;
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
  // shortcut filters (the feed/profile Advanced panel): all optional, all
  // compiled server-side into the same safe machinery as everything above
  types?: unknown; // post types (csv), era-aware via typeClause
  circles?: unknown; // audience circles (csv), narrows visibilityQueryFor
  author?: unknown; // a username — resolved to ownerId (unknown user = empty result)
  minTextChars?: unknown; // text length bounds ($strLenCP over both text eras)
  maxTextChars?: unknown;
  minReactions?: unknown; // engagement thresholds — bounded-window mode (see below)
  minComments?: unknown;
};

/** The owner comes from the authenticated actor, never a request field.
 * This predicate narrows the normal visibility/app/PAT fences; it cannot grant access. */
export function searchOwnerScope(scope: unknown, viewerId?: string | null): { ownerId?: string } | Fail {
  if (scope === undefined || scope === 'visible') return {};
  if (scope !== 'mine') return fail(400, 'Search scope must be visible or mine');
  if (!viewerId) return fail(401, 'Sign in to search your account Things');
  return { ownerId: viewerId };
}

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
  // Non-object entries reach here from buildGroup's isGroup() dispatch: strings
  // and numbers fall through to sanitizeFieldPath(undefined) and 400 on their
  // own, but null/undefined would throw on the .field read and escape the route
  // as a 500 instead. Reject every non-object shape up front.
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return fail(400, 'Each condition must be an object');
  }
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
      const name = typeof input.value === 'string' ? input.value.trim() : '';
      const alias = Object.prototype.hasOwnProperty.call(TYPE_ALIASES, name) ? TYPE_ALIASES[name] : undefined;
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
      const literal = escapeRegex(value);
      const pattern = op === 'startsWith' ? `^${literal}` : op === 'endsWith' ? `${literal}$` : literal;
      if (field === 'crystal.emoji' && op === 'contains') {
        const namedTokens = emojiTokensForSearchTerm(value);
        if (namedTokens.length) {
          return {
            $or: [
              { [field]: { $regex: pattern, $options: 'i' } },
              { [field]: { $in: namedTokens } }
            ]
          };
        }
      }
      return { [field]: { $regex: pattern, $options: 'i' } };
    }
  }
};

const isGroup = (entry: any): entry is SearchGroup =>
  !!entry && typeof entry === 'object' && Array.isArray(entry.conditions);

export const buildGroup = (group: SearchGroup, depth: number, counter: { total: number }): Record<string, any> | Fail => {
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

export const csvList = (value: unknown, max = 20): string[] => {
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

export const parseDate = (value: unknown): Date | null | Fail => {
  if (value === undefined || value === null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? fail(400, 'Invalid date') : value;
  if (typeof value !== 'string' && typeof value !== 'number') return fail(400, 'Dates must be ISO strings');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fail(400, 'Invalid date') : date;
};

// shortcut-filter numbers: absent/empty means "no bound", anything else must be
// a finite non-negative number (floored, sanity-capped)
export const parseCount = (value: unknown, label: string, max: number): number | null | Fail => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fail(400, `${label} must be a non-negative number`);
  return Math.min(Math.floor(num), max);
};

// Text length over both eras (v2 crystal.text / v1 root text), string-guarded
// so a data crystal carrying a non-string `text` can't blow up $strLenCP.
export const textLengthExpr = () => {
  const value = { $ifNull: ['$crystal.text', { $ifNull: ['$text', ''] }] };
  return { $strLenCP: { $cond: [{ $eq: [{ $type: value }, 'string'] }, value, ''] } };
};
