import { escapeRegex, findUserByUsername } from '../auth/users';
import { getThingsCollection } from '../mongodb/collections';
import { fetchCappedTotal } from '../mongodb/cappedTotal';
import {
  ACL_INHERIT,
  KEY_SEGMENT_PATTERN,
  MAX_TEXT_CHARS,
  PROTECTED_THINGTIME,
  SEARCHABLE_ROOT_FIELDS,
  SEARCH_DATATYPES
} from '~/schemas/registry';
import {
  POST_TYPES,
  REQUESTABLE_VISIBILITIES,
  appMatchClauses,
  appShapeProjections,
  appVisiblePage,
  asViewer,
  batchedThingLookup,
  canViewInherited,
  chronoCursorClause,
  fail,
  isFail,
  isPostThing,
  oldestCursorClause,
  parseChronoCursor,
  thingtimeInClause,
  toPublicPosts,
  toPublicThings,
  typeClause,
  visibilityQueryFor,
  withMatch,
  type AppLens,
  type Fail,
  type PostType,
  type PostVisibility,
  type PublicPost,
  type PublicThing,
  type ThingDoc,
  type Viewer
} from './things';
import { subspaceFeedClauses } from '../subspaces/gate';
import { attachRankScores, type RankedSearchSource } from './searchRanking';
import { emojiTokensForSearchTerm } from './emojiSearch';

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
// double/decimal, which is exactly the developer-datatype semantics we want).
// Keys are the shared SEARCH_DATATYPES (registry) so server + client never drift;
// only 'boolean' remaps (→ 'bool'), the rest are identity.
const TYPE_ALIASES: Record<string, string> = Object.fromEntries(
  SEARCH_DATATYPES.map((name) => [name, name === 'boolean' ? 'bool' : name])
);

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
// match-count ceiling + timeout live in ../mongodb/cappedTotal (fetchCappedTotal),
// shared with the schema browser so /search and /schemas can't drift.
// Engagement filters (min reactions/comments) can't be expressed as an indexed
// match — counts live in child things (FUNDAMENTALS §3), so we score a bounded
// window of the newest/best-matching candidates and page within it by offset.
// Same determinism trade-off as the ranked feed's RANKED_CANDIDATE_WINDOW.
const ENGAGEMENT_CANDIDATE_WINDOW = 400;
const MAX_AUTHOR_CHARS = 64;
// Attachments are level-one things and intentionally participate in generic
// search. Other protected system kinds retain their existing exclusion.
const GENERIC_SEARCH_EXCLUDED_THINGTIME = PROTECTED_THINGTIME.filter((kind) => kind !== 'attachment');

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

export type SearchResult = {
  ok: true;
  things: Array<PublicThing & { rankScore?: number }>;
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

// shortcut-filter numbers: absent/empty means "no bound", anything else must be
// a finite non-negative number (floored, sanity-capped)
const parseCount = (value: unknown, label: string, max: number): number | null | Fail => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return fail(400, `${label} must be a non-negative number`);
  return Math.min(Math.floor(num), max);
};

// Text length over both eras (v2 crystal.text / v1 root text), string-guarded
// so a data crystal carrying a non-string `text` can't blow up $strLenCP.
const textLengthExpr = () => {
  const value = { $ifNull: ['$crystal.text', { $ifNull: ['$text', ''] }] };
  return { $strLenCP: { $cond: [{ $eq: [{ $type: value }, 'string'] }, value, ''] } };
};

// Exact per-doc ACL projection for one page of search results: keep only the
// docs the viewer may actually see (the DB match is a superset — canViewInherited
// is the authoritative check), then project the public thing + post shapes. This
// is the shared tail of BOTH paging paths (engagement window + chrono/ranked), so
// a visibility fix can never accidentally patch one branch and leak from the other.
const projectVisiblePage = async (
  page: ThingDoc[],
  viewer: Viewer,
  app: AppLens = null
): Promise<{ things: Array<PublicThing & { rankScore?: number }>; posts: Record<string, PublicPost> }> => {
  // App lens: namespace verdict + author-liveness batch replace the acl walk,
  // authors/acl are consent-shaped, and the PublicPost projection (scope-blind
  // child aggregation) never rides an app response — generic things only.
  if (app) {
    const visible = await appVisiblePage(app, page);
    const things = await toPublicThings(visible, viewer);
    await appShapeProjections(app, visible, things);
    return { things: attachRankScores(things, visible as RankedSearchSource[]), posts: {} };
  }
  // One shared batched lookup for the whole page, matching listThings: a page
  // of attached things (comments, reactions, shares — anything carrying
  // tt:inherit) then costs one round trip per chain LEVEL instead of one per
  // doc. Unbatched, a 50-result page of depth-1 comments issued 50 findOnes
  // against a 10-connection pool, draining as 5 serial pool waves.
  const lookup = batchedThingLookup();
  const verdicts = await Promise.all(page.map((doc) => canViewInherited(doc, viewer, lookup)));
  const visible = page.filter((_, index) => verdicts[index]);
  const things = await toPublicThings(visible, viewer);
  const postDocs = visible.filter((doc) => isPostThing(doc));
  const reactionTargets = await Promise.all(
    visible.map(async (doc) =>
      Array.isArray(doc.thingtime) && doc.thingtime.includes('reaction') && typeof doc.targetId === 'string'
        ? lookup(doc.targetId)
        : null
    )
  );
  const targetPosts = reactionTargets.filter((doc): doc is ThingDoc => !!doc && isPostThing(doc));
  const uniquePostDocs = [...new Map([...postDocs, ...targetPosts].map((doc) => [doc.shareId, doc])).values()];
  const postProjections = uniquePostDocs.length ? await toPublicPosts(uniquePostDocs, viewer) : [];
  const posts: Record<string, PublicPost> = {};
  for (const post of postProjections) posts[post.id] = post;
  visible.forEach((doc, index) => {
    const target = reactionTargets[index];
    if (target && posts[target.shareId]) posts[doc.shareId] = posts[target.shareId];
  });
  return { things: attachRankScores(things, visible as RankedSearchSource[]), posts };
};

export const searchThings = async (
  viewerInput: string | Viewer,
  query: SearchQuery,
  app: AppLens = null
): Promise<Fail | SearchResult> => {
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
    clauses.push(thingtimeInClause(thingtime));
  }

  // Protected system kinds are NOT discoverable through the generic search:
  // user things are public but belong on the dedicated /api/v1/users/search
  // (which caps + requires a query, so this endpoint can't be a bulk directory
  // scrape / account-existence + user-count oracle); theme/feed-algorithm/
  // waitlist things are owner-private and never meant to be searched. schema
  // things stay searchable — the schema browser relies on it.
  clauses.push({ thingtime: { $nin: GENERIC_SEARCH_EXCLUDED_THINGTIME } });

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

  // -- shortcut filters (feed/profile Advanced panel) -----------------------

  const emptyResult: SearchResult = { ok: true, things: [], posts: {}, nextCursor: null, total: 0, totalCapped: false, ranked: false };

  // post types, era-aware (v2 crystal.type / v1 root type)
  const types = csvList(query.types).filter((entry): entry is PostType => POST_TYPES.includes(entry as PostType));
  if (types.length) clauses.push(typeClause(types));

  // audience circles narrow the visibility superset below — validate against
  // the REQUESTABLE set so 'hidden' survives (a dropped circle silently reads
  // as "no circle filter", which widens rather than narrows)
  const circles = csvList(query.circles).filter((entry): entry is PostVisibility =>
    REQUESTABLE_VISIBILITIES.includes(entry as PostVisibility)
  );

  // author: one username → ownerId. An unknown username matches nothing —
  // that's an empty result, not an error (filters are exploratory). Dual-era:
  // findUserByUsername resolves user things first, legacy users second, and
  // its adapter's _id IS the ownerId posts carry in either era.
  if (query.author !== undefined && query.author !== null && query.author !== '') {
    if (typeof query.author !== 'string' || query.author.trim().length > MAX_AUTHOR_CHARS) {
      return fail(400, 'author must be a username');
    }
    const authorDoc = await findUserByUsername(query.author.trim());
    if (!authorDoc) return emptyResult;
    clauses.push({ ownerId: String(authorDoc._id) });
  }

  // text length bounds — $expr per matched doc, same cost class as the
  // grammar's regex operators
  const minTextChars = parseCount(query.minTextChars, 'minTextChars', MAX_TEXT_CHARS);
  if (isFail(minTextChars)) return minTextChars;
  const maxTextChars = parseCount(query.maxTextChars, 'maxTextChars', MAX_TEXT_CHARS);
  if (isFail(maxTextChars)) return maxTextChars;
  if (minTextChars !== null || maxTextChars !== null) {
    // $let binds the length once so $strLenCP runs a single time per doc even
    // when both bounds are set
    const bounds: Record<string, any>[] = [];
    if (minTextChars !== null) bounds.push({ $gte: ['$$textLen', minTextChars] });
    if (maxTextChars !== null) bounds.push({ $lte: ['$$textLen', maxTextChars] });
    clauses.push({
      $expr: {
        $let: {
          vars: { textLen: textLengthExpr() },
          in: bounds.length === 1 ? bounds[0] : { $and: bounds }
        }
      }
    });
  }

  const minReactions = parseCount(query.minReactions, 'minReactions', 1_000_000);
  if (isFail(minReactions)) return minReactions;
  const minComments = parseCount(query.minComments, 'minComments', 1_000_000);
  if (isFail(minComments)) return minComments;
  const engagement = minReactions !== null || minComments !== null;

  // Same audience model as the feed: the DB match is a superset (public things
  // + the viewer's own), the exact acl verdict happens per doc below. Things
  // carrying ['tt:inherit'] (comments/reactions) only surface for their owner —
  // matching listThings, attached things aren't independently discoverable.
  // Under the app lens the audience superset IS the namespace conjunction —
  // server-injected, never expressible from the client grammar (appId/acl stay
  // out of SEARCHABLE_ROOT_FIELDS).
  const directVisibility = app ? withMatch({}, ...appMatchClauses(app)) : visibilityQueryFor(viewer, circles);
  // Inherited children (notably reactions) need their parent ACL evaluated by
  // canViewInherited below; include them in this coarse DB-level superset.
  const visibility =
    !app && directVisibility && circles.length === 0
      ? { $or: [directVisibility, { acl: ACL_INHERIT }] }
      : directVisibility;
  if (!visibility) return emptyResult;

  // subspace fences (removed / private-subspace posts) — same clauses the feeds use
  const baseMatch = withMatch(visibility, ...clauses, ...subspaceFeedClauses(viewer));
  const ranked = sort === 'relevance';

  // A cursor is minted for one paging mode and is meaningless in another: offset
  // modes (engagement filters, relevance ranking) mint a plain integer offset,
  // chrono modes mint `${ms}_${shareId}`. Silently coercing across modes —
  // Number(chronoCursor) is NaN → offset 0, or parseChronoCursor(offset) → null —
  // resurfaces page one and duplicates results once the client appends. Reject a
  // cursor that doesn't match the active mode so the client restarts cleanly.
  if (query.cursor !== undefined && query.cursor !== null && query.cursor !== '') {
    const cursorStr = typeof query.cursor === 'string' ? query.cursor : '';
    const validForMode = engagement || ranked ? /^\d+$/.test(cursorStr) : parseChronoCursor(cursorStr) !== null;
    if (!validForMode) {
      return fail(400, 'This cursor doesn’t match the current sort or filters — start a new search');
    }
  }

  // $text must sit in a top-level $and (withMatch provides exactly that)
  const textClause = q ? { $text: { $search: q } } : null;
  const match = textClause ? withMatch(textClause, visibility, ...clauses) : baseMatch;

  const things = await getThingsCollection();

  // -- engagement-window mode ------------------------------------------------
  // Reaction/comment counts are aggregated from child things at read time
  // (never stored on the parent), so they can't be part of the indexed match.
  // Instead: take a bounded window of the newest (or best-matching) candidates,
  // batch-count their children (one $group per era — never N+1), filter by the
  // thresholds, and page by offset within the filtered window. Counts sum raw
  // docs across eras (embedded residue + interim kind docs + v2 things) with
  // NO (user, token) dedup, unlike the cards' mergedReactionsOf — so a post
  // holding the same reaction in two era representations can over-count a
  // filter verdict until the things v1→v2 admin migration collapses the
  // residue. Exact dedup would mean shipping every (owner, token) pair for up
  // to 400 posts over the wire; a threshold heuristic doesn't justify that.
  if (engagement) {
    const offset = Math.min(Math.max(0, Number(query.cursor) || 0), ENGAGEMENT_CANDIDATE_WINDOW);
    const windowSort = ranked
      ? { score: { $meta: 'textScore' }, createdAt: -1, shareId: 1 }
      : sort === 'oldest'
        ? { createdAt: 1, shareId: 1 }
        : { createdAt: -1, shareId: 1 };

    const candidates = (await things
      .aggregate([
        { $match: match },
        { $sort: windowSort },
        { $limit: ENGAGEMENT_CANDIDATE_WINDOW },
        {
          $project: {
            shareId: 1,
            ...(ranked ? { score: { $meta: 'textScore' } } : {}),
            embeddedComments: { $size: { $ifNull: ['$comments', []] } },
            embeddedReactions: {
              $sum: {
                $map: {
                  input: { $objectToArray: { $ifNull: ['$reactions', {}] } },
                  as: 'entry',
                  in: { $size: { $ifNull: ['$$entry.v', []] } }
                }
              }
            }
          }
        }
      ])
      .toArray()) as any as {
        shareId: string;
        score?: number;
        embeddedComments: number;
        embeddedReactions: number;
      }[];

    const ids = candidates.map((candidate) => candidate.shareId);
    const [v2Counts, legacyCounts] = ids.length
      ? await Promise.all([
          things
            .aggregate([
              { $match: { targetId: { $in: ids }, thingtime: { $in: ['comment', 'reaction'] } } },
              {
                $group: {
                  _id: '$targetId',
                  comments: { $sum: { $cond: [{ $in: ['comment', { $ifNull: ['$thingtime', []] }] }, 1, 0] } },
                  reactions: { $sum: { $cond: [{ $in: ['reaction', { $ifNull: ['$thingtime', []] }] }, 1, 0] } }
                }
              }
            ])
            .toArray() as Promise<any[]>,
          things
            .aggregate([
              { $match: { parentId: { $in: ids }, kind: { $in: ['comment', 'reaction'] } } },
              {
                $group: {
                  _id: '$parentId',
                  comments: { $sum: { $cond: [{ $eq: ['$kind', 'comment'] }, 1, 0] } },
                  reactions: { $sum: { $cond: [{ $eq: ['$kind', 'reaction'] }, 1, 0] } }
                }
              }
            ])
            .toArray() as Promise<any[]>
        ])
      : [[], []];

    const countsById = new Map<string, { comments: number; reactions: number }>();
    const bump = (id: string, comments: number, reactions: number) => {
      const entry = countsById.get(id) || { comments: 0, reactions: 0 };
      entry.comments += comments;
      entry.reactions += reactions;
      countsById.set(id, entry);
    };
    for (const row of v2Counts) bump(String(row._id), row.comments || 0, row.reactions || 0);
    for (const row of legacyCounts) bump(String(row._id), row.comments || 0, row.reactions || 0);
    for (const candidate of candidates) bump(candidate.shareId, candidate.embeddedComments || 0, candidate.embeddedReactions || 0);

    const filtered = candidates.filter((candidate) => {
      const counts = countsById.get(candidate.shareId) || { comments: 0, reactions: 0 };
      if (minReactions !== null && counts.reactions < minReactions) return false;
      if (minComments !== null && counts.comments < minComments) return false;
      return true;
    });

    const pageIds = filtered.slice(offset, offset + limit).map((candidate) => candidate.shareId);
    const pageDocs = pageIds.length
      ? ((await things.find({ shareId: { $in: pageIds } } as any).toArray()) as any as ThingDoc[])
      : [];
    const docsById = new Map(pageDocs.map((doc) => [doc.shareId, doc]));
    const scoreById = new Map(candidates.map((candidate) => [candidate.shareId, candidate.score]));
    const page = pageIds
      .map((id) => {
        const doc = docsById.get(id);
        if (!doc) return null;
        const score = scoreById.get(id);
        return typeof score === 'number' ? ({ ...doc, score } as ThingDoc) : doc;
      })
      .filter(Boolean) as ThingDoc[];

    const { things: publicThings, posts } = await projectVisiblePage(page, viewer, app);

    return {
      ok: true,
      things: publicThings,
      posts,
      nextCursor: offset + limit < filtered.length ? String(offset + limit) : null,
      // the window bounds the count — when the window itself filled up, there
      // may be more matches beyond it
      total: filtered.length,
      totalCapped: candidates.length >= ENGAGEMENT_CANDIDATE_WINDOW,
      ranked
    };
  }

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
  // circle-restricted docs the exact acl pass rejects may be included. Shared
  // with the schema browser via fetchCappedTotal so both stay in lockstep.
  const [{ docs, nextCursor }, { total, totalCapped }] = await Promise.all([
    fetchPage(),
    fetchCappedTotal(things, match, query.cursor)
  ]);
  const page = docs.slice(0, limit);

  // exact acl evaluation — the DB match is only a superset; the cursor advances
  // over the raw page so filtered docs are skipped, not resurfaced.
  const { things: publicThings, posts } = await projectVisiblePage(page, viewer, app);

  return { ok: true, things: publicThings, posts, nextCursor, total, totalCapped, ranked };
};
